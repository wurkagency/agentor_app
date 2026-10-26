import { getNotificationSettings } from '@agentor/db';
import { Responsive } from '@agentor/ui/mobile';
import { getTranslations } from 'next-intl/server';
import { DesktopRedirect } from '@/components/mobile/desktop-redirect';
import { requireCustomerArea } from '@/server/auth/session';
import { db } from '@/server/infra';
import { ChannelsMobile } from './channels-mobile';

export async function generateMetadata() {
  const t = await getTranslations('mobile.channels');
  return { title: t('title') };
}

/**
 * MA35 Notifikationskanaler: the channel matrix of D12 on the phone, reached from MA11. On a
 * computer the same matrix is on /settings/notifications.
 */
export default async function ChannelsPage() {
  const ctx = await requireCustomerArea();
  const settings = await getNotificationSettings(db(), {
    tenantId: ctx.tenant.tenantId,
    userId: ctx.user.id,
  });
  const t = await getTranslations('notifications');
  const isAdmin = ctx.tenant.role === 'owner' || ctx.tenant.role === 'admin';
  const firstName = ctx.user.name.split(' ')[0] ?? ctx.user.name;
  return (
    <Responsive
      desktop={<DesktopRedirect href="/settings/notifications" label={t('title')} />}
      mobile={
        <ChannelsMobile
          firstName={firstName}
          thresholds={settings.thresholds}
          initial={{
            matrix: settings.matrix,
            quiet: settings.quiet,
            smsPhone: settings.smsPhone ?? '',
            ...(isAdmin ? { thresholds: settings.thresholds } : {}),
          }}
        />
      }
    />
  );
}
