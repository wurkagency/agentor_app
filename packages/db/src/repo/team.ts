import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, inArray, isNull, gt, sql } from 'drizzle-orm';
import { withoutTenant, withTenant, type Database } from '../client.js';
import {
  authSessions,
  authUsers,
  flowGrants,
  flows,
  invitations,
  memberships,
  type MembershipRole,
} from '../schema/index.js';
import { seatUsageTx } from './billing.js';
import { writeAudit, type Actor } from './audit.js';

export class TeamError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'LAST_OWNER'
      | 'OWNER_ONLY'
      | 'ALREADY_MEMBER'
      | 'ALREADY_INVITED'
      | 'INVALID_FLOWS'
      | 'SEATS'
      | 'SELF',
  ) {
    super(code);
    this.name = 'TeamError';
  }
}

export interface MemberRow {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: MembershipRole;
  flowScope: 'all' | 'selected';
  isExternal: boolean;
  twoFactorEnabled: boolean;
  lastActiveAt: Date | null;
  grants: { flowId: string; flowName: string; expiresAt: Date | null }[];
}

/** Team list (D11-Team): members with their access and MFA state. */
export async function listMembers(
  db: Database,
  ctx: { tenantId: string; userId: string },
): Promise<MemberRow[]> {
  return withTenant(db, ctx, async (tx) => {
    const rows = await tx
      .select({
        membershipId: memberships.id,
        userId: memberships.userId,
        role: memberships.role,
        flowScope: memberships.flowScope,
        isExternal: memberships.isExternal,
        name: authUsers.name,
        email: authUsers.email,
        twoFactorEnabled: authUsers.twoFactorEnabled,
        lastActiveAt: sql<Date | null>`(select max(s.updated_at) from auth.sessions s where s.user_id = ${memberships.userId})`,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(authUsers, eq(authUsers.id, memberships.userId))
      .orderBy(
        sql`case ${memberships.role} when 'owner' then 0 when 'admin' then 1 when 'developer' then 2 else 3 end`,
        asc(authUsers.name),
      );
    const grants = await tx
      .select({
        membershipId: flowGrants.membershipId,
        flowId: flowGrants.flowId,
        flowName: flows.name,
        expiresAt: flowGrants.expiresAt,
      })
      .from(flowGrants)
      .innerJoin(
        flows,
        and(eq(flows.tenantId, flowGrants.tenantId), eq(flows.id, flowGrants.flowId)),
      );
    return rows.map((r) => ({
      membershipId: r.membershipId,
      userId: r.userId,
      name: r.name,
      email: r.email,
      role: r.role,
      flowScope: r.flowScope,
      isExternal: r.isExternal,
      twoFactorEnabled: r.twoFactorEnabled,
      lastActiveAt: r.lastActiveAt ? new Date(r.lastActiveAt) : null,
      grants: grants
        .filter((g) => g.membershipId === r.membershipId)
        .map((g) => ({ flowId: g.flowId, flowName: g.flowName, expiresAt: g.expiresAt })),
    }));
  });
}

export async function listOpenInvitations(db: Database, ctx: { tenantId: string; userId: string }) {
  return withTenant(db, ctx, (tx) =>
    tx
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        flowScope: invitations.flowScope,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .where(
        and(
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(invitations.createdAt)),
  );
}

export async function listFlowOptions(db: Database, ctx: { tenantId: string; userId: string }) {
  return withTenant(db, ctx, (tx) =>
    tx.select({ id: flows.id, name: flows.name }).from(flows).orderBy(asc(flows.name)),
  );
}

export interface InviteInput {
  email: string;
  role: Exclude<MembershipRole, 'owner'>;
  flowScope: 'all' | 'selected';
  flowIds: string[];
  accessExpiresAt: Date | null;
  isExternal: boolean;
}

export const INVITE_TTL_DAYS = 7;

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/** Creates an invitation and returns the raw token for the e-mail link (only its hash is stored). */
export async function createInvitation(
  db: Database,
  actor: Actor,
  input: InviteInput,
): Promise<{ token: string; id: string }> {
  const email = input.email.trim().toLowerCase();
  const token = randomBytes(32).toString('base64url');
  return withTenant(db, actor, async (tx) => {
    const existing = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(authUsers, eq(authUsers.id, memberships.userId))
      .where(eq(authUsers.email, email))
      .limit(1);
    if (existing.length) throw new TeamError('ALREADY_MEMBER');
    const open = await tx
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          eq(invitations.email, email),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (open.length) throw new TeamError('ALREADY_INVITED');
    const seats = await seatUsageTx(tx);
    if (seats.limit !== null && seats.used >= seats.limit) throw new TeamError('SEATS');
    const flowIds = input.flowScope === 'selected' ? [...new Set(input.flowIds)] : [];
    if (input.flowScope === 'selected') {
      if (flowIds.length === 0) throw new TeamError('INVALID_FLOWS');
      const found = await tx.select({ id: flows.id }).from(flows).where(inArray(flows.id, flowIds));
      if (found.length !== flowIds.length) throw new TeamError('INVALID_FLOWS');
    }
    const [row] = await tx
      .insert(invitations)
      .values({
        tenantId: actor.tenantId,
        email,
        role: input.role,
        flowScope: input.flowScope,
        flowIds,
        accessExpiresAt: input.flowScope === 'selected' ? input.accessExpiresAt : null,
        isExternal: input.isExternal,
        tokenHash: hashInviteToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000),
        invitedBy: actor.userId,
      })
      .returning({ id: invitations.id });
    await writeAudit(tx, actor, {
      action: 'member.invited',
      objectType: 'invitation',
      objectId: row!.id,
      after: {
        email,
        role: input.role,
        flowScope: input.flowScope,
        flows: flowIds.length,
        accessExpiresAt: input.accessExpiresAt,
      },
    });
    return { token, id: row!.id };
  });
}

export async function revokeInvitation(
  db: Database,
  actor: Actor,
  invitationId: string,
): Promise<void> {
  await withTenant(db, actor, async (tx) => {
    const res = await tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invitations.id, invitationId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .returning({ email: invitations.email });
    if (!res.length) throw new TeamError('NOT_FOUND');
    await writeAudit(tx, actor, {
      action: 'invitation.revoked',
      objectType: 'invitation',
      objectId: invitationId,
      before: { email: res[0]!.email },
    });
  });
}

async function loadMember(tx: Tx, membershipId: string) {
  const [m] = await tx
    .select({
      id: memberships.id,
      userId: memberships.userId,
      role: memberships.role,
      flowScope: memberships.flowScope,
    })
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .limit(1);
  if (!m) throw new TeamError('NOT_FOUND');
  return m;
}

async function ownerCount(tx: Tx) {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(eq(memberships.role, 'owner'));
  return r?.n ?? 0;
}

/**
 * Changes a member's role. Owners are managed only by owners; the last owner can't be demoted.
 * The member's sessions are revoked so the new role applies at once (§9.5: rotation on role change).
 */
type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];

export async function changeRole(
  db: Database,
  actor: Actor & { role: MembershipRole },
  membershipId: string,
  role: MembershipRole,
): Promise<void> {
  await withTenant(db, actor, (tx) => changeRoleTx(tx, actor, membershipId, role));
}

async function changeRoleTx(
  tx: Tx,
  actor: Actor & { role: MembershipRole },
  membershipId: string,
  role: MembershipRole,
) {
  {
    const m = await loadMember(tx, membershipId);
    if (m.role === role) return;
    if ((m.role === 'owner' || role === 'owner') && actor.role !== 'owner')
      throw new TeamError('OWNER_ONLY');
    if (m.role === 'owner' && (await ownerCount(tx)) <= 1) throw new TeamError('LAST_OWNER');
    // Owners and admins always see every flow.
    const flowScope = role === 'owner' || role === 'admin' ? 'all' : m.flowScope;
    await tx.update(memberships).set({ role, flowScope }).where(eq(memberships.id, membershipId));
    if (flowScope === 'all')
      await tx.delete(flowGrants).where(eq(flowGrants.membershipId, membershipId));
    await writeAudit(tx, actor, {
      action: 'member.role_changed',
      objectType: 'membership',
      objectId: membershipId,
      before: { role: m.role },
      after: { role },
    });
    await tx.delete(authSessions).where(eq(authSessions.userId, m.userId));
  }
}

export async function removeMember(
  db: Database,
  actor: Actor & { role: MembershipRole },
  membershipId: string,
): Promise<void> {
  await withTenant(db, actor, async (tx) => {
    const m = await loadMember(tx, membershipId);
    if (m.userId === actor.userId) throw new TeamError('SELF');
    if (m.role === 'owner' && actor.role !== 'owner') throw new TeamError('OWNER_ONLY');
    if (m.role === 'owner' && (await ownerCount(tx)) <= 1) throw new TeamError('LAST_OWNER');
    await tx.delete(memberships).where(eq(memberships.id, membershipId));
    await writeAudit(tx, actor, {
      action: 'member.removed',
      objectType: 'membership',
      objectId: membershipId,
      before: { role: m.role },
    });
    // Sessions that had this tenant active lose it on the next request (re-validated); no wider logout.
    await tx
      .update(authSessions)
      .set({ activeTenantId: null })
      .where(
        and(eq(authSessions.userId, m.userId), eq(authSessions.activeTenantId, actor.tenantId)),
      );
  });
}

/** Per-flow access for developers and readers (produktspecifikation §6). */
export interface AccessInput {
  flowScope: 'all' | 'selected';
  flowIds: string[];
  expiresAt: Date | null;
  isExternal: boolean;
}

export async function setMemberAccess(
  db: Database,
  actor: Actor,
  membershipId: string,
  input: AccessInput,
): Promise<void> {
  await withTenant(db, actor, (tx) => setAccessTx(tx, actor, membershipId, input));
}

/** Role and access in one transaction (team edit dialog): both apply, or neither. */
export async function updateMember(
  db: Database,
  actor: Actor & { role: MembershipRole },
  membershipId: string,
  role: MembershipRole,
  access: AccessInput,
): Promise<void> {
  await withTenant(db, actor, async (tx) => {
    await changeRoleTx(tx, actor, membershipId, role);
    const scoped = role === 'developer' || role === 'reader';
    await setAccessTx(
      tx,
      actor,
      membershipId,
      scoped ? access : { ...access, flowScope: 'all', flowIds: [], expiresAt: null },
    );
  });
}

async function setAccessTx(tx: Tx, actor: Actor, membershipId: string, input: AccessInput) {
  {
    const m = await loadMember(tx, membershipId);
    if (input.flowScope === 'selected' && (m.role === 'owner' || m.role === 'admin'))
      throw new TeamError('INVALID_FLOWS');
    const flowIds = [...new Set(input.flowIds)];
    if (input.flowScope === 'selected') {
      if (!flowIds.length) throw new TeamError('INVALID_FLOWS');
      const found = await tx.select({ id: flows.id }).from(flows).where(inArray(flows.id, flowIds));
      if (found.length !== flowIds.length) throw new TeamError('INVALID_FLOWS');
    }
    await tx
      .update(memberships)
      .set({ flowScope: input.flowScope, isExternal: input.isExternal })
      .where(eq(memberships.id, membershipId));
    await tx.delete(flowGrants).where(eq(flowGrants.membershipId, membershipId));
    if (input.flowScope === 'selected') {
      await tx.insert(flowGrants).values(
        flowIds.map((flowId) => ({
          tenantId: actor.tenantId,
          membershipId,
          flowId,
          expiresAt: input.expiresAt,
        })),
      );
    }
    await writeAudit(tx, actor, {
      action: 'member.access_changed',
      objectType: 'membership',
      objectId: membershipId,
      before: { flowScope: m.flowScope },
      after: {
        flowScope: input.flowScope,
        flows: flowIds.length,
        expiresAt: input.expiresAt,
        isExternal: input.isExternal,
      },
    });
  }
}

/** Accepts an invitation for the signed-in user; returns the tenant joined. */
export async function acceptInvitation(
  db: Database,
  userId: string,
  token: string,
): Promise<string> {
  return withoutTenant(
    db,
    async (tx) => {
      const r = await tx.execute<{ t: string }>(
        sql`select app.accept_invitation(${hashInviteToken(token)}) as t`,
      );
      return r.rows[0]!.t;
    },
    userId,
  );
}

export async function previewInvitation(db: Database, token: string) {
  return withoutTenant(db, async (tx) => {
    const r = await tx.execute<{ tenant_name: string; email: string; role: string; state: string }>(
      sql`select * from app.invitation_preview(${hashInviteToken(token)})`,
    );
    return r.rows[0] ?? null;
  });
}
