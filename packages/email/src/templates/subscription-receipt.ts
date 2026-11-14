import { b, define, signOff } from './define.js';

/**
 * E08: once, when the first payment has gone through, to the invoice e-mail. The invoice PDF is
 * linked (behind login), not attached.
 */
export interface SubscriptionReceiptProps {
  company: string;
  plan: string;
  interval: 'month' | 'year';
  invoiceNumber: string;
  periodStart: Date;
  /** Last day of the period (inclusive). */
  periodEnd: Date;
  paidAt: Date | null;
  /** "Visa •••• 4242", when known. */
  card: string | null;
  netOre: number;
  vatOre: number;
  url: string;
  billingEmail: string;
}

export default define<SubscriptionReceiptProps>((p, x) => {
  const interval = x.t(`common.interval.${p.interval}`);
  const paid = [p.paidAt ? x.date(p.paidAt) : null, p.card].filter(Boolean).join(' · ');
  return {
    subject: x.t('receipt.subject', { number: p.invoiceNumber }),
    preheader: x.t('receipt.preheader', { company: p.company, plan: p.plan, interval }),
    blocks: [
      b.heading(x.t('receipt.heading')),
      b.paragraphs(
        x.t('common.hello'),
        x.t('receipt.body', { company: p.company, plan: p.plan, interval }),
      ),
      b.keyValueTable(
        [
          { label: x.t('receipt.invoice'), value: p.invoiceNumber },
          {
            label: x.t('receipt.period'),
            value: `${x.date(p.periodStart)} – ${x.date(p.periodEnd)}`,
          },
          ...(paid ? [{ label: x.t('receipt.paid'), value: paid }] : []),
          { label: x.t('common.net'), value: x.money(p.netOre) },
          { label: x.t('common.vat'), value: x.money(p.vatOre) },
        ],
        { label: x.t('receipt.total'), value: x.money(p.netOre + p.vatOre) },
      ),
      b.button(x.t('receipt.button'), p.url),
      b.smallPrint(x.t('receipt.hint')),
      signOff(x),
    ],
    reason: x.t('common.reasonBilling', { email: p.billingEmail, company: p.company }),
  };
});
