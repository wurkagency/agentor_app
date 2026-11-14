import { redirect } from 'next/navigation';
import { requireStaff } from '@/server/platform';

export default async function AdminPage() {
  await requireStaff(true);
  redirect('/platform/admin/status');
}
