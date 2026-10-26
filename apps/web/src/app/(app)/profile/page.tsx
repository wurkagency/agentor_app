import type { Locale } from '@agentor/i18n';
import { getLocale, getTranslations } from 'next-intl/server';
import { ProfilePage } from '@/components/profile/profile-page';
import { customerOwner } from '@/server/profile/owner';
import { profileView } from '@/server/profile/view';

export async function generateMetadata() {
  const t = await getTranslations('profile');
  return { title: t('titleCustomer') };
}

/**
 * Min profil (D15, MA36): the signed-in user's own profile in the customer app. A staff member in
 * a support view gets no profile here (requireCustomerArea).
 */
export default async function CustomerProfilePage() {
  const owner = await customerOwner();
  const locale = (await getLocale()) as Locale;
  return <ProfilePage view={await profileView(owner, locale)} locale={locale} />;
}
