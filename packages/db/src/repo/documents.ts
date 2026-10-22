import { desc, eq, sql } from 'drizzle-orm';
import { withTenant, withoutTenant, type Database } from '../client.js';
import { creditNoteLines, creditNotes, type CreditRefundMethod } from '../schema/index.js';

/**
 * Invoices and credit notes as documents (PLAN-EMAILS-PDF §6–7). Reading goes through
 * app.invoice_document / app.credit_note_document, which allow Superadmin or an owner of the
 * company and return null for anyone else; credit notes are created only by
 * app.create_credit_note, which checks the role and the uncredited amount under a lock.
 */

/** Who is asking: an owner in their company, or a staff member (no company context). */
export type DocumentReader = { tenantId: string; userId: string } | { staffUserId: string };

function asReader<T>(
  db: Database,
  r: DocumentReader,
  tenantId: string,
  fn: Parameters<typeof withTenant<T>>[2],
) {
  return 'staffUserId' in r
    ? withoutTenant(db, fn, r.staffUserId)
    : r.tenantId === tenantId
      ? withTenant(db, r, fn)
      : // An owner asking for another company: no context, so the access check fails.
        withoutTenant(db, fn, r.userId);
}

export interface InvoiceDocumentLine {
  idx: number;
  text: string;
  detail: string | null;
  unit: 'hours' | 'pieces';
  quantity_milli: number;
  unit_price_ore: number | null;
  amount_ore: number;
  case_number: number | null;
  registered_minutes: number | null;
  billed_minutes: number | null;
  log: { date: string; registeredMinutes: number; billedMinutes: number }[] | null;
}

export interface BillingParty {
  name: string;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  cvr: string | null;
  billingEmail: string | null;
  customerNumber: number;
}

export type BillingSeller = Partial<
  Record<
    | 'companyName'
    | 'companyAddress'
    | 'companyPostalCity'
    | 'companyCvr'
    | 'companyEmail'
    | 'bankReg'
    | 'bankAccount'
    | 'bankIban',
    string | null
  >
>;

export interface InvoiceDocumentData {
  invoice: {
    id: string;
    tenant_id: string;
    number: string;
    kind: 'subscription' | 'support';
    status: 'open' | 'paid' | 'failed' | 'void';
    description: string;
    period_start: string;
    period_end: string;
    amount_ore: number;
    vat_ore: number;
    payment_method: 'card' | 'mobilepay' | 'invoice';
    provider_payment_id: string | null;
    paid_at: string | null;
    issued_at: string | null;
    due_at: string | null;
    attach_timelog: boolean;
    created_at: string;
  };
  lines: InvoiceDocumentLine[];
  tenant: BillingParty;
  subscription: {
    cardBrand: string | null;
    cardLast4: string | null;
    ean: string | null;
    interval: 'month' | 'year';
    plan: string | null;
  } | null;
  seller: BillingSeller;
}

export async function invoiceDocumentData(
  db: Database,
  reader: DocumentReader,
  tenantId: string,
  invoiceId: string,
): Promise<InvoiceDocumentData | null> {
  return asReader(db, reader, tenantId, async (tx) => {
    const res = await tx.execute<{ v: InvoiceDocumentData | null }>(
      sql`select app.invoice_document(${tenantId}::uuid, ${invoiceId}::uuid) as v`,
    );
    return res.rows[0]?.v ?? null;
  });
}

export interface CreditNoteDocumentData {
  creditNote: {
    id: string;
    tenant_id: string;
    number: string;
    invoice_id: string;
    invoice_number: string;
    invoice_issued_at: string;
    reason: string;
    refund_method: CreditRefundMethod;
    refund_state: 'none' | 'pending' | 'done' | 'failed';
    refunded_at: string | null;
    net_ore: number;
    vat_ore: number;
    created_by_name: string;
    created_at: string;
  };
  lines: {
    source_index: number;
    text: string;
    detail: string | null;
    unit: 'hours' | 'pieces';
    quantity_milli: number;
    unit_price_ore: number | null;
    amount_ore: number;
  }[];
  invoice: { grossOre: number; paymentMethod: string };
  /** Credited so far, including this note (positive øre). */
  creditedGrossOre: number;
  tenant: BillingParty;
  subscription: { cardBrand: string | null; cardLast4: string | null } | null;
  seller: BillingSeller;
}

export async function creditNoteDocumentData(
  db: Database,
  reader: DocumentReader,
  tenantId: string,
  creditNoteId: string,
): Promise<CreditNoteDocumentData | null> {
  return asReader(db, reader, tenantId, async (tx) => {
    const res = await tx.execute<{ v: CreditNoteDocumentData | null }>(
      sql`select app.credit_note_document(${tenantId}::uuid, ${creditNoteId}::uuid) as v`,
    );
    return res.rows[0]?.v ?? null;
  });
}

/* ---- Stored PDFs ------------------------------------------------------------------------------- */

export interface StoredDocument {
  id: string;
  storageKey: string;
  sha256: string;
  filename: string;
}

const stored = (r: { id: string; storage_key: string; sha256: string; filename: string }) => ({
  id: r.id,
  storageKey: r.storage_key,
  sha256: r.sha256,
  filename: r.filename,
});

export async function findDocument(
  db: Database,
  reader: DocumentReader,
  d: { tenantId: string; kind: 'invoice' | 'credit_note'; refId: string; variant: string },
): Promise<StoredDocument | null> {
  return asReader(db, reader, d.tenantId, async (tx) => {
    const res = await tx.execute<{
      id: string;
      storage_key: string;
      sha256: string;
      filename: string;
    }>(
      sql`select * from app.document_find(${d.tenantId}::uuid, ${d.kind}, ${d.refId}::uuid, ${d.variant})`,
    );
    return res.rows[0] ? stored(res.rows[0]) : null;
  });
}

/** Records a rendered PDF; when another request saved the same state first, returns that one. */
export async function saveDocument(
  db: Database,
  reader: DocumentReader,
  d: {
    tenantId: string;
    kind: 'invoice' | 'credit_note';
    refId: string;
    variant: string;
    storageKey: string;
    sha256: string;
    bytes: number;
    filename: string;
  },
): Promise<StoredDocument> {
  return asReader(db, reader, d.tenantId, async (tx) => {
    const res = await tx.execute<{
      id: string;
      storage_key: string;
      sha256: string;
      filename: string;
    }>(
      sql`select * from app.document_save(${d.tenantId}::uuid, ${d.kind}, ${d.refId}::uuid, ${d.variant}, ${d.storageKey}, ${d.sha256}, ${d.bytes}::int, ${d.filename})`,
    );
    return stored(res.rows[0]!);
  });
}

/** For the signed download route only: the signature is the access check. */
export async function documentById(
  db: Database,
  id: string,
): Promise<Omit<StoredDocument, 'id'> | null> {
  const res = await withoutTenant(db, (tx) =>
    tx.execute<{ storage_key: string; sha256: string; filename: string }>(
      sql`select * from app.document_by_id(${id}::uuid)`,
    ),
  );
  const r = res.rows[0];
  return r ? { storageKey: r.storage_key, sha256: r.sha256, filename: r.filename } : null;
}

/* ---- Credit notes ------------------------------------------------------------------------------ */

export interface CreditableLine {
  idx: number;
  text: string;
  detail: string | null;
  unit: 'hours' | 'pieces';
  quantityMilli: number;
  unitPriceOre: number | null;
  amountOre: number;
  creditedOre: number;
  creditedMilli: number;
}

/** Superadmin: an invoice's lines with what is left to credit ("Kreditér" sheet). */
export async function invoiceCreditState(
  db: Database,
  staffUserId: string,
  tenantId: string,
  invoiceId: string,
): Promise<CreditableLine[]> {
  const res = await withoutTenant(
    db,
    (tx) =>
      tx.execute<{
        idx: number;
        text: string;
        detail: string | null;
        unit: 'hours' | 'pieces';
        quantity_milli: number;
        unit_price_ore: number | null;
        amount_ore: number;
        credited_ore: number;
        credited_milli: number;
      }>(
        sql`select * from app.platform_invoice_credit_state(${tenantId}::uuid, ${invoiceId}::uuid)`,
      ),
    staffUserId,
  );
  return res.rows.map((r) => ({
    idx: Number(r.idx),
    text: r.text,
    detail: r.detail,
    unit: r.unit,
    quantityMilli: Number(r.quantity_milli),
    unitPriceOre: r.unit_price_ore === null ? null : Number(r.unit_price_ore),
    amountOre: Number(r.amount_ore),
    creditedOre: Number(r.credited_ore),
    creditedMilli: Number(r.credited_milli),
  }));
}

export class CreditNoteError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CreditNoteError';
  }
}

const CREDIT_CODES = [
  'NOT_SUPERADMIN',
  'REASON_REQUIRED',
  'REFUND_METHOD_INVALID',
  'INVOICE_NOT_FOUND',
  'INVOICE_NOT_ISSUED',
  'REFUND_NOT_POSSIBLE',
  'LINE_INVALID',
  'CREDIT_EXCEEDS_INVOICE',
  'NOTHING_TO_CREDIT',
];

function creditCode(e: unknown): string | null {
  const msg =
    e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : '';
  return CREDIT_CODES.find((c) => msg.includes(c)) ?? null;
}

/** Superadmin creates a credit note (full: lines null). Audit-logged in the customer's log. */
export async function createCreditNote(
  db: Database,
  staff: { userId: string; name: string },
  input: {
    tenantId: string;
    invoiceId: string;
    lines: { idx: number; quantityMilli: number; amountOre: number }[] | null;
    reason: string;
    refund: CreditRefundMethod;
  },
): Promise<{ id: string; number: string; netOre: number; vatOre: number }> {
  try {
    const res = await withoutTenant(
      db,
      (tx) =>
        tx.execute<{ id: string; number: string; net_ore: number; vat_ore: number }>(
          sql`select * from app.create_credit_note(${input.tenantId}::uuid, ${input.invoiceId}::uuid, ${
            input.lines ? JSON.stringify(input.lines) : null
          }::jsonb, ${input.reason}, ${input.refund}, ${staff.name})`,
        ),
      staff.userId,
    );
    const r = res.rows[0]!;
    return { id: r.id, number: r.number, netOre: Number(r.net_ore), vatOre: Number(r.vat_ore) };
  } catch (e) {
    const code = creditCode(e);
    if (code) throw new CreditNoteError(code);
    throw e;
  }
}

/** Takes the card refund once; null when it is already pending or done. */
export async function claimCreditRefund(
  db: Database,
  staffUserId: string,
  tenantId: string,
  creditNoteId: string,
): Promise<{ paymentId: string | null; grossOre: number; number: string } | null> {
  const res = await withoutTenant(
    db,
    (tx) =>
      tx.execute<{ payment_id: string | null; gross_ore: number; number: string }>(
        sql`select * from app.credit_note_refund_claim(${tenantId}::uuid, ${creditNoteId}::uuid)`,
      ),
    staffUserId,
  );
  const r = res.rows[0];
  return r ? { paymentId: r.payment_id, grossOre: Number(r.gross_ore), number: r.number } : null;
}

export async function recordCreditRefund(
  db: Database,
  staff: { userId: string; name: string },
  tenantId: string,
  creditNoteId: string,
  ok: boolean,
  refundId: string | null,
): Promise<void> {
  await withoutTenant(
    db,
    (tx) =>
      tx.execute(
        sql`select app.credit_note_refund_result(${tenantId}::uuid, ${creditNoteId}::uuid, ${ok}, ${refundId}, ${staff.name})`,
      ),
    staff.userId,
  );
}

export interface FinanceCreditNote {
  id: string;
  tenantId: string;
  tenantName: string;
  number: string;
  invoiceId: string;
  invoiceNumber: string;
  reason: string;
  refundMethod: CreditRefundMethod;
  refundState: 'none' | 'pending' | 'done' | 'failed';
  netOre: number;
  vatOre: number;
  createdByName: string;
  createdAt: Date;
}

/** Superadmin: every credit note (F4, F6). */
export async function financeCreditNotes(
  db: Database,
  staffUserId: string,
): Promise<FinanceCreditNote[]> {
  const res = await withoutTenant(
    db,
    (tx) =>
      tx.execute<{ c: Record<string, unknown> }>(
        sql`select c from app.platform_finance_credit_notes() c`,
      ),
    staffUserId,
  );
  return res.rows.map(({ c }) => ({
    id: c.id as string,
    tenantId: c.tenant_id as string,
    tenantName: c.tenant_name as string,
    number: c.number as string,
    invoiceId: c.invoice_id as string,
    invoiceNumber: c.invoice_number as string,
    reason: c.reason as string,
    refundMethod: c.refund_method as CreditRefundMethod,
    refundState: c.refund_state as FinanceCreditNote['refundState'],
    netOre: Number(c.net_ore),
    vatOre: Number(c.vat_ore),
    createdByName: c.created_by_name as string,
    createdAt: new Date(c.created_at as string),
  }));
}

/** The owner's credit notes (Abonnement › Fakturaer); RLS returns nothing for others. */
export async function listCreditNotes(db: Database, ctx: { tenantId: string; userId: string }) {
  return withTenant(db, ctx, (tx) =>
    tx
      .select({
        id: creditNotes.id,
        number: creditNotes.number,
        invoiceId: creditNotes.invoiceId,
        invoiceNumber: creditNotes.invoiceNumber,
        netOre: creditNotes.netOre,
        vatOre: creditNotes.vatOre,
        refundMethod: creditNotes.refundMethod,
        refundState: creditNotes.refundState,
        createdAt: creditNotes.createdAt,
      })
      .from(creditNotes)
      .orderBy(desc(creditNotes.createdAt)),
  );
}

/** Lines of one credit note (owner), for tests and the e-mail. */
export async function creditNoteLinesOf(
  db: Database,
  ctx: { tenantId: string; userId: string },
  creditNoteId: string,
) {
  return withTenant(db, ctx, (tx) =>
    tx.select().from(creditNoteLines).where(eq(creditNoteLines.creditNoteId, creditNoteId)),
  );
}
