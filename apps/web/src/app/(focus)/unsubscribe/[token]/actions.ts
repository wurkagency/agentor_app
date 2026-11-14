'use server';

import { unsubscribeApply } from '@agentor/db';
import { redirect } from 'next/navigation';
import { db } from '@/server/infra';

/** "Afmeld" on the unsubscribe page: e-mail off for the weekly summary, audit-logged in SQL. */
export async function unsubscribeAction(token: string): Promise<void> {
  const ok = await unsubscribeApply(db(), token);
  redirect(
    ok
      ? `/unsubscribe/${encodeURIComponent(token)}?done=1`
      : `/unsubscribe/${encodeURIComponent(token)}`,
  );
}
