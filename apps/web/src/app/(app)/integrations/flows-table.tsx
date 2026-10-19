'use client';

import type { Status } from '@agentor/core';
import { formatDate, formatNumber, formatRelative, formatTime } from '@agentor/i18n';
import {
  Button,
  Checkbox,
  ConnectorLogo,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
  ModeBadge,
  SearchInput,
  Segmented,
  StatusPill,
  Table,
  Td,
  Th,
  toast,
  Tr,
} from '@agentor/ui';
import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Code,
  MoreHorizontal,
  Pencil,
  RotateCw,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Fragment, useMemo, useState, useTransition } from 'react';
import { FilterMenu } from '@/components/filter-menu';
import { pauseFlows, resumeFlows, retryFailures, runFlowsNow, setRoutePause } from './actions';

export interface FlowTableRow {
  id: string;
  name: string;
  status: Status;
  statusSince: string | null;
  pausedByName: string | null;
  mode: 'live' | 'test' | 'draft' | 'mixed' | null;
  records: number;
  openFailures: number;
  lastRunAt: string | null;
  published: boolean;
  connectors: { id: string; connectorId: string; name: string; logo: string; status: string }[];
  brokenConnectionId: string | null;
  routes: {
    id: string;
    source: string;
    destination: string;
    status: Status;
    mode: 'live' | 'test' | 'draft';
    records: number;
    failed: number;
    openFailures: number;
    lastAt: string | null;
    pausedBy: string | null;
  }[];
}

export function FlowsTable({
  rows,
  canEdit,
  developer,
}: {
  rows: FlowTableRow[];
  canEdit: boolean;
  developer: boolean;
}) {
  const t = useTranslations('flows');
  const ts = useTranslations('status');
  const tm = useTranslations('mode');
  const tc = useTranslations('common');
  const locale = useLocale() as 'da' | 'en';
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [mode, setMode] = useState<'live' | 'test' | 'draft' | 'mixed' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(rows.filter((r) => r.status === 'error').map((r) => r.id)),
  );

  const now = new Date();
  const rel = (iso: string | null) => {
    if (!iso) return t('never');
    const d = new Date(iso);
    return now.getTime() - d.getTime() > 2 * 86_400_000
      ? formatDate(d, locale)
      : formatRelative(d, now, locale);
  };
  // "siden 14:02" today, "siden i går", otherwise the date (D2).
  const since = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (now.toDateString() === d.toDateString()) return formatTime(d, locale);
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    if (y.toDateString() === d.toDateString()) return t('yesterday');
    return formatDate(d, locale);
  };

  const connectorOptions = (role: 'source' | 'dest') => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      const list = role === 'source' ? r.connectors.slice(0, 1) : r.connectors.slice(1);
      for (const c of list) seen.set(c.connectorId, c.connectorId);
    }
    return [...seen.keys()].map((v) => ({ value: v, label: nameOf(v) }));
  };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!status || r.status === status) &&
        (!mode || r.mode === mode) &&
        (!source || r.connectors[0]?.connectorId === source) &&
        (!dest || r.connectors.slice(1).some((c) => c.connectorId === dest)) &&
        (!term ||
          r.name.toLowerCase().includes(term) ||
          r.connectors.some((c) => c.name.toLowerCase().includes(term)) ||
          r.routes.some((x) => `${x.source} ${x.destination}`.toLowerCase().includes(term))),
    );
  }, [rows, q, status, mode, source, dest]);

  const allOpen = filtered.length > 0 && filtered.every((r) => open.has(r.id));
  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const bulk = (fn: typeof pauseFlows, done: string) =>
    start(async () => {
      const res = await fn([...selected]);
      if (res.ok) {
        toast.ok({ title: t(done, { count: res.data?.done ?? 0 }), closeLabel: tc('close') });
        setSelected(new Set());
        router.refresh();
      } else toast.error({ title: t('actionFailed'), closeLabel: tc('close') });
    });

  const retry = (flowId: string, routeId?: string) =>
    start(async () => {
      const res = await retryFailures(flowId, routeId);
      if (res.ok) {
        toast.info({ title: t('retryStarted'), closeLabel: tc('close') });
        setTimeout(() => router.refresh(), 2500);
      } else toast.error({ title: t('actionFailed'), closeLabel: tc('close') });
    });

  const resumeRoute = (flowId: string, routeId: string) =>
    start(async () => {
      const res = await setRoutePause(flowId, routeId, false);
      if (res.ok) router.refresh();
      else toast.error({ title: t('actionFailed'), closeLabel: tc('close') });
    });

  const statusText = (r: FlowTableRow) => {
    if (r.status === 'error')
      return ts('since', { status: ts('error'), time: since(r.statusSince) });
    if (r.status === 'broken')
      return ts('since', { status: ts('broken'), time: since(r.statusSince) });
    if (r.status === 'draft') return `${ts('draft')} · ${t('notPublished')}`;
    return ts(r.status);
  };
  const routeStatusText = (r: FlowTableRow['routes'][number]) => {
    if (r.status === 'error') return `${ts('error')} · ${t('records', { count: r.openFailures })}`;
    if (r.status === 'info') return `${ts('info')} · ${t('writesNothing')}`;
    if (r.status === 'paused' && r.pausedBy) return t('pausedBy', { name: r.pausedBy });
    return ts(r.status);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          aria-label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-64"
        />
        <FilterMenu
          label={t('filter.status')}
          allLabel={t('filter.all')}
          value={status}
          onChange={setStatus}
          options={(['ok', 'warn', 'error', 'broken', 'paused', 'info', 'draft'] as Status[])
            .filter((s) => rows.some((r) => r.status === s))
            .map((s) => ({ value: s, label: ts(s) }))}
        />
        <FilterMenu
          label={t('filter.source')}
          allLabel={t('filter.all')}
          value={source}
          onChange={setSource}
          options={connectorOptions('source')}
        />
        <FilterMenu
          label={t('filter.destination')}
          allLabel={t('filter.all')}
          value={dest}
          onChange={setDest}
          options={connectorOptions('dest')}
        />
        <FilterMenu
          label={t('filter.mode')}
          allLabel={t('filter.all')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'live', label: tm('live') },
            { value: 'draft', label: tm('draft') },
            { value: 'test', label: tm('test') },
            { value: 'mixed', label: t('mixed') },
          ]}
        />
        <div className="ml-auto flex items-center gap-3">
          <Segmented
            aria-label={t('viewLabel')}
            tone="dark"
            value={developer ? 'developer' : 'basic'}
            onValueChange={(v) =>
              router.replace(v === 'developer' ? `${pathname}?view=developer` : pathname, {
                scroll: false,
              })
            }
            options={[
              { value: 'basic', label: t('basic') },
              { value: 'developer', label: t('developer'), icon: <Icon icon={Code} size={14} /> },
            ]}
          />
          <Button
            variant="ghost"
            size="s"
            onClick={() => setOpen(allOpen ? new Set() : new Set(filtered.map((r) => r.id)))}
          >
            <Icon icon={ChevronsUpDown} size={14} />
            {allOpen ? t('collapseAll') : t('expandAll')}
          </Button>
        </div>
      </div>

      {selected.size > 0 && canEdit && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md bg-navy px-4 py-2.5 text-on-navy on-navy"
          role="region"
          aria-label={t('bulkLabel')}
        >
          <span className="text-table font-semibold">
            {t('selected', { count: selected.size })}
          </span>
          <Button
            variant="secondary"
            size="s"
            disabled={pending}
            onClick={() => bulk(pauseFlows, 'pausedToast')}
          >
            {t('pause')}
          </Button>
          <Button
            variant="secondary"
            size="s"
            disabled={pending}
            onClick={() => bulk(resumeFlows, 'resumedToast')}
          >
            {t('resume')}
          </Button>
          <Button
            variant="secondary"
            size="s"
            disabled={pending}
            onClick={() => bulk(runFlowsNow, 'runToast')}
          >
            {t('runNow')}
          </Button>
          <Button
            variant="ghost"
            size="s"
            className="ml-auto text-on-navy"
            onClick={() => setSelected(new Set())}
          >
            {t('clearSelection')}
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-md bg-surface shadow-sm">
        <Table aria-label={t('tableLabel')}>
          <thead>
            <tr>
              <Th className="w-10">
                {canEdit && (
                  <Checkbox
                    size={16}
                    aria-label={t('selectAll')}
                    checked={
                      selected.size > 0 && selected.size === filtered.length
                        ? true
                        : selected.size > 0
                          ? 'indeterminate'
                          : false
                    }
                    onCheckedChange={(v) =>
                      setSelected(v === true ? new Set(filtered.map((r) => r.id)) : new Set())
                    }
                  />
                )}
              </Th>
              <Th className="w-8">
                <span className="sr-only">{t('expand')}</span>
              </Th>
              <Th>{t('col.flow')}</Th>
              <Th>{t('col.connections')}</Th>
              <Th>{t('col.status')}</Th>
              <Th>{t('col.mode')}</Th>
              <Th numeric>{t('col.records')}</Th>
              <Th>{t('col.lastRun')}</Th>
              <Th>
                <span className="sr-only">{t('col.actions')}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const isOpen = open.has(r.id);
              return (
                <Fragment key={r.id}>
                  <Tr interactive selected={selected.has(r.id)}>
                    <Td>
                      {canEdit && (
                        <Checkbox
                          size={16}
                          aria-label={t('selectFlow', { name: r.name })}
                          checked={selected.has(r.id)}
                          onCheckedChange={() => setSelected((s) => toggle(s, r.id))}
                        />
                      )}
                    </Td>
                    <Td className="px-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-expanded={isOpen}
                        aria-label={
                          isOpen
                            ? t('collapseFlow', { name: r.name })
                            : t('expandFlow', { name: r.name })
                        }
                        onClick={() => setOpen((s) => toggle(s, r.id))}
                      >
                        <Icon icon={isOpen ? ChevronDown : ChevronRight} size={16} />
                      </Button>
                    </Td>
                    <Td>
                      <Link
                        href={`/integrations/${r.id}`}
                        className="font-semibold text-fg-1 no-underline hover:underline"
                      >
                        {r.name}
                      </Link>
                      <span className="text-meta text-fg-2">
                        {' '}
                        · {t('routes', { count: r.routes.length })}
                      </span>
                      {developer && (
                        <span className="ml-2 font-mono text-mono text-fg-2">{r.id.slice(-8)}</span>
                      )}
                    </Td>
                    <Td>
                      <span className="flex items-center -space-x-1">
                        {r.connectors.map((c) => (
                          <ConnectorLogo
                            key={c.id}
                            size={24}
                            connector={{
                              name: `${nameOf(c.connectorId)} · ${c.name}`,
                              logoUrl: c.logo,
                            }}
                            className="ring-2 ring-white"
                          />
                        ))}
                      </span>
                    </Td>
                    <Td>
                      <StatusPill status={r.status}>{statusText(r)}</StatusPill>
                    </Td>
                    <Td>
                      {r.mode === 'mixed' ? (
                        <span className="text-table text-fg-2">{t('mixed')}</span>
                      ) : r.mode && r.published ? (
                        <ModeBadge mode={r.mode}>{tm(r.mode)}</ModeBadge>
                      ) : (
                        <span className="text-fg-2">–</span>
                      )}
                    </Td>
                    <Td numeric>{r.published ? formatNumber(r.records, locale) : '–'}</Td>
                    <Td className="text-fg-2">{r.published ? rel(r.lastRunAt) : t('never')}</Td>
                    <Td className="text-right">
                      <span className="inline-flex items-center gap-1">
                        <PrimaryAction
                          row={r}
                          canEdit={canEdit}
                          onResume={() => bulkOne(resumeFlows, r.id)}
                        />
                        <RowMenu
                          row={r}
                          canEdit={canEdit}
                          onRun={() => bulkOne(runFlowsNow, r.id)}
                          onPause={() => bulkOne(pauseFlows, r.id)}
                        />
                      </span>
                    </Td>
                  </Tr>
                  {isOpen &&
                    r.routes.map((x) => (
                      <Tr key={x.id} sub>
                        <Td sub />
                        <Td sub />
                        <Td sub className="pl-8">
                          <span className="text-table">
                            {x.source} <span className="text-fg-2">→</span> {x.destination}
                          </span>
                          {developer && (
                            <span className="ml-2 font-mono text-mono text-fg-2">{x.id}</span>
                          )}
                        </Td>
                        <Td sub />
                        <Td sub>
                          <StatusPill status={x.status} compact>
                            {routeStatusText(x)}
                          </StatusPill>
                        </Td>
                        <Td sub>
                          <ModeBadge mode={x.mode} small>
                            {tm(x.mode)}
                          </ModeBadge>
                        </Td>
                        <Td sub numeric>
                          {formatNumber(x.records, locale)}
                        </Td>
                        <Td sub className="text-fg-2">
                          {rel(x.lastAt)}
                        </Td>
                        <Td sub className="text-right">
                          {canEdit && x.openFailures > 0 && (
                            <Button
                              variant="secondary"
                              size="s"
                              disabled={pending}
                              onClick={() => retry(r.id, x.id)}
                            >
                              <Icon icon={RotateCw} size={14} />
                              {t('retry', { count: x.openFailures })}
                            </Button>
                          )}
                          {canEdit && x.status === 'paused' && x.pausedBy && (
                            <Button
                              variant="secondary"
                              size="s"
                              disabled={pending}
                              onClick={() => resumeRoute(r.id, x.id)}
                            >
                              {t('resume')}
                            </Button>
                          )}
                        </Td>
                      </Tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </Table>
        {filtered.length === 0 && (
          <p className="m-0 px-5 py-8 text-center text-fg-2">{t('noMatches')}</p>
        )}
      </div>
    </div>
  );

  function bulkOne(fn: typeof pauseFlows, id: string) {
    start(async () => {
      const res = await fn([id]);
      if (res.ok) router.refresh();
      else toast.error({ title: t('actionFailed'), closeLabel: tc('close') });
    });
  }
}

const NAMES: Record<string, string> = {
  woocommerce: 'WooCommerce',
  shopify: 'Shopify',
  dinero: 'Dinero',
  economic: 'e-conomic',
  hubspot: 'HubSpot',
  brevo: 'Brevo',
  mailchimp: 'Mailchimp',
};
const nameOf = (id: string) => NAMES[id] ?? id;

function PrimaryAction({
  row,
  canEdit,
  onResume,
}: {
  row: FlowTableRow;
  canEdit: boolean;
  onResume: () => void;
}) {
  const t = useTranslations('flows');
  if (!canEdit) return null;
  if (row.status === 'broken' && row.brokenConnectionId)
    return (
      <Button variant="dark" size="s" asChild>
        <Link href={`/connections/${row.brokenConnectionId}?reconnect=1`}>{t('reconnect')}</Link>
      </Button>
    );
  if (row.status === 'error')
    return (
      <Button variant="primary" size="s" asChild>
        <Link href={`/integrations/${row.id}/editor`}>
          <Icon icon={Pencil} size={14} />
          {t('openEditor')}
        </Link>
      </Button>
    );
  if (row.status === 'paused')
    return (
      <Button variant="secondary" size="s" onClick={onResume}>
        {t('resume')}
      </Button>
    );
  if (row.status === 'draft')
    return (
      <Button variant="secondary" size="s" asChild>
        <Link href={`/integrations/${row.id}/editor`}>{t('continueSetup')}</Link>
      </Button>
    );
  return null;
}

function RowMenu({
  row,
  canEdit,
  onRun,
  onPause,
}: {
  row: FlowTableRow;
  canEdit: boolean;
  onRun: () => void;
  onPause: () => void;
}) {
  const t = useTranslations('flows');
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('moreFor', { name: row.name })}>
          <Icon icon={MoreHorizontal} size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => router.push(`/integrations/${row.id}`)}>
          {t('open')}
        </DropdownMenuItem>
        {canEdit && (
          <DropdownMenuItem onSelect={() => router.push(`/integrations/${row.id}/editor`)}>
            {t('openEditor')}
          </DropdownMenuItem>
        )}
        {canEdit && row.published && row.status !== 'paused' && (
          <>
            <DropdownMenuItem onSelect={onRun}>{t('runNow')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={onPause}>{t('pause')}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
