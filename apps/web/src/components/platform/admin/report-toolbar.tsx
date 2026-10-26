import { MobilePageTitle } from '@agentor/ui/mobile';
import { getLocale, getTranslations } from 'next-intl/server';
import { PlatformSubTabs } from '@/components/mobile/sub-tabs';
import { DateRangeForm } from '@/components/platform/date-range-form';
import { FilterStatus } from '@/components/platform/url-segmented';
import { monthLong } from '@/components/platform/finance/bits';
import { PERIOD_PRESETS, presetOf, presetRange } from '@/server/date-range';
import { parseMonth } from '@/server/finance-data';
import { ReportMenus, type MenuLink } from './report-menus';

export type ReportType = 'revenue' | 'support' | 'invoicing';
export const REPORT_TYPES: ReportType[] = ['revenue', 'support', 'invoicing'];

const BASE = '/platform/admin/reports';

/** Omsætning is a monthly report: only the whole-month presets apply to it. */
const PRESETS: Record<ReportType, typeof PERIOD_PRESETS> = {
  revenue: ['thisMonth', 'lastMonth'],
  support: PERIOD_PRESETS,
  invoicing: PERIOD_PRESETS,
};

interface Period {
  fromIso: string;
  toIso: string;
}

/**
 * What the menus need: the type links keep the period, the period links keep the type, and
 * "Vælg datointerval" (not on Omsætning) shows Fra/til. The bookkeeper gets the month the period
 * starts in, as the monthly report (E18) always has.
 */
async function menus(type: ReportType, range: Period, custom: boolean) {
  const t = await getTranslations('platform.reports');
  const locale = (await getLocale()) as 'da' | 'en';
  const query = `from=${range.fromIso}&to=${range.toIso}`;
  const preset = presetOf(range.fromIso, range.toIso);
  const pickRange = !preset || custom;
  const types: MenuLink[] = REPORT_TYPES.map((r) => ({
    key: r,
    label: t(`type.${r}`),
    href: `${BASE}/${r}?${query}`,
    active: r === type,
  }));
  const periods: MenuLink[] = [
    ...PRESETS[type].map((p) => {
      const r = presetRange(p);
      return {
        key: p,
        label: t(`preset.${p}`),
        href: `${BASE}/${type}?from=${r.fromIso}&to=${r.toIso}`,
        active: !pickRange && preset === p,
      };
    }),
    ...(type === 'revenue'
      ? []
      : [
          {
            key: 'custom',
            label: t('preset.custom'),
            href: `${BASE}/${type}?${query}&period=custom`,
            active: pickRange,
          },
        ]),
  ];
  const month = parseMonth(range.fromIso.slice(0, 7));
  return {
    t,
    query,
    pickRange: pickRange && type !== 'revenue',
    types,
    periods,
    pdfHref: `${BASE}/${type}/export.pdf?${query}`,
    csvHref: `${BASE}/${type}/export.csv?${query}`,
    sendMonth: { key: month.key, name: monthLong(month.start, locale) },
  };
}

/**
 * The top of Administration › Rapporter (F7, A3, A4): report type, period and Eksport as
 * dropdowns, and Fra/til when "Vælg datointerval" is chosen. Type and period live in the URL.
 */
export async function ReportToolbar({
  type,
  range,
  custom = false,
}: {
  type: ReportType;
  range: Period;
  /** ?period=custom: show Fra/til even when the dates match a preset. */
  custom?: boolean;
}) {
  const m = await menus(type, range, custom);
  return (
    <div className="flex flex-col items-end gap-3">
      <ReportMenus
        types={m.types}
        periods={m.periods}
        pdfHref={m.pdfHref}
        csvHref={m.csvHref}
        sendMonth={m.sendMonth}
      />
      {m.pickRange && (
        <DateRangeForm
          action={`${BASE}/${type}`}
          from={range.fromIso}
          to={range.toIso}
          keep={{ period: 'custom' }}
          labels={{
            legend: m.t('period'),
            from: m.t('from'),
            to: m.t('to'),
            apply: m.t('apply'),
          }}
        />
      )}
      <FilterStatus>{m.t('showing', { type: m.t(`type.${type}`) })}</FilterStatus>
    </div>
  );
}

/**
 * The top of the phone reports (MP23, MP27, MP28): the section tabs, "Rapporter", the report type
 * and period dropdowns, and Fra/til when a date range is picked.
 */
export async function ReportMobileHead({
  type,
  range,
  custom = false,
}: {
  type: ReportType;
  range: Period;
  custom?: boolean;
}) {
  const m = await menus(type, range, custom);
  return (
    <>
      <PlatformSubTabs />
      <MobilePageTitle title={m.t('title')} />
      <ReportMenus
        mobile
        only="pickers"
        types={m.types}
        periods={m.periods}
        pdfHref={m.pdfHref}
        csvHref={m.csvHref}
        sendMonth={m.sendMonth}
      />
      {m.pickRange && (
        <DateRangeForm
          mobile
          action={`${BASE}/${type}`}
          from={range.fromIso}
          to={range.toIso}
          keep={{ period: 'custom' }}
          labels={{
            legend: m.t('period'),
            from: m.t('from'),
            to: m.t('to'),
            apply: m.t('apply'),
          }}
        />
      )}
    </>
  );
}

/** "Eksport" docked above the tab bar on the phone reports (MP23, MP27, MP28). */
export async function ReportMobileExports({ type, range }: { type: ReportType; range: Period }) {
  const m = await menus(type, range, false);
  return (
    <div className="sticky bottom-over-tabbar z-20 -mx-4 mt-1 bg-white px-4 pt-3 pb-5 shadow-hairline-t">
      <ReportMenus
        mobile
        only="export"
        types={m.types}
        periods={m.periods}
        pdfHref={m.pdfHref}
        csvHref={m.csvHref}
        sendMonth={m.sendMonth}
      />
    </div>
  );
}
