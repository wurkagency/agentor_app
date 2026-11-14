'use server';

import { customerReply, isUuid, openCustomerCase, PlatformError } from '@agentor/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ActionResult } from '@/server/actor';
import { requireCustomerArea } from '@/server/auth/session';
import { db } from '@/server/infra';

const caseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  flowId: z.string().refine(isUuid).nullable(),
});

/** "Kontakt support": any member of the company can open a case; Agentor support sees it at once. */
export async function openCaseAction(input: z.input<typeof caseSchema>): Promise<ActionResult> {
  const ctx = await requireCustomerArea();
  const parsed = caseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  let id: string;
  try {
    const c = await openCustomerCase(
      db(),
      { tenantId: ctx.tenant.tenantId, userId: ctx.user.id, name: ctx.user.name },
      parsed.data,
    );
    id = c.id;
  } catch (e) {
    if (e instanceof PlatformError) return { ok: false, error: e.code };
    throw e;
  }
  revalidatePath('/support');
  redirect(`/support/${id}`);
}

export async function replyAction(caseId: string, body: string): Promise<ActionResult> {
  const ctx = await requireCustomerArea();
  if (!isUuid(caseId) || !body.trim()) return { ok: false, error: 'invalid' };
  try {
    await customerReply(
      db(),
      { tenantId: ctx.tenant.tenantId, userId: ctx.user.id, name: ctx.user.name },
      caseId,
      body,
    );
  } catch (e) {
    if (e instanceof PlatformError) return { ok: false, error: e.code };
    throw e;
  }
  revalidatePath(`/support/${caseId}`);
  return { ok: true };
}
