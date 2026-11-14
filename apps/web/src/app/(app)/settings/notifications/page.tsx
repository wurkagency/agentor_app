import { getNotificationSettings } from '@agentor/db';
import { getTranslations } from 'next-intl/server';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireCustomerArea } from '@/server/auth/session';
import { db } from '@/server/infra';
import { NotificationsForm } from './notifications-form';
import { MobileShell, Responsive } from '@agentor/ui/mobile';
import { AppTopBar } from '@/components/mobile/chrome';
import { env } from '@/server/env';
import { PushSettings } from './push-settings';

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
  const desktop = (
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
  const tm = await getTranslations('mobile.pushSettings');
  const isAdmin = ctx.tenant.role === 'owner' || ctx.tenant.role === 'admin';
  // MA11: push on this phone and quiet hours; e-mail, SMS and thresholds stay on D12.
  const mobile = (
    <MobileShell topBar={<AppTopBar back="/more" title={tm('title')} bell={false} />}>
      <PushSettings
        vapidKey={ctx.support ? null : (env().VAPID_PUBLIC_KEY ?? null)}
        quiet={settings.quiet}
        settings={{
          matrix: settings.matrix,
          quiet: settings.quiet,
          smsPhone: settings.smsPhone ?? '',
          ...(isAdmin ? { thresholds: settings.thresholds } : {}),
        }}
      />
    </MobileShell>
  );
  return <Responsive desktop={desktop} mobile={mobile} />;
}
