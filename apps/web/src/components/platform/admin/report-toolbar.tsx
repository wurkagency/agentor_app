import { Icon } from '@agentor/ui';
import { Download, FileText } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/button-link';
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
