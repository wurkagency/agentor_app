import { formatMinutes, formatMoney } from '@agentor/i18n';
import type { NextRequest } from 'next/server';
import { monthReport, parseMonth } from '@/server/finance-data';
import { renderPdf, type PdfLine } from '@/server/invoice-pdf';
import { requireStaff } from '@/server/platform';

/** "PDF" (F7): the monthly report on one page, amounts ex. VAT. */
export async function GET(req: NextRequest) {
  const { actor } = await requireStaff(true);
  const m = parseMonth(req.nextUrl.searchParams.get('month') ?? undefined);
  const r = await monthReport(actor, m);
  const kr = (ore: number) => formatMoney(ore / 100, 'da');
  const lines: PdfLine[] = [
    { text: 'Agentor', x: 50, y: 790, size: 18, bold: true },
    { text: `Månedsrapport ${m.key}`, x: 50, y: 765, size: 13, bold: true },
    { text: 'Beløb er ekskl. moms.', x: 50, y: 748, size: 9 },
  ];
  const rules: { y: number; x1: number; x2: number }[] = [];
  let y = 715;
  const row = (label: string, value: string, bold = false) => {
    lines.push({ text: label, x: 50, y, size: 10, bold });
    lines.push({ text: value, x: 545, y, size: 10, bold, align: 'right' });
    y -= 18;
  };
  row('Omsætning', kr(r.revenueOre), true);
  row('Abonnementer', kr(r.subscriptionOre));
  row('Support', kr(r.supportOre));
  row('Aktive abonnementer ultimo', String(r.activeAtEnd));
  row('Fakturerbar tid', formatMinutes(r.billableMinutes));
  row('Afregnet tid', formatMinutes(r.billedMinutes));
  row('Ikke fakturerbar', formatMinutes(r.nonBillableMinutes));
  row('Udestående inkl. moms', kr(r.outstandingGross));
  row('Sager løst', String(r.casesResolved));
  y -= 10;
  rules.push({ y: y + 14, x1: 50, x2: 545 });
  lines.push({ text: 'Største kunder i support', x: 50, y, size: 11, bold: true });
  y -= 18;
  for (const c of r.topCustomers.slice(0, 8))
    row(c.name, `${formatMinutes(c.billedMinutes)} · ${kr(c.netOre)}`);
  y -= 10;
  rules.push({ y: y + 14, x1: 50, x2: 545 });
  lines.push({ text: 'Tid pr. supporter', x: 50, y, size: 11, bold: true });
  y -= 18;
  for (const s of r.perStaff)
    row(
      s.name,
      `${formatMinutes(s.billable)} fakturerbar · ${formatMinutes(s.nonBillable)} ikke · ${s.cases} sager`,
    );
  return new Response(new Uint8Array(renderPdf(lines, rules)), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="finans-${m.key}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
