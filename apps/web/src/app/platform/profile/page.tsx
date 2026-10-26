import type { Locale } from '@agentor/i18n';
import { getLocale, getTranslations } from 'next-intl/server';
import { ProfilePage } from '@/components/profile/profile-page';
import { staffOwner } from '@/server/profile/owner';
import { profileView } from '@/server/profile/view';

export async function generateMetadata() {
  const t = await getTranslations('profile');
  return { title: t('titleStaff') };
}

/** Profil (PR1, MP29): the staff member's own profile dashboard, from the profile button. */
export default async function PlatformProfilePage() {
  const owner = await staffOwner();
  const locale = (await getLocale()) as Locale;
  return <ProfilePage view={await profileView(owner, locale)} locale={locale} />;
}
