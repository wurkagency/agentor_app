import { b, define, signOff } from './define.js';

/**
 * E18: "Send til bogholder" under Administration › Rapporter, to Agentor's bookkeeper. Internal.
 * The CSV (agentor-finans-ÅÅÅÅ-MM.csv) is attached by the caller. Amounts excl. VAT.
 */
export interface MonthlyReportProps {
  /** "2026-09". */
  month: string;
  revenueOre: number;
  subscriptionsOre: number;
  supportOre: number;
  filename: string;
  bytes: number;
}

export default define<MonthlyReportProps>((p, x) => {
  const [y, m] = p.month.split('-').map(Number);
  const first = new Date(Date.UTC(y!, (m ?? 1) - 1, 15));
  const monthName = new Intl.DateTimeFormat(x.ctx.locale === 'da' ? 'da-DK' : 'en-GB', {
    month: 'long',
    timeZone: 'Europe/Copenhagen',
  }).format(first);
  const monthYear = `${monthName} ${y}`;
  const kr = (ore: number) => x.money(Math.round(ore / 100) * 100, true);
  const kb = Math.max(1, Math.round(p.bytes / 1024));
  return {
    subject: x.t('monthlyReport.subject', { month: monthYear }),
    preheader: x.t('monthlyReport.preheader'),
    blocks: [
      b.heading(x.t('monthlyReport.heading', { month: monthName })),
      b.paragraphs(x.t('common.hello'), x.t('monthlyReport.body', { month: monthYear })),
      b.statGrid([
        { value: kr(p.revenueOre), label: x.t('monthlyReport.revenue') },
        { value: kr(p.subscriptionsOre), label: x.t('monthlyReport.subscriptions') },
        { value: kr(p.supportOre), label: x.t('monthlyReport.support') },
      ]),
      b.attachmentChip(p.filename, x.t('monthlyReport.fileMeta', { kb }), x.assets),
      b.smallPrint(x.t('monthlyReport.hint')),
      signOff(x),
    ],
    reason: x.t('monthlyReport.reason'),
  };
});
