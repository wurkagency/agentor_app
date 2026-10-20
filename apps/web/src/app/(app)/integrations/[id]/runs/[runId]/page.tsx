import { getRun, isUuid } from '@agentor/db';
import { formatDate, formatMoney, formatTime, type Locale } from '@agentor/i18n';
import { StatusPill } from '@agentor/ui';
import {
  DeskNote,
  MobileCard,
  MobileEmpty,
  MobileShell,
  Responsive,
  Row,
  SectionHeading,
  Segmented,
} from '@agentor/ui/mobile';
import { CircleCheck } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { routeTarget } from '@/components/flows/helpers';
import { explain } from '@/components/flows/record-error';
import { AppTopBar } from '@/components/mobile/chrome';
import { DesktopRedirect } from '@/components/mobile/desktop-redirect';
import { SendDeskLinkButton } from '@/components/mobile/send-desk-link';
import { requireAppContext } from '@/server/auth/session';
import { connectionMap, viewsFor } from '@/server/flows';
import { db } from '@/server/infra';
import { RetryFailedButton } from '../retry-button';

export async function generateMetadata() {
  const t = await getTranslations('mobile.failure');
  return { title: t('title') };
}

/**
 * MA06 Fejl (a run's failed records, why and how to fix, retry) and MA25 the developer view of
 * one record (request and response). On a computer: the flow's Kørsler tab (D8) with this run.
 */
export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; runId: string }>;
  searchParams: Promise<{ view?: string; record?: string }>;
}) {
  const ctx = await requireAppContext();
  const { id, runId } = await params;
  if (!isUuid(id) || !isUuid(runId)) notFound();
  const sp = await searchParams;
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const [views, conns, detail] = await Promise.all([
    viewsFor(ctx),
    connectionMap(ctx.tenant.tenantId, ctx.user.id),
    getRun(db(), c, runId),
  ]);
  const f = views.find((v) => v.id === id);
  if (!f || !detail || detail.run.flowId !== id) notFound();
  const t = await getTranslations('mobile.failure');
  const te = await getTranslations('recordErrors');
  const tr = await getTranslations('runs');
  const locale = (await getLocale()) as Locale;
  const canEdit = ['owner', 'admin', 'developer'].includes(ctx.tenant.role);
  const developer = sp.view === 'developer';
  const now = new Date();
  const base = `/integrations/${id}/runs/${runId}`;
  const desktopHref = `/integrations/${id}?tab=runs&run=${runId}${sp.record ? `&record=${sp.record}` : ''}${developer ? '&view=developer' : ''}`;

  const failed = detail.records.filter((r) => r.outcome === 'failed');
  const first = failed[0];
  const target = first ? routeTarget(f.definition, conns, first.routeId) : null;
  const country = (code: string | undefined) =>
    code
      ? (new Intl.DisplayNames([locale === 'da' ? 'da-DK' : 'en-GB'], { type: 'region' }).of(
          code,
        ) ?? code)
      : null;
  const e =
    first && target
      ? explain((k, p) => te(k, p), {
          errorCode: first.errorCode,
          errorParams: first.errorParams,
          label: failed.map((r) => r.label).join(locale === 'da' ? ' og ' : ' and '),
          entity: first.entity,
          system: target.system,
          fieldLabel: target.fieldLabel(first.errorParams?.field),
        })
      : null;
  const at = first?.createdAt ?? detail.run.startedAt;
  const when =
    at.toDateString() === now.toDateString()
      ? t('today', { time: formatTime(at, locale) })
      : `${formatDate(at, locale)} ${formatTime(at, locale)}`;
  const count = new Set(failed.map((r) => r.sourceId)).size;
  const headline = first
    ? te(
        `summary.${first.entity === 'creditNote' ? 'creditNote' : first.entity === 'order' ? 'order' : 'record'}`,
        { count, system: target?.system ?? '' },
      ).replace(/\.$/, '')
    : t('noFailures');
  const routeName = (routeId: string) => {
    const r = f.routes.find((x) => x.id === routeId);
    return r ? `${r.source} → ${r.destination}` : '';
  };
  const record =
    detail.records.find((r) => r.id === sp.record) ?? first ?? detail.records[0] ?? null;

  const segmented = (
    <Segmented
      label={t('viewLabel')}
      value={developer ? 'developer' : 'basic'}
      linkAs={Link}
      items={[
        { key: 'basic', label: t('basic'), href: base },
        {
          key: 'developer',
          label: t('developer'),
          href: `${base}?view=developer${record ? `&record=${record.id}` : ''}`,
        },
      ]}
    />
  );

  const mobile = developer ? (
    <MobileShell
      topBar={
        <AppTopBar
          back={base}
          title={t('runTitle', { time: formatTime(detail.run.startedAt, locale) })}
          {...(record ? { subtitle: record.label } : {})}
        />
      }
    >
      {segmented}
      {record && (
        <>
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill status={record.outcome === 'failed' ? 'error' : 'ok'}>
              {tr(`outcome.${record.outcome}` as 'outcome.created')}
            </StatusPill>
            {record.errorCode && (
              <span className="font-mono text-mono text-fg-2">{record.errorCode}</span>
            )}
          </span>
          <h1 className="m-0 text-m-heading">
            {e && record.outcome === 'failed' ? e.what.replace(/\.$/, '') : record.label}
          </h1>
          <p className="m-0 text-meta font-medium text-fg-2">
            {[
              record.amountOre !== null ? formatMoney(record.amountOre / 100, locale) : null,
              f.routes.find((r) => r.id === record.routeId)
                ? `${f.routes.find((r) => r.id === record.routeId)!.source} → ${f.routes.find((r) => r.id === record.routeId)!.destination}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <DebugBlocks
            debug={record.debug}
            labels={{ request: t('request'), response: t('response'), none: t('noDebug') }}
          />
          <p className="m-0 font-mono text-mono text-fg-2">
            {t('id', { id: record.id.slice(0, 12) })}
          </p>
          {canEdit && record.outcome === 'failed' && (
            <div className="mt-auto">
              <RetryFailedButton flowId={id} routeId={record.routeId} label={t('retryOne')} big />
            </div>
          )}
        </>
      )}
    </MobileShell>
  ) : (
    <MobileShell
      topBar={<AppTopBar back={`/integrations/${id}/runs`} title={t('title')} subtitle={f.name} />}
    >
      {segmented}
      {first && e ? (
        <>
          <span className="self-start">
            <StatusPill status="error">{t('errorAt', { when })}</StatusPill>
          </span>
          <h1 className="m-0 text-m-heading">{headline}</h1>
          <MobileCard>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex flex-col gap-1">
                <SectionHeading as="span" flush>
                  {t('why')}
                </SectionHeading>
                <p className="m-0">{e.why}</p>
              </div>
              <div className="flex flex-col gap-1">
                <SectionHeading as="span" flush>
                  {t('howToFix')}
                </SectionHeading>
                <p className="m-0">{e.steps.join(' ')}</p>
              </div>
            </div>
          </MobileCard>
          <MobileCard>
            {failed.map((r) => {
              const pv = (r.preview ?? null) as {
                customer?: string;
                country?: string;
                saleKind?: string | null;
                lines?: { description?: string }[];
              } | null;
              const what = pv?.lines?.[0]?.description;
              const where = country(pv?.country);
              return (
                <Row
                  key={r.id}
                  leading={<span className="font-mono text-meta text-fg-2">{r.label}</span>}
                  title={[
                    what ?? pv?.customer ?? r.label,
                    r.amountOre !== null ? formatMoney(r.amountOre / 100, locale) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  meta={
                    where
                      ? pv?.saleKind === 'b2c'
                        ? t('person', { country: where })
                        : t('company', { country: where })
                      : routeName(r.routeId)
                  }
                />
              );
            })}
          </MobileCard>
          <div className="mt-auto flex flex-col gap-2">
            <Suspense>
              <SendDeskLinkButton path={desktopHref} title={headline} />
            </Suspense>
            {canEdit && (
              <RetryFailedButton
                flowId={id}
                routeId={first.routeId}
                big
                label={
                  first.entity === 'order' ? t('retry', { count }) : t('retryRecords', { count })
                }
              />
            )}
          </div>
        </>
      ) : (
        <>
          <MobileEmpty icon={CircleCheck} title={t('noFailures')}>
            {t('noFailuresBody', { total: detail.run.recordsTotal, ok: detail.run.recordsOk })}
          </MobileEmpty>
          <DeskNote>{t('deskNote')}</DeskNote>
        </>
      )}
    </MobileShell>
  );

  return (
    <Responsive
      desktop={<DesktopRedirect href={desktopHref} label={t('title')} />}
      mobile={mobile}
    />
  );
}

/** MA25: the record's request and response as the engine logged them (no credentials). */
function DebugBlocks({
  debug,
  labels,
}: {
  debug: unknown;
  labels: { request: string; response: string; none: string };
}) {
  const d = (debug ?? null) as { request?: unknown; response?: unknown } | null;
  if (!d) return <p className="m-0 text-meta text-fg-2">{labels.none}</p>;
  const block = (title: string, body: unknown) =>
    body === undefined ? null : (
      <section className="flex flex-col gap-1.5" aria-label={title}>
        <SectionHeading as="h2" flush>
          {title}
        </SectionHeading>
        <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-all rounded-node bg-navy p-3.5 font-mono text-mono text-on-navy">
          {typeof body === 'string' ? body : JSON.stringify(body, null, 2)}
        </pre>
      </section>
    );
  if (d.request === undefined && d.response === undefined) return block(labels.request, d);
  return (
    <>
      {block(labels.request, d.request)}
      {block(labels.response, d.response)}
    </>
  );
}
