'use server';

import {
  createInvitation,
  listFlowOptions,
  removeMember,
  revokeInvitation,
  TeamError,
  updateMember as updateMemberRepo,
} from '@agentor/db';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { actorFor, type ActionResult } from '@/server/actor';
import { requireRole } from '@/server/auth/session';
import { db } from '@/server/infra';
import { appLink, sendEmail } from '@/server/mail';

const ADMIN = ['owner', 'admin'] as const;

const flowAccess = z
  .object({
    flowScope: z.enum(['all', 'selected']),
    flowIds: z.array(z.uuid()).max(500).default([]),
    accessExpiresAt: z.iso.date().nullable().default(null),
    isExternal: z.boolean().default(false),
  })
  .refine((v) => v.flowScope === 'all' || v.flowIds.length > 0, { message: 'INVALID_FLOWS' });

const inviteSchema = z
  .object({
    email: z.email().max(254),
    role: z.enum(['admin', 'developer', 'reader']),
  })
  .and(flowAccess)
  .refine((v) => v.flowScope === 'all' || v.role !== 'admin', { message: 'INVALID_FLOWS' });

/** End of the chosen day in Copenhagen, so "udløber 12. nov." includes 12 November. */
function endOfDay(isoDate: string | null): Date | null {
  return isoDate ? new Date(`${isoDate}T23:59:59+01:00`) : null;
}

function fail(e: unknown): ActionResult {
  if (e instanceof TeamError) return { ok: false, error: e.code };
  console.error('team action failed', e instanceof Error ? e.message : e);
  return { ok: false, error: 'generic' };
}

export async function inviteMember(input: unknown): Promise<ActionResult> {
  const ctx = await requireRole(ADMIN);
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.some((i) => i.message === 'INVALID_FLOWS')
        ? 'INVALID_FLOWS'
        : 'INVALID',
    };
  }
  const v = parsed.data;
  try {
    const actor = await actorFor(ctx);
    const { token } = await createInvitation(db(), actor, {
      email: v.email,
      role: v.role,
      flowScope: v.flowScope,
      flowIds: v.flowIds,
      accessExpiresAt: endOfDay(v.accessExpiresAt),
      isExternal: v.isExternal,
    });
    // E09. Access and expiry rows only when they are set.
    const [roles, team] = await Promise.all([
      getTranslations({ locale: 'da', namespace: 'profile.roles' }),
      getTranslations({ locale: 'da', namespace: 'team' }),
    ]);
    const hint = {
      admin: 'roleAdminShort',
      developer: 'roleDeveloperShort',
      reader: 'roleReaderShort',
    } as const;
    let access: string | null = null;
    if (v.flowScope === 'selected') {
      const names = (
        await listFlowOptions(db(), { tenantId: ctx.tenant.tenantId, userId: ctx.user.id })
      )
        .filter((f) => v.flowIds.includes(f.id))
        .map((f) => f.name);
      access = team('someFlows', { count: names.length, names: names.join(', ') });
    }
    await sendEmail(
      'team-invite',
      {
        inviter: ctx.user.name,
        company: ctx.tenant.tenantName,
        role: roles(v.role),
        roleDetail: team(hint[v.role]).toLowerCase(),
        access,
        accessExpiresAt: endOfDay(v.accessExpiresAt),
        url: appLink(`/invite/${token}`),
        email: v.email.toLowerCase(),
      },
      { to: v.email.toLowerCase() },
    );
    revalidatePath('/settings/team');
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function withdrawInvitation(invitationId: string): Promise<ActionResult> {
  const ctx = await requireRole(ADMIN);
  if (!z.uuid().safeParse(invitationId).success) return { ok: false, error: 'NOT_FOUND' };
  try {
    await revokeInvitation(db(), await actorFor(ctx), invitationId);
    revalidatePath('/settings/team');
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const updateSchema = z
  .object({
    membershipId: z.uuid(),
    role: z.enum(['owner', 'admin', 'developer', 'reader']),
  })
  .and(flowAccess);

export async function updateMember(input: unknown): Promise<ActionResult> {
  const ctx = await requireRole(ADMIN);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' };
  const v = parsed.data;
  try {
    await updateMemberRepo(db(), await actorFor(ctx), v.membershipId, v.role, {
      flowScope: v.flowScope,
      flowIds: v.flowIds,
      expiresAt: endOfDay(v.accessExpiresAt),
      isExternal: v.isExternal,
    });
    revalidatePath('/settings/team');
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removeTeamMember(membershipId: string): Promise<ActionResult> {
  const ctx = await requireRole(ADMIN);
  if (!z.uuid().safeParse(membershipId).success) return { ok: false, error: 'NOT_FOUND' };
  try {
    await removeMember(db(), await actorFor(ctx), membershipId);
    revalidatePath('/settings/team');
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
