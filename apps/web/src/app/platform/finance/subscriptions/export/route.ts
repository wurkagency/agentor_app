import { csvResponse, subscriptionsCsv } from '@/server/finance-export';
import { requireStaff } from '@/server/platform';

/** "Eksportér" (F2): all subscriptions. Superadmin only. */
export async function GET() {
  const { actor } = await requireStaff(true);
  return csvResponse(
    await subscriptionsCsv(actor),
    `abonnementer-${new Date().toISOString().slice(0, 10)}.csv`,
  );
}
