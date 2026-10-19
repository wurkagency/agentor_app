import { getNotificationSettings } from '@agentor/db';
import { getTranslations } from 'next-intl/server';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireCustomerArea } from '@/server/auth/session';
import { db } from '@/server/infra';
import { NotificationsForm } from './notifications-form';

export async function generateMetadata() {
  const t = await getTranslations('notifications');
  return { title: t('title') };
}

/** Notifikationer (D12-Notifikationer). Channels per user; thresholds per tenant (PLAN Q11). */
export default async function NotificationsPage() {
  const ctx = await requireCustomerArea();
  const settings = await getNotificationSettings(db(), {
    tenantId: ctx.tenant.tenantId,
    userId: ctx.user.id,
  });
  const t = await getTranslations('notifications');
  const nav = await getTranslations('nav');
  const firstName = ctx.user.name.split(' ')[0] ?? ctx.user.name;
  return (
    <PageBody>
      <PageHeader
        eyebrow={nav('settings')}
        title={t('title')}
        subtitle={t('intro', { name: firstName })}
      />
      <NotificationsForm
        initial={settings}
        canEditThresholds={ctx.tenant.role === 'owner' || ctx.tenant.role === 'admin'}
      />
    </PageBody>
  );
}
