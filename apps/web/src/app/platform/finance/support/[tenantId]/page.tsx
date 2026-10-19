import { supportMonth } from '@agentor/core';
import { isUuid } from '@agentor/db';
import { formatDateTime, formatMinutes, type Locale } from '@agentor/i18n';
import { Banner, Card, Icon, StatusPill, Table, Td, Th, Tr } from '@agentor/ui';
import { ArrowLeft, ArrowRight, CreditCard, FileText } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ButtonLink } from '@/components/button-link';
import { ApproveButton, PreviewInvoicesButton } from '@/components/platform/finance/draft-buttons';
import { dayMonth, money, monthLong, withParams } from '@/components/platform/finance/bits';
import { Logo } from '@/components/logo';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { parseMonth, subscriptionRows, supportForMonth } from '@/server/finance-data';
import { requireStaff } from '@/server/platform';

export async function generateMetadata() {
  const t = await getTranslations('platform.finance.draft');
  return { title: t('title') };
}

/** Supportfaktura (F5): the draft for one customer and month, approved by Superadmin. */
export default async function SupportInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ month?: string; rounding?: string }>;
}) {
  const { actor } = await requireStaff(true);
  const { tenantId } = await params;
  const sp = await searchParams;
  if (!isUuid(tenantId)) notFound();
  const t = await getTranslations('platform.finance');
  const locale = (await getLocale()) as Locale;
  const m = parseMonth(sp.month);
  const [data, subs] = await Promise.all([supportForMonth(actor, m), subscriptionRows(actor)]);
  const index = data.customers.findIndex((c) => c.tenantId === tenantId);
  const c = data.customers[index];
  const sub = subs.find((s) => s.tenantId === tenantId);
  if (!sub) notFound();
  const showRounding = sp.rounding === '1';
  const invoice = c?.invoice ?? null;
  // A sent or approved invoice shows its own lines; a draft shows the live lines.
  const lines =
    invoice && (invoice.approvedAt || invoice.status !== 'draft')
      ? invoice.lines.map((l) => ({
          text: l.text,
          detail: l.detail ?? '',
          registered: l.registeredMinutes ?? 0,
          billed: l.billedMinutes ?? 0,
          rate: l.rateOre ?? data.rateOre,
          amount: l.amountOre,
        }))
      : (c?.lines ?? []).map((l) => ({
          text: l.text,
          detail: '',
          registered: l.registeredMinutes,
          billed: l.billedMinutes,
          rate: l.rateOre,
          amount: l.amountOre,
        }));
  const net = lines.reduce((a, l) => a + l.amount, 0);
  const vat = Math.round(net * 0.25);
  const prev = index > 0 ? data.customers[index - 1] : null;
  const next = index >= 0 && index < data.customers.length - 1 ? data.customers[index + 1] : null;
  const sendAt = invoice?.sendAt ?? supportMonth(m.year, m.month).sendAt;
  const state = !invoice
    ? t('draft.notCreated')
    : invoice.status === 'paid'
      ? t('state.paid')
      : invoice.status !== 'draft'
        ? t('draft.sent', { number: invoice.number ?? '' })
        : invoice.approvedAt
          ? t('draft.approvedBy', { name: invoice.approvedByName ?? '' })
          : t('state.draft');
  const method =
    sub.paymentMethod === 'invoice'
      ? t('draft.byInvoice')
      : sub.paymentMethod === 'mobilepay'
        ? 'MobilePay'
        : `${sub.cardBrand === 'mastercard' ? 'Mastercard' : 'Visa'} •••• ${sub.cardLast4 ?? ''}`;

  return (
    <PageBody>
      <Link
        href={`/platform/finance/support?month=${m.key}`}
        className="inline-flex items-center gap-2 text-table font-medium text-fg-1 no-underline"
      >
        <Icon icon={ArrowLeft} size={16} />
        {t('tab.support')} · {monthLong(m.start, locale)}
      </Link>
      <PageHeader
        title={t('draft.heading', { name: sub.tenantName })}
        subtitle={t('draft.sub', {
          month: `${monthLong(m.start, locale)} ${m.year}`,
          state: invoice?.status === 'draft' || !invoice ? t('state.draft').toLowerCase() : state,
          n: index + 1,
          total: data.customers.length,
          date: dayMonth(m.end, locale),
        })}
        actions={
          <>
            {prev ? (
              <ButtonLink
                href={withParams(`/platform/finance/support/${prev.tenantId}`, { month: m.key })}
              >
                <Icon icon={ArrowLeft} size={16} />
                {t('previous')}
              </ButtonLink>
            ) : null}
            {next ? (
              <ButtonLink
                href={withParams(`/platform/finance/support/${next.tenantId}`, { month: m.key })}
              >
                {t('next')}
                <Icon icon={ArrowRight} size={16} />
              </ButtonLink>
            ) : null}
            {invoice ? (
              <ApproveButton
                tenantId={tenantId}
                invoiceId={invoice.id}
                approved={Boolean(invoice.approvedAt) || invoice.status !== 'draft'}
              />
            ) : (
              <PreviewInvoicesButton
                month={m.key}
                firstTenantId={tenantId}
                label={t('draft.create')}
              />
            )}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card className="flex flex-col gap-6 lg:col-span-8" padding="none">
          <div className="flex flex-wrap justify-between gap-6 px-6 pt-6">
            <div className="flex flex-col gap-1">
              <Logo />
              <span className="text-meta text-fg-2">Agentor ApS · app.agentor.dk</span>
            </div>
            <dl className="m-0 grid grid-cols-kv gap-x-6 gap-y-1 text-meta">
              <dt className="text-fg-2">{t('draft.number')}</dt>
              <dd className="m-0 font-mono">{invoice?.number ?? t('draft.numberOnSend')}</dd>
              <dt className="text-fg-2">{t('draft.date')}</dt>
              <dd className="m-0">
                {dayMonth(sendAt, locale)} {m.end.getFullYear()}
              </dd>
              <dt className="text-fg-2">{t('draft.due')}</dt>
              <dd className="m-0">
                {sub.paymentMethod === 'invoice' ? t('draft.dueInvoice') : t('draft.dueCard')}
              </dd>
            </dl>
          </div>
          <div className="flex flex-col px-6 text-table">
            <strong>{sub.tenantName}</strong>
            {sub.cvr && <span>CVR {sub.cvr}</span>}
            {sub.billingEmail && <span className="text-fg-2">{sub.billingEmail}</span>}
          </div>
          <Table>
            <thead>
              <tr>
                <Th className="pl-6">{t('draft.case')}</Th>
                {showRounding && <Th numeric>{t('col.registered')}</Th>}
                <Th numeric>{t('col.billed')}</Th>
                <Th numeric>{t('draft.rate')}</Th>
                <Th numeric className="pr-6">
                  {t('draft.amount')}
                </Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <Tr key={l.text}>
                  <Td className="pl-6">
                    <span className="flex flex-col whitespace-normal">
                      <span>{l.text}</span>
                      {l.detail && <span className="text-meta text-fg-2">{l.detail}</span>}
                    </span>
                  </Td>
                  {showRounding && <Td numeric>{formatMinutes(l.registered, locale)}</Td>}
                  <Td numeric>{formatMinutes(l.billed, locale)}</Td>
                  <Td numeric>{money(l.rate, locale)}</Td>
                  <Td numeric className="pr-6">
                    {money(l.amount, locale)}
                  </Td>
                </Tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <Td colSpan={5} className="pl-6 text-fg-2">
                    {t('noSupport')}
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
          <dl className="m-0 ml-auto grid grid-cols-kv gap-x-8 gap-y-2 px-6 pb-6 text-right text-table">
            <dt className="text-fg-2">{t('draft.subtotal')}</dt>
            <dd className="m-0 tabular">{money(net, locale)}</dd>
            <dt className="text-fg-2">{t('draft.vat')}</dt>
            <dd className="m-0 tabular">{money(vat, locale)}</dd>
            <dt className="font-semibold">{t('draft.total')}</dt>
            <dd className="m-0 text-section tabular">{money(net + vat, locale)}</dd>
          </dl>
        </Card>
        <div className="flex flex-col gap-5 lg:col-span-4">
          <Card className="flex flex-col gap-4">
            <h2 className="m-0 text-card">{t('draft.sending')}</h2>
            <dl className="m-0 grid grid-cols-kv gap-x-6 gap-y-3 text-table">
              <dt className="text-fg-2">{t('col.status')}</dt>
              <dd className="m-0">
                <StatusPill
                  status={invoice?.approvedAt || invoice?.status === 'paid' ? 'ok' : 'info'}
                  compact
                >
                  {state}
                </StatusPill>
              </dd>
              <dt className="text-fg-2">{t('draft.sends')}</dt>
              <dd className="m-0">{formatDateTime(sendAt, locale)}</dd>
              <dt className="text-fg-2">{t('draft.payment')}</dt>
              <dd className="m-0 flex flex-col gap-0.5">
                <span className="inline-flex items-center gap-2">
                  <Icon
                    icon={sub.paymentMethod === 'invoice' ? FileText : CreditCard}
                    size={16}
                    className="text-fg-2"
                  />
                  {method}
                </span>
                <span className="text-meta text-fg-2">
                  {sub.paymentMethod === 'invoice'
                    ? t('draft.invoiceTerms')
                    : t('draft.chargedOnSend')}
                </span>
              </dd>
              <dt className="text-fg-2">{t('draft.recipient')}</dt>
              <dd className="m-0 break-all">{sub.billingEmail ?? '–'}</dd>
            </dl>
          </Card>
          <Card className="flex flex-col gap-1">
            <Link
              href={withParams(`/platform/finance/support/${tenantId}`, {
                month: m.key,
                rounding: showRounding ? undefined : '1',
              })}
              scroll={false}
              className="flex items-start gap-3 text-fg-1 no-underline"
              aria-pressed={showRounding}
            >
              <span
                className={
                  showRounding
                    ? 'mt-0.5 grid size-5 place-items-center rounded-2xs bg-fg-1 text-white'
                    : 'mt-0.5 size-5 rounded-2xs shadow-ring-strong'
                }
                aria-hidden
              >
                {showRounding ? '✓' : ''}
              </span>
              <span className="flex flex-col">
                <span className="text-body font-semibold">{t('draft.showRounding')}</span>
                <span className="text-meta text-fg-2">{t('draft.showRoundingHelp')}</span>
              </span>
            </Link>
          </Card>
          {c && c.nonBillableMinutes > 0 && (
            <Banner tone="info">
              {t('draft.notBilled', { time: formatMinutes(c.nonBillableMinutes, locale) })}
            </Banner>
          )}
        </div>
      </div>
    </PageBody>
  );
}
