'use client';

import { manifestFor } from '@agentor/connectors';
import type { Status } from '@agentor/core';
import {
  diffDefinitions,
  parseDefinition,
  validateDefinition,
  type Finding,
  type FlowDefinition,
  type Route,
} from '@agentor/flows';
import { formatRelative } from '@agentor/i18n';
import {
  Banner,
  Button,
  EmptyState,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
  Segmented,
  toast,
} from '@agentor/ui';
import {
  ArrowLeft,
  Check,
  Code,
  List,
  Monitor,
  MoreHorizontal,
  PanelRightOpen,
  Play,
  Redo2,
  Undo2,
  Workflow,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomPanel, type BottomTab } from '@/components/editor/bottom-panel';
import { Canvas } from '@/components/editor/canvas';
import { FlowPanel, NodePanel } from '@/components/editor/flow-panel';
import { Guide } from '@/components/editor/guide';
import { Inspector, type InspectorTab } from '@/components/editor/inspector';
import { ListView } from '@/components/editor/list-view';
import {
  newNodeId,
  newRouteId,
  routeLabel,
  type ConnMap,
  type EditorConnection,
} from '@/components/editor/model';
import { Palette } from '@/components/editor/palette';
import { PublishDialog } from '@/components/editor/publish-dialog';
import {
  discardDraftAction,
  getTestRun,
  publishAction,
  releaseLockAction,
  saveDraftAction,
  startTestRun,
  type TestRunRecord,
} from './actions';

type Lookups = Record<
  string,
  Partial<Record<string, { value: string; label: string; vatCode?: string }[]>>
>;

export interface EditorProps {
  flow: { id: string; name: string; template: string | null };
  draft: { id: string; updatedAt: string } | null;
  initial: Record<string, unknown>;
  published: { number: number; definition: Record<string, unknown> } | null;
  readOnly: 'role' | 'locked' | null;
  lockedBy: string | null;
  connections: EditorConnection[];
  lookups: Lookups;
  plan: { name: string; maxDestinations: number | null; minPollMinutes: number; isOwner: boolean };
  routeStats: Record<string, { records: number; status: Status; openFailures: number }>;
  openFailures: number;
  history: {
    id: string;
    routeId: string;
    label: string;
    outcome: string;
    mode: string;
    time: string;
  }[];
  focus: { route: string | null; tab: string | null; field: string | null };
  guide: boolean;
}

function safe(raw: Record<string, unknown>): FlowDefinition {
  try {
    return parseDefinition(raw);
  } catch {
    return parseDefinition({ nodes: [], routes: [] });
  }
}

const TABS: InspectorTab[] = ['general', 'mapping', 'fields', 'filters', 'run', 'history'];

export function Editor(p: EditorProps) {
  const t = useTranslations('editor');
  const tf = useTranslations('flows');
  const locale = useLocale() as 'da' | 'en';
  const router = useRouter();
  const conns: ConnMap = useMemo(
    () => Object.fromEntries(p.connections.map((c) => [c.id, c])),
    [p.connections],
  );
  const published = useMemo(
    () => (p.published ? safe(p.published.definition) : null),
    [p.published],
  );
  const [def, setDef] = useState<FlowDefinition>(() => safe(p.initial));
  const [past, setPast] = useState<FlowDefinition[]>([]);
  const [future, setFuture] = useState<FlowDefinition[]>([]);
  const [savedDef, setSavedDef] = useState<FlowDefinition>(() => safe(p.initial));
  const [savedAt, setSavedAt] = useState<string | null>(p.draft?.updatedAt ?? null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'canvas' | 'list'>('canvas');
  // The canvas needs 1280 px (decision 15): narrower windows open in the list view, and
  // "Lærred" in the view switch shows the canvas anyway.
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 1279px)');
    const apply = () => narrow.matches && setView('list');
    apply();
    narrow.addEventListener('change', apply);
    return () => narrow.removeEventListener('change', apply);
  }, []);
  const [developer, setDeveloper] = useState(false);
  const [selected, setSelectedRoute] = useState<string | null>(p.focus.route);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const setSelected = (id: string | null) => {
    setSelectedRoute(id);
    setSelectedNode(null);
    setInspectorOpen(true);
  };
  // `]` hides the inspector down to a 48 px edge (§5.1).
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [guideOpen, setGuideOpen] = useState(p.guide);
  const [visitedRoute, setVisitedRoute] = useState(Boolean(p.focus.route));
  const [tab, setTab] = useState<InspectorTab>(
    TABS.includes(p.focus.tab as InspectorTab) ? (p.focus.tab as InspectorTab) : 'mapping',
  );
  const [focusField, setFocusField] = useState<string | null>(
    p.focus.field ? `mapping.${p.focus.field}` : null,
  );
  const [bottomTab, setBottomTab] = useState<BottomTab>('validation');
  const [bottomOpen, setBottomOpen] = useState(true);
  const [validatedAt, setValidatedAt] = useState<number>(() => Date.now());
  const [test, setTest] = useState<{
    runId: string;
    status: 'idle' | 'running' | 'done';
    records: TestRunRecord[];
  } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const readOnly = p.readOnly !== null;
  const dirty = JSON.stringify(def) !== JSON.stringify(savedDef);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const findings: Finding[] = useMemo(
    () =>
      validateDefinition(def, {
        connections: conns,
        lookups: p.lookups,
        maxDestinations: p.plan.maxDestinations,
      }),
    [def, conns, p.lookups, p.plan.maxDestinations],
  );
  const errors = findings.filter((f) => f.severity === 'error').length;
  const changes = useMemo(() => diffDefinitions(published, def), [published, def]);
  const route = def.routes.find((r) => r.id === selected) ?? null;
  const source = def.nodes.find((n) => n.role === 'source');
  const sourceConn = source ? conns[source.connectionId] : undefined;

  const commit = useCallback(
    (next: FlowDefinition) => {
      setPast((x) => [...x.slice(-49), def]);
      setFuture([]);
      setDef(next);
    },
    [def],
  );
  const updateFlow = (fn: (d: FlowDefinition) => void) => {
    if (readOnly) return;
    const next = structuredClone(def);
    fn(next);
    commit(next);
  };
  const updateRoute = (fn: (r: Route) => void) =>
    updateFlow((d) => {
      const r = d.routes.find((x) => x.id === selected);
      if (r) fn(r);
    });

  const save = useCallback(
    async (d: FlowDefinition = def) => {
      if (!p.draft || readOnly) return true;
      setSaving(true);
      const res = await saveDraftAction(p.flow.id, p.draft.id, d);
      setSaving(false);
      if (res.ok) {
        setSavedDef(d);
        setSavedAt(res.data!.savedAt);
        return true;
      }
      toast.error({
        title: t(res.error === 'LOCKED' ? 'errors.locked' : 'errors.save'),
        closeLabel: t('close'),
      });
      return false;
    },
    [def, p.draft, p.flow.id, readOnly, t],
  );

  // Autosave a moment after the last change.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty || readOnly) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [def, dirty, readOnly, save]);

  // Hand the lock back when leaving the editor. Deferred, so a remount (React's dev double
  // mount, Fast Refresh) cancels it instead of dropping the lock while the editor is open.
  const release = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const draftId = p.draft?.id;
    if (release.current) clearTimeout(release.current);
    release.current = null;
    return () => {
      if (draftId && !readOnly)
        release.current = setTimeout(() => void releaseLockAction(draftId), 0);
    };
  }, [p.draft?.id, readOnly]);

  useEffect(() => {
    if (selected) setVisitedRoute(true);
  }, [selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable], [role="combobox"]')) return;
      if (e.key === ']' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setInspectorOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Unsaved-change guard: autosave runs after 1.5 s, so this only catches a very quick exit.
  useEffect(() => {
    if (!dirty || readOnly) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty, readOnly]);

  // Poll the test run until the worker has finished it.
  useEffect(() => {
    if (!test || test.status !== 'running') return;
    const id = setInterval(async () => {
      const res = await getTestRun(test.runId);
      if (res.ok && res.data && res.data.status !== 'queued' && res.data.status !== 'running')
        setTest({ runId: test.runId, status: 'done', records: res.data.records });
    }, 700);
    return () => clearInterval(id);
  }, [test]);

  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setFuture((f) => [def, ...f]);
    setPast((x) => x.slice(0, -1));
    setDef(prev);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setPast((x) => [...x, def]);
    setFuture((f) => f.slice(1));
    setDef(next);
  };

  const runTest = async () => {
    if (!p.draft) return;
    setBottomTab('test');
    setBottomOpen(true);
    setTest({ runId: '', status: 'running', records: [] });
    const res = await startTestRun(p.flow.id, p.draft.id, def);
    if (!res.ok) {
      setTest(null);
      toast.error({ title: t('errors.test'), closeLabel: t('close') });
      return;
    }
    setSavedDef(def);
    setTest({ runId: res.data!.runId, status: 'running', records: [] });
  };

  const publish = async (opts: { invoiceMode: 'draft' | 'live' | null; retry: boolean }) => {
    if (!p.draft) return;
    const d = structuredClone(def);
    if (opts.invoiceMode)
      for (const r of d.routes)
        if (r.entity === 'order' && r.targetEntity === 'order' && r.mode !== 'test') {
          const node = d.nodes.find((n) => n.id === r.to);
          const m = node ? manifestFor(conns[node.connectionId]?.connectorId ?? '') : null;
          if (m?.category === 'erp') r.mode = opts.invoiceMode;
        }
    setPublishing(true);
    setPublishError(null);
    const res = await publishAction(p.flow.id, p.draft.id, d, { retryFailures: opts.retry });
    setPublishing(false);
    if (!res.ok) {
      setPublishError(res.error);
      return;
    }
    toast.ok({
      title: t('published', { n: res.data!.version }),
      description: res.data!.retried ? t('retrying') : undefined,
      closeLabel: t('close'),
    });
    setPublishOpen(false);
    router.push(`/integrations/${p.flow.id}`);
    router.refresh();
  };

  const goTo = (f: Finding) => {
    if (f.routeId) setSelected(f.routeId);
    if (f.path?.startsWith('mapping')) {
      setTab('mapping');
      setFocusField(f.path);
    } else if (f.path?.startsWith('templates')) {
      setTab('fields');
      setFocusField(f.path);
    } else if (f.path?.startsWith('general')) setTab('general');
  };

  const addDestination = (connectionId: string, at?: { x: number; y: number }) =>
    updateFlow((d) => {
      const c = conns[connectionId];
      if (!c) return;
      const id = newNodeId(c.connectorId, d.nodes);
      const ys = d.nodes
        .filter((n) => n.role === 'destination')
        .map((n) => (n.position?.y ?? 0) + 200);
      d.nodes.push({
        id,
        role: 'destination',
        connectionId,
        position: at ?? { x: 520, y: Math.max(0, ...ys) },
      });
    });

  const connect = (
    from: string,
    entity: Route['entity'],
    to: string,
    targetEntity: Route['entity'],
  ) =>
    updateFlow((d) => {
      const node = d.nodes.find((n) => n.id === to);
      const c = node ? conns[node.connectionId] : undefined;
      const id = newRouteId(entity, c?.connectorId ?? 'dest', d.routes);
      // New routes always start in Test (D4): nothing is written until someone chooses so.
      d.routes.push({
        id,
        from,
        to,
        entity,
        targetEntity,
        mode: 'test',
        paused: false,
        settings: {},
        mapping: {},
        categoryAccounts: [],
        filters: [],
        updateExisting: true,
        expressions: {},
        sourceOptions: {},
        tables: {},
        templates: {},
      });
      setTimeout(() => {
        setSelected(id);
        setTab(entity === 'order' ? 'mapping' : 'general');
      });
    });

  const routeStatus = (id: string): Status =>
    p.routeStats[id]?.status ?? (published ? 'ok' : 'draft');
  const statusLine = [
    published ? t('publishedV', { n: p.published!.number }) : t('neverPublished'),
    changes.length ? t('draftChanges', { count: changes.length }) : t('noChanges'),
    saving
      ? t('saving')
      : savedAt
        ? t('savedAgo', { when: formatRelative(new Date(savedAt), new Date(now), locale) })
        : null,
  ].filter(Boolean);

  const testFailed =
    test?.status === 'done' ? test.records.some((r) => r.outcome === 'failed') : null;

  const footer = (
    <>
      <span className="text-meta text-fg-2" aria-live="polite">
        {readOnly ? t('readOnly') : dirty ? t('unsaved') : t('allSaved')}
      </span>
      {!readOnly && (
        <span className="flex gap-2">
          <Button variant="secondary" size="s" disabled={!dirty} onClick={() => commit(savedDef)}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            size="s"
            disabled={!dirty}
            loading={saving}
            onClick={() => void save()}
          >
            {t('save')}
          </Button>
        </span>
      )}
    </>
  );
  const mappingErrors = findings.some(
    (f) => f.severity === 'error' && f.path?.startsWith('mapping'),
  );
  const guide =
    guideOpen && !published ? (
      <Guide
        done={{
          route: visitedRoute,
          mapping: visitedRoute && !mappingErrors,
          test: test?.status === 'done' && !testFailed,
          publish: false,
        }}
        onClose={() => setGuideOpen(false)}
      />
    ) : null;

  return (
    <>
      {/* M5-Editor: the editor needs a computer; smaller screens get a pointer back. */}
      <div className="fixed inset-x-0 bottom-0 top-editor-header z-10 flex items-center justify-center bg-bg-base px-4 md:hidden">
        <EmptyState
          icon={Monitor}
          title={t('desktopOnly.title')}
          action={
            <Button variant="secondary" size="m" asChild>
              <Link href={`/integrations/${p.flow.id}`}>{t('back')}</Link>
            </Button>
          }
        >
          {t('desktopOnly.body')}
        </EmptyState>
      </div>
      <div className="fixed inset-x-0 bottom-0 top-editor-header z-10 hidden flex-col bg-bg-base md:flex">
        <header className="flex h-editor-toolbar flex-none items-center gap-3 bg-surface px-4 shadow-hairline-y">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/integrations/${p.flow.id}`} aria-label={t('back')}>
              <Icon icon={ArrowLeft} size={18} />
            </Link>
          </Button>
          <div className="flex min-w-0 flex-col">
            <h1 className="m-0 truncate text-card">{p.flow.name}</h1>
            <p className="m-0 truncate text-meta text-fg-2">
              {statusLine.join(' · ')}
              {errors > 0 && (
                <span className="font-semibold text-error-fg">
                  {' '}
                  · {t('errorsToFix', { count: errors })}
                </span>
              )}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('undo')}
              onClick={undo}
              disabled={!past.length || readOnly}
            >
              <Icon icon={Undo2} size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('redo')}
              onClick={redo}
              disabled={!future.length || readOnly}
            >
              <Icon icon={Redo2} size={16} />
            </Button>
            <Segmented
              aria-label={t('viewLabel')}
              value={view}
              onValueChange={setView}
              options={[
                { value: 'list', label: t('list.title'), icon: <Icon icon={List} size={14} /> },
                { value: 'canvas', label: t('canvas'), icon: <Icon icon={Workflow} size={14} /> },
              ]}
            />
            <Segmented
              aria-label={t('modeLabel')}
              tone="dark"
              value={developer ? 'developer' : 'basic'}
              onValueChange={(v) => setDeveloper(v === 'developer')}
              options={[
                { value: 'basic', label: tf('basic') },
                {
                  value: 'developer',
                  label: tf('developer'),
                  icon: <Icon icon={Code} size={14} />,
                },
              ]}
            />
            {!readOnly && (
              <>
                <Button
                  variant="ghost"
                  size="m"
                  onClick={() => {
                    setValidatedAt(Date.now());
                    setBottomTab('validation');
                    setBottomOpen(true);
                  }}
                >
                  <Icon icon={Check} size={16} />
                  {t('validate')}
                </Button>
                <Button
                  variant="secondary"
                  size="m"
                  onClick={runTest}
                  loading={test?.status === 'running'}
                >
                  {test?.status !== 'running' && <Icon icon={Play} size={16} />}
                  {t('testRun')}
                </Button>
                <Button
                  variant="primary"
                  size="m"
                  disabled={errors > 0 || changes.length === 0}
                  title={errors > 0 ? t('fixFirst') : undefined}
                  onClick={async () => {
                    if (dirty) await save();
                    setPublishError(null);
                    setPublishOpen(true);
                  }}
                >
                  {t('publishButton')}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={t('menu')}>
                      <Icon icon={MoreHorizontal} size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onSelect={() => router.push(`/integrations/${p.flow.id}?tab=settings`)}
                    >
                      {t('versions')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        const blob = new Blob([JSON.stringify(def, null, 2)], {
                          type: 'application/json',
                        });
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = `${p.flow.name}.json`;
                        a.click();
                        URL.revokeObjectURL(a.href);
                      }}
                    >
                      {t('exportJson')}
                    </DropdownMenuItem>
                    {published && p.draft && (
                      <DropdownMenuItem
                        destructive
                        onSelect={async () => {
                          const res = await discardDraftAction(p.flow.id, p.draft!.id);
                          if (res.ok) router.push(`/integrations/${p.flow.id}`);
                        }}
                      >
                        {t('discard')}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </header>

        {p.readOnly && (
          <Banner tone="info" global>
            {p.readOnly === 'locked'
              ? t('lockedBy', { name: p.lockedBy ?? '' })
              : t('readOnlyRole')}
          </Banner>
        )}

        <div className="flex min-h-0 flex-1">
          <Palette
            def={def}
            connections={p.connections}
            readOnly={readOnly}
            maxDestinations={p.plan.maxDestinations}
            planName={p.plan.name}
            canSeePlans={p.plan.isOwner}
            onAdd={addDestination}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              {view === 'canvas' ? (
                <Canvas
                  def={def}
                  conns={conns}
                  findings={findings}
                  selectedRouteId={selected}
                  selectedNodeId={selectedNode}
                  running={test?.status === 'running'}
                  readOnly={readOnly}
                  onSelectRoute={(id) => {
                    setSelected(id);
                    setFocusField(null);
                  }}
                  onSelectNode={(id) => {
                    setSelectedRoute(null);
                    setSelectedNode(id);
                    setInspectorOpen(true);
                  }}
                  onConnect={connect}
                  onDropConnection={(id, x, y) => {
                    const c = conns[id];
                    // Only what the palette would add: an unused, working destination.
                    const dests = def.nodes.filter((n) => n.role === 'destination').length;
                    if (
                      !c ||
                      c.status === 'broken' ||
                      def.nodes.some((n) => n.connectionId === id) ||
                      (p.plan.maxDestinations !== null && dests >= p.plan.maxDestinations)
                    )
                      return;
                    addDestination(id, { x, y });
                  }}
                  onMoveNode={(id, x, y) =>
                    updateFlow((d) => {
                      const n = d.nodes.find((q) => q.id === id);
                      if (n) n.position = { x, y };
                    })
                  }
                />
              ) : (
                <div className="h-full overflow-y-auto">
                  <ListView
                    def={def}
                    conns={conns}
                    findings={findings}
                    selectedRouteId={selected}
                    onSelectRoute={setSelected}
                    routeStatus={routeStatus}
                  />
                </div>
              )}
            </div>
            <BottomPanel
              def={def}
              conns={conns}
              findings={findings}
              tab={bottomTab}
              setTab={setBottomTab}
              open={bottomOpen}
              setOpen={setBottomOpen}
              onGoTo={goTo}
              validatedAt={formatRelative(new Date(validatedAt), new Date(now), locale)}
              test={test}
              onRerun={runTest}
              sourceName={sourceConn?.name ?? ''}
              developer={developer}
            />
          </div>
          {!inspectorOpen ? (
            <div className="flex h-full w-12 flex-none justify-center bg-surface pt-3 shadow-hairline-l">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('openInspector')}
                onClick={() => setInspectorOpen(true)}
              >
                <Icon icon={PanelRightOpen} size={16} />
              </Button>
            </div>
          ) : route ? (
            <Inspector
              def={def}
              route={route}
              conns={conns}
              lookups={p.lookups}
              findings={findings}
              tab={tab}
              setTab={(x) => {
                setTab(x);
                setFocusField(null);
              }}
              update={updateRoute}
              updateFlow={updateFlow}
              stats={p.routeStats[route.id]}
              history={p.history.filter((h) => h.routeId === route.id)}
              developer={developer}
              readOnly={readOnly}
              focusField={focusField}
              minPollMinutes={p.plan.minPollMinutes}
              onDelete={() => {
                updateFlow((d) => void (d.routes = d.routes.filter((r) => r.id !== route.id)));
                setSelected(null);
              }}
              onClose={() => setSelected(null)}
              guide={guide}
              footer={footer}
            />
          ) : selectedNode ? (
            <NodePanel
              nodeId={selectedNode}
              def={def}
              conns={conns}
              readOnly={readOnly}
              onSelectRoute={setSelected}
              onRemove={() => {
                updateFlow((d) => {
                  d.nodes = d.nodes.filter((n) => n.id !== selectedNode);
                  d.routes = d.routes.filter((r) => r.to !== selectedNode);
                });
                setSelectedNode(null);
              }}
              onClose={() => setInspectorOpen(false)}
            />
          ) : (
            <FlowPanel
              name={p.flow.name}
              def={def}
              conns={conns}
              readOnly={readOnly}
              minPollMinutes={p.plan.minPollMinutes}
              guide={guide}
              footer={footer}
              onSelectRoute={setSelected}
              updateFlow={updateFlow}
              onClose={() => setInspectorOpen(false)}
            />
          )}
        </div>

        {publishOpen && (
          <PublishDialog
            open={publishOpen}
            onOpenChange={setPublishOpen}
            flowName={p.flow.name}
            nextVersion={(p.published?.number ?? 0) + 1}
            published={
              published && p.published
                ? { number: p.published.number, definition: published }
                : null
            }
            draft={def}
            conns={conns}
            lookups={p.lookups}
            testedClean={testFailed === null ? null : !testFailed}
            openFailures={p.openFailures}
            busy={publishing}
            error={publishError}
            onPublish={publish}
          />
        )}
        <span className="sr-only" aria-live="polite">
          {route ? t('selectedRoute', { route: routeLabel(def, conns, route) }) : ''}
        </span>
      </div>
    </>
  );
}
