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
  const v = row[field];
  if (op === '=') return v === value || (Array.isArray(v) && v[0] === value);
  if (op === 'in')
    return (value as unknown[]).some((x) => x === v || (Array.isArray(v) && v[0] === x));
  if (op === '>=') return String(v ?? '') >= String(value);
  throw new Error(`fake odoo: operator ${op}`);
};

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
      default:
        throw new Error(`fake odoo: ${model}.${method}`);
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
