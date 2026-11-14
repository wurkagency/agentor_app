import { b, define, signOff } from './define.js';

/**
 * E15: "Send rykker" (Finans › Fakturering). The second reminder uses the same template with
 * "2. påmindelse" in the subject. Replies go to Agentor's invoice address.
 */
export interface InvoiceReminderProps {
  company: string;
  number: string;
  grossOre: number;
  dueAt: Date;
  /** 1 for the first reminder, 2 or more for later ones. */
  reminder: number;
  url: string;
  billingEmail: string;
}

export default define<InvoiceReminderProps>((p, x) => {
  const amount = x.money(p.grossOre);
  return {
    subject:
      p.reminder >= 2
        ? x.t('reminder.subjectSecond', { number: p.number, n: p.reminder })
        : x.t('reminder.subject', { number: p.number }),
    preheader: x.t('reminder.preheader', { number: p.number, amount, due: x.dayMonth(p.dueAt) }),
    blocks: [
      b.heading(x.t('reminder.heading')),
      b.paragraphs(
        x.t('common.helloName', { name: p.company }),
        x.t('reminder.body', { number: p.number }),
      ),
      b.amountPanel({
        amountLabel: x.t('common.amountInclVat'),
        amount,
        dueLabel: x.t('reminder.due'),
        due: x.date(p.dueAt),
      }),
      b.button(x.t('reminder.button'), p.url),
      b.smallPrint(x.t('reminder.hint')),
      signOff(x),
    ],
    reason: x.t('common.reasonBilling', { email: p.billingEmail, company: p.company }),
  };
});
