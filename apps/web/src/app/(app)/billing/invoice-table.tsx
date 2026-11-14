import { Card, CardHeader, cn, EmptyState, Icon, StatusPill, Table, Td, Th, Tr } from '@agentor/ui';
import { Download, Receipt } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

const STATUS = {
  paid: 'ok',
  open: 'info',
  failed: 'error',
  void: 'paused',
} as const;

export interface InvoiceRow {
  id: string;
  number: string;
  date: string;
  description: string;
  amount: string;
  status: keyof typeof STATUS;
}

/** Fakturaer (D13): number, date, description, amount incl. VAT, status, PDF. */
export async function InvoiceTable({
  invoices,
  className,
  title = true,
}: {
  invoices: InvoiceRow[];
  locale: 'da' | 'en';
  className?: string;
  title?: boolean;
}) {
  const t = await getTranslations('billing');
  return (
    <Card padding="none" className={cn('flex flex-col overflow-hidden', className)}>
      {title && (
        <div className="px-5 pt-5 pb-3">
          <CardHeader title={t('invoices')} />
        </div>
      )}
      {invoices.length === 0 ? (
        <EmptyState icon={Receipt} title={t('noInvoices')}>
          {t('noInvoicesBody')}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>{t('invoiceNo')}</Th>
                <Th>{t('date')}</Th>
                <Th>{t('description')}</Th>
                <Th numeric>{t('amount')}</Th>
                <Th>{t('status')}</Th>
                <Th>
                  <span className="sr-only">{t('pdf')}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <Tr key={i.id}>
                  <Td className="font-mono text-meta">{i.number}</Td>
                  <Td>{i.date}</Td>
                  <Td>{i.description}</Td>
                  <Td numeric>{i.amount}</Td>
                  <Td>
                    <StatusPill status={STATUS[i.status]} compact>
                      {t(`invoiceStatus.${i.status}`)}
                    </StatusPill>
                  </Td>
                  <Td className="text-right">
                    <Link
                      href={`/billing/invoices/${i.id}/pdf`}
                      prefetch={false}
                      className="inline-flex items-center gap-1.5 text-meta font-semibold text-fg-1 no-underline"
                      aria-label={t('downloadPdf', { number: i.number })}
                    >
                      <Icon icon={Download} size={14} />
                      {t('pdf')}
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}

export interface CreditNoteRow {
  id: string;
  number: string;
  date: string;
  invoiceNumber: string;
  amount: string;
  state: 'none' | 'pending' | 'done' | 'failed' | 'offset';
}

/** Kreditnotaer (I02): number, date, the invoice it credits, amount incl. VAT, refund, PDF. */
export async function CreditNoteTable({ notes }: { notes: CreditNoteRow[] }) {
  const t = await getTranslations('billing');
  if (notes.length === 0) return null;
  return (
    <Card padding="none" className="flex flex-col overflow-hidden">
      <div className="px-5 pt-5 pb-3">
        <CardHeader title={t('creditNotes')} />
      </div>
      <div className="overflow-x-auto">
        <Table>
          <thead>
            <tr>
              <Th>{t('invoiceNo')}</Th>
              <Th>{t('date')}</Th>
              <Th>{t('description')}</Th>
              <Th numeric>{t('amount')}</Th>
              <Th>{t('status')}</Th>
              <Th>
                <span className="sr-only">{t('pdf')}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {notes.map((c) => (
              <Tr key={c.id}>
                <Td className="font-mono text-meta">{c.number}</Td>
                <Td>{c.date}</Td>
                <Td>{t('creditFor', { number: c.invoiceNumber })}</Td>
                <Td numeric>{c.amount}</Td>
                <Td>
                  <StatusPill status={c.state === 'done' ? 'ok' : 'info'} compact>
                    {t(`refundState.${c.state}`)}
                  </StatusPill>
                </Td>
                <Td className="text-right">
                  <Link
                    href={`/billing/credit-notes/${c.id}/pdf`}
                    prefetch={false}
                    className="inline-flex items-center gap-1.5 text-meta font-semibold text-fg-1 no-underline"
                    aria-label={t('downloadCreditPdf', { number: c.number })}
                  >
                    <Icon icon={Download} size={14} />
                    {t('pdf')}
                  </Link>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Card>
  );
}
