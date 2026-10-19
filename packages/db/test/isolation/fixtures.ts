import type pg from 'pg';

/** Fixed ids so failures are easy to read. All are valid UUID v7 strings. */
export const ID = {
  tenantA: '0190a000-0000-7000-8000-00000000000a',
  tenantB: '0190a000-0000-7000-8000-00000000000b',
  userAOwner: '0190a000-0000-7000-8000-0000000a0001',
  userADevRestricted: '0190a000-0000-7000-8000-0000000a0002',
  userAReader: '0190a000-0000-7000-8000-0000000a0003',
  userBOwner: '0190a000-0000-7000-8000-0000000b0001',
  /** Member of both tenants, like an agency (D9). */
  userShared: '0190a000-0000-7000-8000-0000000ab001',
  /** Has an account but no membership yet; invited to tenant A. */
  userInviteeA: '0190a000-0000-7000-8000-0000000ac001',
  memAOwner: '0190a000-0000-7000-8000-0000000a1001',
  memADevRestricted: '0190a000-0000-7000-8000-0000000a1002',
  memAReader: '0190a000-0000-7000-8000-0000000a1003',
  memAShared: '0190a000-0000-7000-8000-0000000a1004',
  memBOwner: '0190a000-0000-7000-8000-0000000b1001',
  memBShared: '0190a000-0000-7000-8000-0000000b1002',
  flowA1: '0190a000-0000-7000-8000-0000000a2001',
  flowA2: '0190a000-0000-7000-8000-0000000a2002',
  flowB1: '0190a000-0000-7000-8000-0000000b2001',
  grantA1: '0190a000-0000-7000-8000-0000000a3001',
  grantA2Expired: '0190a000-0000-7000-8000-0000000a3002',
  grantB1: '0190a000-0000-7000-8000-0000000b3001',
  connA: '0190a000-0000-7000-8000-0000000a4001',
  connB: '0190a000-0000-7000-8000-0000000b4001',
  eventA: '0190a000-0000-7000-8000-0000000a4101',
  eventB: '0190a000-0000-7000-8000-0000000b4101',
  keyA: '0190a000-0000-7000-8000-0000000a5001',
  keyB: '0190a000-0000-7000-8000-0000000b5001',
  secretA: '0190a000-0000-7000-8000-0000000a6001',
  secretB: '0190a000-0000-7000-8000-0000000b6001',
  auditA: '0190a000-0000-7000-8000-0000000a7001',
  auditB: '0190a000-0000-7000-8000-0000000b7001',
  versionA1: '0190a000-0000-7000-8000-0000000a2101',
  versionA2: '0190a000-0000-7000-8000-0000000a2102',
  versionB1: '0190a000-0000-7000-8000-0000000b2101',
  draftA1: '0190a000-0000-7000-8000-0000000a2103',
  draftB1: '0190a000-0000-7000-8000-0000000b2103',
  runA1: '0190a000-0000-7000-8000-0000000a2201',
  runA2: '0190a000-0000-7000-8000-0000000a2202',
  runB1: '0190a000-0000-7000-8000-0000000b2201',
  recordA1: '0190a000-0000-7000-8000-0000000a2301',
  recordA2: '0190a000-0000-7000-8000-0000000a2302',
  recordB1: '0190a000-0000-7000-8000-0000000b2301',
  linkA1: '0190a000-0000-7000-8000-0000000a2401',
  linkB1: '0190a000-0000-7000-8000-0000000b2401',
  lookupA: '0190a000-0000-7000-8000-0000000a4201',
  lookupB: '0190a000-0000-7000-8000-0000000b4201',
  noteA: '0190a000-0000-7000-8000-0000000a7101',
  noteB: '0190a000-0000-7000-8000-0000000b7101',
  inviteA: '0190a000-0000-7000-8000-0000000a8001',
  inviteB: '0190a000-0000-7000-8000-0000000b8001',
  grantSupportA: '0190a000-0000-7000-8000-0000000a9001',
  grantSupportB: '0190a000-0000-7000-8000-0000000b9001',
} as const;

/** Seeds two tenants with at least one row in every tenant table. Runs as superuser. */
export async function seedFixtures(admin: pg.ClientBase): Promise<void> {
  const q = (text: string, values: unknown[] = []) => admin.query(text, values);
  await q('begin');
  await q(`insert into tenants (id, name) values ($1, 'Tenant A'), ($2, 'Tenant B')`, [
    ID.tenantA,
    ID.tenantB,
  ]);
  await q(
    `insert into auth.users (id, email, name) values
       ($1, 'owner-a@example.test', 'Owner A'),
       ($2, 'dev-a@example.test', 'Restricted Dev A'),
       ($3, 'reader-a@example.test', 'Reader A'),
       ($4, 'owner-b@example.test', 'Owner B'),
       ($5, 'shared@example.test', 'Shared Agency'),
       ($6, 'invitee-a@example.test', 'Invitee A')`,
    [
      ID.userAOwner,
      ID.userADevRestricted,
      ID.userAReader,
      ID.userBOwner,
      ID.userShared,
      ID.userInviteeA,
    ],
  );
  await q(
    `insert into memberships (tenant_id, id, user_id, role, flow_scope) values
       ($1, $3, $5, 'owner', 'all'),
       ($1, $4, $6, 'developer', 'selected'),
       ($1, $7, $8, 'reader', 'all'),
       ($1, $9, $10, 'developer', 'all'),
       ($2, $11, $12, 'owner', 'all'),
       ($2, $13, $10, 'admin', 'all')`,
    [
      ID.tenantA,
      ID.tenantB,
      ID.memAOwner,
      ID.memADevRestricted,
      ID.userAOwner,
      ID.userADevRestricted,
      ID.memAReader,
      ID.userAReader,
      ID.memAShared,
      ID.userShared,
      ID.memBOwner,
      ID.userBOwner,
      ID.memBShared,
    ],
  );
  await q(
    `insert into flows (tenant_id, id, name) values
       ($1, $3, 'Flow A1'), ($1, $4, 'Flow A2'), ($2, $5, 'Flow B1')`,
    [ID.tenantA, ID.tenantB, ID.flowA1, ID.flowA2, ID.flowB1],
  );
  await q(
    `insert into flow_grants (tenant_id, id, membership_id, flow_id, expires_at, created_at) values
       ($1, $3, $4, $5, null, now()),
       ($1, $6, $4, $7, '2020-02-01', '2020-01-01'),
       ($2, $8, $9, $10, null, now())`,
    [
      ID.tenantA,
      ID.tenantB,
      ID.grantA1,
      ID.memADevRestricted,
      ID.flowA1,
      ID.grantA2Expired,
      ID.flowA2,
      ID.grantB1,
      ID.memBShared,
      ID.flowB1,
    ],
  );
  await q(
    `insert into connections (tenant_id, id, connector_id, name) values
       ($1, $3, 'mock', 'Conn A'), ($2, $4, 'mock', 'Conn B')`,
    [ID.tenantA, ID.tenantB, ID.connA, ID.connB],
  );
  await q(
    `insert into inbound_events (tenant_id, id, connection_id, headers, body) values
       ($1, $3, $5, '{}', '\\x7b7d'), ($2, $4, $6, '{}', '\\x7b7d')`,
    [ID.tenantA, ID.tenantB, ID.eventA, ID.eventB, ID.connA, ID.connB],
  );
  await q(
    `insert into app.webhook_routes (token_hash, tenant_id, connection_id) values
       ($1, $3, $5), ($2, $4, $6)`,
    ['A'.repeat(43), 'B'.repeat(43), ID.tenantA, ID.tenantB, ID.connA, ID.connB],
  );
  await q(
    `insert into tenant_keys (tenant_id, id, kek_id, wrapped_dek) values
       ($1, $3, 'test-kek', '\\x01'), ($2, $4, 'test-kek', '\\x02')`,
    [ID.tenantA, ID.tenantB, ID.keyA, ID.keyB],
  );
  await q(
    `insert into connection_secrets (tenant_id, id, connection_id, format, key_id, nonce, ciphertext) values
       ($1, $3, $5, 'test', $7, '\\x00', '\\xaa'),
       ($2, $4, $6, 'test', $8, '\\x00', '\\xbb')`,
    [ID.tenantA, ID.tenantB, ID.secretA, ID.secretB, ID.connA, ID.connB, ID.keyA, ID.keyB],
  );
  await q(
    `insert into audit_log (tenant_id, id, actor_kind, action, object_type) values
       ($1, $3, 'system', 'test.seed', 'tenant'), ($2, $4, 'system', 'test.seed', 'tenant')`,
    [ID.tenantA, ID.tenantB, ID.auditA, ID.auditB],
  );
  await q(
    `insert into invitations (tenant_id, id, email, role, token_hash, expires_at, invited_by) values
       ($1, $3, 'invitee-a@example.test', 'reader', 'hash-a', now() + interval '7 days', $5),
       ($2, $4, 'invitee-b@example.test', 'reader', 'hash-b', now() + interval '7 days', $6)`,
    [ID.tenantA, ID.tenantB, ID.inviteA, ID.inviteB, ID.userAOwner, ID.userBOwner],
  );
  await q(
    `insert into notification_prefs (tenant_id, user_id, event, email) values
       ($1, $3, 'connection_broken', true), ($2, $4, 'connection_broken', true)`,
    [ID.tenantA, ID.tenantB, ID.userAOwner, ID.userBOwner],
  );
  await q(`insert into notification_settings (tenant_id, user_id) values ($1, $3), ($2, $4)`, [
    ID.tenantA,
    ID.tenantB,
    ID.userAOwner,
    ID.userBOwner,
  ]);
  await q(
    `insert into support_access_grants (tenant_id, id, case_ref, reason, support_name, expires_at) values
       ($1, $3, '#1', 'test', 'Support A', now() + interval '1 hour'),
       ($2, $4, '#2', 'test', 'Support B', now() + interval '1 hour')`,
    [ID.tenantA, ID.tenantB, ID.grantSupportA, ID.grantSupportB],
  );
  await q(
    `insert into subscriptions (tenant_id, plan_id, status, current_period_end) values
       ($1, 'business', 'active', now() - interval '1 day'), ($2, 'startup', 'active', now() + interval '20 days')`,
    [ID.tenantA, ID.tenantB],
  );
  await q(
    `insert into usage_counters (tenant_id, period, transactions) values ($1, '2026-10', 712), ($2, '2026-10', 10)`,
    [ID.tenantA, ID.tenantB],
  );
  await q(
    `insert into addons (tenant_id, kind, quantity, period, price_ore) values
       ($1, 'transactions', 1000, '2026-10', 10000), ($2, 'transactions', 1000, '2026-10', 10000)`,
    [ID.tenantA, ID.tenantB],
  );
  await q(
    `insert into invoices (tenant_id, number, period_start, period_end, description, amount_ore, vat_ore) values
       ($1, 'AG-TEST-A', '2026-10-01', '2026-11-01', 'Business · månedlig', 19875, 3975),
       ($2, 'AG-TEST-B', '2026-10-01', '2026-11-01', 'Startup · månedlig', 9875, 1975)`,
    [ID.tenantA, ID.tenantB],
  );
  // M6: flows, runs, records, links, lookups, notifications. Flow A2 is not granted to the
  // restricted developer, so its version, run and record must stay invisible to them.
  await q(
    `insert into flow_versions (tenant_id, id, flow_id, number, state, definition) values
       ($1, $3, $5, 1, 'published', '{}'), ($1, $4, $6, 1, 'published', '{}'), ($2, $7, $8, 1, 'published', '{}')`,
    [
      ID.tenantA,
      ID.tenantB,
      ID.versionA1,
      ID.versionA2,
      ID.flowA1,
      ID.flowA2,
      ID.versionB1,
      ID.flowB1,
    ],
  );
  await q(
    `insert into flow_versions (tenant_id, id, flow_id, state, definition) values
       ($1, $3, $5, 'draft', '{}'), ($2, $4, $6, 'draft', '{}')`,
    [ID.tenantA, ID.tenantB, ID.draftA1, ID.draftB1, ID.flowA1, ID.flowB1],
  );
  await q(
    `insert into runs (tenant_id, id, flow_id, version_id, kind, status) values
       ($1, $3, $5, $6, 'scheduled', 'ok'), ($1, $4, $7, $8, 'scheduled', 'ok'),
       ($2, $9, $10, $11, 'scheduled', 'ok')`,
    [
      ID.tenantA,
      ID.tenantB,
      ID.runA1,
      ID.runA2,
      ID.flowA1,
      ID.versionA1,
      ID.flowA2,
      ID.versionA2,
      ID.runB1,
      ID.flowB1,
      ID.versionB1,
    ],
  );
  await q(
    `insert into run_records (tenant_id, id, run_id, flow_id, route_id, entity, source_id, label, outcome, mode) values
       ($1, $3, $5, $6, 'r1', 'order', 'o-1', '#1', 'created', 'live'),
       ($1, $4, $7, $8, 'r1', 'order', 'o-2', '#2', 'failed', 'live'),
       ($2, $9, $10, $11, 'r1', 'order', 'o-3', '#3', 'created', 'live')`,
    [
      ID.tenantA,
      ID.tenantB,
      ID.recordA1,
      ID.recordA2,
      ID.runA1,
      ID.flowA1,
      ID.runA2,
      ID.flowA2,
      ID.recordB1,
      ID.runB1,
      ID.flowB1,
    ],
  );
  await q(
    `insert into record_links (tenant_id, id, flow_id, route_id, source_id, destination_id) values
       ($1, $3, $5, 'r1', 'o-1', 'd-1'), ($2, $4, $6, 'r1', 'o-3', 'd-3')`,
    [ID.tenantA, ID.tenantB, ID.linkA1, ID.linkB1, ID.flowA1, ID.flowB1],
  );
  await q(
    `insert into connection_lookups (tenant_id, id, connection_id, list, options) values
       ($1, $3, $5, 'accounts', '[]'), ($2, $4, $6, 'accounts', '[]')`,
    [ID.tenantA, ID.tenantB, ID.lookupA, ID.lookupB, ID.connA, ID.connB],
  );
  // Sync engine (M10): idempotency keys, cursors, payloads and Agentor's own writes.
  await q(
    `insert into sync_items (tenant_id, flow_id, connection_id, entity, source_id, source_version, run_id) values
       ($1, $3, $5, 'order', 'o-1', 'v1', $7), ($2, $4, $6, 'order', 'o-3', 'v1', $8)`,
    [ID.tenantA, ID.tenantB, ID.flowA1, ID.flowB1, ID.connA, ID.connB, ID.runA1, ID.runB1],
  );
  await q(
    `insert into sync_cursors (tenant_id, flow_id, connection_id, entity, cursor) values
       ($1, $3, $5, 'order', now()), ($2, $4, $6, 'order', now())`,
    [ID.tenantA, ID.tenantB, ID.flowA1, ID.flowB1, ID.connA, ID.connB],
  );
  await q(
    `insert into sync_payloads (tenant_id, run_id, entity, source_id, source_version, payload) values
       ($1, $3, 'order', 'o-1', 'v1', '{"sourceId":"o-1"}'), ($2, $4, 'order', 'o-3', 'v1', '{"sourceId":"o-3"}')`,
    [ID.tenantA, ID.tenantB, ID.runA1, ID.runB1],
  );
  await q(
    `insert into entity_links (tenant_id, connection_id, entity, source_connection_id, source_id, destination_id) values
       ($1, $3, 'customer', $3, 'c-1', 'd-1'), ($2, $4, 'customer', $4, 'c-3', 'd-3')`,
    [ID.tenantA, ID.tenantB, ID.connA, ID.connB],
  );
  await q(
    `insert into notifications (tenant_id, id, user_id, event, message_key) values
       ($1, $3, $5, 'systematic_error', 'test'), ($2, $4, $6, 'systematic_error', 'test')`,
    [ID.tenantA, ID.tenantB, ID.noteA, ID.noteB, ID.userAOwner, ID.userBOwner],
  );
  await q('commit');
}
