import type { ErrorGroup } from '@agentor/db';
import { cn } from '@agentor/ui';
import {
  ChipGroup,
  MobileCard,
  MobileEmpty,
  MobileFootnote,
  MobilePageTitle,
  MobileShell,
  Row,
} from '@agentor/ui/mobile';
import { CircleCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { PlatformSubTabs } from '@/components/mobile/sub-tabs';
import { DateRangeForm } from '@/components/platform/date-range-form';

/**
 * MP05 Fejl: error codes and counts across customers for 24 timer, 7 dage, 30 dage or a Fra/til
 * period, as on S7. Which customers a code hits stays on the server (decision 16).
 */
export async function ErrorsMobile({
  groups,
  describe,
  period,
  from,
  to,
  max,
  aside,
}: {
  groups: ErrorGroup[];
  describe: (code: string) => string;
  /** The chip in use, or null when a Fra/til period is. */
  period: '24h' | '7d' | '30d' | null;
  from: string;
  to: string;
  max: string;
  aside: string;
}) {
  const t = await getTranslations('mobile.platform.errors');
  const tp = await getTranslations('platform.errors');
  const records = groups.reduce((a, g) => a + g.records, 0);
  const customers = new Set(groups.flatMap((g) => g.tenantIds)).size;
  const noCase = groups.filter((g) => g.caseNumbers.length === 0).length;
  const sorted = [...groups].sort((a, b) => b.records - a.records);
  const trend = (g: ErrorGroup) =>
    g.previousCustomers === 0
      ? { text: `↑ ${t('new')}`, bad: true }
      : g.trend === 'rising'
        ? { text: `↑ ${t('rising')}`, bad: true }
        : g.trend === 'falling'
          ? { text: `↓ ${t('falling')}`, bad: false }
          : { text: t('stable'), bad: false };

  return (
    <MobileShell topBar={<PlatformTopBar />}>
      <PlatformSubTabs />
      <MobilePageTitle title={t('title')} aside={aside} />
      <ChipGroup
        label={tp('period')}
        linkAs={Link}
        value={period}
        items={(['24h', '7d', '30d'] as const).map((p) => ({
          key: p,
          label: tp(`p${p}`),
          href: `/platform/support/errors?period=${p}`,
        }))}
      />
      <DateRangeForm
        mobile
        action="/platform/support/errors"
        from={from}
        to={to}
        max={max}
        labels={{ legend: tp('period'), from: tp('from'), to: tp('to'), apply: tp('apply') }}
      />
      <MobileCard>
        <dl className="m-0 grid grid-cols-3 divide-x divide-border">
          {[
            { value: records, label: t('records'), bad: false },
            { value: customers, label: t('customers'), bad: false },
            { value: noCase, label: t('noCase'), bad: noCase > 0 },
          ].map((s) => (
            <div key={s.label} className="flex flex-col-reverse px-4 py-3.5">
              <dt className="text-meta font-medium text-fg-2">{s.label}</dt>
              <dd className={cn('m-0 text-m-hero tabular', s.bad && 'text-error-fg')}>{s.value}</dd>
            </div>
          ))}
        </dl>
      </MobileCard>
      {sorted.length === 0 ? (
        <MobileEmpty icon={CircleCheck} title={t('empty')} />
      ) : (
        <MobileCard>
          {sorted.map((g) => {
            const tr = trend(g);
            const explain = describe(g.code);
            const meta =
              g.caseNumbers.length === 0
                ? t('metaNoCase', { explain, count: g.customers })
                : t('meta', { explain, count: g.customers });
            return (
              <Row
                key={`${g.connectorId}:${g.code}`}
                title={<span className="font-mono text-mono">{g.code}</span>}
                meta={explain ? meta : meta.replace(/^ · /, '')}
                trailing={
                  <span className="flex flex-none flex-col items-end">
                    <strong className="text-card tabular">{g.records}</strong>
                    <span
                      className={cn(
                        'text-micro font-semibold',
                        tr.bad ? 'text-error-fg' : 'text-fg-2',
                      )}
                    >
                      {tr.text}
                    </span>
                  </span>
                }
              />
            );
          })}
        </MobileCard>
      )}
      <MobileFootnote>{t('note')}</MobileFootnote>
    </MobileShell>
  );
}
