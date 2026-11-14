import { isUuid } from '@agentor/db';
import { notFound, redirect } from 'next/navigation';
import { currentMonth, financeInvoicesAll } from '@/server/finance-data';
import { requireStaff } from '@/server/platform';

/**
 * An invoice by id: a support invoice opens Supportfaktura (F5, MP21) for its month, which lives
 * at /platform/finance/support/[tenantId]; anything else opens its PDF.
 */
export default async function InvoicePage({
  params,
}: {
  params: Promise<{ tenantId: string; invoiceId: string }>;
}) {
  const { actor } = await requireStaff(true);
  const { tenantId, invoiceId } = await params;
  if (!isUuid(tenantId) || !isUuid(invoiceId)) notFound();
  const invoice = (await financeInvoicesAll(actor)).find(
    (i) => i.id === invoiceId && i.tenantId === tenantId,
  );
  if (!invoice) notFound();
  if (invoice.kind !== 'support')
    redirect(`/platform/finance/invoices/${tenantId}/${invoiceId}/pdf`);
  redirect(`/platform/finance/support/${tenantId}?month=${currentMonth(invoice.periodStart).key}`);
}
