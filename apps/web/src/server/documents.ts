import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  creditNoteDocumentData,
  documentById,
  findDocument,
  invoiceDocumentData,
  saveDocument,
  type BillingParty,
  type BillingSeller,
  type CreditNoteDocumentData,
  type DocumentReader,
  type InvoiceDocumentData,
  type StoredDocument,
} from '@agentor/db';
import { formatDate, formatMinutes } from '@agentor/i18n';
import {
  creditNotePdf,
  invoicePdf,
  type DocumentLine,
  type InvoicePayment,
  type Party,
  type SellerDetails,
} from '@agentor/pdf';
import { brandName } from '../components/billing/card';
import { env } from './env';
import { db } from './infra';
import { storage } from './storage';

/**
 * Invoice (I01) and credit note (I02) PDFs (PLAN-EMAILS-PDF §6.3): rendered once per document
 * and state, kept in storage under their SHA-256 and never re-rendered; served through a signed
 * link that works for 5 minutes. The database decides who may read a document (Superadmin, or
 * an owner of the company); a link is only signed after that check.
 */

const LINK_SECONDS = 5 * 60;

/* ---- Mapping ------------------------------------------------------------------------------------ */

export function sellerFrom(s: BillingSeller): SellerDetails {
  return {
    name: s.companyName || 'Agentor ApS',
    address: s.companyAddress || null,
    postalCity: s.companyPostalCity || null,
    cvr: s.companyCvr || null,
    email: s.companyEmail || 'faktura@agentor.dk',
    web: 'app.agentor.dk',
    bankReg: s.bankReg || null,
    bankAccount: s.bankAccount || null,
    iban: s.bankIban || null,
  };
}

const partyFrom = (t: BillingParty): Party => ({
  name: t.name,
  addressLines: [t.addressLine, [t.postalCode, t.city].filter(Boolean).join(' ')].filter(
    (x): x is string => Boolean(x),
  ),
  cvr: t.cvr,
  email: t.billingEmail,
});

const cardOf = (s: { cardBrand: string | null; cardLast4: string | null } | null) =>
  s?.cardLast4 ? `${brandName(s.cardBrand)} •••• ${s.cardLast4}` : null;

/** "2.–7. okt." or "19. okt." from a case line's registrations. */
function dateRange(log: { date: string }[] | null): string | null {
  if (!log?.length) return null;
  const days = log.map((l) => new Date(`${l.date}T12:00:00Z`)).sort((a, b) => +a - +b);
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const dm = (d: Date) => formatDate(d, 'da').replace(/\s*\d{4}$/, '');
  if (+first === +last) return dm(first);
  return first.getUTCMonth() === last.getUTCMonth()
    ? `${first.getUTCDate()}.–${dm(last)}`
    : `${dm(first)}–${dm(last)}`;
}

export function invoiceInput(d: InvoiceDocumentData) {
  const i = d.invoice;
  const lines: DocumentLine[] = d.lines.map((l) => {
    const ref = l.case_number ? `#${l.case_number}` : null;
    const title = ref && l.text.startsWith(`${ref} `) ? l.text.slice(ref.length + 1) : l.text;
    const support = l.unit === 'hours';
    const range = support ? dateRange(l.log) : null;
    const detail = support
      ? [
          range,
          l.registered_minutes !== null
            ? `registreret ${formatMinutes(l.registered_minutes, 'da')}`
            : null,
          'oprundet',
        ]
          .filter(Boolean)
          .join(' · ')
      : (l.detail ??
        (i.kind === 'subscription' && l.idx === 0
          ? `${formatDate(new Date(i.period_start), 'da')} – ${formatDate(new Date(new Date(i.period_end).getTime() - 1), 'da')}`
          : null));
    return {
      ref,
      title,
      detail,
      quantity: support ? { hours: l.quantity_milli / 1000 } : { pieces: l.quantity_milli / 1000 },
      unitPriceOre: l.unit_price_ore,
      amountOre: l.amount_ore,
    };
  });
  const card = cardOf(d.subscription);
  const payment: InvoicePayment =
    i.payment_method === 'invoice'
      ? {
          method: 'invoice',
          ean: d.subscription?.ean ?? null,
          dueAt: new Date(i.due_at ?? i.issued_at ?? i.period_start),
        }
      : i.status === 'paid'
        ? {
            method: 'card',
            state: 'paid',
            card,
            paidAt: new Date(i.paid_at ?? i.issued_at ?? i.period_start),
            transaction: i.provider_payment_id,
          }
        : {
            method: 'card',
            state: i.status === 'failed' ? 'failed' : 'open',
            card,
            dueAt: new Date(i.due_at ?? i.issued_at ?? i.period_start),
          };
  const timelog =
    i.kind === 'support' && i.attach_timelog
      ? d.lines.flatMap((l) =>
          (l.log ?? []).map((e) => ({
            date: new Date(`${e.date}T12:00:00Z`),
            caseLabel: l.text,
            registeredMinutes: e.registeredMinutes,
            billedMinutes: e.billedMinutes,
          })),
        )
      : null;
  return {
    number: i.number,
    issuedAt: new Date(i.issued_at ?? i.period_start),
    dueAt: i.due_at ? new Date(i.due_at) : null,
    customerNumber: `K-${d.tenant.customerNumber}`,
    seller: sellerFrom(d.seller),
    customer: partyFrom(d.tenant),
    variant:
      i.kind === 'support'
        ? {
            kind: 'support' as const,
            month: new Date(i.period_start),
            rateOre: d.lines.find((l) => l.unit === 'hours')?.unit_price_ore ?? 64_000,
          }
        : {
            kind: 'subscription' as const,
            plan: d.subscription?.plan ?? i.description,
            interval: d.subscription?.interval ?? 'month',
            periodStart: new Date(i.period_start),
            periodEnd: new Date(new Date(i.period_end).getTime() - 1),
          },
    lines,
    netOre: i.amount_ore,
    vatOre: i.vat_ore,
    payment,
    timelog: timelog?.length ? timelog : null,
  };
}

export function creditNoteInput(d: CreditNoteDocumentData) {
  const c = d.creditNote;
  return {
    number: c.number,
    issuedAt: new Date(c.created_at),
    customerNumber: `K-${d.tenant.customerNumber}`,
    seller: sellerFrom(d.seller),
    customer: partyFrom(d.tenant),
    invoice: {
      number: c.invoice_number,
      issuedAt: new Date(c.invoice_issued_at),
      afterGrossOre: d.invoice.grossOre - d.creditedGrossOre,
    },
    reason: c.reason,
    createdBy: c.created_by_name,
    lines: d.lines.map((l) => ({
      title: l.text,
      detail: l.detail,
      quantity:
        l.unit === 'hours'
          ? { hours: l.quantity_milli / 1000 }
          : { pieces: l.quantity_milli / 1000 },
      unitPriceOre: l.unit_price_ore,
      amountOre: l.amount_ore,
    })),
    netOre: c.net_ore,
    vatOre: c.vat_ore,
    refund:
      c.refund_method === 'offset'
        ? ({ method: 'offset' } as const)
        : ({
            method: 'card',
            state:
              c.refund_state === 'done'
                ? 'done'
                : c.refund_state === 'failed'
                  ? 'failed'
                  : 'pending',
            card: cardOf(d.subscription),
            at: c.refunded_at ? new Date(c.refunded_at) : null,
          } as const),
  };
}

/* ---- Storage ------------------------------------------------------------------------------------ */

/** "INV/2026/01043" → "INV-2026-01043.pdf", as before documents were stored. */
const fileName = (number: string) => `${number.replace(/[^\w.-]+/g, '-')}.pdf`;

async function storeOnce(
  reader: DocumentReader,
  doc: { tenantId: string; kind: 'invoice' | 'credit_note'; refId: string; variant: string },
  render: () => { pdf: Buffer; filename: string },
): Promise<StoredDocument> {
  const found = await findDocument(db(), reader, doc);
  if (found) return found;
  const { pdf, filename } = render();
  const sha256 = createHash('sha256').update(pdf).digest('hex');
  const storageKey = `documents/${doc.tenantId}/${doc.kind.replace('_', '-')}/${doc.refId}/${sha256}.pdf`;
  await storage().put(storageKey, pdf);
  // If another request stored this state first, theirs is kept and returned.
  return saveDocument(db(), reader, {
    ...doc,
    storageKey,
    sha256,
    bytes: pdf.length,
    filename,
  });
}

/** The invoice's PDF for its current state (open, paid, failed), rendered at most once. */
export async function invoiceDocument(
  reader: DocumentReader,
  tenantId: string,
  invoiceId: string,
): Promise<StoredDocument | null> {
  const data = await invoiceDocumentData(db(), reader, tenantId, invoiceId);
  if (!data) return null;
  return storeOnce(
    reader,
    { tenantId, kind: 'invoice', refId: invoiceId, variant: data.invoice.status },
    () => ({
      pdf: invoicePdf(invoiceInput(data)),
      filename: fileName(data.invoice.number),
    }),
  );
}

/** The credit note's PDF; a pending refund and a done one are separate (immutable) files. */
export async function creditNoteDocument(
  reader: DocumentReader,
  tenantId: string,
  creditNoteId: string,
): Promise<StoredDocument | null> {
  const data = await creditNoteDocumentData(db(), reader, tenantId, creditNoteId);
  if (!data) return null;
  return storeOnce(
    reader,
    {
      tenantId,
      kind: 'credit_note',
      refId: creditNoteId,
      variant: `refund-${data.creditNote.refund_method}-${data.creditNote.refund_state}`,
    },
    () => ({
      pdf: creditNotePdf(creditNoteInput(data)),
      filename: fileName(data.creditNote.number),
    }),
  );
}

/* ---- Signed links ------------------------------------------------------------------------------- */

const key = () =>
  createHash('sha256').update(`agentor-documents:${env().BETTER_AUTH_SECRET}`).digest();

const sign = (id: string, exp: number) =>
  createHmac('sha256', key()).update(`${id}.${exp}`).digest('base64url');

/** A link to one stored PDF that works for 5 minutes and needs nothing else. */
export function signedDocumentUrl(id: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + LINK_SECONDS;
  return `/api/documents/${id}?exp=${exp}&sig=${sign(id, exp)}`;
}

export function verifyDocumentLink(
  id: string,
  exp: string | null,
  sig: string | null,
  now = Date.now(),
): boolean {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp)) return false;
  const e = Number(exp);
  if (e < Math.floor(now / 1000) || e > Math.floor(now / 1000) + LINK_SECONDS) return false;
  const want = Buffer.from(sign(id, e));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Streams a stored PDF after the link check; the hash proves the file is unchanged. */
export async function documentResponse(id: string): Promise<Response> {
  const doc = await documentById(db(), id);
  if (!doc) return new Response(null, { status: 404 });
  const file = await storage().get(doc.storageKey);
  if (!file || createHash('sha256').update(file).digest('hex') !== doc.sha256)
    return new Response(null, { status: 404 });
  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${doc.filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
