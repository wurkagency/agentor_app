/**
 * Flows, versions and seven days of run history for Nordlys Cykler (D1, D2, D7, D8, D10).
 * Deterministic: the same seed gives the same numbers. Two scenarios:
 *  - "board": everything the boards show (e-conomic broken, 3 EU orders and 2 credit notes
 *    failing, Brevo route paused, Lager retur paused, B2B-ordrer an unpublished draft);
 *  - "gate":  the Phase 1 prototype path (only the stale EU B2B account fails), so fixing it
 *    leaves Overblik at "Alt kører".
 */
import type pg from 'pg';
import { CONNECTIONS, FLOWS, USERS } from './seed-data';

export type Scenario = 'board' | 'gate';

const C = {
  woo: CONNECTIONS.woo.id,
  shopify: CONNECTIONS.shopify.id,
  dinero: CONNECTIONS.dinero.id,
  economic: CONNECTIONS.economic.id,
  hubspot: CONNECTIONS.hubspot.id,
  brevo: CONNECTIONS.brevo.id,
};

/** D3: the Dinero accounts; 1010 no longer exists in Dinero, which is the error to fix. */
export const WEBSHOP_ACCOUNTS = {
  'accounts.domestic': '1000',
  'accounts.vatFree': '1050',
  'accounts.euB2b': '1010',
  'accounts.export': '1040',
  'accounts.shipping': '1100',
  'accounts.shippingVatFree': '1110',
};

const CATEGORY_ACCOUNTS = [
  { category: 'Cykler', account: '1000' },
  { category: 'Reservedele', account: '1000' },
  { category: 'Tøj', account: '1020' },
  { category: 'Gavekort', account: '6900' },
  { category: 'Service', account: '1030' },
  { category: 'Fragt', account: '1100' },
  { category: 'Tøj', account: '1020', product: 'Cykelhjelm Pro' },
];

const route = (
  id: string,
  from: string,
  to: string,
  entity: string,
  targetEntity: string,
  mode: 'test' | 'draft' | 'live',
  extra: Record<string, unknown> = {},
) => ({
  id,
  from,
  to,
  entity,
  targetEntity,
  mode,
  paused: false,
  settings: {},
  mapping: {},
  categoryAccounts: [],
  filters: [],
  updateExisting: true,
  ...extra,
});

const nodes = (src: string, dests: [string, string][]) => [
  { id: 'src', role: 'source', connectionId: src, position: { x: 0, y: 160 } },
  ...dests.map(([id, conn], i) => ({
    id,
    role: 'destination',
    connectionId: conn,
    position: { x: 520, y: i * 180 },
  })),
];

export const WEBSHOP_V7 = {
  defaultMode: 'live',
  pollMinutes: 5,
  nodes: nodes(C.woo, [
    ['dinero', C.dinero],
    ['hubspot', C.hubspot],
    ['brevo', C.brevo],
  ]),
  routes: [
    route('orders-dinero', 'src', 'dinero', 'order', 'order', 'draft', {
      mapping: WEBSHOP_ACCOUNTS,
      categoryAccounts: CATEGORY_ACCOUNTS,
      settings: { 'invoice.bookAutomatically': false, 'invoice.language': 'da' },
    }),
    route('creditnotes-dinero', 'src', 'dinero', 'creditNote', 'creditNote', 'live'),
    route('customers-dinero', 'src', 'dinero', 'customer', 'customer', 'live'),
    route('customers-hubspot', 'src', 'hubspot', 'customer', 'customer', 'test'),
    route('customers-brevo', 'src', 'brevo', 'customer', 'customer', 'live'),
  ],
};

/** The draft on top of v7: the "Kun ordrer med total > 0" filter (D5-GaaLive). */
export const WEBSHOP_DRAFT = {
  ...WEBSHOP_V7,
  routes: WEBSHOP_V7.routes.map((r) =>
    r.id === 'orders-dinero' ? { ...r, filters: [{ field: 'total', op: 'gt', value: 0 }] } : r,
  ),
};

const OUTLET = {
  defaultMode: 'live',
  pollMinutes: 5,
  nodes: nodes(C.shopify, [['economic', C.economic]]),
  routes: [
    route('orders-economic', 'src', 'economic', 'order', 'order', 'live', {
      mapping: { ...WEBSHOP_ACCOUNTS, 'accounts.euB2b': '1015' },
    }),
    route('creditnotes-economic', 'src', 'economic', 'creditNote', 'creditNote', 'live', {
      mapping: { ...WEBSHOP_ACCOUNTS, 'accounts.euB2b': '1015' },
    }),
    route('customers-economic', 'src', 'economic', 'customer', 'customer', 'live'),
  ],
};

const KREDITNOTAER = {
  defaultMode: 'live',
  pollMinutes: 5,
  nodes: nodes(C.woo, [['dinero', C.dinero]]),
  routes: [route('creditnotes-dinero', 'src', 'dinero', 'creditNote', 'creditNote', 'live')],
};

const NYHEDSBREV = {
  defaultMode: 'live',
  pollMinutes: 5,
  nodes: nodes(C.woo, [['brevo', C.brevo]]),
  routes: [route('customers-brevo', 'src', 'brevo', 'customer', 'customer', 'live')],
};

const LAGER = {
  defaultMode: 'live',
  pollMinutes: 15,
  nodes: nodes(C.dinero, [
    ['woo', C.woo],
    ['shopify', C.shopify],
  ]),
  routes: [
    route('stock-woo', 'src', 'woo', 'stock', 'stock', 'live'),
    route('stock-shopify', 'src', 'shopify', 'stock', 'stock', 'live'),
  ],
};

const B2B = {
  defaultMode: 'test',
  pollMinutes: 5,
  nodes: nodes(C.woo, [['economic', C.economic]]),
  routes: [route('orders-economic', 'src', 'economic', 'order', 'order', 'test')],
};

/** Deterministic pseudo-random numbers (no Math.random in seeds). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const FIRST = [
  'Line',
  'Mads',
  'Ane',
  'Søren',
  'Ida',
  'Lars',
  'Sofie',
  'Emil',
  'Freja',
  'Noah',
  'Clara',
  'Oskar',
  'Alma',
  'Viggo',
  'Ella',
];
const LAST = [
  'Bak',
  'Holm',
  'Kjær',
  'Lund',
  'Friis',
  'Bruun',
  'Dahl',
  'Storm',
  'Vang',
  'Krogh',
  'Juhl',
  'Skov',
];

interface RecordRow {
  run: number;
  routeId: string;
  entity: string;
  sourceId: string;
  label: string;
  outcome: string;
  mode: string;
  amount: number | null;
  errorCode: string | null;
  errorParams: Record<string, string> | null;
  preview: Record<string, unknown> | null;
  minutesAgo: number;
}

export async function seedFlows(
  owner: pg.Client,
  tenantId: string,
  scenario: Scenario,
  now = new Date(),
): Promise<void> {
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  const jonas = USERS.jonas.name;
  const mette = USERS.mette.name;

  // --- flows and versions -----------------------------------------------------------------------
  const flowsDef: {
    key: keyof typeof FLOWS;
    published: { number: number; def: unknown; at: string; by: string } | null;
    draft?: { def: unknown; by: string };
    pausedAt?: Date;
    pausedBy?: string;
    routePauses?: Record<string, { at: string; by: string }>;
    template?: string;
  }[] = [
    {
      key: 'outlet',
      published: { number: 3, def: OUTLET, at: '2026-09-20T10:00:00+02:00', by: mette },
    },
    {
      key: 'webshop',
      published: { number: 7, def: WEBSHOP_V7, at: '2026-10-14T11:20:00+02:00', by: jonas },
      draft: { def: WEBSHOP_DRAFT, by: mette },
      routePauses: { 'customers-brevo': { at: '2026-10-03T09:00:00+02:00', by: jonas } },
      template: 'webshop-dinero',
    },
    {
      key: 'kreditnotaer',
      published: { number: 2, def: KREDITNOTAER, at: '2026-09-28T13:00:00+02:00', by: mette },
    },
    {
      key: 'nyhedsbrev',
      published: { number: 1, def: NYHEDSBREV, at: '2026-09-10T09:30:00+02:00', by: mette },
      template: 'customers-brevo',
    },
    {
      key: 'lager',
      published: { number: 1, def: LAGER, at: '2026-09-15T08:00:00+02:00', by: jonas },
      pausedAt: new Date('2026-10-01T16:00:00+02:00'),
      pausedBy: jonas,
    },
    { key: 'b2b', published: null, draft: { def: B2B, by: mette } },
  ];

  const versionIds: Record<string, string> = {};
  for (const f of flowsDef) {
    const flowId = FLOWS[f.key].id;
    let publishedId: string | null = null;
    if (f.published) {
      // Earlier versions, archived, so the history has something to show.
      for (let n = 1; n < f.published.number; n++)
        await owner.query(
          `insert into flow_versions (tenant_id, flow_id, number, state, definition, author_name, published_at, published_by_name, created_at)
           values ($1, $2, $3, 'archived', $4, $5, $6, $5, $6)`,
          [
            tenantId,
            flowId,
            n,
            JSON.stringify(f.published.def),
            f.published.by,
            new Date(
              new Date(f.published.at).getTime() - (f.published.number - n) * 3 * 86_400_000,
            ),
          ],
        );
      const r = await owner.query<{ id: string }>(
        `insert into flow_versions (tenant_id, flow_id, number, state, definition, author_name, published_at, published_by_name, created_at)
         values ($1, $2, $3, 'published', $4, $5, $6, $5, $6) returning id`,
        [
          tenantId,
          flowId,
          f.published.number,
          JSON.stringify(f.published.def),
          f.published.by,
          f.published.at,
        ],
      );
      publishedId = r.rows[0]!.id;
      versionIds[f.key] = publishedId;
    }
    if (f.draft)
      await owner.query(
        `insert into flow_versions (tenant_id, flow_id, state, definition, author_name, updated_at)
         values ($1, $2, 'draft', $3, $4, $5)`,
        [tenantId, flowId, JSON.stringify(f.draft.def), f.draft.by, ago(60)],
      );
    await owner.query(
      `update flows set published_version_id = $2, paused_at = $3, paused_by_name = $4, route_pauses = $5,
              template = $6, next_run_at = $7, created_at = $8
        where id = $1`,
      [
        flowId,
        publishedId,
        f.pausedAt ?? null,
        f.pausedBy ?? null,
        JSON.stringify(f.routePauses ?? {}),
        f.template ?? null,
        publishedId && !f.pausedAt ? new Date(now.getTime() + 4 * 60_000) : null,
        f.published ? f.published.at : ago(2 * 1440),
      ],
    );
  }

  // --- seven days of history ----------------------------------------------------------------------
  const rand = rng(10447);
  const records: RecordRow[] = [];
  const minutesIn7Days = 7 * 1440;
  // Runs every 25 minutes; run index 0 is the newest (4 minutes ago, D2 "for 4 min. siden").
  const runMinute = (i: number) => 4 + i * 25;
  const runsCount = Math.floor((minutesIn7Days - 10) / 25);

  // Orders → Dinero Fakturaer: 412 orders (#10026…#10437), plus the newest run's EU orders.
  for (let i = 0; i < 412; i++) {
    const n = 10437 - i;
    const run = 1 + Math.floor((i / 412) * (runsCount - 1));
    const amount = Math.round((149 + rand() * rand() * 1150) * 100);
    records.push({
      run,
      routeId: 'orders-dinero',
      entity: 'order',
      sourceId: `o-${n}`,
      label: `#${n}`,
      outcome: 'created',
      mode: 'draft',
      amount,
      errorCode: null,
      errorParams: null,
      preview: { customer: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}` },
      minutesAgo: runMinute(run),
    });
  }
  // The newest run: the three EU B2B orders fail on the stale account (D1-Problemer, D8).
  const eu = [
    { n: 10447, amount: 439500, customer: 'Hans Weber GmbH' },
    { n: 10441, amount: 1534500, customer: 'Cykelhuset Malmö AB' },
    { n: 10439, amount: 113740, customer: 'Fietsen de Vries B.V.' },
  ];
  for (const o of eu)
    records.push({
      run: 0,
      routeId: 'orders-dinero',
      entity: 'order',
      sourceId: `o-${o.n}`,
      label: `#${o.n}`,
      outcome: 'failed',
      mode: 'draft',
      amount: o.amount,
      errorCode: 'ACCOUNT_NOT_FOUND',
      errorParams: { field: 'accounts.euB2b', value: '1010' },
      preview: { customer: o.customer },
      minutesAgo: runMinute(0),
    });

  // Customers → Dinero Kunder (658), → HubSpot Test (96).
  for (let i = 0; i < 658; i++) {
    const run = 1 + Math.floor((i / 658) * (runsCount - 1));
    const name = `${FIRST[(i * 3) % FIRST.length]} ${LAST[(i * 5) % LAST.length]}`;
    records.push({
      run,
      routeId: 'customers-dinero',
      entity: 'customer',
      sourceId: `c-h${i}`,
      label: name,
      outcome: i % 4 === 0 ? 'updated' : 'created',
      mode: 'live',
      amount: null,
      errorCode: null,
      errorParams: null,
      preview: null,
      minutesAgo: runMinute(run),
    });
    if (i < 96)
      records.push({
        run,
        routeId: 'customers-hubspot',
        entity: 'customer',
        sourceId: `c-h${i}`,
        label: name,
        outcome: 'would_create',
        mode: 'test',
        amount: null,
        errorCode: null,
        errorParams: null,
        preview: null,
        minutesAgo: runMinute(run) + 3,
      });
  }
  // Kreditnotaer → Dinero Kreditnotaer (18); on the board two fail for a missing invoice.
  for (let i = 0; i < 18; i++) {
    const failed = scenario === 'board' && i < 2;
    const n = failed ? (i === 0 ? 10441 : 10439) : 10400 - i * 7;
    const run = failed ? 2 : 3 + i * 9;
    records.push({
      run,
      routeId: 'creditnotes-dinero',
      entity: 'creditNote',
      sourceId: `cn-${n}`,
      label: `KN-${n}`,
      outcome: failed ? 'failed' : 'created',
      mode: 'live',
      amount: -Math.round((199 + rand() * 600) * 100),
      errorCode: failed ? 'INVOICE_MISSING' : null,
      errorParams: failed ? { order: `#${n}` } : null,
      preview: null,
      minutesAgo: runMinute(run),
    });
  }

  // --- write runs and records (webshop flow) -------------------------------------------------------
  const webshopFlow = FLOWS.webshop.id;
  const runIds: string[] = [];
  for (let i = 0; i < runsCount; i++) {
    const rs = records.filter((r) => r.run === i);
    if (i > 0 && rs.length === 0 && i % 3) continue;
    const failed = rs.filter((r) => r.outcome === 'failed').length;
    const ok = rs.length - failed;
    const r = await owner.query<{ id: string }>(
      `insert into runs (tenant_id, flow_id, version_id, kind, status, started_at, finished_at, records_total, records_ok, records_failed, duration_ms)
       values ($1, $2, $3, 'scheduled', $4, $5::timestamptz, $5::timestamptz + interval '4 seconds', $6, $7, $8, 4200) returning id`,
      [
        tenantId,
        webshopFlow,
        versionIds.webshop,
        failed ? (ok ? 'partial' : 'failed') : 'ok',
        ago(runMinute(i)),
        rs.length,
        ok,
        failed,
      ],
    );
    runIds[i] = r.rows[0]!.id;
  }
  await insertRecords(owner, tenantId, webshopFlow, records, runIds, ago);

  // Links for what was written, so updates and duplicates are recognised.
  await owner.query(
    `insert into record_links (tenant_id, flow_id, route_id, source_id, destination_id)
     select tenant_id, flow_id, route_id, source_id, 'dinero-' || source_id from run_records
      where flow_id = $1 and outcome in ('created', 'updated') and mode <> 'test'
     on conflict do nothing`,
    [webshopFlow],
  );

  // Smaller flows: Kreditnotaer (37 records) and Kunder til nyhedsbrev (204 records).
  await historyFor(
    owner,
    tenantId,
    FLOWS.kreditnotaer.id,
    versionIds.kreditnotaer!,
    'creditnotes-dinero',
    'creditNote',
    37,
    9,
    ago,
  );
  await historyFor(
    owner,
    tenantId,
    FLOWS.nyhedsbrev.id,
    versionIds.nyhedsbrev!,
    'customers-brevo',
    'customer',
    204,
    12,
    ago,
  );
  // Outlet → regnskab ran fine until e-conomic's access was revoked yesterday 09:14.
  await historyFor(
    owner,
    tenantId,
    FLOWS.outlet.id,
    versionIds.outlet!,
    'orders-economic',
    'order',
    7,
    27 * 60,
    ago,
    3300,
  );

  await owner.query(
    `update flows f set last_run_at = (select max(started_at) from runs r where r.flow_id = f.id) where tenant_id = $1`,
    [tenantId],
  );

  // Notifications (D2-Notifikationer) for the owner and the admin.
  for (const user of [USERS.mette.id, USERS.jonas.id]) {
    const add = (n: {
      event: string;
      key: string;
      params: object;
      href: string;
      action: boolean;
      minutesAgo: number;
      flowId?: string;
      connectionId?: string;
      read?: boolean;
    }) =>
      owner.query(
        `insert into notifications (tenant_id, user_id, event, needs_action, message_key, params, href, flow_id, connection_id, created_at, read_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          tenantId,
          user,
          n.event,
          n.action,
          n.key,
          JSON.stringify(n.params),
          n.href,
          n.flowId ?? null,
          n.connectionId ?? null,
          ago(n.minutesAgo),
          n.read ? ago(n.minutesAgo - 1) : null,
        ],
      );
    if (scenario === 'board') {
      await add({
        event: 'connection_broken',
        key: 'connectionBroken',
        params: { connector: 'e-conomic', name: 'Outlet → regnskab' },
        href: `/connections/${C.economic}?reconnect=1`,
        action: true,
        minutesAgo: 27 * 60,
        connectionId: C.economic,
      });
      await add({
        event: 'record_failed',
        key: 'creditNotesFailed',
        params: { count: 2, flow: 'Webshop → regnskab og CRM', system: 'Dinero' },
        href: `/integrations/${webshopFlow}?tab=runs`,
        action: true,
        minutesAgo: 4 + 2 * 25,
        flowId: webshopFlow,
      });
    }
    await add({
      event: 'record_failed',
      key: 'recordsFailed',
      params: { count: 3, flow: 'Webshop → regnskab og CRM' },
      href: `/integrations/${webshopFlow}?tab=runs&run=${runIds[0]}`,
      action: true,
      minutesAgo: 4,
      flowId: webshopFlow,
    });
    await add({
      event: 'connector_update',
      key: 'published',
      params: { name: jonas, number: 7, flow: 'Webshop → regnskab og CRM' },
      href: `/integrations/${webshopFlow}?tab=settings`,
      action: false,
      minutesAgo: 5 * 1440,
      read: true,
    });
  }
}

async function insertRecords(
  owner: pg.Client,
  tenantId: string,
  flowId: string,
  records: RecordRow[],
  runIds: string[],
  ago: (m: number) => Date,
) {
  for (let i = 0; i < records.length; i += 400) {
    const chunk = records.slice(i, i + 400);
    const values: unknown[] = [];
    const rows = chunk.map((r, j) => {
      const b = j * 13;
      values.push(
        tenantId,
        runIds[r.run] ?? runIds[0],
        flowId,
        r.routeId,
        r.entity,
        r.sourceId,
        r.label,
        r.outcome,
        r.mode,
        r.amount,
        r.errorCode,
        r.errorParams ? JSON.stringify(r.errorParams) : null,
        JSON.stringify({ preview: r.preview, at: ago(r.minutesAgo).toISOString() }),
      );
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12}::jsonb, $${b + 13}::jsonb)`;
    });
    await owner.query(
      `insert into run_records (tenant_id, run_id, flow_id, route_id, entity, source_id, label, outcome, mode, amount_ore, error_code, error_params, preview, created_at, duration_ms)
       select v.t::uuid, v.r::uuid, v.f::uuid, v.ro, v.e, v.s, v.l, v.o, v.m, v.a::int, v.ec, v.ep::jsonb, (v.meta::jsonb -> 'preview'), (v.meta::jsonb ->> 'at')::timestamptz, 300 + (random() * 400)::int
         from (values ${rows.join(',')}) as v(t, r, f, ro, e, s, l, o, m, a, ec, ep, meta)`,
      values,
    );
  }
}

async function historyFor(
  owner: pg.Client,
  tenantId: string,
  flowId: string,
  versionId: string,
  routeId: string,
  entity: string,
  count: number,
  everyMinutes: number,
  ago: (m: number) => Date,
  startMinutes = 9,
) {
  const rand = rng(count * 31);
  const runIds: string[] = [];
  const records: RecordRow[] = [];
  const runs = Math.min(count, Math.floor((7 * 1440 - startMinutes) / everyMinutes));
  for (let i = 0; i < Math.max(runs, 1); i++) {
    const r = await owner.query<{ id: string }>(
      `insert into runs (tenant_id, flow_id, version_id, kind, status, started_at, finished_at, records_total, records_ok, duration_ms)
       values ($1, $2, $3, 'scheduled', 'ok', $4::timestamptz, $4::timestamptz + interval '2 seconds', 0, 0, 2100) returning id`,
      [tenantId, flowId, versionId, ago(startMinutes + i * everyMinutes)],
    );
    runIds.push(r.rows[0]!.id);
  }
  for (let i = 0; i < count; i++) {
    const run = i % runIds.length;
    records.push({
      run,
      routeId,
      entity,
      sourceId: `${entity}-${flowId.slice(-4)}-${i}`,
      label:
        entity === 'customer'
          ? `${FIRST[(i * 11) % FIRST.length]!.toLowerCase()}@…`
          : entity === 'creditNote'
            ? `KN-${10300 - i}`
            : `#${3318 - i}`,
      outcome: 'created',
      mode: 'live',
      amount:
        entity === 'customer'
          ? null
          : Math.round((199 + rand() * 900) * 100) * (entity === 'creditNote' ? -1 : 1),
      errorCode: null,
      errorParams: null,
      preview: null,
      minutesAgo: startMinutes + run * everyMinutes,
    });
  }
  await insertRecords(owner, tenantId, flowId, records, runIds, ago);
  await owner.query(
    `update runs r set records_total = c.n, records_ok = c.n
       from (select run_id, count(*)::int n from run_records where flow_id = $1 group by run_id) c
      where r.id = c.run_id`,
    [flowId],
  );
}
