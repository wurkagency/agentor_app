import { getTranslations } from 'next-intl/server';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireAppContext } from '@/server/auth/session';
import { ProfileForms } from './profile-forms';

export async function generateMetadata() {
  const t = await getTranslations('profile');
  return { title: t('title') };
}

/** Min profil (profile menu, README decision 3). No board; built from the settings form pattern. */
export default async function ProfilePage() {
  const ctx = await requireAppContext();
  const t = await getTranslations('profile');
  const nav = await getTranslations('nav');
  return (
    <PageBody>
      <PageHeader eyebrow={nav('settings')} title={t('title')} />
      <ProfileForms name={ctx.user.name} email={ctx.user.email} locale={ctx.user.locale} />
    </PageBody>
  );
}
