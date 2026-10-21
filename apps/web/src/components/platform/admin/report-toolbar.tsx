import { Icon } from '@agentor/ui';
import { BigButtonLink, MobilePageTitle, Segmented } from '@agentor/ui/mobile';
import { Download, FileText } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/button-link';
import { PlatformSubTabs } from '@/components/mobile/sub-tabs';
import { DateRangeForm } from '@/components/platform/date-range-form';
import { FilterStatus, UrlSegmented } from '@/components/platform/url-segmented';
import type { DateRange } from '@/server/date-range';

export type ReportType = 'revenue' | 'support' | 'invoicing';
export const REPORT_TYPES: ReportType[] = ['revenue', 'support', 'invoicing'];

/**
 * The top of Administration › Rapporter (F7, A3, A4): report type, the Fra/til period (A3, A4)
 * and PDF/CSV for that period. The type and period live in the URL.
 */
export async function ReportToolbar({
  type,
  range,
  query,
  extra,
}: {
  type: ReportType;
  /** Omitted on Omsætning, which picks a whole month in its list instead. */
  range?: DateRange;
  /** ?from=&to= for the type links and the exports. */
  query: string;
  extra?: ReactNode;
}) {
  const t = await getTranslations('platform.reports');
  const base = '/platform/admin/reports';
  return (
    <div className="flex flex-col items-end gap-3">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <UrlSegmented
          label={t('typeLabel')}
          segments={REPORT_TYPES.map((r) => ({
            href: `${base}/${r}?${query}`,
            label: t(`type.${r}`),
            active: r === type,
          }))}
        />
        {range && (
          <DateRangeForm
            action={`${base}/${type}`}
            from={range.fromIso}
            to={range.toIso}
            labels={{ legend: t('period'), from: t('from'), to: t('to'), apply: t('apply') }}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <ButtonLink
          variant="secondary"
          href={`${base}/${type}/export.pdf?${query}`}
          prefetch={false}
        >
          <Icon icon={FileText} size={16} />
          {t('pdf')}
        </ButtonLink>
        <ButtonLink
          variant="secondary"
          href={`${base}/${type}/export.csv?${query}`}
          prefetch={false}
        >
          <Icon icon={Download} size={16} />
          {t('csv')}
        </ButtonLink>
        {extra}
      </div>
      <FilterStatus>{t('showing', { type: t(`type.${type}`) })}</FilterStatus>
    </div>
  );
}

/**
 * The top of the phone reports (MP23, MP27, MP28): the section tabs, "Rapporter", the report type
 * and, on Support og tid and Fakturering, Fra and Til.
 */
export async function ReportMobileHead({
  type,
  range,
  query,
}: {
  type: ReportType;
  /** Fra and Til; on Omsætning the month shown, which picking a date changes. */
  range?: Pick<DateRange, 'fromIso' | 'toIso'>;
  query: string;
}) {
  const t = await getTranslations('platform.reports');
  const base = '/platform/admin/reports';
  return (
    <>
      <PlatformSubTabs />
      <MobilePageTitle title={t('title')} />
      <Segmented
        label={t('typeLabel')}
        linkAs={Link}
        value={type}
        items={REPORT_TYPES.map((r) => ({
          key: r,
          label: t(`type.${r}`),
          href: `${base}/${r}?${query}`,
        }))}
      />
      {range && (
        <DateRangeForm
          mobile
          action={`${base}/${type}`}
          from={range.fromIso}
          to={range.toIso}
          labels={{ legend: t('period'), from: t('from'), to: t('to'), apply: t('apply') }}
        />
      )}
    </>
  );
}

/** "Gem som PDF" and "Eksportér CSV" docked above the tab bar (MP27, MP28). */
export async function ReportMobileExports({ type, query }: { type: ReportType; query: string }) {
  const t = await getTranslations('platform.reports');
  const base = `/platform/admin/reports/${type}`;
  return (
    <div className="sticky bottom-over-tabbar z-20 -mx-4 mt-1 flex gap-2.5 bg-white px-4 pt-3 pb-5 shadow-hairline-t">
      <BigButtonLink
        variant="secondary"
        icon={FileText}
        href={`${base}/export.pdf?${query}`}
        className="flex-1"
      >
        {t('pdfMobile')}
      </BigButtonLink>
      <BigButtonLink
        variant="secondary"
        icon={Download}
        href={`${base}/export.csv?${query}`}
        className="flex-1"
      >
        {t('csvMobile')}
      </BigButtonLink>
    </div>
  );
}
