import { action, b, define, signOff } from './define.js';

/**
 * E10: a Super Administrator creates a customer under Platform › Kunder. The future owner sets up
 * a login and pays by card; the account is active only after payment. The link works 14 days.
 */
export interface CustomerCreatedProps {
  staff: string;
  company: string;
  plan: string;
  interval: 'month' | 'year';
  /** Plan price for the interval, excl. VAT. */
  priceNetOre: number;
  /** First payment incl. VAT. */
  firstPaymentGrossOre: number;
  url: string;
  email: string;
}

export default define<CustomerCreatedProps>((p, x) => {
  const interval = x.t(`common.interval.${p.interval}`);
  return {
    subject: x.t('customerCreated.subject', { company: p.company }),
    preheader: x.t('customerCreated.preheader'),
    blocks: [
      b.heading(x.t('customerCreated.heading')),
      b.paragraphs(
        x.t('common.hello'),
        x.t('customerCreated.body', { staff: p.staff, company: p.company, plan: p.plan, interval }),
      ),
      b.keyValueTable([
        {
          label: x.t('customerCreated.plan'),
          value: x.t(`customerCreated.price.${p.interval}`, {
            plan: p.plan,
            price: x.money(p.priceNetOre, true),
          }),
        },
        {
          label: x.t('customerCreated.firstPayment'),
          value: x.t('common.inclVat', { amount: x.money(p.firstPaymentGrossOre) }),
        },
      ]),
      ...action(x, x.t('customerCreated.button'), p.url, x.t('customerCreated.expiry')),
      b.divider(),
      b.smallPrint(x.t('customerCreated.safety')),
      signOff(x),
    ],
    reason: x.t('customerCreated.reason', { email: p.email }),
  };
});
