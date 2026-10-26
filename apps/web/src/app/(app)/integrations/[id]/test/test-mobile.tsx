'use client';

import type { FlowDefinition, Route } from '@agentor/flows';
import { formatMoney, type Locale } from '@agentor/i18n';
import { toast } from '@agentor/ui';
import {
  BigButton,
  BigButtonLink,
  DeskNote,
  ExpandCard,
  KV,
  MobileCallout,
  MobileCard,
  MobileShell,
  Row,
  RowIcon,
  RowsSkeleton,
  SectionHeading,
} from '@agentor/ui/mobile';
import { CircleMinus, CircleX, FileText, FlaskConical, Play, RotateCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getTestRun, type TestRunRecord } from '../editor/actions';
import { nodeManifest, routeLabel, type ConnMap } from '@/components/editor/model';
import { AppTopBar } from '@/components/mobile/chrome';
import { testDraftAction } from './actions';

interface Preview {
  customer?: string;
  country?: string;
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

type Test = { runId: string; status: string; records: TestRunRecord[] };

const finished = (s: string) => s !== 'queued' && s !== 'running';

/** MA22: summary, records per route, and each record folding out to what would be written. */
export function TestRunMobile({
  flow,
  draftId,
  def,
  conns,
  sourceName,
  nextVersion,
  canEdit,
  initial,
}: {
  flow: { id: string; name: string };
  draftId: string | null;
  def: FlowDefinition | null;
  conns: ConnMap;
  sourceName: string;
  nextVersion: number;
  canEdit: boolean;
  initial: Test | null;
}) {
  const t = useTranslations('mobile.testRun');
  const te = useTranslations('editor');
  const tm = useTranslations('mode');
  const tf = useTranslations('mobile.flow');
  const locale = useLocale() as Locale;
  const [test, setTest] = useState<Test | null>(initial);
  const back = `/integrations/${flow.id}?tab=routes`;
  const ready = Boolean(canEdit && draftId && def);
  const [starting, setStarting] = useState(ready && !initial);

  const start = useCallback(async () => {
    if (!draftId) return;
    setStarting(true);
    const res = await testDraftAction(flow.id, draftId);
    setStarting(false);
    if (!res.ok) {
      toast.error({ title: te('errors.test'), closeLabel: te('close') });
      return;
    }
    const runId = res.data!.runId;
    // The URL keeps the result on reload, without a server round trip now.
    window.history.replaceState(window.history.state, '', `?run=${runId}`);
    setTest({ runId, status: 'queued', records: [] });
  }, [draftId, flow.id, te]);

  // Arriving from "Testkør" (MA20) starts the run; the ref keeps a remount from starting two.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || initial || !ready) return;
    started.current = true;
    void start();
  }, [initial, ready, start]);

  // Poll until the worker has finished, as the editor does.
  useEffect(() => {
    if (!test || finished(test.status)) return;
    const id = setInterval(async () => {
      const res = await getTestRun(test.runId);
      if (res.ok && res.data && finished(res.data.status))
        setTest({ runId: test.runId, status: res.data.status, records: res.data.records });
    }, 700);
    return () => clearInterval(id);
  }, [test]);

  const topBar = <AppTopBar back={back} title={t('title')} subtitle={flow.name} />;
  if (!ready || !def)
    return (
      <MobileShell topBar={topBar}>
        <DeskNote>{canEdit ? t('noDraft') : t('readOnly')}</DeskNote>
      </MobileShell>
    );

  const running = starting || Boolean(test && !finished(test.status));
  const records = running ? [] : (test?.records ?? []);
  const count = (o: string) => records.filter((x) => x.outcome === o).length;
  const failed = count('failed');
  const money = (ore: number | null | undefined) =>
    ore === null || ore === undefined ? '–' : formatMoney(ore / 100, locale);
  const outcomeText = (x: TestRunRecord, r: Route | undefined) =>
    x.outcome === 'skipped' && x.skipReason?.startsWith('filter:total')
      ? te('skippedZero')
      : te(`testOutcome.${x.outcome}.${r?.entity === 'order' ? 'order' : 'other'}`);
  const withRecords = def.routes
    .map((r) => ({ route: r, records: records.filter((x) => x.routeId === r.id) }))
    .filter((x) => x.records.length > 0);

  return (
    <MobileShell topBar={topBar}>
      <MobileCallout tone="info" icon={FlaskConical} title={t('calloutTitle')}>
        {t('calloutBody', { count: 10, source: sourceName })}
      </MobileCallout>

      {running ? (
        <RowsSkeleton rows={4} label={te('testRunning')} leading="none" />
      ) : !test ? null : (
        <>
          <div className="grid grid-cols-2 gap-2.5" aria-live="polite">
            <MobileCard className="flex min-w-0 flex-col gap-1 px-3.5 py-3">
              <span className="truncate text-meta font-medium text-fg-2">{t('wouldCreate')}</span>
              <strong className="text-m-kpi tabular">{count('would_create')}</strong>
              {failed > 0 && (
                <span className="truncate text-micro font-semibold text-error-fg">
                  {te('wouldFail', { count: failed })}
                </span>
              )}
            </MobileCard>
            <MobileCard className="flex min-w-0 flex-col gap-1 px-3.5 py-3">
              <span className="truncate text-meta font-medium text-fg-2">{t('wouldSkip')}</span>
              <strong className="text-m-kpi tabular">{count('skipped')}</strong>
              <span className="truncate text-micro font-medium text-fg-2">
                {t('wouldUpdate', { count: count('would_update') })}
              </span>
            </MobileCard>
          </div>

          <SectionHeading>{t('routes')}</SectionHeading>
          <MobileCard>
            {def.routes.map((r) => (
              <Row
                key={r.id}
                title={routeLabel(def, conns, r)}
                meta={r.paused ? t('paused') : tm(r.mode)}
                trailing={
                  <strong className="text-body tabular">
                    {r.paused ? '–' : records.filter((x) => x.routeId === r.id).length}
                  </strong>
                }
              />
            ))}
          </MobileCard>

          {withRecords.map(({ route: r, records: rs }, ri) => {
            const system = nodeManifest(def, conns, r.to)?.name ?? '';
            return (
              <section
                key={r.id}
                className="flex flex-col gap-2"
                aria-label={routeLabel(def, conns, r, true)}
              >
                <SectionHeading>{routeLabel(def, conns, r, true)}</SectionHeading>
                {rs.map((x, i) => {
                  const pv = (x.preview ?? null) as Preview | null;
                  return (
                    <ExpandCard
                      key={x.id}
                      open={ri === 0 && i === 0}
                      leading={
                        <RowIcon
                          size={30}
                          icon={
                            x.outcome === 'failed'
                              ? CircleX
                              : x.outcome === 'skipped'
                                ? CircleMinus
                                : FileText
                          }
                          tone={x.outcome === 'failed' ? 'error' : 'neutral'}
                        />
                      }
                      title={t('recordTitle', { label: x.label, outcome: outcomeText(x, r) })}
                      meta={[pv?.customer, money(x.amountOre)].filter(Boolean).join(' · ')}
                    >
                      {pv?.lines ? (
                        <>
                          {pv.customer && <KV k={te('customer')}>{pv.customer}</KV>}
                          {pv.country && (
                            <KV k={te('country')}>
                              {pv.country} · {te(`saleKind.${pv.saleKind ?? 'domestic'}`)}
                            </KV>
                          )}
                          {pv.lines.map((l, li) => {
                            const account = l.account
                              ? `${l.account} ${l.accountLabel ?? ''}`.trim()
                              : te('noAccount');
                            return (
                              <KV
                                key={li}
                                k={
                                  l.kind === 'shipping' ? te('shipping') : te('line', { n: li + 1 })
                                }
                              >
                                <span className={l.account ? undefined : 'text-error-fg'}>
                                  {l.kind === 'shipping'
                                    ? t('amountValue', { amount: money(l.amount), account })
                                    : t('lineValue', {
                                        description: l.description,
                                        amount: money(l.amount),
                                        account,
                                      })}
                                </span>
                              </KV>
                            );
                          })}
                          <KV k={te('total')}>
                            <strong>{money(pv.total ?? 0)}</strong>
                            {pv.vatFree ? ` · ${te('withoutVat')}` : ''}
                          </KV>
                        </>
                      ) : (
                        <p className="m-0 pt-2 text-table text-fg-2">{te('noPreview')}</p>
                      )}
                      {system && <KV k={t('inSystem', { system })}>{tm(r.mode)}</KV>}
                    </ExpandCard>
                  );
                })}
              </section>
            );
          })}
        </>
      )}

      <div className="mt-auto flex gap-2 pt-1">
        <BigButton
          variant="secondary"
          icon={test ? RotateCw : Play}
          loading={running}
          onClick={() => void start()}
          className="flex-1"
        >
          {running ? te('testRunning') : test ? te('runAgain') : t('start')}
        </BigButton>
        <BigButtonLink
          href={`/integrations/${flow.id}/publish${test && !running ? `?run=${test.runId}` : ''}`}
          linkAs={Link}
          className="flex-1"
        >
          {tf('publish', { n: nextVersion })}
        </BigButtonLink>
      </div>
    </MobileShell>
  );
}
