import { listInvoices } from '@agentor/db';
import { formatDate, formatMoney } from '@agentor/i18n';
import { getLocale, getTranslations } from 'next-intl/server';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireRole } from '@/server/auth/session';
import { db } from '@/server/infra';
import { InvoiceTable } from '../invoice-table';

export async function generateMetadata() {
  const t = await getTranslations('billing');
  return { title: t('invoices') };
}

export default async function InvoicesPage() {
  const ctx = await requireRole(['owner']);
  const invoices = await listInvoices(db(), { tenantId: ctx.tenant.tenantId, userId: ctx.user.id });
  const t = await getTranslations('billing');
  const locale = (await getLocale()) as 'da' | 'en';
  return (
    <PageBody>
      <PageHeader eyebrow={t('title')} title={t('invoices')} subtitle={t('invoicesIntro')} />
      <InvoiceTable
        title={false}
        locale={locale}
        invoices={invoices.map((i) => ({
          id: i.id,
          number: i.number,
          date: formatDate(i.periodStart, locale),
          description: i.description,
          amount: formatMoney((i.amountOre + i.vatOre) / 100, locale),
          status: i.status,
        }))}
      />
    </PageBody>
  );
}
