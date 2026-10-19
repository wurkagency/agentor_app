'use client';

import type { Finding, FlowDefinition } from '@agentor/flows';
import { formatMoney } from '@agentor/i18n';
import { Button, cn, Icon, ModeBadge, StatusPill } from '@agentor/ui';
import { ChevronDown, ChevronUp, CircleX, Play, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { TestRunRecord } from '@/app/(app)/integrations/[id]/editor/actions';
import { fieldLabel, findingPlace, routeLabel, type ConnMap } from './model';

export type BottomTab = 'validation' | 'test';

interface Preview {
  customer?: string;
  country?: string;
  vatNumber?: string | null;
  saleKind?: string | null;
  lines?: {
    description: string;
    amount: number;
    account: string | null;
    accountLabel: string | null;
    kind: string;
  }[];
  total?: number | null;
  vatFree?: boolean;
}

/** Validation findings and test run results (§5.1 bottom panel; D3-Validering, D5-Testkørsel). */
export function BottomPanel({
  def,
  conns,
  findings,
  tab,
  setTab,
  open,
  setOpen,
  onGoTo,
  validatedAt,
  test,
  onRerun,
  sourceName,
}: {
  def: FlowDefinition;
  conns: ConnMap;
  findings: Finding[];
  tab: BottomTab;
  setTab: (t: BottomTab) => void;
  open: boolean;
  setOpen: (o: boolean) => void;
  onGoTo: (f: Finding) => void;
  validatedAt: string | null;
  test: { status: 'idle' | 'running' | 'done'; records: TestRunRecord[] } | null;
  onRerun: () => void;
  sourceName: string;
}) {
  const t = useTranslations('editor');
  const tm = useTranslations('mode');
  const locale = useLocale() as 'da' | 'en';
  const [route, setRoute] = useState<string | null>(null);
  const [record, setRecord] = useState<string | null>(null);
  const message = (f: Finding) => {
    const r = def.routes.find((x) => x.id === f.routeId);
    const params: Record<string, string | number> = { ...(f.params ?? {}) };
    if (r && f.path?.startsWith('mapping.'))
      params.field = fieldLabel(def, conns, r, f.path.slice(8));
    return {
      title: t(`findings.${f.code}.title`, params),
      body: t(`findings.${f.code}.body`, params),
    };
  };

  const records = test?.records ?? [];
  const byRoute = def.routes.map((r) => ({
    route: r,
    records: records.filter((x) => x.routeId === r.id),
  }));
  const activeRoute = route ?? byRoute.find((x) => x.records.length)?.route.id ?? null;
  const shown = records.filter((x) => x.routeId === activeRoute);
  const count = (o: string[]) => shown.filter((x) => o.includes(x.outcome)).length;
  const sel =
    shown.find((x) => x.id === record) ?? shown.find((x) => x.outcome !== 'skipped') ?? shown[0];
  const pv = (sel?.preview ?? null) as Preview | null;

  return (
    <section
      aria-label={t('bottomLabel')}
      className={cn('flex flex-none flex-col bg-surface shadow-hairline-t', open ? 'h-72' : 'h-11')}
    >
      <div className="flex h-11 flex-none items-center gap-5 px-5">
        <div role="tablist" aria-label={t('bottomLabel')} className="flex h-full items-end gap-5">
          {(['validation', 'test'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => {
                setTab(k);
                setOpen(true);
              }}
              className={cn(
                'inline-flex h-full cursor-pointer items-center gap-2 border-0 bg-transparent px-0 font-sans text-table font-semibold text-fg-2',
                tab === k && 'text-fg-1 shadow-tab-active',
              )}
            >
              {t(`bottom.${k}`)}
              {k === 'validation' && findings.length > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-fg-1 px-1.5 text-micro text-white">
                  {findings.length}
                </span>
              )}
              {k === 'test' && test && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-micro text-fg-1">
                  {t('dryRun')}
                </span>
              )}
            </button>
          ))}
        </div>
        <span className="ml-auto text-meta text-fg-2">
          {tab === 'validation'
            ? validatedAt
              ? t('validatedAt', { when: validatedAt })
              : ''
            : test
              ? t('latestFrom', { count: 10, source: sourceName })
              : ''}
        </span>
        {tab === 'test' && test && (
          <Button
            variant="secondary"
            size="s"
            onClick={onRerun}
            loading={test.status === 'running'}
          >
            {test.status !== 'running' && <Icon icon={Play} size={14} />}
            {t('runAgain')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={open ? t('collapsePanel') : t('expandPanel')}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon icon={open ? ChevronDown : ChevronUp} size={16} />
        </Button>
      </div>

      {open && tab === 'validation' && (
        <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-2 overflow-y-auto p-0 px-5 pb-4">
          {findings.length === 0 && (
            <li className="py-4 text-table text-fg-2">{t('noFindings')}</li>
          )}
          {findings.map((f, i) => {
            const m = message(f);
            return (
              <li
                key={`${f.code}-${f.routeId}-${f.path}-${i}`}
                className={cn(
                  'flex items-start gap-3 rounded-sm px-4 py-3',
                  f.severity === 'error' ? 'bg-error-bg' : 'shadow-ring-chip',
                )}
              >
                <Icon
                  icon={f.severity === 'error' ? CircleX : TriangleAlert}
                  size={16}
                  className={cn(
                    'mt-0.5',
                    f.severity === 'error' ? 'text-error-fg' : 'text-warn-fg',
                  )}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="m-0 text-table">
                    <span className="font-semibold">{m.title}</span> {m.body}
                  </p>
                  <p
                    className={cn(
                      'm-0 text-meta',
                      f.severity === 'error' ? 'text-fg-1' : 'text-fg-2',
                    )}
                  >
                    {findingPlace((k) => t(k), def, conns, f)}
                  </p>
                </div>
                {f.routeId && (
                  <Button variant="secondary" size="s" onClick={() => onGoTo(f)}>
                    {f.path ? t('goToField') : t('showRoute')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {open && tab === 'test' && (
        <div className="grid min-h-0 flex-1 grid-cols-12 shadow-hairline-t">
          {!test ? (
            <p className="col-span-12 m-0 p-5 text-table text-fg-2">{t('testIntro')}</p>
          ) : test.status === 'running' && records.length === 0 ? (
            <p className="col-span-12 m-0 p-5 text-table text-fg-2" role="status">
              {t('testRunning')}
            </p>
          ) : (
            <>
              <ul
                className="col-span-3 m-0 list-none overflow-y-auto p-0 shadow-hairline-r"
                aria-label={t('testRoutes')}
              >
                {byRoute.map(({ route: r, records: rs }) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setRoute(r.id);
                        setRecord(null);
                      }}
                      aria-current={activeRoute === r.id ? 'true' : undefined}
                      className={cn(
                        'flex w-full cursor-pointer items-center justify-between gap-2 border-0 border-b border-border bg-transparent px-4 py-2.5 text-left font-sans text-table text-fg-1',
                        activeRoute === r.id && 'bg-row-hover shadow-row-selected',
                      )}
                    >
                      <span className="min-w-0 truncate">{routeLabel(def, conns, r, true)}</span>
                      <span className="flex items-center gap-2">
                        <ModeBadge mode={r.mode} small>
                          {tm(r.mode)}
                        </ModeBadge>
                        <span className="tabular">{r.paused ? '–' : rs.length}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="col-span-4 flex min-h-0 flex-col shadow-hairline-r">
                <div className="grid grid-cols-3 gap-2 px-4 py-2" aria-live="polite">
                  {[
                    ['would_create', t('wouldCreate'), count(['would_create'])],
                    ['would_update', t('wouldUpdate'), count(['would_update'])],
                    ['skipped', t('wouldSkip'), count(['skipped'])],
                  ].map(([k, label, n]) => (
                    <div key={String(k)} className="flex flex-col">
                      <span className="text-card font-semibold tabular">{n}</span>
                      <span className="text-micro text-fg-2">{label}</span>
                    </div>
                  ))}
                </div>
                {count(['failed']) > 0 && (
                  <p className="m-0 px-4 pb-2 text-meta font-semibold text-error-fg">
                    {t('wouldFail', { count: count(['failed']) })}
                  </p>
                )}
                <ul
                  className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0"
                  aria-label={t('testRecords')}
                >
                  {shown.map((x) => (
                    <li key={x.id}>
                      <button
                        type="button"
                        onClick={() => setRecord(x.id)}
                        aria-current={sel?.id === x.id ? 'true' : undefined}
                        className={cn(
                          'flex w-full cursor-pointer flex-wrap items-center justify-between gap-x-2 gap-y-1 border-0 border-t border-border bg-transparent px-4 py-2 text-left font-sans text-table text-fg-1',
                          sel?.id === x.id && 'bg-row-hover',
                        )}
                      >
                        <span className="font-mono text-mono">{x.label}</span>
                        <span className="text-right tabular">
                          {x.amountOre === null ? '–' : formatMoney(x.amountOre / 100, locale)}
                        </span>
                        <span className="basis-full">
                          <StatusPill
                            status={
                              x.outcome === 'failed'
                                ? 'error'
                                : x.outcome === 'skipped'
                                  ? 'paused'
                                  : 'ok'
                            }
                            compact
                          >
                            {x.outcome === 'skipped' && x.skipReason?.startsWith('filter:total')
                              ? t('skippedZero')
                              : t(
                                  `testOutcome.${x.outcome}.${def.routes.find((r) => r.id === x.routeId)?.entity === 'order' ? 'order' : 'other'}`,
                                )}
                          </StatusPill>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="col-span-5 min-h-0 overflow-y-auto px-4 py-3">
                {sel && pv?.lines ? (
                  <table
                    className="w-full border-collapse text-table"
                    aria-label={t('beforeAfter', { label: sel.label })}
                  >
                    <thead>
                      <tr className="text-left text-meta">
                        <th className="pb-2 font-semibold" />
                        <th className="pb-2 font-semibold">
                          {t('before', { label: sel.label, source: sourceName })}
                        </th>
                        <th className="pb-2 font-semibold">{t('after')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-border">
                        <td className="whitespace-nowrap py-1.5 pr-3 align-top text-fg-2">
                          {t('customer')}
                        </td>
                        <td className="py-1.5">{pv.customer}</td>
                        <td className="py-1.5">{pv.customer}</td>
                      </tr>
                      <tr className="border-t border-border bg-primary-bright">
                        <td className="whitespace-nowrap py-1.5 pr-3 align-top">{t('country')}</td>
                        <td className="py-1.5">
                          {pv.country}
                          {pv.vatNumber ? ` · ${t('vatNo')} ${pv.vatNumber.slice(0, 5)}…` : ''}
                        </td>
                        <td className="py-1.5">{t(`saleKind.${pv.saleKind ?? 'domestic'}`)}</td>
                      </tr>
                      {pv.lines.map((l, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="whitespace-nowrap py-1.5 pr-3 align-top text-fg-2">
                            {l.kind === 'shipping' ? t('shipping') : t('line', { n: i + 1 })}
                          </td>
                          <td className="py-1.5">
                            {l.description} · {formatMoney(l.amount / 100, locale)}
                          </td>
                          <td className="py-1.5">
                            {l.account ? (
                              <>
                                <span className="font-mono text-mono">{l.account}</span>{' '}
                                {l.accountLabel}
                              </>
                            ) : (
                              <span className="text-error-fg">{t('noAccount')}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-border font-semibold">
                        <td className="whitespace-nowrap py-1.5 pr-3 align-top text-fg-2">
                          {t('total')}
                        </td>
                        <td className="py-1.5">{formatMoney((pv.total ?? 0) / 100, locale)}</td>
                        <td className="py-1.5">
                          {formatMoney((pv.total ?? 0) / 100, locale)}
                          {pv.vatFree ? ` · ${t('withoutVat')}` : ''}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                ) : (
                  <p className="m-0 text-table text-fg-2">{sel ? t('noPreview') : ''}</p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
