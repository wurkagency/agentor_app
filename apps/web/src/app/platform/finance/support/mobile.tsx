import { formatMinutes, formatNumber, type Locale } from '@agentor/i18n';
import {
  CardActions,
  CardButton,
  ExpandCard,
  KV,
  MobileCallout,
  MobileEmpty,
  MobileFootnote,
  MobileKpi,
  MobileLogo,
  MobileShell,
  Segmented,
} from '@agentor/ui/mobile';
import { Clock, FileText, Headphones } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { dayMonth, growthOf, kr, monthYear } from '@/components/platform/finance/bits';
import { KpiPair, KrValue, SmallKpi } from '@/components/platform/finance/mobile-bits';
import { growthPct, pct, type CustomerSupport, type Month } from '@/server/finance-data';

export interface SettlementMobileData {
  m: Month;
  isOpen: boolean;
  rateOre: number;
  totals: { registered: number; billed: number; gross: number; net: number; nonBillable: number };
  prevGross: number;
  prevBilled: number;
  series: number[];
  customers: CustomerSupport[];
  live: number;
  /** September | Oktober as links. */
  months: { key: string; label: string; href: string }[];
}

/** MP19 Supportafregning (F3): the month's support per customer, cases folded out. */
export async function SettlementMobile({ d }: { d: SettlementMobileData }) {
  const t = await getTranslations('mobile.settlement');
  const tf = await getTranslations('platform.finance');
  const locale = (await getLocale()) as Locale;
  const { m, totals } = d;
  const krs = (ore: number) => `${kr(ore, locale)} kr.`;
  const rate = pct(totals.registered, totals.registered + totals.nonBillable);
  return (
    <MobileShell
      topBar={
        <PlatformTopBar
          back="/platform/finance"
          title={tf('tab.support')}
          subtitle={t('subtitle', {
            month: monthYear(m.start, locale),
            rate: kr(Math.round(d.rateOre * 1.25), locale),
          })}
          bell={false}
        />
      }
    >
      {d.isOpen && (
        <MobileCallout
          tone="info"
          icon={Clock}
          title={t('closes', { date: dayMonth(new Date(m.end.getTime() - 1), locale) })}
        >
          {t('sends', { date: dayMonth(m.end, locale) })}
        </MobileCallout>
      )}
      <KpiPair>
        <MobileKpi
          featured
          label={tf('billing.billedTime')}
          trend={growthOf(growthPct(totals.gross, d.prevGross), (a) => `${a} %`, locale)}
          value={<KrValue value={kr(totals.gross, locale)} />}
          data={d.series}
          meta={tf('billing.exVat', { amount: krs(totals.net) })}
        />
        <SmallKpi
          label={tf('billing.registered')}
          trend={growthOf(growthPct(totals.billed, d.prevBilled), (a) => `${a} %`, locale)}
          value={formatMinutes(totals.registered, locale)}
          meta={t('billed', { time: formatMinutes(totals.billed, locale) })}
        />
      </KpiPair>
      <KpiPair>
        <SmallKpi
          label={tf('billing.customersWith')}
          value={formatNumber(d.customers.length, locale)}
          meta={t('ofCustomers', {
            pct: formatNumber(pct(d.customers.length, d.live), locale),
            count: d.live,
          })}
        />
        <SmallKpi
          label={tf('billing.rate')}
          value={`${formatNumber(rate, locale)} %`}
          meta={t('notBillable', { time: formatMinutes(totals.nonBillable, locale) })}
        />
      </KpiPair>
      <Segmented
        label={tf('billing.month')}
        linkAs={Link}
        value={m.key}
        items={d.months.map((x) => ({ key: x.key, label: x.label, href: x.href }))}
      />
      {d.customers.length === 0 ? (
        <MobileEmpty icon={Headphones} title={tf('noSupport')} />
      ) : (
        d.customers.map((c) => (
          <ExpandCard
            key={c.tenantId}
            leading={<MobileLogo name={c.tenantName} size={32} />}
            title={c.tenantName}
            meta={`${formatMinutes(c.billed, locale)} · ${krs(c.grossOre)}`}
          >
            <KV k={t('planCases')}>
              {c.planName} · {c.lines.length}
            </KV>
            <KV k={tf('col.registered')}>{formatMinutes(c.registered, locale)}</KV>
            <KV k={tf('col.billed')}>
              <strong>{formatMinutes(c.billed, locale)}</strong>
            </KV>
            <KV k={tf('col.amountInclVat')}>
              <strong>{krs(c.grossOre)}</strong>
            </KV>
            {c.lines.map((l) => (
              <div key={l.caseId} className="flex flex-col gap-0.5 pt-2 text-table leading-snug">
                <span className="truncate">
                  <span className="font-mono text-fg-2">#{l.caseNumber}</span>{' '}
                  {l.text.replace(/^#\d+\s*/, '')}
                </span>
                <span className="text-fg-2 tabular">
                  {t('line', {
                    registered: formatMinutes(l.registeredMinutes, locale),
                    billed: formatMinutes(l.billedMinutes, locale),
                    amount: krs(Math.round(l.amountOre * 1.25)),
                  })}
                </span>
              </div>
            ))}
            <CardActions>
              <CardButton
                href={`/platform/finance/support/${c.tenantId}?month=${m.key}`}
                linkAs={Link}
                icon={FileText}
              >
                {t('invoice')}
              </CardButton>
            </CardActions>
          </ExpandCard>
        ))
      )}
      <MobileFootnote>{t('footnote')}</MobileFootnote>
    </MobileShell>
  );
}
