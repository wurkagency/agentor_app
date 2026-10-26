import { withVat } from '@agentor/core';
import { customerSupportMonth, listInvoices } from '@agentor/db';
import { formatDate, formatMinutes, formatMoney, formatNumber, type Locale } from '@agentor/i18n';
import { StatusPill } from '@agentor/ui';
import {
  BigButtonLink,
  MobileCard,
  MobileShell,
  Row,
  RowIcon,
  RowLink,
  SectionHeading,
} from '@agentor/ui/mobile';
import { CalendarClock, FileText, Headset } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { brandName } from '@/components/billing/card';
import { AppTopBar } from '@/components/mobile/chrome';
import type { AppContext } from '@/server/auth/session';
import type { billingOverview } from '@/server/billing-overview';
import { db } from '@/server/infra';
import { ChangeCardRow } from './change-card-row';

/**
 * MA15 Abonnement: plan, usage, this month's support (MP19's numbers seen from the customer),
 * card change through QuickPay, next charge, invoices as PDF, and "Skift plan" (MA33).
 */
export async function BillingMobile({
  ctx,
  o,
}: {
  ctx: AppContext;
  o: NonNullable<Awaited<ReturnType<typeof billingOverview>>>;
}) {
  const t = await getTranslations('mobile.billing');
  const locale = (await getLocale()) as Locale;
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const [invoices, support] = await Promise.all([
    listInvoices(db(), c),
    customerSupportMonth(db(), c),
  ]);
  const now = new Date();
  const month = new Intl.DateTimeFormat(locale === 'da' ? 'da-DK' : 'en-GB', {
    month: 'long',
  }).format(now);
  const firstNext = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const renews = o.subscription.currentPeriodEnd;
  const yearly = o.subscription.interval === 'year';
  const priceNet = yearly ? o.plan.priceMonthlyOre * 10 : o.plan.priceMonthlyOre;
  const supportGross = withVat(Math.round((support.billedMinutes / 60) * support.rateOre)).gross;
  const ratio = o.quota.limit ? Math.min(1, o.quota.used / o.quota.limit) : 0;
  const status =
    o.subscription.status === 'past_due'
      ? { s: 'error' as const, text: t('pastDue') }
      : o.subscription.status === 'incomplete'
        ? { s: 'warn' as const, text: t('noCard') }
        : { s: 'ok' as const, text: t('paid') };
  const statusText = (s: string) =>
    ['paid', 'open', 'failed', 'refunded', 'void', 'overdue'].includes(s)
      ? t(`status.${s}` as 'status.paid')
      : s;

  return (
    <MobileShell topBar={<AppTopBar back="/more" title={t('title')} />}>
      <MobileCard>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <strong className="text-m-hero font-bold">
              {yearly
                ? t('planYear', { plan: o.plan.name })
                : t('planMonth', { plan: o.plan.name })}
            </strong>
            <StatusPill status={status.s}>{status.text}</StatusPill>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-table">
              <span className="font-medium text-fg-2">{t('transactions', { month })}</span>
              <strong className="tabular">
                {formatNumber(o.quota.used, locale)}
                {o.quota.limit !== null && ` / ${formatNumber(o.quota.limit, locale)}`}
              </strong>
            </div>
            <div
              role="meter"
              aria-label={t('transactions', { month })}
              aria-valuemin={0}
              aria-valuemax={o.quota.limit ?? o.quota.used}
              aria-valuenow={o.quota.used}
              className="h-2 overflow-hidden rounded-full bg-border"
            >
              <div className="h-full bg-fg-1" style={{ width: `${Math.round(ratio * 100)}%` }} />
            </div>
            {renews && (
              <span className="text-meta font-medium text-fg-2">
                {t('resets', { date: formatDate(renews, locale) })}
              </span>
            )}
          </div>
        </div>
      </MobileCard>
      <MobileCard>
        <Row
          leading={<RowIcon icon={Headset} size={30} />}
          title={t('support', { month })}
          meta={
            support.billedMinutes
              ? t('supportMeta', {
                  time: formatMinutes(support.billedMinutes, locale),
                  date: formatDate(firstNext, locale),
                })
              : t('supportNone')
          }
          trailing={
            <strong className="flex-none tabular">
              {formatMoney(supportGross / 100, locale).replace(/,00(?=\s?kr)/, '')}
            </strong>
          }
        />
        <ChangeCardRow
          title={t('card')}
          meta={
            o.subscription.cardLast4
              ? `${brandName(o.subscription.cardBrand)} •••• ${o.subscription.cardLast4}`
              : t('cardNone')
          }
        />
        {renews && (
          <Row
            leading={<RowIcon icon={CalendarClock} size={30} />}
            title={t('next')}
            meta={t('nextMeta', {
              date: formatDate(renews, locale),
              amount: formatMoney(withVat(priceNet).gross / 100, locale),
            })}
          />
        )}
      </MobileCard>
      {invoices.length > 0 && (
        <>
          <SectionHeading>{t('invoices')}</SectionHeading>
          <MobileCard>
            {invoices.slice(0, 4).map((i) => (
              <RowLink
                key={i.id}
                href={`/billing/invoices/${i.id}/pdf`}
                linkAs="a"
                leading={<RowIcon icon={FileText} size={30} />}
                title={i.description}
                meta={t('invoiceMeta', {
                  date: formatDate(i.issuedAt ?? i.periodStart, locale),
                  status: statusText(i.status),
                })}
                trailing={
                  <strong className="flex-none tabular">
                    {formatMoney((i.amountOre + i.vatOre) / 100, locale)}
                  </strong>
                }
              />
            ))}
          </MobileCard>
        </>
      )}
      <BigButtonLink href="/billing/plan" variant="secondary" linkAs={Link}>
        {t('changePlan')}
      </BigButtonLink>
    </MobileShell>
  );
}
