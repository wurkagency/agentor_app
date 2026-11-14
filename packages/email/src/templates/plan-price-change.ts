import { b, define, signOff } from './define.js';

/**
 * E14: a Super Administrator changes a plan price with "Alle fra næste fornyelse". Sent 30 days
 * before, to the invoice e-mail of each customer on the plan. Prices incl. VAT.
 */
export interface PlanPriceChangeProps {
  company: string;
  plan: string;
  interval: 'month' | 'year';
  oldGrossOre: number;
  newGrossOre: number;
  /** The new price applies from the first renewal after this date. */
  effectiveFrom: Date;
  url: string;
  billingEmail: string;
}

export default define<PlanPriceChangeProps>((p, x) => {
  const date = x.date(p.effectiveFrom);
  const price = (ore: number) => x.t(`planPrice.per.${p.interval}`, { amount: x.money(ore) });
  return {
    subject: x.t('planPrice.subject', { plan: p.plan }),
    preheader: x.t('planPrice.preheader', { date }),
    blocks: [
      b.heading(x.t('planPrice.heading', { plan: p.plan })),
      b.paragraphs(
        x.t('common.helloName', { name: p.company }),
        x.t('planPrice.body', { plan: p.plan, date }),
      ),
      b.keyValueTable([
        { label: x.t('planPrice.old'), value: price(p.oldGrossOre) },
        { label: x.t('planPrice.new'), value: price(p.newGrossOre) },
        { label: x.t('planPrice.from'), value: x.t('planPrice.fromValue', { date }) },
      ]),
      b.button(x.t('planPrice.button'), p.url),
      b.smallPrint(x.t('planPrice.hint')),
      signOff(x),
    ],
    reason: x.t('common.reasonBilling', { email: p.billingEmail, company: p.company }),
  };
});
