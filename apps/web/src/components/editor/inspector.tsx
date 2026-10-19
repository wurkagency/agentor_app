'use client';

import type { Status } from '@agentor/core';
import type { FilterRule, Finding, FlowDefinition, Route, RouteMode } from '@agentor/flows';
import {
  Advanced,
  Banner,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  Icon,
  Input,
  ModeBadge,
  Segmented,
  Select,
  StatusPill,
  Switch,
} from '@agentor/ui';
import { MoreHorizontal, PanelRightClose, Plus, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, type ReactNode } from 'react';
import { describeFilters, nodeManifest, routeLabel, type ConnMap } from './model';

export type InspectorTab = 'general' | 'mapping' | 'filters' | 'run' | 'history';
type Lookups = Record<
  string,
  Partial<Record<'accounts' | 'vatCodes' | 'templates', { value: string; label: string }[]>>
>;

export interface InspectorProps {
  def: FlowDefinition;
  route: Route;
  conns: ConnMap;
  lookups: Lookups;
  findings: Finding[];
  tab: InspectorTab;
  setTab: (t: InspectorTab) => void;
  update: (fn: (r: Route) => void) => void;
  updateFlow: (fn: (d: FlowDefinition) => void) => void;
  stats: { records: number; status: Status } | undefined;
  history: { id: string; label: string; outcome: string; mode: string; time: string }[];
  developer: boolean;
  readOnly: boolean;
  focusField: string | null;
  minPollMinutes: number;
  onDelete: () => void;
  onClose: () => void;
  footer: ReactNode;
  guide: ReactNode;
}

const FILTER_FIELDS: FilterRule['field'][] = ['total', 'status', 'country', 'customerKind'];
const FILTER_OPS: FilterRule['op'][] = ['gt', 'gte', 'lt', 'eq', 'neq'];

export function Inspector(p: InspectorProps) {
  const t = useTranslations('editor');
  const tm = useTranslations('mode');
  const ts = useTranslations('status');
  const r = p.route;
  const dst = nodeManifest(p.def, p.conns, r.to);
  const destNode = p.def.nodes.find((n) => n.id === r.to);
  const accounts = destNode ? p.lookups[destNode.connectionId]?.accounts : undefined;
  const inPort = dst?.inputs.find((x) => x.entity === r.targetEntity);
  const modes: RouteMode[] = (['test', 'draft', 'live'] as RouteMode[]).filter(
    (m) => m === 'test' || inPort?.modes?.includes(m) || (!inPort?.modes && m === 'live'),
  );
  const groups = dst?.mapping?.[r.targetEntity] ?? [];
  const settingsFields = dst?.routeSettings?.[r.targetEntity] ?? [];
  const mine = p.findings.filter((f) => f.routeId === r.id);
  const errorsAt = (path: string) => mine.find((f) => f.path === path && f.severity === 'error');
  const mappingErrors = mine.filter(
    (f) => f.severity === 'error' && f.path?.startsWith('mapping'),
  ).length;
  const ro = p.readOnly;

  useEffect(() => {
    if (!p.focusField) return;
    const el = document.getElementById(`field-${p.focusField}`);
    el?.scrollIntoView({ block: 'center' });
    el?.focus();
  }, [p.focusField, p.tab]);

  const accountOptions = (accounts ?? []).map((a) => ({
    value: a.value,
    label: (
      <span>
        <span className="font-mono text-mono">{a.value}</span> {a.label}
      </span>
    ),
  }));

  const tabs: { key: InspectorTab; label: string; dot?: boolean }[] = [
    { key: 'general', label: t('tabs.general') },
    { key: 'mapping', label: t('tabs.mapping'), dot: mappingErrors > 0 },
    { key: 'filters', label: t('tabs.filters') },
    { key: 'run', label: t('tabs.run') },
    { key: 'history', label: t('tabs.history') },
  ];

  return (
    <aside
      aria-label={t('inspectorLabel')}
      className="flex h-full w-110 flex-none flex-col bg-surface shadow-hairline-l"
    >
      <div className="flex flex-col gap-2 px-5 pb-0 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span className="eyebrow">{t('route')}</span>
            <h2 className="m-0 text-card">{routeLabel(p.def, p.conns, r)}</h2>
          </div>
          <div className="flex items-center gap-1">
            {!ro && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t('routeMenu')}>
                    <Icon icon={MoreHorizontal} size={16} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    destructive
                    icon={<Icon icon={Trash2} size={16} />}
                    onSelect={p.onDelete}
                  >
                    {t('deleteRoute')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('closeInspector')}
              onClick={p.onClose}
            >
              <Icon icon={PanelRightClose} size={16} />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-meta text-fg-2">
          <ModeBadge mode={r.mode}>{tm(r.mode)}</ModeBadge>
          {p.stats && <StatusPill status={p.stats.status}>{ts(p.stats.status)}</StatusPill>}
          {p.stats && <span>{t('recordsWeek', { count: p.stats.records })}</span>}
        </div>
        <div
          role="tablist"
          aria-label={t('inspectorTabs')}
          className="mt-2 flex gap-5 shadow-hairline-b"
        >
          {tabs.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={p.tab === x.key}
              onClick={() => p.setTab(x.key)}
              className={cn(
                'inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent px-0 pb-2.5 font-sans text-table font-semibold text-fg-2 hover:text-fg-1',
                p.tab === x.key && 'text-fg-1 shadow-tab-active',
              )}
            >
              {x.label}
              {x.dot && (
                <span className="size-1.5 rounded-full bg-error-fg" aria-label={t('hasErrors')} />
              )}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        {p.guide}
        {p.tab === 'general' && (
          <>
            <Field
              label={t('general.mode')}
              help={t(`modeHelp.${r.mode}`, { system: dst?.name ?? '' })}
              inline
            >
              {({ describedBy }) => (
                <span aria-describedby={describedBy}>
                  <Segmented
                    aria-label={t('general.mode')}
                    value={r.mode}
                    onValueChange={(v) => !ro && p.update((x) => void (x.mode = v))}
                    options={modes.map((m) => ({ value: m, label: tm(m) }))}
                  />
                </span>
              )}
            </Field>
            {r.entity === 'order' && (
              <Field label={t('general.sendWhen')} inline>
                {({ id }) => (
                  <Select
                    id={id}
                    disabled={ro}
                    value={String(r.settings['trigger.orderStatus'] ?? 'completed')}
                    onValueChange={(v) =>
                      p.update((x) => void (x.settings['trigger.orderStatus'] = v))
                    }
                    options={['completed', 'processing'].map((v) => ({
                      value: v,
                      label: t(`orderStatus.${v}`),
                    }))}
                  />
                )}
              </Field>
            )}
            <Field
              label={t('general.updateExisting')}
              help={t('general.updateExistingHelp')}
              inline
            >
              {({ id, describedBy }) => (
                <Switch
                  id={id}
                  aria-describedby={describedBy}
                  disabled={ro}
                  checked={r.updateExisting}
                  onCheckedChange={(v) => p.update((x) => void (x.updateExisting = v))}
                />
              )}
            </Field>
            {settingsFields.map((s) => (
              <Field key={s.key} label={s.label} help={s.help} inline>
                {({ id, describedBy }) =>
                  s.type === 'boolean' ? (
                    <Switch
                      id={id}
                      aria-describedby={describedBy}
                      disabled={ro}
                      checked={Boolean(r.settings[s.key] ?? s.default)}
                      onCheckedChange={(v) => p.update((x) => void (x.settings[s.key] = v))}
                    />
                  ) : s.type === 'select' ? (
                    <Select
                      id={id}
                      disabled={ro}
                      value={String(r.settings[s.key] ?? s.default)}
                      onValueChange={(v) => p.update((x) => void (x.settings[s.key] = v))}
                      options={(s.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
                    />
                  ) : (
                    <Input
                      id={id}
                      disabled={ro}
                      value={String(r.settings[s.key] ?? s.default)}
                      onChange={(e) => p.update((x) => void (x.settings[s.key] = e.target.value))}
                    />
                  )
                }
              </Field>
            ))}
            <Advanced label={t('advanced')} {...(p.developer ? { open: true } : {})}>
              <Field label={t('general.conflict')} inline>
                {({ id }) => (
                  <Select
                    id={id}
                    disabled={ro}
                    value={String(r.settings['conflict.rule'] ?? 'source')}
                    onValueChange={(v) => p.update((x) => void (x.settings['conflict.rule'] = v))}
                    options={['source', 'destination', 'skip'].map((v) => ({
                      value: v,
                      label: t(`conflict.${v}`),
                    }))}
                  />
                )}
              </Field>
              <Field label={t('general.idempotency')} help={t('general.idempotencyHelp')} inline>
                {({ id }) => <Input id={id} readOnly mono value={`${r.id}:{sourceId}`} />}
              </Field>
              {p.developer && (
                <pre className="m-0 max-h-60 overflow-auto rounded-sm bg-navy p-3 font-mono text-mono text-on-navy">
                  {JSON.stringify(r, null, 2)}
                </pre>
              )}
            </Advanced>
          </>
        )}

        {p.tab === 'mapping' && (
          <>
            {mappingErrors > 0 && (
              <Banner tone="error">{t('mappingMissing', { count: mappingErrors })}</Banner>
            )}
            {groups.length === 0 && (
              <p className="m-0 text-table text-fg-2">
                {t('noMapping', { system: dst?.name ?? '' })}
              </p>
            )}
            {groups.map((g) => (
              <section key={g.key} className="flex flex-col gap-3" aria-labelledby={`grp-${g.key}`}>
                <div>
                  <h3 id={`grp-${g.key}`} className="m-0 text-body font-semibold">
                    {g.title}
                  </h3>
                  {g.description && <p className="m-0 text-meta text-fg-2">{g.description}</p>}
                </div>
                {g.fields.map((f) => {
                  const err = errorsAt(`mapping.${f.key}`);
                  const value = r.mapping[f.key];
                  const stale = err?.code === 'ACCOUNT_NOT_FOUND';
                  return (
                    <Field
                      key={f.key}
                      inline
                      label={f.label}
                      error={
                        err
                          ? stale
                            ? t('accountGone', { value: value ?? '', system: dst?.name ?? '' })
                            : t('required')
                          : undefined
                      }
                    >
                      {({ describedBy }) => (
                        <Select
                          id={`field-mapping.${f.key}`}
                          aria-label={f.label}
                          aria-describedby={describedBy}
                          disabled={ro}
                          invalid={Boolean(err)}
                          value={stale ? '' : (value ?? '')}
                          placeholder={t('chooseAccount')}
                          onValueChange={(v) => p.update((x) => void (x.mapping[f.key] = v))}
                          options={accountOptions}
                        />
                      )}
                    </Field>
                  );
                })}
              </section>
            ))}
            {groups.length > 0 && (
              <section className="flex flex-col gap-3" aria-labelledby="grp-categories">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 id="grp-categories" className="m-0 text-body font-semibold">
                      {t('categoryTitle')}
                    </h3>
                    <p className="m-0 text-meta text-fg-2">{t('categoryHint')}</p>
                  </div>
                  {!ro && (
                    <Button
                      variant="secondary"
                      size="s"
                      onClick={() =>
                        p.update(
                          (x) =>
                            void x.categoryAccounts.push({
                              category: '',
                              account: '',
                              product: t('newProduct'),
                            }),
                        )
                      }
                    >
                      <Icon icon={Plus} size={14} />
                      {t('exception')}
                    </Button>
                  )}
                </div>
                <table className="w-full border-collapse text-table">
                  <thead>
                    <tr className="text-left text-meta">
                      <th className="py-1.5 font-semibold">{t('category')}</th>
                      <th className="py-1.5 font-semibold">{t('account')}</th>
                      <th>
                        <span className="sr-only">{t('remove')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.categoryAccounts.map((row, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-1.5 pr-2">
                          {row.product ? (
                            <span className="flex flex-col">
                              <Input
                                aria-label={t('productName')}
                                density="table"
                                disabled={ro}
                                value={row.product}
                                onChange={(e) =>
                                  p.update(
                                    (x) => void (x.categoryAccounts[i]!.product = e.target.value),
                                  )
                                }
                              />
                              <span className="text-micro text-fg-2">{t('productException')}</span>
                            </span>
                          ) : (
                            row.category
                          )}
                        </td>
                        <td className="py-1.5 pr-2">
                          <Select
                            aria-label={t('accountFor', { name: row.product ?? row.category })}
                            density="table"
                            disabled={ro}
                            value={row.account}
                            onValueChange={(v) =>
                              p.update((x) => void (x.categoryAccounts[i]!.account = v))
                            }
                            options={accountOptions}
                          />
                        </td>
                        <td className="w-8 text-right">
                          {!ro && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t('removeRow', { name: row.product ?? row.category })}
                              onClick={() => p.update((x) => void x.categoryAccounts.splice(i, 1))}
                            >
                              <Icon icon={X} size={14} />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="m-0 text-meta text-fg-2">
                  {t('lookupNote', { system: dst?.name ?? '' })}
                </p>
              </section>
            )}
          </>
        )}

        {p.tab === 'filters' && (
          <section className="flex flex-col gap-3">
            <p className="m-0 text-table text-fg-2">
              {r.filters.length ? describeFilters((k, q) => t(k, q), r.filters) : t('filter.none')}
            </p>
            {r.filters.map((f, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2">
                <Select
                  className="col-span-5"
                  aria-label={t('filter.field')}
                  density="compact"
                  disabled={ro}
                  value={f.field}
                  onValueChange={(v) =>
                    p.update((x) => void (x.filters[i]!.field = v as FilterRule['field']))
                  }
                  options={FILTER_FIELDS.map((v) => ({ value: v, label: t(`filter.fields.${v}`) }))}
                />
                <Select
                  className="col-span-3"
                  aria-label={t('filter.op')}
                  density="compact"
                  disabled={ro}
                  value={f.op}
                  onValueChange={(v) =>
                    p.update((x) => void (x.filters[i]!.op = v as FilterRule['op']))
                  }
                  options={FILTER_OPS.map((v) => ({ value: v, label: t(`filter.ops.${v}`) }))}
                />
                <Input
                  className="col-span-3"
                  aria-label={t('filter.value')}
                  density="compact"
                  disabled={ro}
                  value={String(f.value)}
                  onChange={(e) =>
                    p.update((x) => {
                      const v = e.target.value;
                      x.filters[i]!.value =
                        f.field === 'total' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
                    })
                  }
                />
                {!ro && (
                  <Button
                    className="col-span-1"
                    variant="ghost"
                    size="icon"
                    aria-label={t('filter.remove')}
                    onClick={() => p.update((x) => void x.filters.splice(i, 1))}
                  >
                    <Icon icon={X} size={14} />
                  </Button>
                )}
              </div>
            ))}
            {!ro && (
              <div>
                <Button
                  variant="secondary"
                  size="s"
                  onClick={() =>
                    p.update((x) => void x.filters.push({ field: 'total', op: 'gt', value: 0 }))
                  }
                >
                  <Icon icon={Plus} size={14} />
                  {t('filter.add')}
                </Button>
              </div>
            )}
          </section>
        )}

        {p.tab === 'run' && (
          <section className="flex flex-col gap-4">
            <Field
              label={t('run.interval')}
              help={t('run.intervalHelp', { min: p.minPollMinutes })}
              inline
            >
              {({ id }) => (
                <Select
                  id={id}
                  disabled={ro}
                  value={String(p.def.pollMinutes)}
                  onValueChange={(v) => p.updateFlow((d) => void (d.pollMinutes = Number(v)))}
                  options={[1, 5, 15, 30, 60]
                    .filter((m) => m >= p.minPollMinutes)
                    .map((m) => ({ value: String(m), label: t('run.every', { count: m }) }))}
                />
              )}
            </Field>
            <p className="m-0 text-meta text-fg-2">{t('run.note')}</p>
          </section>
        )}

        {p.tab === 'history' && (
          <section className="flex flex-col gap-2">
            {p.history.length === 0 ? (
              <p className="m-0 text-table text-fg-2">{t('history.none')}</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {p.history.slice(0, 12).map((h) => (
                  <li
                    key={h.id}
                    className="flex items-center justify-between gap-3 border-t border-border py-2 text-table first:border-0"
                  >
                    <span className="font-mono text-mono">{h.label}</span>
                    <span className="text-meta text-fg-2">{h.time}</span>
                    <StatusPill
                      status={
                        h.outcome === 'failed'
                          ? 'error'
                          : h.mode === 'test'
                            ? 'info'
                            : h.outcome === 'skipped'
                              ? 'paused'
                              : 'ok'
                      }
                      compact
                    >
                      {t(`history.outcome.${h.outcome}`)}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 px-5 py-3 shadow-hairline-t">
        {p.footer}
      </div>
    </aside>
  );
}
