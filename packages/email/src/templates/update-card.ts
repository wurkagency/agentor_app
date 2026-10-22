import { b, define, signOff } from './define.js';

/**
 * E16: "Betalingslink" on a declined card. The button opens a page behind login that starts
 * QuickPay's hosted card form; the mail carries no card data beyond brand and last four digits.
 */
export interface UpdateCardProps {
  company: string;
  number: string;
  grossOre: number;
  /** "Mastercard •••• 0019", when known. */
  card: string | null;
  /** "Startup · oktober". */
  detail: string | null;
  url: string;
  billingEmail: string;
}

export default define<UpdateCardProps>((p, x) => {
  const amount = x.money(p.grossOre);
  return {
    subject: x.t('updateCard.subject', { number: p.number }),
    preheader: x.t('updateCard.preheader', { amount }),
    blocks: [
      b.heading(x.t('updateCard.heading')),
      b.paragraphs(
        x.t('common.helloName', { name: p.company }),
        x.t('updateCard.body', { number: p.number, amount }),
      ),
      b.keyValueTable([
        ...(p.card ? [{ label: x.t('updateCard.card'), value: p.card }] : []),
        {
          label: x.t('updateCard.invoice'),
          value: p.detail ? `${p.number} · ${p.detail}` : p.number,
        },
        { label: x.t('common.amountInclVat'), value: amount },
      ]),
      b.button(x.t('updateCard.button'), p.url),
      b.smallPrint(x.t('updateCard.hint')),
      signOff(x),
    ],
    reason: x.t('common.reasonBilling', { email: p.billingEmail, company: p.company }),
  };
});
