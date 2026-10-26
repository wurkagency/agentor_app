import { formatDate, formatMinutes, type Locale } from '@agentor/i18n';
import {
  Avatar,
  Banner,
  Card,
  CardHeader,
  EmptyState,
  KpiCard,
  Table,
  Td,
  Th,
  Tr,
} from '@agentor/ui';
import { Responsive } from '@agentor/ui/mobile';
import { CircleCheck, Clock, Hourglass, Timer } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { ReportToolbar } from '@/components/platform/admin/report-toolbar';
import { CustomerChip, growthOf, money } from '@/components/platform/finance/bits';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireStaff } from '@/server/platform';
import { growthPct, reportRange, supportReport } from '@/server/reports';
import { SupportReportMobile } from './mobile';

export async function generateMetadata() {
  const t = await getTranslations('platform.reports');
  return { title: t('type.support') };
}

/**
 * Administration › Rapporter › Support og tid (A3): registered, billed and non-billable time,
 * cases resolved, time per supporter and per category, and the largest customers, for a Fra/til
 * period. Amounts ex. VAT. Same rows as the PDF and the CSV.
 */
export default async function SupportReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; period?: string }>;
}) {
  const { actor } = await requireStaff(true);
  const sp = await searchParams;
  const t = await getTranslations('platform.reports');
  const tc = await getTranslations('platform.case');
  const locale = (await getLocale()) as Locale;
  const { range, invalid } = reportRange('support', sp);
  const r = await supportReport(actor, range);
  const m = (n: number) => formatMinutes(n, locale);
  const pctGrowth = (a: number, b: number, goodUp = true) =>
    growthOf(growthPct(a, b), (x) => `${x} %`, locale, goodUp);
  const minutesGrowth = (a: number, b: number) => {
    const diff = a - b;
    if (diff === 0) return undefined;
    return {
      direction: diff > 0 ? ('up' as const) : ('down' as const),
      tone: diff > 0 ? ('bad' as const) : ('good' as const),
      text: m(Math.abs(diff)),
    };
  };
  const rounding = r.billedMinutes - r.registeredMinutes;
  const period = `${formatDate(range.from, locale)} – ${formatDate(new Date(range.to.getTime() - 1), locale)}`;
  const sum = (k: 'billable' | 'nonBillable' | 'cases') => r.perStaff.reduce((a, s) => a + s[k], 0);
  const opt = <T,>(key: string, v: T | undefined) => (v === undefined ? {} : { [key]: v });

  const growth = {
    registered: pctGrowth(r.registeredMinutes, r.previous.registeredMinutes),
    billed: pctGrowth(r.billedMinutes, r.previous.billedMinutes),
    nonBillable: minutesGrowth(r.nonBillableMinutes, r.previous.nonBillableMinutes),
    resolved:
      r.casesResolved !== r.previous.casesResolved
        ? {
            direction:
              r.casesResolved > r.previous.casesResolved ? ('up' as const) : ('down' as const),
            tone: 'neutral' as const,
            text: String(Math.abs(r.casesResolved - r.previous.casesResolved)),
          }
        : undefined,
  };

  const desktop = (
    <PageBody>
      <PageHeader
        title={t('title')}
        subtitle={t('support.intro')}
        actions={<ReportToolbar type="support" range={range} custom={sp.period === 'custom'} />}
      />
      {invalid && <Banner tone="warn">{t('rangeInvalid')}</Banner>}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-kpi-hero-3">
        <KpiCard
          hero
          compact
          icon={Clock}
          label={t('support.registered')}
          {...opt('growth', pctGrowth(r.registeredMinutes, r.previous.registeredMinutes))}
          value={m(r.registeredMinutes)}
          footer={`${period} · ${t('support.billable')}`}
        />
        <KpiCard
          compact
          icon={Timer}
          label={t('support.billed')}
          {...opt('growth', pctGrowth(r.billedMinutes, r.previous.billedMinutes))}
          value={m(r.billedMinutes)}
          footer={t('support.rounding', {
            time: m(rounding),
            pct: r.registeredMinutes ? Math.round((rounding / r.registeredMinutes) * 100) : 0,
          })}
        />
        <KpiCard
          compact
          icon={Hourglass}
          label={t('support.nonBillable')}
          {...opt('growth', minutesGrowth(r.nonBillableMinutes, r.previous.nonBillableMinutes))}
          value={m(r.nonBillableMinutes)}
          footer={t('support.nonBillableSub')}
        />
        <KpiCard
          compact
          icon={CircleCheck}
          label={t('support.resolved')}
          {...opt(
            'growth',
            r.casesResolved !== r.previous.casesResolved
              ? {
                  direction: r.casesResolved > r.previous.casesResolved ? 'up' : 'down',
                  tone: 'neutral',
                  text: String(Math.abs(r.casesResolved - r.previous.casesResolved)),
                }
              : undefined,
          )}
          value={String(r.casesResolved)}
          footer={
            r.medianResolvedMinutes === null
              ? t('support.customers', { count: r.customersResolved })
              : t('support.resolvedSub', {
                  count: r.customersResolved,
                  time: m(r.medianResolvedMinutes),
                })
          }
        />
      </div>

      <Card padding="none" className="overflow-x-auto">
        <div className="px-5 pb-2 pt-5">
          <CardHeader title={t('support.perStaff')} />
        </div>
        {r.perStaff.length === 0 ? (
          <EmptyState icon={Clock} title={t('support.empty')}>
            {t('support.emptyBody')}
          </EmptyState>
        ) : (
          <Table aria-label={t('support.perStaff')}>
            <thead>
              <tr>
                <Th className="pl-5">{t('support.colStaff')}</Th>
                <Th numeric>{t('support.colBillable')}</Th>
                <Th numeric>{t('support.colNonBillable')}</Th>
                <Th numeric>{t('support.colCases')}</Th>
                <Th numeric className="pr-5">
                  {t('support.colAuto')}
                </Th>
              </tr>
            </thead>
            <tbody>
              {r.perStaff.map((s) => (
                <Tr key={s.name}>
                  <Td className="pl-5">
                    <span className="flex items-center gap-2.5">
                      <Avatar name={s.name} size={28} />
                      {s.name}
                    </span>
                  </Td>
                  <Td numeric>{m(s.billable)}</Td>
                  <Td numeric>{m(s.nonBillable)}</Td>
                  <Td numeric>{s.cases}</Td>
                  <Td numeric className="pr-5">
                    {s.autoShare} %
                  </Td>
                </Tr>
              ))}
              <Tr>
                <Td className="pl-5 font-semibold">{t('total')}</Td>
                <Td numeric className="font-semibold">
                  {m(sum('billable'))}
                </Td>
                <Td numeric className="font-semibold">
                  {m(sum('nonBillable'))}
                </Td>
                <Td numeric className="font-semibold">
                  {sum('cases')}
                </Td>
                <Td numeric className="pr-5 font-semibold">
                  {r.autoShare} %
                </Td>
              </Tr>
            </tbody>
          </Table>
        )}
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card padding="none" className="overflow-x-auto">
          <div className="px-5 pb-2 pt-5">
            <CardHeader title={t('support.perCategory')} />
          </div>
          <Table aria-label={t('support.perCategory')}>
            <thead>
              <tr>
                <Th className="pl-5">{t('support.colCategory')}</Th>
                <Th numeric>{t('support.colTime')}</Th>
                <Th numeric>{t('support.colCases')}</Th>
                <Th numeric className="pr-5">
                  {t('support.colShare')}
                </Th>
              </tr>
            </thead>
            <tbody>
              {r.perCategory.map((c) => (
                <Tr key={c.category}>
                  <Td className="pl-5">{tc(`category.${c.category}` as 'category.error')}</Td>
                  <Td numeric>{m(c.minutes)}</Td>
                  <Td numeric>{c.cases}</Td>
                  <Td numeric className="pr-5">
                    {c.share} %
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card padding="none" className="overflow-x-auto">
          <div className="px-5 pb-2 pt-5">
            <CardHeader title={t('support.topCustomers')} />
          </div>
          <Table aria-label={t('support.topCustomers')}>
            <thead>
              <tr>
                <Th className="pl-5">{t('support.colCustomer')}</Th>
                <Th numeric>{t('support.colCases')}</Th>
                <Th numeric>{t('support.colBilled')}</Th>
                <Th numeric>{t('support.colAmount')}</Th>
                <Th numeric className="pr-5">
                  {t('support.colShare')}
                </Th>
              </tr>
            </thead>
            <tbody>
              {r.topCustomers.map((c) => (
                <Tr key={c.tenantId}>
                  <Td className="pl-5">
                    <CustomerChip name={c.name} />
                  </Td>
                  <Td numeric>{c.cases}</Td>
                  <Td numeric>{m(c.billedMinutes)}</Td>
                  <Td numeric>{money(c.netOre, locale)}</Td>
                  <Td numeric className="pr-5">
                    {c.share} %
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </PageBody>
  );
  return (
    <Responsive
      desktop={desktop}
      mobile={
        <SupportReportMobile r={r} range={range} custom={sp.period === 'custom'} growth={growth} />
      }
    />
  );
}
