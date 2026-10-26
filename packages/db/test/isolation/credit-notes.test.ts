import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { adminUrl, roleUrl } from './env.js';
import { ID } from './fixtures.js';

/**
 * Credit notes and invoice documents (I01/I02, PLAN-EMAILS-PDF §6–7): only Superadmin creates
 * credit notes; a credit never exceeds what is left of the invoice, per line or in total, also
 * when two run at once; K-ÅÅÅÅ-nnnn has no gaps; the original invoice is never changed; a
 * document is readable only by Superadmin or an owner of the company.
 */

const STAFF = '0190a000-0000-7000-8000-0000000f0c01';
const INVOICE = '0190a000-0000-7000-8000-0000000ac0a1';
const INVOICE_2 = '0190a000-0000-7000-8000-0000000ac0a2';
const INVOICE_DISCOUNT = '0190a000-0000-7000-8000-0000000ac0a4';
const LINES = JSON.stringify([
  {
    text: '#2271 Ordrer synkroniseres dobbelt',
    amountOre: 144000,
    caseNumber: 2271,
    registeredMinutes: 125,
    billedMinutes: 135,
    rateOre: 64000,
  },
  {
    text: '#2291 Fakturaer til EU-kunder fejler',
    amountOre: 96000,
    caseNumber: 2291,
    registeredMinutes: 87,
    billedMinutes: 90,
    rateOre: 64000,
  },
]);
/** Credit notes made by these tests, not the fixtures' (numbered in another year). */
const MINE = `where created_by_name = 'Kasper Nyborg'`;
let admin: pg.Client;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: adminUrl(inject('isolationDb')) });
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email, name) values ($1, 'kasper@agentor.test', 'Kasper Nyborg') on conflict do nothing`,
    [STAFF],
  );
  await admin.query(
    `insert into platform.staff (user_id, role) values ($1, 'superadmin') on conflict do nothing`,
    [STAFF],
  );
  await admin.query(
    `insert into invoices (tenant_id, id, number, kind, status, period_start, period_end, description,
                           lines, amount_ore, vat_ore, payment_method, provider_payment_id, paid_at, issued_at)
     values ($1, $2, 'INV/2026/90001', 'support', 'paid', '2026-08-01', '2026-09-01', 'Support · oktober 2026',
             $4::jsonb, 240000, 60000, 'card', 'qp-1', now(), now()),
            ($1, $3, 'INV/2026/90002', 'support', 'paid', '2026-09-01', '2026-10-01', 'Support · oktober 2026 (2)',
             $4::jsonb, 240000, 60000, 'card', 'qp-2', now(), now())`,
    [ID.tenantA, INVOICE, INVOICE_2, LINES],
  );
});

afterAll(async () => {
  // The fixture credit notes ("Fixture") stay for the other suites; lines go with their note.
  await admin.query(
    `delete from credit_notes where tenant_id = $1 and created_by_name = 'Kasper Nyborg'`,
    [ID.tenantA],
  );
  await admin.query(`delete from audit_log where action like 'credit_note.%'`);
  await admin.query(`delete from invoices where id in ($1, $2, $3)`, [
    INVOICE,
    INVOICE_2,
    INVOICE_DISCOUNT,
  ]);
  await admin.query(`delete from platform.staff where user_id = $1`, [STAFF]);
  await admin.end();
});

/** One statement as a role and user, in its own committed transaction. */
async function as(
  role: 'web' | 'worker',
  ctx: { user?: string; tenant?: string },
  text: string,
  values: unknown[] = [],
): Promise<{ rows?: Record<string, unknown>[]; error?: pg.DatabaseError }> {
  const c = new pg.Client({ connectionString: roleUrl(role, inject('isolationDb')) });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(
      `select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`,
      [ctx.tenant ?? '', ctx.user ?? ''],
    );
    const r = await c.query(text, values);
    await c.query('commit');
    return { rows: r.rows };
  } catch (error) {
    await c.query('rollback').catch(() => undefined);
    if (error instanceof pg.DatabaseError) return { error };
    throw error;
  } finally {
    await c.end();
  }
}

const create = (lines: unknown, refund = 'offset', invoice = INVOICE, user = STAFF) =>
  as(
    'web',
    { user },
    `select * from app.create_credit_note($1, $2, $3::jsonb, 'Fejl hos Agentor', $4, 'Kasper Nyborg')`,
    [ID.tenantA, invoice, lines === null ? null : JSON.stringify(lines), refund],
  );

describe('creating credit notes', () => {
  it('only Superadmin may create one; owners and supporters may not', async () => {
    const owner = await as(
      'web',
      { user: ID.userAOwner, tenant: ID.tenantA },
      `select * from app.create_credit_note($1, $2, null, 'x', 'offset', 'x')`,
      [ID.tenantA, INVOICE],
    );
    expect(owner.error?.message).toMatch(/NOT_SUPERADMIN/);
    const direct = await as(
      'web',
      { user: ID.userAOwner, tenant: ID.tenantA },
      `insert into credit_notes (tenant_id, number, invoice_id, invoice_number, invoice_issued_at, reason, refund_method, net_ore, vat_ore, created_by_name)
       values ($1, 'K-2026-9999', $2, 'x', now(), 'x', 'offset', -1, 0, 'x')`,
      [ID.tenantA, INVOICE],
    );
    expect(direct.error?.code).toBe('42501');
  });

  it('a partial credit takes part of one line, with VAT in proportion', async () => {
    const r = await create([{ idx: 0, quantityMilli: 500, amountOre: 32000 }]);
    expect(r.error).toBeUndefined();
    expect(r.rows![0]).toMatchObject({ net_ore: -32000, vat_ore: -8000 });
    expect(String(r.rows![0]!.number)).toMatch(/^K-\d{4}-\d{4,}$/);
  });

  it('can never exceed what is left of a line', async () => {
    const r = await create([{ idx: 0, quantityMilli: 2000, amountOre: 144000 }]);
    expect(r.error?.message).toMatch(/CREDIT_EXCEEDS_INVOICE/);
  });

  it('rejects lines that are not on the invoice or not positive', async () => {
    expect((await create([{ idx: 9, quantityMilli: 1, amountOre: 1 }])).error?.message).toMatch(
      /LINE_INVALID/,
    );
    expect((await create([{ idx: 1, quantityMilli: 1, amountOre: -5 }])).error?.message).toMatch(
      /LINE_INVALID/,
    );
  });

  it('a full credit takes exactly what is left, then nothing more is possible', async () => {
    const r = await create(null);
    expect(r.error).toBeUndefined();
    // 240.000 net − 32.000 already credited; VAT is what is left of 60.000.
    expect(r.rows![0]).toMatchObject({ net_ore: -208000, vat_ore: -52000 });
    const again = await create(null);
    expect(again.error?.message).toMatch(/NOTHING_TO_CREDIT/);
    const sums = await admin.query(
      `select sum(net_ore)::int as net, sum(vat_ore)::int as vat from credit_notes where invoice_id = $1`,
      [INVOICE],
    );
    expect(sums.rows[0]).toEqual({ net: -240000, vat: -60000 });
  });

  it('never changes the original invoice', async () => {
    const r = await admin.query(
      `select status, amount_ore, vat_ore, lines from invoices where id = $1`,
      [INVOICE],
    );
    expect(r.rows[0]).toMatchObject({ status: 'paid', amount_ore: 240000, vat_ore: 60000 });
    expect(r.rows[0]!.lines).toEqual(JSON.parse(LINES));
  });

  it('two credits at once on the same invoice can not both pass the check', async () => {
    const half = [{ idx: 0, quantityMilli: 2250, amountOre: 144000 }];
    const results = await Promise.all([
      create(half, 'offset', INVOICE_2),
      create(half, 'offset', INVOICE_2),
    ]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.find((r) => r.error)?.error?.message).toMatch(/CREDIT_EXCEEDS_INVOICE/);
  });

  it('numbers have no gaps, also when credit notes are made at once or one fails', async () => {
    const before = await admin.query(`select max(number) as n from credit_notes ${MINE}`);
    // One fails (too much) in between; its number must not be used up.
    const runs = await Promise.all([
      create([{ idx: 1, quantityMilli: 250, amountOre: 16000 }], 'offset', INVOICE_2),
      create([{ idx: 1, quantityMilli: 99999, amountOre: 999999 }], 'offset', INVOICE_2),
      create([{ idx: 1, quantityMilli: 250, amountOre: 16000 }], 'offset', INVOICE_2),
    ]);
    expect(runs.filter((r) => r.error)).toHaveLength(1);
    const all = await admin.query(`select number from credit_notes ${MINE} order by number`);
    const nums = all.rows.map((r) => Number(String(r.number).split('-')[2]));
    nums.forEach((n, i) => expect(n).toBe(i + 1));
    expect(String(before.rows[0]!.n)).not.toBe(String(all.rows.at(-1)!.number));
  });

  it('refunds to a card only when the invoice was paid by card', async () => {
    const offset = await admin.query(
      `insert into invoices (tenant_id, number, kind, status, period_start, period_end, description, lines, amount_ore, vat_ore, payment_method, issued_at)
       values ($1, 'INV/2026/90003', 'subscription', 'open', '2026-11-01', '2026-12-01', 'Enterprise', '[]', 299000, 74750, 'invoice', now())
       returning id`,
      [ID.tenantA],
    );
    const r = await create(null, 'card', offset.rows[0]!.id as string);
    expect(r.error?.message).toMatch(/REFUND_NOT_POSSIBLE/);
    await admin.query(`delete from invoices where id = $1`, [offset.rows[0]!.id]);
  });

  it('a card refund is claimed once', async () => {
    const r = await create([{ idx: 1, quantityMilli: 250, amountOre: 16000 }], 'card', INVOICE_2);
    expect(r.error).toBeUndefined();
    const id = r.rows![0]!.id as string;
    const claim = () =>
      as('web', { user: STAFF }, `select * from app.credit_note_refund_claim($1, $2)`, [
        ID.tenantA,
        id,
      ]);
    const [a, b] = await Promise.all([claim(), claim()]);
    expect([a.rows!.length, b.rows!.length].sort()).toEqual([0, 1]);
    const done = await as(
      'web',
      { user: STAFF },
      `select app.credit_note_refund_result($1, $2, true, 'rf-1', 'Kasper Nyborg')`,
      [ID.tenantA, id],
    );
    expect(done.error).toBeUndefined();
    const s = await admin.query(
      `select refund_state, refund_payment_id from credit_notes where id = $1`,
      [id],
    );
    expect(s.rows[0]).toEqual({ refund_state: 'done', refund_payment_id: 'rf-1' });
    // Done stays done: no second claim.
    expect((await claim()).rows).toHaveLength(0);
  });

  it('a full credit of a discounted invoice takes what was paid, not the list price', async () => {
    // 2.990 kr. Enterprise with 20 % off: line 0 is the list price, the discount a negative line.
    await admin.query(
      `insert into invoices (tenant_id, id, number, kind, status, period_start, period_end, description,
                             lines, amount_ore, vat_ore, payment_method, provider_payment_id, paid_at, issued_at)
       values ($1, $2, 'INV/2026/90004', 'subscription', 'paid', '2026-12-01', '2027-01-01', 'Enterprise',
               '[{"text": "Rabat 20 %", "amountOre": -59800}]', 239200, 59800, 'card', 'qp-4', now(), now())`,
      [ID.tenantA, INVOICE_DISCOUNT],
    );
    const state = await as(
      'web',
      { user: STAFF },
      `select idx, amount_ore, unit_price_ore from app.platform_invoice_credit_state($1, $2)`,
      [ID.tenantA, INVOICE_DISCOUNT],
    );
    expect(state.rows).toEqual([{ idx: 0, amount_ore: 239200, unit_price_ore: 239200 }]);
    const r = await create(null, 'offset', INVOICE_DISCOUNT);
    expect(r.error).toBeUndefined();
    expect(r.rows![0]).toMatchObject({ net_ore: -239200, vat_ore: -59800 });
  });

  it('a refund result is recorded once; a late second answer changes nothing', async () => {
    const r = await create([{ idx: 1, quantityMilli: 250, amountOre: 16000 }], 'card', INVOICE_2);
    const id = r.rows![0]!.id as string;
    await as('web', { user: STAFF }, `select * from app.credit_note_refund_claim($1, $2)`, [
      ID.tenantA,
      id,
    ]);
    const result = (ok: boolean) =>
      as(
        'web',
        { user: STAFF },
        `select app.credit_note_refund_result($1, $2, $3, 'rf-2', 'Kasper Nyborg')`,
        [ID.tenantA, id, ok],
      );
    await result(true);
    await result(false);
    const s = await admin.query(`select refund_state from credit_notes where id = $1`, [id]);
    expect(s.rows[0]).toEqual({ refund_state: 'done' });
    const log = await admin.query(
      `select action from audit_log where object_id = $1 and action like 'credit_note.refund%'`,
      [id],
    );
    expect(log.rows).toEqual([{ action: 'credit_note.refunded' }]);
  });

  it('writes every credit note to the customer audit log', async () => {
    const r = await admin.query(
      `select count(*)::int as n from audit_log where tenant_id = $1 and action = 'credit_note.created'`,
      [ID.tenantA],
    );
    const notes = await admin.query(
      `select count(*)::int as n from credit_notes where tenant_id = $1 and created_by_name = 'Kasper Nyborg'`,
      [ID.tenantA],
    );
    expect(r.rows[0]!.n).toBe(notes.rows[0]!.n);
  });
});

describe('documents', () => {
  const read = (ctx: { user?: string; tenant?: string }, tenant = ID.tenantA) =>
    as('web', ctx, `select app.invoice_document($1, $2) as v`, [tenant, INVOICE]);

  it('Superadmin and the owner read the invoice; a reader or another company get nothing', async () => {
    expect((await read({ user: STAFF })).rows![0]!.v).not.toBeNull();
    expect((await read({ user: ID.userAOwner, tenant: ID.tenantA })).rows![0]!.v).not.toBeNull();
    expect((await read({ user: ID.userAReader, tenant: ID.tenantA })).rows![0]!.v).toBeNull();
    expect((await read({ user: ID.userBOwner, tenant: ID.tenantB })).rows![0]!.v).toBeNull();
    // Asking with tenant B's context for tenant A's invoice: still nothing.
    expect((await read({ user: ID.userShared, tenant: ID.tenantB })).rows![0]!.v).toBeNull();
  });

  it('the invoice document carries the lines as printed and the customer number', async () => {
    const v = (await read({ user: STAFF })).rows![0]!.v as {
      lines: { idx: number; amount_ore: number; quantity_milli: number }[];
      tenant: { customerNumber: number };
    };
    expect(v.lines.map((l) => [l.idx, l.amount_ore, l.quantity_milli])).toEqual([
      [0, 144000, 2250],
      [1, 96000, 1500],
    ]);
    expect(v.tenant.customerNumber).toBeGreaterThan(1000);
  });

  it('stored files are found only by those who may read them', async () => {
    const save = await as(
      'web',
      { user: ID.userAOwner, tenant: ID.tenantA },
      `select * from app.document_save($1, 'invoice', $2, 'paid', 'documents/x.pdf', $3, 10, 'x.pdf')`,
      [ID.tenantA, INVOICE, 'a'.repeat(64)],
    );
    expect(save.error).toBeUndefined();
    const other = await as(
      'web',
      { user: ID.userBOwner, tenant: ID.tenantB },
      `select * from app.document_find($1, 'invoice', $2, 'paid')`,
      [ID.tenantA, INVOICE],
    );
    expect(other.rows).toHaveLength(0);
    const deny = await as(
      'web',
      { user: ID.userBOwner, tenant: ID.tenantB },
      `select * from app.document_save($1, 'invoice', $2, 'paid', 'documents/y.pdf', $3, 10, 'y.pdf')`,
      [ID.tenantA, INVOICE, 'b'.repeat(64)],
    );
    expect(deny.error?.code).toBe('42501');
    // A second save for the same state keeps the first file (immutable).
    const again = await as(
      'web',
      { user: STAFF },
      `select * from app.document_save($1, 'invoice', $2, 'paid', 'documents/z.pdf', $3, 10, 'z.pdf')`,
      [ID.tenantA, INVOICE, 'c'.repeat(64)],
    );
    expect(again.rows![0]).toMatchObject({ storage_key: 'documents/x.pdf' });
    await admin.query(`delete from app.documents where ref_id = $1`, [INVOICE]);
  });
});
