import { formatDate, formatMinutes, type Locale } from '@agentor/i18n';
import { StatusPill, type Growth } from '@agentor/ui';
import {
  ExpandCard,
  KV,
  MobileCard,
  MobileEmpty,
  MobileKpi,
  MobileShell,
  RowIcon,
  RowLink,
  SectionHeading,
  StackedValue,
} from '@agentor/ui/mobile';
import { FileText } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { dayMonth, growthOf, kr, monthLong } from '@/components/platform/finance/bits';
import { MobileStatement } from '@/components/platform/finance/mobile-actions';
import {
  CustomerTile,
  KpiPair,
  KrValue,
  SmallKpi,
} from '@/components/platform/finance/mobile-bits';
import { growthPct, type Month, type SubRow } from '@/server/finance-data';

export interface CustomerFinanceMobileData {
  sub: SubRow;
  cur: Month;
  ytdNet: number;
  ytdSubs: number;
  lastYear: number;
  curve: number[];
  supportGross: number;
  supportBilled: number;
  prevSupport: number;
  used: number;
  periodMonths: number;
  /** "Visa •••• 4242", "Faktura · EAN …". */
  method: string;
  subscription: { status: ComponentProps<typeof StatusPill>['status']; label: string };
  invoices: {
    key: string;
    href: string;
    /** PDFs are files from a route handler, not pages. */
    file: boolean;
    title: string;
    meta: string;
    amount: string;
    pill: ReactNode;
  }[];
}

/** MP20 Kundens økonomi (F4): one customer's revenue, subscription and invoices. */
export async function CustomerFinanceMobile({ d }: { d: CustomerFinanceMobileData }) {
  const t = await getTranslations('mobile.customerFinance');
  const tf = await getTranslations('platform.finance');
  const locale = (await getLocale()) as Locale;
  const { sub, cur } = d;
  const krs = (ore: number) => `${kr(ore, locale)} kr.`;
  const pct = (a: number, b: number): Growth | undefined =>
    growthOf(growthPct(a, b), (x) => `${x} %`, locale);
  const interval = sub.interval === 'year' ? tf('sub.yearly') : tf('sub.monthly');
  return (
    <MobileShell
      topBar={
        <PlatformTopBar
          back="/platform/finance/subscriptions"
          title={t('title')}
          subtitle={sub.tenantName}
          bell={false}
          actions={
            <MobileStatement
              tenantId={sub.tenantId}
              name={sub.tenantName}
              email={sub.billingEmail}
            />
          }
        />
      }
    >
      <MobileCard>
        <div className="flex items-center gap-3 px-4 py-3.5">
          <CustomerTile name={sub.tenantName} />
          <span className="flex min-w-0 flex-col leading-snug">
            <strong className="truncate text-card">{sub.tenantName}</strong>
            <span className="text-meta font-medium text-fg-2">
              {[
                sub.cvr ? `CVR ${sub.cvr}` : null,
                tf('customer.since', {
                  date: `${dayMonth(sub.customerSince, locale)} ${sub.customerSince.getFullYear()}`,
                }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
        </div>
      </MobileCard>
      <KpiPair>
        <MobileKpi
          featured
          label={t('revenueYear')}
          trend={pct(d.ytdNet, d.lastYear)}
          value={<KrValue value={kr(d.ytdNet, locale)} />}
          data={d.curve}
          meta={t('split', {
            subs: kr(d.ytdSubs, locale),
            support: kr(d.ytdNet - d.ytdSubs, locale),
          })}
        />
        <SmallKpi
          label={tf('customer.supportIn', { month: monthLong(cur.start, locale) })}
          trend={pct(d.supportGross, d.prevSupport)}
          value={krs(d.supportGross)}
          meta={t('supportMeta', {
            time: formatMinutes(d.supportBilled, locale),
            date: dayMonth(cur.end, locale),
          })}
        />
      </KpiPair>
      <ExpandCard
        title={t('subscription', { plan: sub.planName, interval: interval.toLowerCase() })}
        meta={`${kr(sub.priceOre, locale)} kr.${sub.interval === 'year' ? tf('perYearShort') : tf('perMonthShort')}`}
        trailing={<StatusPill status={d.subscription.status}>{d.subscription.label}</StatusPill>}
      >
        <KV k={tf('col.nextCharge')}>
          {sub.nextChargeAt
            ? sub.interval === 'year'
              ? formatDate(sub.nextChargeAt, locale)
              : dayMonth(sub.nextChargeAt, locale)
            : tf('sub.none')}
        </KV>
        <KV k={t('used')}>{t('months', { used: d.used, total: d.periodMonths })}</KV>
        <KV k={tf('col.method')}>{d.method}</KV>
      </ExpandCard>

      <SectionHeading>{t('invoices')}</SectionHeading>
      {d.invoices.length === 0 ? (
        <MobileEmpty icon={FileText} title={t('noInvoices')} />
      ) : (
        <MobileCard>
          {d.invoices.map((i) => (
            <RowLink
              key={i.key}
              href={i.href}
              {...(i.file ? {} : { linkAs: Link })}
              leading={<RowIcon icon={FileText} size={30} />}
              title={i.title}
              meta={i.meta}
              trailing={<StackedValue value={i.amount} pill={i.pill} />}
            />
          ))}
        </MobileCard>
      )}
    </MobileShell>
  );
}
