'use client';

import { Card, CopyButton, Icon, StatusPill, Table, Td, Th, Tr, cn } from '@agentor/ui';
import { Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { RetryButton } from './flow-actions';

const OUTCOME = {
  created: 'ok',
  updated: 'ok',
  skipped: 'paused',
  failed: 'error',
  would_create: 'info',
  would_update: 'info',
  waiting: 'warn',
} as const;

export interface RunsViewProps {
  flowId: string;
  developer: boolean;
  canEdit: boolean;
  runs: { id: string; time: string; total: number; failed: number; status: string }[];
  selected: {
    id: string;
    time: string;
    total: number;
    ok: number;
    failed: number;
    seconds: string | null;
    records: {
      id: string;
      label: string;
      route: string;
      outcome: keyof typeof OUTCOME;
      amount: string;
    }[];
  } | null;
  record: {
    id: string;
    routeId: string;
    title: string;
    subtitle: string;
    why: string;
    steps: string[];
    mappingField: string | null;
    code: string | null;
    debug: string | null;
    facts: { k: string; v: string; mono?: boolean }[];
  } | null;
}

/** Kørsler (D8): runs today on the left, the chosen run's records, and why a record failed. */
export function RunsView({ flowId, developer, canEdit, runs, selected, record }: RunsViewProps) {
  const tr = useTranslations('runs');
  const tc = useTranslations('common');
  const pathname = usePathname();
  const params = useSearchParams();
  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    next.set('tab', 'runs');
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return `${pathname}?${next}`;
  };

  if (runs.length === 0)
    return (
      <Card>
        <p className="m-0 text-fg-2">{tr('noneToday')}</p>
      </Card>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <Card padding="none" className="flex flex-col lg:col-span-3">
        <p className="m-0 px-4 pb-2 pt-4 text-meta font-semibold text-fg-2">{tr('today')}</p>
        <ul className="m-0 max-h-160 list-none overflow-y-auto p-0" aria-label={tr('listLabel')}>
          {runs.map((r) => {
            const active = selected?.id === r.id;
            return (
              <li key={r.id}>
                <Link
                  href={href({ run: r.id, record: null })}
                  scroll={false}
                  aria-current={active ? 'true' : undefined}
                  className={`flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-table text-fg-1 no-underline hover:bg-row-hover ${active ? 'bg-row-hover font-semibold' : ''}`}
                >
                  <span className="tabular">{r.time}</span>
                  <span className="text-meta text-fg-2">{tr('records', { count: r.total })}</span>
                  <StatusPill
                    status={r.failed ? 'error' : r.status === 'test' ? 'info' : 'ok'}
                    compact
                  >
                    {r.failed
                      ? tr('failedCount', { count: r.failed })
                      : r.status === 'test'
                        ? 'Test'
                        : 'OK'}
                  </StatusPill>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="flex flex-col gap-4 lg:col-span-9">
        {selected && (
          <Card padding="none" className="flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5">
              <div className="flex flex-col gap-0.5">
                <h2 className="m-0 text-card">{tr('runAt', { time: selected.time })}</h2>
                <p className="m-0 text-meta text-fg-2">
                  {tr('summary', {
                    total: selected.total,
                    ok: selected.ok,
                    failed: selected.failed,
                  })}
                  {selected.seconds ? ` · ${tr('seconds', { s: selected.seconds })}` : ''}
                </p>
              </div>
              {canEdit && selected.failed > 0 && (
                <RetryButton flowId={flowId} count={selected.failed} />
              )}
            </div>
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>{tr('col.record')}</Th>
                    <Th>{tr('col.route')}</Th>
                    <Th>{tr('col.outcome')}</Th>
                    <Th numeric>{tr('col.amount')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {selected.records.map((r) => (
                    <Tr key={r.id} interactive selected={record?.id === r.id}>
                      <Td>
                        {r.outcome === 'failed' ? (
                          <Link
                            href={href({ record: r.id })}
                            scroll={false}
                            className="font-mono text-mono text-fg-1"
                          >
                            {r.label}
                          </Link>
                        ) : (
                          <span className="font-mono text-mono">{r.label}</span>
                        )}
                      </Td>
                      <Td>{r.route}</Td>
                      <Td>
                        <StatusPill status={OUTCOME[r.outcome]} compact>
                          {tr(`outcome.${r.outcome}`)}
                        </StatusPill>
                      </Td>
                      <Td numeric>{r.amount}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>
        )}

        {record && (
          <Card className="flex flex-col gap-4" aria-labelledby="record-error">
            <div className="flex flex-col gap-1">
              <p className="eyebrow m-0 text-error-fg">
                {tr('errorAt', { time: selected?.time ?? '' })}
              </p>
              <h3 id="record-error" className="m-0 text-card">
                {record.title}
              </h3>
              <p className="m-0 text-meta text-fg-2">{record.subtitle}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <section className="flex flex-col gap-1.5">
                <h4 className="m-0 text-table font-semibold">{tr('why')}</h4>
                <p className="m-0 text-table">{record.why}</p>
              </section>
              <section className="flex flex-col gap-1.5">
                <h4 className="m-0 text-table font-semibold">{tr('howToFix')}</h4>
                <ol className="m-0 flex flex-col gap-1 pl-5 text-table">
                  {record.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </section>
            </div>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                {record.mappingField && (
                  <Link
                    href={`/integrations/${flowId}/editor?route=${record.routeId}&tab=mapping&field=${encodeURIComponent(record.mappingField)}`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-table font-semibold text-fg-1 no-underline"
                  >
                    <Icon icon={Settings2} size={14} />
                    {tr('openSetting')}
                  </Link>
                )}
                <RetryButton flowId={flowId} routeId={record.routeId} count={1} />
              </div>
            )}
            <section className="flex flex-col gap-2 shadow-hairline-t pt-3">
              <h4 className="m-0 text-table font-semibold">{tr('technical')}</h4>
              {developer ? (
                <>
                  <dl className="m-0 grid grid-cols-form-row gap-x-4 gap-y-1.5 text-table">
                    {record.facts.map((f) => (
                      <div key={f.k} className="contents">
                        <dt className="text-fg-2">{f.k}</dt>
                        <dd className={cn('m-0 break-all', f.mono && 'font-mono text-mono')}>
                          {f.v}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {!record.debug && <p className="m-0 text-meta text-fg-2">{tr('noDebug')}</p>}
                  {record.debug && (
                    <div className="relative">
                      <pre className="m-0 overflow-x-auto rounded-sm bg-navy p-4 font-mono text-mono text-on-navy">
                        {record.debug}
                      </pre>
                      <span className="absolute right-2 top-2">
                        <CopyButton
                          value={record.debug}
                          label={tc('copy')}
                          copiedLabel={tc('copied')}
                        />
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <p className="m-0 text-meta text-fg-2">{tr('technicalHint')}</p>
              )}
            </section>
          </Card>
        )}
      </div>
    </div>
  );
}
