import { getInvoice, isUuid } from '@agentor/db';
import { formatDate, formatMinutes, formatMoney } from '@agentor/i18n';
import { getLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/server/auth/session';
import { db } from '@/server/infra';
import { invoicePdf } from '@/server/invoice-pdf';

/** Invoice as PDF (D13). Owner only; RLS returns nothing for other tenants' ids. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(['owner']);
  const { id } = await params;
  if (!isUuid(id)) return new Response(null, { status: 404 });
  const found = await getInvoice(db(), { tenantId: ctx.tenant.tenantId, userId: ctx.user.id }, id);
  if (!found) return new Response(null, { status: 404 });
  const { invoice: i, tenant } = found;
  const t = await getTranslations('billing');
  const locale = (await getLocale()) as 'da' | 'en';
  const money = (ore: number) => formatMoney(ore / 100, locale);
  const pdf = invoicePdf({
    number: i.number ?? '',
    date: formatDate(i.periodStart, locale),
    period: `${formatDate(i.periodStart, locale)} – ${formatDate(new Date(i.periodEnd.getTime() - 1), locale)}`,
    description: i.description,
    ...(i.kind === 'subscription'
      ? { planAmount: money(i.amountOre - i.lines.reduce((a, l) => a + l.amountOre, 0)) }
      : {}),
    extra: i.lines.map((l) => ({
      text: l.billedMinutes ? `${l.text} · ${formatMinutes(l.billedMinutes, locale)}` : l.text,
      amount: money(l.amountOre),
    })),
    net: money(i.amountOre),
    vat: money(i.vatOre),
    total: money(i.amountOre + i.vatOre),
    status: t(`invoiceStatus.${i.status}`),
    customer: {
      name: tenant.name,
      cvr: tenant.cvr,
      address: [
        tenant.addressLine,
        [tenant.postalCode, tenant.city].filter(Boolean).join(' '),
      ].filter((x): x is string => Boolean(x)),
    },
    ...(i.kind === 'support' && i.attachTimelog
      ? {
          timelog: {
            title: t('pdfTimelog'),
            rows: i.lines.flatMap((l) =>
              (l.log ?? []).map((e) => ({
                text: `${formatDate(new Date(`${e.date}T12:00:00Z`), locale)} · ${l.text}`,
                amount: `${formatMinutes(e.registeredMinutes, locale)} / ${formatMinutes(e.billedMinutes, locale)}`,
              })),
            ),
          },
        }
      : {}),
    labels: {
      invoice: t('pdfInvoice'),
      date: t('date'),
      period: t('pdfPeriod'),
      customer: t('pdfCustomer'),
      description: t('description'),
      amount: t('amount'),
      net: t('pdfNet'),
      vat: t('pdfVat'),
      total: t('pdfTotal'),
      status: t('status'),
      footer: t('pdfFooter'),
    },
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${(i.number ?? 'faktura').replace(/[^\w.-]+/g, '-')}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
