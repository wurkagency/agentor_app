import type { Transport } from '../src/live/http.js';

/**
 * A recorded Odoo 16 database behind JSON-RPC (`/jsonrpc`) for the live client's tests. Tables
 * are plain rows; dotted fields ("location_id.usage") are stored on the row as they are read in
 * domains. Every call is kept so a test can check what was sent.
 */

type Row = Record<string, unknown>;

export interface FakeOdooDb {
  version?: string;
  apiKey?: string;
  tables: Record<string, Row[]>;
  fields?: Record<string, Record<string, Row>>;
  /** Models the user may not read (check_access_rights answers false). */
  denied?: string[];
  /** Answers a call with an Odoo error instead: `{ 'account.move.search_read': {...} }`. */
  errors?: Record<string, { name: string; message: string }>;
}

export interface OdooCall {
  service: string;
  method: string;
  model?: string;
  modelMethod?: string;
  args: unknown[];
  kwargs: Record<string, unknown>;
}

const matches = (row: Row, cond: unknown): boolean => {
  if (!Array.isArray(cond)) return true;
  const [field, op, value] = cond as [string, string, unknown];
  // A field the row doesn't have reads as false, as Odoo answers for empty values.
  const v = row[field] ?? false;
  if (op === '=') return v === value || (Array.isArray(v) && v[0] === value);
  if (op === 'in')
    return (value as unknown[]).some((x) => x === v || (Array.isArray(v) && v[0] === x));
  if (op === '>=') return String(v ?? '') >= String(value);
  if (op === '=ilike') return String(v ?? '').toLowerCase() === String(value).toLowerCase();
  throw new Error(`fake odoo: operator ${op}`);
};

/** Line fields per document model: where the lines live and what the quantity and tax are called. */
const DOCS: Record<string, { lines: string; table: string; qty: string; tax: string }> = {
  'sale.order': {
    lines: 'order_line',
    table: 'sale.order.line',
    qty: 'product_uom_qty',
    tax: 'tax_id',
  },
  'account.move': {
    lines: 'invoice_line_ids',
    table: 'account.move.line',
    qty: 'quantity',
    tax: 'tax_ids',
  },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const pick = (row: Row, fields: string[] | undefined) =>
  fields?.length
    ? Object.fromEntries([['id', row.id], ...fields.map((f) => [f, row[f] ?? false])])
    : row;

function order(rows: Row[], spec: string | undefined): Row[] {
  if (!spec) return rows;
  const keys = spec.split(',').map((p) => p.trim().split(/\s+/) as [string, string?]);
  return [...rows].sort((a, b) => {
    for (const [k, dir] of keys) {
      const c = String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'en', { numeric: true });
      if (c) return dir === 'desc' ? -c : c;
    }
    return 0;
  });
}

export function fakeOdoo(db: FakeOdooDb): { transport: Transport; calls: OdooCall[] } {
  const calls: OdooCall[] = [];
  const table = (model: string) => (db.tables[model] ??= []);
  const nextId = (model: string) => Math.max(0, ...table(model).map((r) => Number(r.id))) + 100;
  const taxIds = (cmd: unknown): number[] =>
    Array.isArray(cmd) && Array.isArray(cmd[0]) ? ((cmd[0] as unknown[])[2] as number[]) : [];

  /** Totals as Odoo computes them: price × qty − discount, plus VAT unless the tax includes it. */
  const recompute = (model: string, doc: Row) => {
    const spec = DOCS[model];
    if (!spec) return;
    let total = 0;
    for (const l of table(spec.table).filter((x) => x.parent === doc.id)) {
      const base =
        Number(l.price_unit) * Number(l[spec.qty] ?? 1) * (1 - Number(l.discount ?? 0) / 100);
      const tax = taxIds(l[spec.tax])
        .map((t) => table('account.tax').find((x) => x.id === t))
        .find(Boolean);
      const rate = tax ? Number(tax.amount) / 100 : 0;
      total += tax?.price_include ? base : base * (1 + rate);
    }
    doc.amount_total = round2(total);
    if (model === 'account.move')
      doc.amount_residual = doc.payment_state === 'paid' ? 0 : doc.amount_total;
  };

  /** create/write values with one2many commands: (5) clears the lines, (0, 0, vals) adds one. */
  const apply = (model: string, doc: Row, vals: Row) => {
    const spec = DOCS[model];
    for (const [k, v] of Object.entries(vals)) {
      if (spec && k === spec.lines) {
        for (const cmd of v as unknown[][]) {
          if (cmd[0] === 5)
            db.tables[spec.table] = table(spec.table).filter((l) => l.parent !== doc.id);
          if (cmd[0] === 0)
            table(spec.table).push({ id: nextId(spec.table), parent: doc.id, ...(cmd[2] as Row) });
        }
      } else doc[k] = v;
    }
    recompute(model, doc);
  };

  const create = (model: string, vals: Row): number => {
    const doc: Row = {
      id: nextId(model),
      state: 'draft',
      ...(model === 'account.move' ? { name: '/', payment_state: 'not_paid' } : {}),
    };
    if (model === 'sale.order')
      Object.assign(doc, { name: `S${String(doc.id).padStart(5, '0')}`, invoice_ids: [] });
    table(model).push(doc);
    apply(model, doc, vals);
    return doc.id as number;
  };

  const wizards = new Map<number, { model: string; vals: Row; context: Row }>();
  let wizardSeq = 9000;

  const linesOf = (model: string, docId: unknown) =>
    table(DOCS[model]!.table).filter((l) => l.parent === docId);

  const business = (
    model: string,
    method: string,
    args: unknown[],
    kwargs: Record<string, unknown>,
  ) => {
    const ids = (Array.isArray(args[0]) ? args[0] : []) as number[];
    const rows = table(model).filter((r) => ids.includes(r.id as number));
    switch (method) {
      case 'create': {
        if (model.includes('.') && /wizard|register|advance|reversal/.test(model)) {
          const wid = ++wizardSeq;
          wizards.set(wid, { model, vals: args[0] as Row, context: (kwargs.context ?? {}) as Row });
          return wid;
        }
        return create(model, args[0] as Row);
      }
      case 'write':
        for (const r of rows) apply(model, r, args[1] as Row);
        return true;
      case 'load': {
        const [fields, data] = args as [string[], string[][]];
        const out: number[] = [];
        for (const row of data) {
          const xid = row[fields.indexOf('id')]!;
          const dbid = Number(row[fields.indexOf('.id')]);
          const [module, name] = xid.split('.') as [string, string];
          table('ir.model.data').push({
            id: nextId('ir.model.data'),
            module,
            name,
            model,
            res_id: dbid,
          });
          out.push(dbid);
        }
        return { ids: out, messages: [] };
      }
      case 'action_confirm':
        for (const r of rows) r.state = 'sale';
        return true;
      case 'action_cancel':
      case 'button_cancel':
        for (const r of rows) r.state = 'cancel';
        return true;
      case 'action_post':
        for (const r of rows) {
          r.state = 'posted';
          r.name = r.move_type === 'out_refund' ? `RINV/2026/${r.id}` : `INV/2026/${r.id}`;
        }
        return true;
      case 'create_invoices': {
        const w = wizards.get(ids[0]!)!;
        for (const soId of w.context.active_ids as number[]) {
          const so = table('sale.order').find((x) => x.id === soId)!;
          const inv = create('account.move', {
            move_type: 'out_invoice',
            partner_id: so.partner_id,
            invoice_origin: so.name,
            invoice_line_ids: linesOf('sale.order', soId).map(
              ({ id: _i, parent: _p, product_uom_qty, tax_id, ...l }) => [
                0,
                0,
                { ...l, quantity: product_uom_qty, tax_ids: tax_id },
              ],
            ),
          });
          so.invoice_ids = [...((so.invoice_ids as number[]) ?? []), inv];
        }
        return true;
      }
      case 'action_create_payments': {
        const w = wizards.get(ids[0]!)!;
        for (const mid of w.context.active_ids as number[]) {
          const m = table('account.move').find((x) => x.id === mid)!;
          m.payment_state = 'paid';
          m.amount_residual = 0;
          table('account.payment').push({ id: nextId('account.payment'), move: mid, ...w.vals });
        }
        return true;
      }
      case 'reverse_moves': {
        const w = wizards.get(ids[0]!)!;
        for (const mid of w.context.active_ids as number[]) {
          const inv = table('account.move').find((x) => x.id === mid)!;
          create('account.move', {
            move_type: 'out_refund',
            reversed_entry_id: mid,
            partner_id: inv.partner_id,
            invoice_line_ids: linesOf('account.move', mid).map(({ id: _i, parent: _p, ...l }) => [
              0,
              0,
              l,
            ]),
          });
        }
        return true;
      }
      case 'message_post_with_template':
        return 1;
      default:
        return undefined;
    }
  };

  const object = (
    model: string,
    method: string,
    args: unknown[],
    kwargs: Record<string, unknown>,
  ) => {
    const err = db.errors?.[`${model}.${method}`];
    if (err) return { error: { code: 200, message: 'Odoo Server Error', data: err } };
    const rows = db.tables[model] ?? [];
    const where = (domain: unknown[]) => rows.filter((r) => domain.every((c) => matches(r, c)));
    switch (method) {
      case 'check_access_rights':
        return { result: !db.denied?.includes(model) };
      case 'fields_get':
        return { result: db.fields?.[model] ?? {} };
      case 'search_read': {
        const found = order(where(args[0] as unknown[]), kwargs.order as string | undefined);
        const offset = Number(kwargs.offset ?? 0);
        const limit = kwargs.limit === undefined ? found.length : Number(kwargs.limit);
        return {
          result: found
            .slice(offset, offset + limit)
            .map((r) => pick(r, kwargs.fields as string[])),
        };
      }
      case 'read': {
        const [ids, fields] = args as [number[], string[]];
        return {
          result: rows.filter((r) => ids.includes(r.id as number)).map((r) => pick(r, fields)),
        };
      }
      case 'search_count':
        return { result: where(args[0] as unknown[]).length };
      case 'name_search':
        return { result: rows.map((r) => [r.id, r.display_name ?? r.name]) };
      case 'read_group': {
        // Only what the client asks: write_date:max grouped by product_id.
        const groups = new Map<number, { product_id: unknown; write_date: string }>();
        for (const r of where(args[0] as unknown[])) {
          const id = (r.product_id as [number, string])[0];
          const g = groups.get(id);
          if (!g || g.write_date < String(r.write_date))
            groups.set(id, { product_id: r.product_id, write_date: String(r.write_date) });
        }
        return { result: [...groups.values()] };
      }
      default: {
        const result = business(model, method, args, kwargs);
        if (result === undefined) throw new Error(`fake odoo: ${model}.${method}`);
        return { result };
      }
    }
  };
  const transport: Transport = async (url, req) => {
    if (!new URL(url).pathname.endsWith('/jsonrpc'))
      return { status: 404, headers: {}, body: '<html>Not Found</html>' };
    const { params, id } = JSON.parse(String(req.body)) as {
      params: { service: string; method: string; args: unknown[] };
      id: number;
    };
    const call: OdooCall = {
      service: params.service,
      method: params.method,
      args: params.args,
      kwargs: {},
    };
    calls.push(call);
    let out: Record<string, unknown>;
    if (params.service === 'common' && params.method === 'version')
      out = { result: { server_version: db.version ?? '16.0+e', server_serie: '16.0' } };
    else if (params.service === 'common' && params.method === 'authenticate') {
      const [database, , key] = params.args as string[];
      out =
        database !== 'nordlys'
          ? {
              error: {
                code: 200,
                message: 'Odoo Server Error',
                data: {
                  name: 'psycopg2.OperationalError',
                  message: `connection failed: FATAL:  database "${database}" does not exist`,
                },
              },
            }
          : { result: key === (db.apiKey ?? 'key-ok') ? 2 : false };
    } else {
      const [, , , model, method, args, kwargs] = params.args as [
        string,
        number,
        string,
        string,
        string,
        unknown[],
        Record<string, unknown>,
      ];
      Object.assign(call, { model, modelMethod: method, args, kwargs });
      out = object(model, method, args, kwargs ?? {});
    }
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, ...out }),
    };
  };
  return { transport, calls };
}
