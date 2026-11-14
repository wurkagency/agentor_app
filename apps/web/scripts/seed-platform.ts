/**
 * Agentor Platform sample data (P1–P6, S1–S8): staff, more fictional customers, support grants,
 * cases with their timelines, and support time. All names are fictional.
 */
import type pg from 'pg';
import { FLOWS, PLATFORM_TENANTS, TENANTS, USERS } from './seed-data';

const STAFF = [
  { user: USERS.kasper, role: 'superadmin', probation: null },
  { user: USERS.anne, role: 'supporter', probation: null },
  { user: USERS.line, role: 'supporter', probation: null },
  { user: USERS.mads, role: 'supporter', probation: '2026-11-30T00:00:00+01:00' },
] as const;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const today = () => new Date().toISOString().slice(0, 10);

export async function seedPlatform(
  owner: pg.Client,
  inTenant: (id: string, fn: () => Promise<void>) => Promise<void>,
) {
  const staffIds = STAFF.map((s) => s.user.id);
  // Staff rows and time without a customer aren't removed with the tenants.
  await owner.query(`delete from platform.time_entries where staff_user_id = any($1)`, [staffIds]);
  await owner.query(`delete from platform.support_sessions where staff_user_id = any($1)`, [
    staffIds,
  ]);
  await owner.query(`delete from platform.timers where staff_user_id = any($1)`, [staffIds]);
  await owner.query(`delete from platform.audit where actor_user_id = any($1)`, [staffIds]);
  for (const s of STAFF)
    await owner.query(
      `insert into platform.staff (user_id, role, probation_until, created_by_name) values ($1, $2, $3, 'Seed')
       on conflict (user_id) do update set role = excluded.role, probation_until = excluded.probation_until, disabled_at = null`,
      [s.user.id, s.role, s.probation],
    );

  // More customers, with plans and a few flows and connections so the list has variety (P1).
  const states: Record<string, { broken?: string; paused?: boolean }> = {
    hav: { broken: 'shopify' },
    kvist: { paused: true },
  };
  for (const [key, c] of Object.entries(PLATFORM_TENANTS)) {
    await inTenant(c.id, async () => {
      await owner.query('delete from tenants where id = $1', [c.id]);
      await owner.query(
        `insert into tenants (id, name, cvr, onboarding_completed_at, created_at) values ($1, $2, $3, now() - interval '40 days', now() - interval '60 days')`,
        [c.id, c.name, c.cvr],
      );
      await owner.query(
        `insert into subscriptions (tenant_id, plan_id, status, provider_subscription_id, current_period_start, current_period_end)
         values ($1, $2, 'active', $3, now() - interval '10 days', now() + interval '20 days')`,
        [c.id, c.plan, `mock_AGSEED${key.toUpperCase()}`],
      );
      for (let i = 0; i < c.flows; i++)
        await owner.query(
          `insert into flows (tenant_id, name, paused_at, last_run_at) values ($1, $2, $3, now() - make_interval(mins => $4))`,
          [c.id, `Flow ${i + 1}`, states[key]?.paused ? minutesAgo(60 * 24 * 5) : null, 2 + i * 7],
        );
      const broken = states[key]?.broken;
      if (broken)
        await owner.query(
          `insert into connections (tenant_id, connector_id, name, status, status_reason, broken_since) values ($1, $2, $3, 'broken', 'Adgangen blev trukket tilbage.', now() - interval '1 day')`,
          [c.id, broken, c.name.replace(/ (ApS|IVS|A\/S)$/, '')],
        );
    });
  }

  // Deterministic case numbers: the EU case is #2291 as on the boards.
  await owner.query(
    `select setval('platform.case_number_seq', greatest(2291, (select coalesce(max(number) + 1, 2291) from platform.cases)), false)`,
  );
  const n = TENANTS.nordlys.id;
  const P = PLATFORM_TENANTS;

  // Support grants (P1, P2): Anne helps Nordlys today; Mølle Sport hasn't answered yet.
  const grant = async (
    tenant: string,
    staff: (typeof STAFF)[number]['user'],
    o: {
      caseId: string;
      caseRef: string;
      reason: string;
      hours: number;
      scope: string;
      approvedBy?: string | null;
      requestedMin: number;
      approvedMin?: number;
    },
  ) => {
    let id = '';
    await inTenant(tenant, async () => {
      const res = await owner.query<{ id: string }>(
        `insert into support_access_grants (tenant_id, case_id, case_ref, reason, support_name, staff_user_id, scope, hours, created_at, approved_at, approved_by, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
        [
          tenant,
          o.caseId,
          o.caseRef,
          o.reason,
          staff.name,
          staff.id,
          o.scope,
          o.hours,
          minutesAgo(o.requestedMin),
          o.approvedMin === undefined ? null : minutesAgo(o.approvedMin),
          o.approvedBy ?? null,
          new Date(Date.now() + (o.hours * 60 - (o.approvedMin ?? o.requestedMin)) * 60_000),
        ],
      );
      id = res.rows[0]!.id;
      await owner.query(
        `insert into audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id, after, created_at)
         values ($1, $2, 'support', $3, 'support.requested', 'support_access', $4, $5, $6)`,
        [
          tenant,
          staff.id,
          staff.name,
          id,
          { caseRef: o.caseRef, reason: o.reason, hours: o.hours, scope: o.scope },
          minutesAgo(o.requestedMin),
        ],
      );
      if (o.approvedMin !== undefined && o.approvedBy)
        await owner.query(
          `insert into audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id, after, created_at)
           values ($1, $2, 'user', $3, 'support.approved', 'support_access', $4, $5, $6)`,
          [
            tenant,
            o.approvedBy,
            USERS.jonas.name,
            id,
            { caseRef: o.caseRef },
            minutesAgo(o.approvedMin),
          ],
        );
    });
    return id;
  };

  // Cases (S1–S3) ----------------------------------------------------------------------------
  type Ev = {
    kind: string;
    author: string;
    userId?: string | null;
    body: string;
    min: number;
    meta?: Record<string, unknown>;
  };
  const kase = async (o: {
    tenant: string;
    title: string;
    status: string;
    priority: string;
    category: string;
    assignee: (typeof STAFF)[number]['user'] | null;
    dueMin?: number | null;
    createdMin: number;
    resolvedMin?: number;
    resolution?: string;
    createdBy?: { id: string | null; name: string; via: 'customer' | 'staff' };
    events: Ev[];
    time?: {
      staff: (typeof STAFF)[number]['user'];
      minutes: number;
      kind: string;
      source: string;
      description: string;
      min: number;
      billable?: boolean;
    }[];
    followers?: string[];
  }) => {
    const res = await owner.query<{ id: string; number: number }>(
      `insert into platform.cases (tenant_id, title, status, priority, category, assignee_id, assignee_name, due_at, created_by_user_id, created_by_name, created_via, resolution, created_at, updated_at, resolved_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id, number`,
      [
        o.tenant,
        o.title,
        o.status,
        o.priority,
        o.category,
        o.assignee?.id ?? null,
        o.assignee?.name ?? null,
        o.dueMin === undefined || o.dueMin === null
          ? null
          : new Date(Date.now() + o.dueMin * 60_000),
        o.createdBy?.id ?? null,
        o.createdBy?.name ?? 'Agentor support',
        o.createdBy?.via ?? 'customer',
        o.resolution ?? null,
        minutesAgo(o.createdMin),
        minutesAgo(
          Math.min(o.createdMin, ...o.events.map((e) => e.min), o.resolvedMin ?? Infinity),
        ),
        o.resolvedMin === undefined ? null : minutesAgo(o.resolvedMin),
      ],
    );
    const c = res.rows[0]!;
    for (const e of o.events)
      await owner.query(
        `insert into platform.case_events (case_id, tenant_id, kind, author_user_id, author_name, body, meta, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          c.id,
          o.tenant,
          e.kind,
          e.userId ?? null,
          e.author,
          e.body,
          e.meta ?? {},
          minutesAgo(e.min),
        ],
      );
    for (const t of o.time ?? [])
      await owner.query(
        `insert into platform.time_entries (staff_user_id, staff_name, case_id, tenant_id, work_date, minutes, kind, source, description, billable, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          t.staff.id,
          t.staff.name,
          c.id,
          o.tenant,
          today(),
          t.minutes,
          t.kind,
          t.source,
          t.description,
          t.billable ?? true,
          minutesAgo(t.min),
        ],
      );
    // Set the final status after the events: a customer message reopens a case (trigger).
    await owner.query(
      `update platform.cases set status = $2, updated_at = $3, resolved_at = $4 where id = $1`,
      [
        c.id,
        o.status,
        minutesAgo(
          Math.min(o.createdMin, ...o.events.map((e) => e.min), o.resolvedMin ?? Infinity),
        ),
        o.resolvedMin === undefined ? null : minutesAgo(o.resolvedMin),
      ],
    );
    for (const f of o.followers ?? [])
      await owner.query(`insert into platform.case_followers (case_id, user_id) values ($1, $2)`, [
        c.id,
        f,
      ]);
    return c;
  };

  // Case numbers start at 2300 (#2291 on the boards is illustrative).
  const eu = await kase({
    tenant: n,
    title: 'Fakturaer til EU-kunder fejler',
    status: 'in_progress',
    priority: 'high',
    category: 'mapping',
    assignee: USERS.anne,
    dueMin: 220,
    createdMin: 200,
    createdBy: { id: USERS.mette.id, name: USERS.mette.name, via: 'customer' },
    followers: [USERS.line.id, USERS.kasper.id],
    events: [
      {
        kind: 'customer_message',
        author: USERS.mette.name,
        userId: USERS.mette.id,
        body: 'Fakturaer til EU-kunder fejler siden i morges. Kan I kigge på det? Det er tre ordrer indtil videre.',
        min: 200,
      },
      {
        kind: 'system',
        author: 'System',
        body: 'Sagen blev oprettet og knyttet til 3 fejl på Ordrer → Dinero Fakturaer.',
        min: 199,
      },
      {
        kind: 'access',
        author: USERS.anne.name,
        userId: USERS.anne.id,
        body: 'Fakturaer til EU-kunder fejler',
        min: 194,
        meta: { hours: 8, scope: 'help' },
      },
      {
        kind: 'session',
        author: USERS.anne.name,
        userId: USERS.anne.id,
        body: 'Så 3 fejlede records · åbnede mapping for Ordrer → Dinero Fakturaer · ingen ændringer gemt',
        min: 145,
        meta: { minutes: 42, actions: 7 },
      },
      {
        kind: 'internal_note',
        author: USERS.anne.name,
        userId: USERS.anne.id,
        body: 'Konto 1010 er slettet i Dinero. Kunden skal selv vælge 1015, fordi de har to EU-konti. Ring hvis hun ikke svarer, hun foretrækker telefon.',
        min: 182,
      },
      {
        kind: 'reply',
        author: USERS.anne.name,
        userId: USERS.anne.id,
        body: 'Hej Mette. Kontoen til EU-salg (1010) findes ikke længere i Dinero. Vælg 1015 Salg EU under Mapping › Konti og publicér. Så gentager vi de 3 ordrer bagefter.',
        min: 143,
      },
      {
        kind: 'internal_note',
        author: USERS.line.name,
        userId: USERS.line.id,
        body: 'Samme fejlkode ses hos Mølle Sport. Måske en ændring hos Dinero? Jeg holder øje med Fejl på tværs.',
        min: 132,
      },
    ],
    time: [
      {
        staff: USERS.anne,
        minutes: 42,
        kind: 'session',
        source: 'auto',
        description: 'Supportsession',
        min: 145,
      },
      // Agentor's own mistake: not billed (F5 info line).
      {
        staff: USERS.anne,
        minutes: 20,
        kind: 'other',
        source: 'manual',
        description: 'Fejl hos Agentor',
        billable: false,
        min: 140,
      },
      {
        staff: USERS.anne,
        minutes: 15,
        kind: 'phone',
        source: 'manual',
        description: 'Telefon med Mette',
        min: 137,
      },
      {
        staff: USERS.anne,
        minutes: 15,
        kind: 'clarification',
        source: 'manual',
        description: 'Afklaring med Line',
        min: 127,
      },
    ],
  });
  await kase({
    tenant: n,
    title: 'Kunder oprettes dobbelt i Dinero',
    status: 'in_progress',
    priority: 'normal',
    category: 'error',
    assignee: USERS.anne,
    dueMin: 60 * 20,
    createdMin: 60 * 26,
    createdBy: { id: USERS.jonas.id, name: USERS.jonas.name, via: 'customer' },
    events: [
      {
        kind: 'customer_message',
        author: USERS.jonas.name,
        userId: USERS.jonas.id,
        body: 'Vi får to kunder i Dinero for samme webshopkunde. Hvordan undgår vi det?',
        min: 60 * 26,
      },
    ],
    time: [
      {
        staff: USERS.anne,
        minutes: 35,
        kind: 'session',
        source: 'auto',
        description: 'Supportsession',
        min: 90,
      },
    ],
  });
  await kase({
    tenant: n,
    title: 'Kreditnotaer mangler faktura',
    status: 'resolved',
    priority: 'high',
    category: 'error',
    assignee: USERS.anne,
    createdMin: 60 * 24 * 5,
    resolvedMin: 60 * 24 * 4,
    resolution: 'Fakturaer gentaget først, derefter kreditnotaer',
    createdBy: { id: USERS.mette.id, name: USERS.mette.name, via: 'customer' },
    events: [
      {
        kind: 'customer_message',
        author: USERS.mette.name,
        userId: USERS.mette.id,
        body: 'To kreditnotaer kan ikke komme over i Dinero.',
        min: 60 * 24 * 5,
      },
      {
        kind: 'reply',
        author: USERS.anne.name,
        userId: USERS.anne.id,
        body: 'Den oprindelige faktura manglede. Vi har gentaget fakturaerne først og derefter kreditnotaerne.',
        min: 60 * 24 * 4,
      },
      {
        kind: 'status',
        author: USERS.anne.name,
        userId: USERS.anne.id,
        body: 'Løst',
        min: 60 * 24 * 4,
      },
    ],
  });
  await kase({
    tenant: n,
    title: 'Momskode ved salg til Norge',
    status: 'closed',
    priority: 'normal',
    category: 'mapping',
    assignee: USERS.anne,
    createdMin: 60 * 24 * 21,
    resolvedMin: 60 * 24 * 20,
    resolution: 'Konto for salg uden for EU sat til 1040',
    createdBy: { id: USERS.mette.id, name: USERS.mette.name, via: 'customer' },
    events: [
      {
        kind: 'customer_message',
        author: USERS.mette.name,
        userId: USERS.mette.id,
        body: 'Hvilken konto skal salg til Norge bogføres på?',
        min: 60 * 24 * 21,
      },
    ],
  });
  const molle = await kase({
    tenant: P.molle.id,
    title: '14 ordrer til e-conomic fejler med momskode',
    status: 'new',
    priority: 'critical',
    category: 'error',
    assignee: USERS.line,
    dueMin: -25,
    createdMin: 85,
    createdBy: { id: null, name: 'Peter Mølle', via: 'customer' },
    events: [
      {
        kind: 'customer_message',
        author: 'Peter Mølle',
        body: 'Alle ordrer til e-conomic fejler med en momskode siden i går eftermiddags.',
        min: 85,
      },
    ],
  });
  await kase({
    tenant: P.kvist.id,
    title: 'Flow pauset – hvordan genoptager vi?',
    status: 'new',
    priority: 'low',
    category: 'question',
    assignee: null,
    dueMin: 120,
    createdMin: 40,
    createdBy: { id: null, name: 'Karin Kvist', via: 'customer' },
    events: [
      {
        kind: 'customer_message',
        author: 'Karin Kvist',
        body: 'Vi har sat et flow på pause under lageroptælling. Hvordan starter vi det igen?',
        min: 40,
      },
    ],
  });
  await kase({
    tenant: P.osterbro.id,
    title: 'Spørgsmål til faktura for oktober',
    status: 'new',
    priority: 'normal',
    category: 'subscription',
    assignee: null,
    dueMin: 90,
    createdMin: 30,
    createdBy: { id: null, name: 'Ole Østerby', via: 'customer' },
    events: [
      {
        kind: 'customer_message',
        author: 'Ole Østerby',
        body: 'Hvorfor er der to linjer på oktober-fakturaen?',
        min: 30,
      },
    ],
  });
  await kase({
    tenant: P.bjerg.id,
    title: 'Hjælp til fan-out til HubSpot',
    status: 'in_progress',
    priority: 'normal',
    category: 'setup',
    assignee: USERS.mads,
    dueMin: 60 * 22,
    createdMin: 60 * 6,
    createdBy: { id: null, name: 'Bente Bjerg', via: 'customer' },
    events: [
      {
        kind: 'customer_message',
        author: 'Bente Bjerg',
        body: 'Kan vi sende kunder til både Dinero og HubSpot fra samme webshop?',
        min: 60 * 6,
      },
    ],
    time: [
      {
        staff: USERS.mads,
        minutes: 125,
        kind: 'other',
        source: 'manual',
        description: 'Opsætning sammen med kunden',
        min: 60 * 4,
      },
    ],
  });
  const hav = await kase({
    tenant: P.hav.id,
    title: 'Shopify-forbindelse afbrudt',
    status: 'waiting',
    priority: 'high',
    category: 'connection',
    assignee: USERS.anne,
    createdMin: 60 * 20,
    createdBy: { id: null, name: 'Hanne Hav', via: 'customer' },
    events: [
      {
        kind: 'customer_message',
        author: 'Hanne Hav',
        body: 'Shopify er afbrudt, og vi kan ikke se hvorfor.',
        min: 60 * 20,
      },
      {
        kind: 'reply',
        author: USERS.anne.name,
        userId: USERS.anne.id,
        body: 'Vi har bedt om adgang for at se forbindelsen. Godkend gerne i appen under Sikkerhed.',
        min: 60 * 19,
      },
    ],
    time: [
      {
        staff: USERS.anne,
        minutes: 10,
        kind: 'email',
        source: 'manual',
        description: 'Mail til kunden',
        min: 60 * 19,
      },
    ],
  });
  await kase({
    tenant: P.fjord.id,
    title: 'Dubletter i Brevo-listen',
    status: 'waiting',
    priority: 'normal',
    category: 'error',
    assignee: USERS.line,
    createdMin: 60 * 24 * 2,
    createdBy: { id: null, name: 'Frida Fjord', via: 'customer' },
    events: [
      {
        kind: 'customer_message',
        author: 'Frida Fjord',
        body: 'Kunderne står to gange i vores nyhedsbrevsliste.',
        min: 60 * 24 * 2,
      },
      {
        kind: 'reply',
        author: USERS.line.name,
        userId: USERS.line.id,
        body: 'Kan I sende et eksempel på en kunde, der står to gange?',
        min: 60 * 24 * 2 - 30,
      },
    ],
  });
  await kase({
    tenant: P.lyngby.id,
    title: 'Opsætning af Dinero-konti',
    status: 'resolved',
    priority: 'normal',
    category: 'setup',
    assignee: USERS.line,
    createdMin: 60 * 24 * 2,
    resolvedMin: 120,
    resolution: 'Konti udfyldt sammen med kunden · flow gået Live',
    createdBy: { id: null, name: 'Lars Lyngby', via: 'customer' },
    events: [
      {
        kind: 'customer_message',
        author: 'Lars Lyngby',
        body: 'Hjælp til at vælge konti i Dinero.',
        min: 60 * 24 * 2,
      },
    ],
    time: [
      {
        staff: USERS.line,
        minutes: 55,
        kind: 'phone',
        source: 'manual',
        description: 'Gennemgang i telefonen',
        min: 140,
      },
    ],
  });

  await grant(n, USERS.anne, {
    caseId: eu.id,
    caseRef: `#${eu.number}`,
    reason: 'Fakturaer til EU-kunder fejler',
    hours: 24,
    scope: 'help',
    approvedBy: USERS.jonas.id,
    requestedMin: 200,
    approvedMin: 194,
  });
  await grant(P.molle.id, USERS.anne, {
    caseId: molle.id,
    caseRef: `#${molle.number}`,
    reason: 'Vi vil se, hvorfor ordrerne til e-conomic fejler med momskode.',
    hours: 8,
    scope: 'help',
    requestedMin: 20,
  });
  await grant(P.hav.id, USERS.anne, {
    caseId: hav.id,
    caseRef: `#${hav.number}`,
    reason: 'Vi vil gerne se, hvorfor forbindelsen til Shopify blev afbrudt i går.',
    hours: 8,
    scope: 'view',
    requestedMin: 60 * 19,
  });

  await owner.query(
    `insert into platform.customer_notes (tenant_id, body, pinned, author_user_id, author_name) values ($1, $2, true, $3, $4)`,
    [
      n,
      'Mette foretrækker telefon. Revisor Bo Dahl har læseadgang og må gerne kontaktes om konti.',
      USERS.anne.id,
      USERS.anne.name,
    ],
  );
  // Time without a case (S6).
  await owner.query(
    `insert into platform.time_entries (staff_user_id, staff_name, work_date, minutes, kind, source, description) values ($1, $2, $3, 45, 'meeting', 'manual', 'Teammøde og vidensdeling')`,
    [USERS.anne.id, USERS.anne.name, today()],
  );
  void FLOWS;
}
