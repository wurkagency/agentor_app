import { formatMinutes, type Locale } from '@agentor/i18n';
import type { Growth } from '@agentor/ui';
import { ExpandCard, MobileCard, MobileShell, TrendPill } from '@agentor/ui/mobile';
import { getLocale, getTranslations } from 'next-intl/server';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { ReportMobileExports, ReportMobileHead } from '@/components/platform/admin/report-toolbar';
import { kr } from '@/components/platform/finance/bits';
import { NameValue } from '@/components/platform/finance/mobile-bits';
import type { DateRange } from '@/server/date-range';
import type { SupportReport } from '@/server/reports';

/**
 * MP27 Rapporter › Support og tid: four key figures for the Fra/til period, then time per
 * supporter, per category and the largest customers as folding cards. Same rows as A3, the PDF
 * and the CSV.
 */
export async function SupportReportMobile({
  r,
  range,
  custom,
  growth,
}: {
  r: SupportReport;
  range: DateRange;
  custom: boolean;
  growth: {
    registered?: Growth | undefined;
    billed?: Growth | undefined;
    nonBillable?: Growth | undefined;
    resolved?: Growth | undefined;
  };
}) {
  const t = await getTranslations('platform.reports');
  const tc = await getTranslations('platform.case');
  const locale = (await getLocale()) as Locale;
  const m = (n: number) => formatMinutes(n, locale);
  const rounding = r.billedMinutes - r.registeredMinutes;
  const top = r.topCustomers[0];
  const kpis: { label: string; value: string; sub: string; trend?: Growth | undefined }[] = [
    {
      label: t('support.registered'),
      value: m(r.registeredMinutes),
      sub: t('support.billableShort'),
      trend: growth.registered,
    },
    {
      label: t('support.billed'),
      value: m(r.billedMinutes),
      sub: t('support.roundingShort', {
        pct: r.registeredMinutes ? Math.round((rounding / r.registeredMinutes) * 100) : 0,
      }),
      trend: growth.billed,
    },
    {
      label: t('support.nonBillable'),
      value: m(r.nonBillableMinutes),
      sub: t('support.nonBillableShort'),
      trend: growth.nonBillable,
    },
    {
      label: t('support.resolved'),
      value: String(r.casesResolved),
      sub:
        r.medianResolvedMinutes === null
          ? t('support.customers', { count: r.customersResolved })
          : t('support.medianShort', { time: m(r.medianResolvedMinutes) }),
      trend: growth.resolved,
    },
  ];
  return (
    <MobileShell topBar={<PlatformTopBar />}>
      <ReportMobileHead type="support" range={range} custom={custom} />
      <div className="grid grid-cols-2 gap-3">
        {kpis.map((k) => (
          <MobileCard key={k.label} className="flex min-w-0 flex-col gap-1 px-3.5 py-3">
            <span className="flex items-center justify-between gap-1.5 overflow-hidden whitespace-nowrap">
              <span className="truncate text-meta font-medium text-fg-2">{k.label}</span>
              {k.trend && <TrendPill growth={k.trend} />}
            </span>
            <strong className="text-m-kpi tabular">{k.value}</strong>
            <span className="truncate text-micro text-fg-2">{k.sub}</span>
          </MobileCard>
        ))}
      </div>
      <ExpandCard
        title={t('support.perStaff')}
        meta={t('support.perStaffMeta', { count: r.perStaff.length, pct: r.autoShare })}
      >
        {r.perStaff.length === 0 ? (
          <p className="m-0 pt-2 text-table text-fg-2">{t('support.empty')}</p>
        ) : (
          r.perStaff.map((s) => (
            <NameValue key={s.name} name={s.name}>
              {t('support.timeCases', { time: m(s.billable), count: s.cases })}
            </NameValue>
          ))
        )}
      </ExpandCard>
      <ExpandCard
        title={t('support.perCategory')}
        meta={r.perCategory
          .slice(0, 2)
          .map((c) => `${tc(`category.${c.category}` as 'category.error')} ${c.share} %`)
          .join(' · ')}
      >
        {r.perCategory.map((c, i) => (
          <NameValue key={c.category} name={tc(`category.${c.category}` as 'category.error')}>
            {i === 0
              ? t('support.timeCases', { time: m(c.minutes), count: c.cases })
              : t('support.timeCasesShort', { time: m(c.minutes), count: c.cases })}
          </NameValue>
        ))}
      </ExpandCard>
      <ExpandCard
        title={t('support.topCustomers')}
        meta={top ? t('support.topMeta', { name: top.name, pct: top.share }) : '–'}
      >
        {r.topCustomers.map((c) => (
          <NameValue key={c.tenantId} name={c.name}>
            {t('support.customerLine', {
              time: m(c.billedMinutes),
              amount: `${kr(c.netOre, locale)} kr.`,
            })}
          </NameValue>
        ))}
      </ExpandCard>
      <ReportMobileExports type="support" range={range} />
    </MobileShell>
  );
}
