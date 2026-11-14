import { redirect } from 'next/navigation';
import { requireStaff } from '@/server/platform';

export default async function ReportsPage() {
  await requireStaff(true);
  redirect('/platform/admin/reports/revenue');
}
