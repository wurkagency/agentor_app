import { describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({ env: () => ({ BETTER_AUTH_SECRET: 's'.repeat(40) }) }));
vi.mock('./infra', () => ({ db: () => ({}) }));
vi.mock('./storage', () => ({ storage: () => ({}) }));

const { creditNoteInput, invoiceInput, signedDocumentUrl, verifyDocumentLink } =
  await import('./documents');
const { creditNotePdf, invoicePdf } = await import('@agentor/pdf');

const ID = '0190a000-0000-7000-8000-0000000d0c01';
const NOW = Date.UTC(2026, 10, 1, 8);

describe('signed document links (PLAN-EMAILS-PDF §6.3)', () => {
  const parts = (url: string) => {
    const u = new URL(url, 'https://app.agentor.dk');
    return { exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig') };
  };

  it('accepts its own link for 5 minutes', () => {
    const { exp, sig } = parts(signedDocumentUrl(ID, NOW));
    expect(verifyDocumentLink(ID, exp, sig, NOW)).toBe(true);
    expect(verifyDocumentLink(ID, exp, sig, NOW + 4 * 60_000)).toBe(true);
    expect(verifyDocumentLink(ID, exp, sig, NOW + 6 * 60_000)).toBe(false);
  });

  it('refuses another document, a changed expiry or a made-up signature', () => {
    const { exp, sig } = parts(signedDocumentUrl(ID, NOW));
    expect(verifyDocumentLink(ID.replace('c01', 'c02'), exp, sig, NOW)).toBe(false);
    expect(verifyDocumentLink(ID, String(Number(exp) + 60), sig, NOW)).toBe(false);
    expect(verifyDocumentLink(ID, exp, 'x'.repeat(43), NOW)).toBe(false);
    expect(verifyDocumentLink(ID, null, sig, NOW)).toBe(false);
    // An expiry far ahead (not one the app would sign) is refused too.
    expect(verifyDocumentLink(ID, String(Math.floor(NOW / 1000) + 86_400), sig, NOW)).toBe(false);
  });
});

const tenant = {
  name: 'Nordlys Cykler ApS',
  addressLine: 'Cykelvej 12',
  postalCode: '8000',
  city: 'Aarhus C',
  cvr: '12345678',
  billingEmail: 'bogholderi@nordlys-cykler.dk',
  customerNumber: 1042,
};

describe('documents from the database rows', () => {
  it('maps a support invoice: lines per case, time log, card payment; totals add up', () => {
    const input = invoiceInput({
      invoice: {
        id: ID,
        tenant_id: ID,
        number: 'INV/2026/01063',
        kind: 'support',
        status: 'paid',
        description: 'Support · oktober 2026',
        period_start: '2026-10-01T00:00:00Z',
        period_end: '2026-11-01T00:00:00Z',
        amount_ore: 240_000,
        vat_ore: 60_000,
        payment_method: 'card',
        provider_payment_id: 'QP-48213977',
        paid_at: '2026-11-01T07:00:00Z',
        issued_at: '2026-11-01T07:00:00Z',
        due_at: '2026-11-01T07:00:00Z',
        attach_timelog: true,
        created_at: '2026-11-01T07:00:00Z',
      },
      lines: [
        {
          idx: 0,
          text: '#2271 Ordrer synkroniseres dobbelt',
          detail: null,
          unit: 'hours',
          quantity_milli: 2250,
          unit_price_ore: 64_000,
          amount_ore: 144_000,
          case_number: 2271,
          registered_minutes: 125,
          billed_minutes: 135,
          log: [
            { date: '2026-10-02', registeredMinutes: 50, billedMinutes: 60 },
            { date: '2026-10-07', registeredMinutes: 75, billedMinutes: 75 },
          ],
        },
        {
          idx: 1,
          text: '#2291 Fakturaer til EU-kunder fejler',
          detail: null,
          unit: 'hours',
          quantity_milli: 1500,
          unit_price_ore: 64_000,
          amount_ore: 96_000,
          case_number: 2291,
          registered_minutes: 87,
          billed_minutes: 90,
          log: [{ date: '2026-10-19', registeredMinutes: 87, billedMinutes: 90 }],
        },
      ],
      tenant,
      subscription: {
        cardBrand: 'visa',
        cardLast4: '4242',
        ean: null,
        interval: 'month',
        plan: 'Business',
      },
      seller: {},
    });
    expect(input.customerNumber).toBe('K-1042');
    expect(input.lines[0]).toMatchObject({
      ref: '#2271',
      title: 'Ordrer synkroniseres dobbelt',
      detail: '2.–7. okt. · registreret 2 t 05 min. · oprundet',
      quantity: { hours: 2.25 },
    });
    expect(input.payment).toMatchObject({ state: 'paid', card: 'Visa •••• 4242' });
    expect(input.timelog).toHaveLength(3);
    expect(input.seller.cvr).toBeNull();
    // The PDF builder checks that the lines add up to the stored net amount.
    expect(() => invoicePdf(input)).not.toThrow();
  });

  it('maps a credit note with what is left of the invoice after it', () => {
    const input = creditNoteInput({
      creditNote: {
        id: ID,
        tenant_id: ID,
        number: 'K-2026-0007',
        invoice_id: ID,
        invoice_number: 'INV/2026/01063',
        invoice_issued_at: '2026-11-01T07:00:00Z',
        reason: 'Fejl hos Agentor',
        refund_method: 'card',
        refund_state: 'done',
        refunded_at: '2026-11-04T09:00:00Z',
        net_ore: -32_000,
        vat_ore: -8_000,
        created_by_name: 'Kasper Nyborg',
        created_at: '2026-11-04T09:00:00Z',
      },
      lines: [
        {
          source_index: 0,
          text: '#2271 Ordrer synkroniseres dobbelt',
          detail: null,
          unit: 'hours',
          quantity_milli: -500,
          unit_price_ore: 64_000,
          amount_ore: -32_000,
        },
      ],
      invoice: { grossOre: 360_000, paymentMethod: 'card' },
      creditedGrossOre: 40_000,
      tenant,
      subscription: { cardBrand: 'visa', cardLast4: '4242' },
      seller: {},
    });
    expect(input.invoice.afterGrossOre).toBe(320_000);
    expect(input.refund).toMatchObject({ method: 'card', state: 'done' });
    expect(() => creditNotePdf(input)).not.toThrow();
  });
});
