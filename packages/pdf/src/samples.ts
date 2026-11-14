import type { CreditNoteInput, InvoiceInput, SellerDetails } from './invoice.js';

/**
 * The I01/I02 boards' sample documents (fictional companies), for tests, the screenshots and
 * the dev preview. Agentor's own details are left empty, so they print as the boards'
 * placeholders until they are filled in under Administration › Produkt.
 */
export const SAMPLE_SELLER: SellerDetails = {
  name: 'Agentor ApS',
  address: null,
  postalCity: null,
  cvr: null,
  email: 'faktura@agentor.dk',
  web: 'app.agentor.dk',
  bankReg: null,
  bankAccount: null,
  iban: null,
};

const customer = {
  name: 'Nordlys Cykler ApS',
  addressLines: ['Cykelvej 12', '8000 Aarhus C'],
  cvr: '12345678',
  email: 'bogholderi@nordlys-cykler.dk',
};

/** I01, support variant: one line per case, paid by card, time log attached. */
export const SAMPLE_SUPPORT_INVOICE: InvoiceInput = {
  number: '2026-1063',
  issuedAt: new Date('2026-11-01T07:00:00Z'),
  dueAt: new Date('2026-11-01T07:00:00Z'),
  customerNumber: 'K-1042',
  seller: SAMPLE_SELLER,
  customer,
  variant: { kind: 'support', month: new Date('2026-10-15T12:00:00Z'), rateOre: 64_000 },
  lines: [
    {
      ref: '#2271',
      title: 'Ordrer synkroniseres dobbelt',
      detail: '2.–7. okt. · registreret 2 t 05 min. · oprundet',
      quantity: { hours: 2.25 },
      unitPriceOre: 64_000,
      amountOre: 144_000,
    },
    {
      ref: '#2291',
      title: 'Fakturaer til EU-kunder fejler',
      detail: '19. okt. · registreret 1 t 27 min. · oprundet',
      quantity: { hours: 1.5 },
      unitPriceOre: 64_000,
      amountOre: 96_000,
    },
    {
      ref: '#2300',
      title: 'Kunder oprettes dobbelt i Dinero',
      detail: '19. okt. · registreret 35 min. · oprundet',
      quantity: { hours: 0.75 },
      unitPriceOre: 64_000,
      amountOre: 48_000,
    },
  ],
  netOre: 288_000,
  vatOre: 72_000,
  payment: {
    method: 'card',
    state: 'paid',
    card: 'Visa •••• 4242',
    paidAt: new Date('2026-11-01T07:00:00Z'),
    transaction: 'QP-48213977',
  },
  timelog: [
    {
      date: new Date('2026-10-02T10:00:00Z'),
      caseLabel: '#2271 Ordrer synkroniseres dobbelt',
      registeredMinutes: 50,
      billedMinutes: 60,
    },
    {
      date: new Date('2026-10-07T10:00:00Z'),
      caseLabel: '#2271 Ordrer synkroniseres dobbelt',
      registeredMinutes: 75,
      billedMinutes: 75,
    },
    {
      date: new Date('2026-10-19T10:00:00Z'),
      caseLabel: '#2291 Fakturaer til EU-kunder fejler',
      registeredMinutes: 87,
      billedMinutes: 90,
    },
    {
      date: new Date('2026-10-19T13:00:00Z'),
      caseLabel: '#2300 Kunder oprettes dobbelt i Dinero',
      registeredMinutes: 35,
      billedMinutes: 45,
    },
  ],
};

/** I01, subscription variant: one line, paid by card. */
export const SAMPLE_SUBSCRIPTION_INVOICE: InvoiceInput = {
  number: '2026-1061',
  issuedAt: new Date('2026-10-20T08:14:00Z'),
  dueAt: null,
  customerNumber: 'K-1042',
  seller: SAMPLE_SELLER,
  customer,
  variant: {
    kind: 'subscription',
    plan: 'Business',
    interval: 'year',
    periodStart: new Date('2026-10-20T10:00:00Z'),
    periodEnd: new Date('2027-10-19T10:00:00Z'),
  },
  lines: [
    {
      title: 'Agentor Business, årligt',
      detail: '20. okt. 2026 – 19. okt. 2027',
      quantity: { pieces: 1 },
      unitPriceOre: 159_000,
      amountOre: 159_000,
    },
  ],
  netOre: 159_000,
  vatOre: 39_750,
  payment: {
    method: 'card',
    state: 'paid',
    card: 'Visa •••• 4242',
    paidAt: new Date('2026-10-20T08:14:00Z'),
    transaction: 'QP-48190023',
  },
};

/** I01, Enterprise on EAN: due date, EAN and bank details instead of "Betalt". */
export const SAMPLE_EAN_INVOICE: InvoiceInput = {
  ...SAMPLE_SUBSCRIPTION_INVOICE,
  number: '2026-1064',
  issuedAt: new Date('2026-11-01T07:00:00Z'),
  dueAt: new Date('2026-12-01T07:00:00Z'),
  customer: { ...customer, name: 'Havnens Kontorforsyning A/S', email: 'kreditor@havnens.test' },
  variant: {
    kind: 'subscription',
    plan: 'Enterprise',
    interval: 'month',
    periodStart: new Date('2026-11-01T07:00:00Z'),
    periodEnd: new Date('2026-11-30T07:00:00Z'),
  },
  lines: [
    {
      title: 'Agentor Enterprise, månedligt',
      detail: '1. nov. 2026 – 30. nov. 2026',
      quantity: { pieces: 1 },
      unitPriceOre: 299_000,
      amountOre: 299_000,
    },
  ],
  netOre: 299_000,
  vatOre: 74_750,
  payment: { method: 'invoice', ean: '5790001234567', dueAt: new Date('2026-12-01T07:00:00Z') },
};

/** I02: a partial credit of 30 minutes on #2271, refunded to the card. */
export const SAMPLE_CREDIT_NOTE: CreditNoteInput = {
  number: 'K-2026-0007',
  issuedAt: new Date('2026-11-04T09:00:00Z'),
  customerNumber: 'K-1042',
  seller: SAMPLE_SELLER,
  customer,
  invoice: {
    number: '2026-1063',
    issuedAt: new Date('2026-11-01T07:00:00Z'),
    afterGrossOre: 320_000,
  },
  reason: 'Fejl hos Agentor: 30 min. på sag #2271 skulle ikke have været faktureret.',
  createdBy: 'Kasper Nyborg',
  lines: [
    {
      ref: '#2271',
      title: 'Ordrer synkroniseres dobbelt',
      detail: 'Kredit af 30 min. · ikke fakturerbar (fejl hos Agentor)',
      quantity: { hours: -0.5 },
      unitPriceOre: 64_000,
      amountOre: -32_000,
    },
  ],
  netOre: -32_000,
  vatOre: -8_000,
  refund: {
    method: 'card',
    state: 'done',
    card: 'Visa •••• 4242',
    at: new Date('2026-11-04T09:00:00Z'),
  },
};

/** A support invoice with many cases: the table runs over pages with its heading repeated. */
export function longInvoice(cases = 40): InvoiceInput {
  const lines = Array.from({ length: cases }, (_, i) => ({
    ref: `#${3000 + i}`,
    title: `Sag nummer ${i + 1} om synkronisering af ordrer og kunder`,
    detail: `${(i % 28) + 1}. okt. · registreret ${10 + i} min. · oprundet`,
    quantity: { hours: 0.25 },
    unitPriceOre: 64_000,
    amountOre: 16_000,
  }));
  const net = lines.reduce((a, l) => a + l.amountOre, 0);
  return {
    ...SAMPLE_SUPPORT_INVOICE,
    number: '2026-1099',
    lines,
    netOre: net,
    vatOre: net / 4,
    timelog: null,
  };
}
