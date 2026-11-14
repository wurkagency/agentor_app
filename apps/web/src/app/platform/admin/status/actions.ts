'use server';

import { PlatformError, createIncident, updateIncident } from '@agentor/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/server/actor';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';

const schema = z
  .object({
    kind: z.enum(['incident', 'maintenance']),
    title: z.string().trim().min(1).max(200),
    impact: z.string().trim().max(300),
    status: z.enum(['planned', 'investigating', 'monitoring', 'resolved', 'completed']),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }).nullable(),
    notes: z.string().trim().max(2000),
  })
  .refine((d) => !d.endsAt || d.endsAt >= d.startsAt);

export type IncidentForm = z.input<typeof schema>;

/** "Opret hændelse", "Planlæg vedligehold" and "Opdatér hændelse" (A1, MP25). Superadmin only. */
export async function saveIncidentAction(
  input: IncidentForm,
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const { actor } = await requireStaff(true);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const d = parsed.data;
  const value = {
    ...d,
    startsAt: new Date(d.startsAt),
    endsAt: d.endsAt ? new Date(d.endsAt) : null,
  };
  try {
    if (id) {
      if (!z.uuid().safeParse(id).success) return { ok: false, error: 'invalid' };
      await updateIncident(db(), actor, id, value);
      revalidatePath('/platform/admin/status');
      return { ok: true, data: { id } };
    }
    const created = await createIncident(db(), actor, value);
    revalidatePath('/platform/admin/status');
    return { ok: true, data: { id: created } };
  } catch (e) {
    if (e instanceof PlatformError) return { ok: false, error: e.code };
    throw e;
  }
}
