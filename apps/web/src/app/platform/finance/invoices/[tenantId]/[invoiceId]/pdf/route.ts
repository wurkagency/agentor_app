import { isUuid } from '@agentor/db';
import { formatDate, formatMinutes, formatMoney, type Locale } from '@agentor/i18n';
import { getLocale, getTranslations } from 'next-intl/server';
import { financeInvoicesAll } from '@/server/finance-data';
import { invoicePdf } from '@/server/invoice-pdf';
import { requireStaff } from '@/server/platform';

/** Invoice PDF for Finans (F4): the same document the customer downloads. Superadmin only. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ tenantId: string; invoiceId: string }> },
) {
  const { actor } = await requireStaff(true);
  const { tenantId, invoiceId } = await params;
  if (!isUuid(tenantId) || !isUuid(invoiceId)) return new Response(null, { status: 404 });
  const i = (await financeInvoicesAll(actor)).find(
    (x) => x.id === invoiceId && x.tenantId === tenantId && x.status !== 'draft',
  );
  if (!i) return new Response(null, { status: 404 });
  const t = await getTranslations('billing');
  const locale = (await getLocale()) as Locale;
  const money = (ore: number) => formatMoney(ore / 100, locale);
  const pdf = invoicePdf({
    number: i.number ?? '',
    date: formatDate(i.issuedAt ?? i.periodStart, locale),
    period: `${formatDate(i.periodStart, locale)} – ${formatDate(new Date(i.periodEnd.getTime() - 1), locale)}`,
    description: i.description,
    ...(i.kind === 'subscription'
      ? { planAmount: money(i.netOre - i.lines.reduce((a, l) => a + l.amountOre, 0)) }
      : {}),
    extra: i.lines.map((l) => ({
      text: l.billedMinutes ? `${l.text} · ${formatMinutes(l.billedMinutes, locale)}` : l.text,
      amount: money(l.amountOre),
    })),
    net: money(i.netOre),
    vat: money(i.vatOre),
    total: money(i.grossOre),
    status: t(`invoiceStatus.${i.status}`),
    customer: { name: i.tenantName, cvr: i.cvr, address: [] },
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
      'Content-Disposition': `attachment; filename="${i.number ?? 'faktura'}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
