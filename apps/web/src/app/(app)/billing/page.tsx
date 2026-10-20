import { withVat } from '@agentor/core';
import { listInvoices } from '@agentor/db';
import { formatDate, formatMoney, formatNumber, formatPercent } from '@agentor/i18n';
import { Banner, Card, UsageMeter } from '@agentor/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { brandName } from '@/components/billing/card';
import { requireRole } from '@/server/auth/session';
import { billingOverview } from '@/server/billing-overview';
import { db } from '@/server/infra';
import { InvoiceTable } from './invoice-table';
import { PaymentMethod } from './payment-method';
import { PlanCompare } from './plan-compare';
import { PlanHero } from './plan-hero';
import { QuotaNotice } from './quota-notice';
import { Responsive } from '@agentor/ui/mobile';
import { BillingMobile } from './mobile';

export async function generateMetadata() {
  const t = await getTranslations('pages');
  return { title: t('billing') };
}

/** Abonnement og forbrug (D13). */
export default async function BillingPage() {
  const ctx = await requireRole(['owner']);
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const [o, invoices] = await Promise.all([billingOverview(ctx), listInvoices(db(), c)]);
  if (!o) notFound();
  const t = await getTranslations('billing');
  const locale = (await getLocale()) as 'da' | 'en';
  const e = o.plan.entitlements;
  const renews = o.subscription.currentPeriodEnd;
  const unlimited = t('unlimited');
  const n = (v: number) => formatNumber(v, locale);

  const desktop = (
    <PageBody>
      <PageHeader title={t('title')} subtitle={t('ownerOnly')} />
      {o.subscription.status === 'past_due' && (
        <Banner tone="error">
          {t('pastDue', {
            since: o.subscription.pastDueSince
              ? formatDate(o.subscription.pastDueSince, locale)
              : '',
          })}
        </Banner>
      )}
      <QuotaNotice quota={o.quota} />
      <div className="grid gap-4 lg:grid-cols-12">
        <PlanHero
          className="lg:col-span-5"
          planName={o.plan.name}
          price={
            o.subscription.interval === 'year'
              ? t('perYear', { price: n(Math.round((o.plan.priceMonthlyOre * 10) / 100)) })
              : t('perMonth', { price: n(Math.round(o.plan.priceMonthlyOre / 100)) })
          }
          interval={o.subscription.interval}
          switchPrice={
            o.subscription.interval === 'year'
              ? t('perMonth', { price: n(Math.round(o.plan.priceMonthlyOre / 100)) })
              : t('perYear', { price: n(Math.round((o.plan.priceMonthlyOre * 10) / 100)) })
          }
          renewsOn={renews ? formatDate(renews, locale) : null}
          renewal={
            o.subscription.status === 'incomplete'
              ? t('noCardYet')
              : t('renews', {
                  date: renews ? formatDate(renews, locale) : '–',
                  card: o.subscription.cardLast4
                    ? `${brandName(o.subscription.cardBrand)} •••• ${o.subscription.cardLast4}`
                    : t('noCard'),
                })
          }
          upgradeTo={
            o.plans.find((p) => p.sortOrder > o.plan.sortOrder && o.blockers[p.id]?.length === 0) ??
            null
          }
        />
        <Card className="grid gap-x-8 gap-y-6 md:grid-cols-2 lg:col-span-7">
          <div className="flex flex-col gap-1.5">
            <UsageMeter
              label={t('transactions')}
              used={o.quota.used}
              limit={o.quota.limit}
              valueText={`${n(o.quota.used)} / ${o.quota.limit === null ? unlimited : n(o.quota.limit)}`}
            />
            <p className="m-0 text-meta text-fg-2">
              {t('transactionsHint', {
                pct: formatPercent(o.quota.ratio, locale, 0),
                date: renews ? formatDate(renews, locale) : '–',
              })}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <UsageMeter
              label={t('integrationSets')}
              used={o.usage.integrationSets}
              limit={e.integrationSets}
              valueText={`${o.usage.integrationSets} / ${e.integrationSets === null ? unlimited : e.integrationSets}`}
            />
            <p className="m-0 text-meta text-fg-2">
              {e.destinationsPerFlow === null
                ? t('integrationSetHintUnlimited')
                : t('integrationSetHint', { count: e.destinationsPerFlow })}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <UsageMeter
              label={t('seats')}
              used={o.usage.seats}
              limit={e.seats}
              valueText={`${o.usage.seats} / ${e.seats === null ? unlimited : e.seats}`}
            />
            <p className="m-0 text-meta text-fg-2">
              {t('externalUsers', { count: o.usage.externalUsers })}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-table">
              <span className="font-medium">{t('retention')}</span>
              <span className="tabular font-semibold">
                {t('days', { count: e.payloadRetentionDays })}
              </span>
            </div>
            <p className="m-0 text-meta text-fg-2">
              {t('retentionHint', { months: e.runHistoryMonths })}
            </p>
          </div>
        </Card>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="compare-heading">
        <h2 id="compare-heading" className="m-0 text-card">
          {t('compare')}
        </h2>
        <PlanCompare
          current={o.plan.id}
          plans={o.plans.map((p) => ({
            id: p.id,
            name: p.name,
            priceOre: p.priceMonthlyOre,
            sortOrder: p.sortOrder,
            pollingMinutes: p.entitlements.pollingIntervalMinutes,
            transactions: p.entitlements.transactionsPerMonth,
            destinations: p.entitlements.destinationsPerFlow,
            features: p.entitlements.features.included,
            excluded: p.entitlements.features.excluded,
            blockers: o.blockers[p.id] ?? [],
            grossOre: withVat(p.priceMonthlyOre).gross,
          }))}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-12">
        <PaymentMethod
          className="lg:col-span-4"
          card={
            o.subscription.cardLast4
              ? {
                  brand: brandName(o.subscription.cardBrand),
                  last4: o.subscription.cardLast4,
                  expiry: o.subscription.cardExpiry,
                }
              : null
          }
        />
        <InvoiceTable
          className="lg:col-span-8"
          locale={locale}
          invoices={invoices.slice(0, 6).map((i) => ({
            id: i.id,
            number: i.number ?? '',
            date: formatDate(i.periodStart, locale),
            description: i.description,
            amount: formatMoney((i.amountOre + i.vatOre) / 100, locale),
            status: i.status === 'draft' ? 'open' : i.status,
          }))}
        />
      </div>
    </PageBody>
  );
  return <Responsive desktop={desktop} mobile={<BillingMobile ctx={ctx} o={o} />} />;
}
