import { b, define, signOff } from './define.js';

/**
 * E17: "Send kontoudtog" on the customer's economy page (F4). One ledger line per open invoice,
 * or "Ingen åbne poster". Amounts incl. VAT.
 */
export interface AccountStatementProps {
  company: string;
  lines: { number: string; description: string; grossOre: number; dueAt: Date | null }[];
  url: string;
  billingEmail: string;
}

export default define<AccountStatementProps>((p, x) => {
  const totalOre = p.lines.reduce((a, l) => a + l.grossOre, 0);
  const total = x.money(totalOre);
  return {
    subject: x.t('statement.subject'),
    preheader: p.lines.length
      ? x.t('statement.preheader', { count: p.lines.length, total })
      : x.t('statement.preheaderEmpty'),
    blocks: [
      b.heading(x.t('statement.heading')),
      b.paragraphs(
        x.t('common.helloName', { name: p.company }),
        x.t(p.lines.length ? 'statement.body' : 'statement.bodyEmpty'),
      ),
      b.ledger(
        p.lines.map((l) => ({
          number: l.number,
          detail: l.dueAt
            ? x.t('statement.detail', { description: l.description, due: x.dayMonth(l.dueAt) })
            : l.description,
          amount: x.money(l.grossOre),
        })),
        { label: x.t('statement.total'), value: total },
        x.t('statement.empty'),
      ),
      b.button(x.t('statement.button'), p.url),
      signOff(x),
    ],
    reason: x.t('common.reasonBilling', { email: p.billingEmail, company: p.company }),
  };
});
