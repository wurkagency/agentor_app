import { manifestFor } from '@agentor/connectors';
import { reconciliation } from '@agentor/db';
import { formatDate, formatMoney, formatNumber } from '@agentor/i18n';
import { Card, EmptyState, StatCard, StatusPill, Table, Td, Th, Tr } from '@agentor/ui';
import { Responsive } from '@agentor/ui/mobile';
import { Scale } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireAppContext } from '@/server/auth/session';
import { viewsFor } from '@/server/flows';
import { db } from '@/server/infra';
import { ReconciliationFlowPicker } from './flow-picker';
import { ReconciliationMobile } from './mobile';

export async function generateMetadata() {
  const t = await getTranslations('reconciliation');
  return { title: t('title') };
}

/**
 * Afstemning (D10): orders in the shop against invoices in accounting, day by day. Differences
 * are the orders that failed or wait; they disappear when retried.
 */
export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ flow?: string; period?: string }>;
}) {
  const ctx = await requireAppContext();
  // Flows with an order → invoice route into an ERP.
  const views = (await viewsFor(ctx, 7)).filter(
    (v) =>
      v.published &&
      (v.definition?.routes ?? []).some((r) => {
        const conn = v.routes.find((x) => x.id === r.id)?.destinationConnector;
        return (
          r.entity === 'order' &&
          r.targetEntity === 'order' &&
          conn &&
          manifestFor(conn.connectorId)?.category === 'erp'
        );
      }),
  );
  const t = await getTranslations('reconciliation');
  const locale = (await getLocale()) as 'da' | 'en';
  const { flow, period: rawPeriod } = await searchParams;
  // MA28 chips: 7 or 30 days on the phone; the desktop table stays at 7 days.
  const period = rawPeriod === '30d' ? '30d' : '7d';
  const canEdit = ['owner', 'admin', 'developer'].includes(ctx.tenant.role);
  const flowList = views.map((v) => ({ id: v.id, name: v.name }));
  const f =
    views.find((v) => v.id === flow) ??
    [...views].sort((a, b) => b.openFailures - a.openFailures || b.records - a.records)[0];
  if (!f)
    return (
      <Responsive
        desktop={
          <PageBody>
            <PageHeader title={t('title')} subtitle={t('intro')} />
            <EmptyState icon={Scale} title={t('emptyTitle')}>
              {t('emptyBody')}
            </EmptyState>
          </PageBody>
        }
        mobile={
          <ReconciliationMobile
            flow={null}
            flows={[]}
            days={[]}
            period={period}
            src=""
            dest=""
            canEdit={canEdit}
          />
        }
      />
    );
  const routeIds = (f.definition?.routes ?? [])
    .filter((r) => r.entity === 'order' && r.targetEntity === 'order')
    .map((r) => r.id);
  const c0 = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const [days, days30] = await Promise.all([
    reconciliation(db(), c0, f.id, routeIds, 7),
    period === '30d' ? reconciliation(db(), c0, f.id, routeIds, 30) : null,
  ]);
  const src = f.source ? manifestFor(f.source.connectorId)?.name : '';
  const dest = f.routes.find((r) => routeIds.includes(r.id))?.destinationConnector;
  const destName = dest ? manifestFor(dest.connectorId)?.name : '';
  const sum = (k: 'sourceCount' | 'destCount' | 'sourceAmount' | 'destAmount') =>
    days.reduce((s, d) => s + d[k], 0);
  const diff = sum('sourceCount') - sum('destCount');
  const diffAmount = sum('sourceAmount') - sum('destAmount');
  const missingToday = days[0]?.missing ?? [];
  const money = (ore: number) => formatMoney(ore / 100, locale);
  const today = new Date().toISOString().slice(0, 10);

  const desktop = (
    <PageBody>
      <PageHeader title={t('title')} subtitle={t('intro')} />
      <div className="flex flex-wrap items-center gap-2">
        <ReconciliationFlowPicker flows={flowList} value={f.id} />
        <span className="text-table text-fg-2">{t('last7')}</span>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          variant="compact"
          label={t('ordersIn', { system: src ?? '' })}
          value={formatNumber(sum('sourceCount'), locale)}
        />
        <StatCard
          variant="compact"
          label={t('invoicesIn', { system: destName ?? '' })}
          value={formatNumber(sum('destCount'), locale)}
        />
        <StatCard
          variant="compact"
          label={t('difference')}
          value={diff ? t('ordersCount', { count: diff }) : t('none')}
          footer={diff ? <p className="m-0 text-meta text-fg-2">{money(diffAmount)}</p> : undefined}
        />
      </div>
      <Card padding="none" className="overflow-x-auto">
        <Table aria-label={t('tableLabel')}>
          <thead>
            <tr>
              <Th>{t('col.date')}</Th>
              <Th numeric>{t('col.source', { system: src ?? '' })}</Th>
              <Th numeric>{t('col.dest', { system: destName ?? '' })}</Th>
              <Th>{t('col.difference')}</Th>
              <Th numeric>{t('col.sourceAmount')}</Th>
              <Th numeric>{t('col.destAmount', { system: destName ?? '' })}</Th>
              <Th>
                <span className="sr-only">{t('col.actions')}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const off = d.sourceCount - d.destCount;
              return (
                <Tr key={d.day}>
                  <Td>
                    {formatDate(new Date(`${d.day}T12:00:00Z`), locale)}
                    {d.day === today && (
                      <span className="text-meta text-fg-2"> · {t('today')}</span>
                    )}
                  </Td>
                  <Td numeric>{d.sourceCount}</Td>
                  <Td numeric>{d.destCount}</Td>
                  <Td>
                    {off ? (
                      <StatusPill status="warn" compact>
                        {t('ordersCount', { count: off })}
                      </StatusPill>
                    ) : (
                      <span className="text-fg-2">{t('none')}</span>
                    )}
                  </Td>
                  <Td numeric>{money(d.sourceAmount)}</Td>
                  <Td numeric>{money(d.destAmount)}</Td>
                  <Td className="text-right">
                    {off > 0 && (
                      <Link
                        href={`/activity?flow=${f.id}&outcome=failed&period=7d`}
                        className="text-meta font-semibold text-fg-1"
                      >
                        {t('seeOrders', { count: off })}
                      </Link>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      {missingToday.length > 0 && (
        <p className="m-0 text-table text-fg-2">
          {t('explanation', {
            date: formatDate(new Date(), locale),
            list: missingToday.join(', '),
            count: missingToday.length,
          })}
        </p>
      )}
    </PageBody>
  );
  const mobile = (
    <ReconciliationMobile
      flow={{ id: f.id, name: f.name }}
      flows={flowList}
      days={days30 ?? days}
      period={period}
      src={src ?? ''}
      dest={destName ?? ''}
      canEdit={canEdit}
    />
  );
  return <Responsive desktop={desktop} mobile={mobile} />;
}
