import { b, define, signOff } from './define.js';

/**
 * E22: Monday 08:00 Europe/Copenhagen, to members who switched it on (off by default). At most 5
 * flows, problems first. Carries an unsubscribe link here and in the List-Unsubscribe header.
 */
export interface WeeklySummaryProps {
  firstName: string | null;
  company: string;
  /** ISO week number. */
  week: number;
  /** Monday and Sunday of the week. */
  from: Date;
  to: Date;
  records: number;
  orders: number;
  errors: number;
  /** Share of runs without errors, 0–1. */
  okRatio: number;
  flows: { name: string; records: number; errors: number; brokenSince: Date | null }[];
  url: string;
  unsubscribeUrl: string;
}

/** "Nordlys Cykler ApS" → "Nordlys Cykler" for the subject line. */
export const shortCompany = (name: string) =>
  name.replace(/\s+(ApS|A\/S|IVS|I\/S|K\/S|P\/S|Aps)\.?$/i, '').trim();

export default define<WeeklySummaryProps>((p, x) => {
  const loc = x.ctx.locale === 'da' ? 'da-DK' : 'en-GB';
  const dayNum = new Intl.DateTimeFormat(loc, { day: 'numeric', timeZone: 'Europe/Copenhagen' });
  const period = `${dayNum.format(p.from)}–${x.date(p.to)}`.replace(/^(\d+)\.?–/, '$1.–');
  const pct = new Intl.NumberFormat(loc, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.floor(p.okRatio * 1000) / 1000);
  const weekday = new Intl.DateTimeFormat(loc, { weekday: 'long', timeZone: 'Europe/Copenhagen' });
  // Problems first (errors, then broken connections), then the busiest; at most five.
  const problem = (f: WeeklySummaryProps['flows'][number]) =>
    f.errors > 0 ? 2 : f.brokenSince ? 1 : 0;
  const flows = [...p.flows]
    .sort((a, c) => problem(c) - problem(a) || c.errors - a.errors || c.records - a.records)
    .slice(0, 5);
  return {
    subject: x.t('weekly.subject', {
      company: shortCompany(p.company),
      records: x.number(p.records),
      errors: p.errors,
    }),
    preheader: x.t('weekly.preheader', { week: p.week, period, pct }),
    blocks: [
      b.heading(x.t('weekly.heading')),
      b.paragraphs(
        p.firstName ? x.t('common.helloName', { name: p.firstName }) : x.t('common.hello'),
        x.t('weekly.body', { week: p.week, period, company: p.company }),
      ),
      b.statGrid([
        { value: x.number(p.records), label: x.t('weekly.records') },
        { value: x.number(p.orders), label: x.t('weekly.orders') },
        { value: x.number(p.errors), label: x.t('weekly.errors') },
        { value: pct, label: x.t('weekly.ok') },
      ]),
      ...(flows.length
        ? [
            b.statusTable(
              x.t('weekly.flows'),
              flows.map((f) => ({
                name: f.name,
                count: x.number(f.records),
                status: f.brokenSince
                  ? x.t('weekly.brokenSince', { day: weekday.format(f.brokenSince) })
                  : f.errors > 0
                    ? x.t('weekly.flowErrors', { count: f.errors })
                    : x.t('weekly.flowOk'),
                tone: f.brokenSince || f.errors > 0 ? 'bad' : 'ok',
              })),
            ),
          ]
        : []),
      b.button(x.t('weekly.button'), p.url),
      signOff(x),
    ],
    reason: x.t('weekly.reason'),
    footerLink: { label: x.t('weekly.unsubscribe'), href: p.unsubscribeUrl },
  };
});
