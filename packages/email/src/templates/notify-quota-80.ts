import { b, define, signOff } from './define.js';

/**
 * E21: usage passed 80 % of the month's transactions. At most once per month per tenant; held in
 * quiet hours.
 */
export interface NotifyQuota80Props {
  firstName: string | null;
  company: string;
  used: number;
  limit: number;
  /** Start of the next period, when the counter resets. */
  resetsAt: Date;
  /** Any day in the current period; names the month. */
  periodDay: Date;
  plan: string;
  url: string;
  settingsUrl: string;
}

export default define<NotifyQuota80Props>((p, x) => {
  const pct = Math.floor((p.used / Math.max(1, p.limit)) * 100);
  const month = new Intl.DateTimeFormat(x.ctx.locale === 'da' ? 'da-DK' : 'en-GB', {
    month: 'long',
    timeZone: 'Europe/Copenhagen',
  }).format(p.periodDay);
  const used = x.number(p.used);
  const limit = x.number(p.limit);
  return {
    subject: x.t('quota.subject', { pct }),
    preheader: x.t('quota.preheader', { used, limit, reset: x.dayMonth(p.resetsAt) }),
    blocks: [
      b.heading(x.t('quota.heading', { pct })),
      b.paragraphs(
        p.firstName ? x.t('common.helloName', { name: p.firstName }) : x.t('common.hello'),
        x.t('quota.body', { company: p.company, used, limit, month }),
      ),
      b.progressBar(
        x.t('quota.bar', { month }),
        `${used} / ${limit}`,
        p.used / Math.max(1, p.limit),
      ),
      b.keyValueTable([
        { label: x.t('quota.resets'), value: x.date(p.resetsAt) },
        { label: x.t('quota.plan'), value: p.plan },
      ]),
      b.button(x.t('quota.button'), p.url),
      b.smallPrint(x.t('quota.hint')),
      signOff(x),
    ],
    reason: x.t('common.reasonNotify', { event: x.t('common.event.quota'), company: p.company }),
    footerLink: { label: x.t('common.editNotifications'), href: p.settingsUrl },
  };
});
