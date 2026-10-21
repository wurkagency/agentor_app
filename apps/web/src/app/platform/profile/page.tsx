import { Card } from '@agentor/ui';
import { getTranslations } from 'next-intl/server';
import { LogoutButton } from '@/components/mobile/logout-button';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireStaff } from '@/server/platform';

export async function generateMetadata() {
  const t = await getTranslations('platform');
  return { title: t('account') };
}

/** Profil (PR1): the staff member's own profile. The full dashboard follows in M3. */
export default async function PlatformProfilePage() {
  const { session, actor } = await requireStaff();
  const t = await getTranslations('platform');
  return (
    <PageBody>
      <PageHeader title={actor.name} subtitle={`${t(`role.${actor.role}`)} · Agentor`} />
      <Card className="flex flex-wrap items-center justify-between gap-4">
        <span className="text-body">{session.user.email}</span>
        <LogoutButton />
      </Card>
    </PageBody>
  );
}
