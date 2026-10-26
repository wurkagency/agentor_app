import { getSecuritySettings } from '@agentor/db';
import { formatNumber, type Locale } from '@agentor/i18n';
import { MobileCard, MobileShell, Responsive, RowIcon, RowLink } from '@agentor/ui/mobile';
import {
  Bell,
  CreditCard,
  Download,
  Headset,
  MessageSquare,
  Plug,
  ScrollText,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AppTopBar } from '@/components/mobile/chrome';
import { DesktopRedirect } from '@/components/mobile/desktop-redirect';
import { LogoutButton } from '@/components/mobile/logout-button';
import { HideWhenInstalled } from '@/components/mobile/standalone';
import { requireAppContext } from '@/server/auth/session';
import { billingOverview } from '@/server/billing-overview';
import { connectionMap } from '@/server/flows';
import { db } from '@/server/infra';
import { initials } from '@/server/platform-data';

export async function generateMetadata() {
  const t = await getTranslations('mobile.more');
  return { title: t('title') };
}

/**
 * MA10 Mere: navigation only, and log out. On a computer the same things live in the profile
 * menu and Indstillinger, so the desktop branch goes to Overblik.
 */
export default async function MorePage() {
  const ctx = await requireAppContext();
  const t = await getTranslations('mobile.more');
  const tr = await getTranslations('profile.roles');
  const locale = (await getLocale()) as Locale;
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const role = ctx.tenant.role;
  const admin = role === 'owner' || role === 'admin';
  const [billing, security, conns] = await Promise.all([
    role === 'owner' ? billingOverview(ctx) : null,
    admin ? getSecuritySettings(db(), c) : null,
    connectionMap(ctx.tenant.tenantId, ctx.user.id),
  ]);
  const now = Date.now();
  const pending = (security?.grants ?? []).filter(
    (g) =>
      !g.approvedAt && !g.deniedAt && !g.revokedAt && g.requestedAt.getTime() > now - 86_400_000,
  );
  const broken = [...conns.values()].filter((x) => x.status === 'broken').length;
  const icon = (i: typeof Bell) => <RowIcon icon={i} tone="neutral" />;

  const mobile = (
    <MobileShell topBar={<AppTopBar />}>
      <MobileCard>
        {/* The whole card opens Min profil (MA10 → MA36). */}
        <Link href="/profile" className="flex items-center gap-3 p-4 text-fg-1 no-underline">
          <span className="grid size-11 flex-none place-items-center rounded-full bg-fg-1 font-semibold text-white">
            {initials(ctx.user.name)}
          </span>
          <span className="flex flex-1 flex-col leading-snug">
            <strong>{ctx.user.name}</strong>
            <span className="text-meta font-medium text-fg-2">
              {t('role', { role: tr(role), company: ctx.tenant.tenantName })}
            </span>
          </span>
        </Link>
      </MobileCard>
      <MobileCard>
        {billing && (
          <RowLink
            href="/billing"
            linkAs={Link}
            leading={icon(CreditCard)}
            title={t('billing')}
            meta={
              billing.quota.limit === null
                ? t('billingMetaUnlimited', {
                    plan: billing.plan.name,
                    used: formatNumber(billing.quota.used, locale),
                  })
                : t('billingMeta', {
                    plan: billing.plan.name,
                    used: formatNumber(billing.quota.used, locale),
                    limit: formatNumber(billing.quota.limit, locale),
                  })
            }
          />
        )}
        {admin && (
          <RowLink
            href={pending[0] ? `/support-access/${pending[0].id}` : '/settings/security'}
            linkAs={Link}
            leading={icon(Headset)}
            title={t('support')}
            meta={
              pending.length ? t('supportPending', { count: pending.length }) : t('supportNone')
            }
            {...(pending.length
              ? {
                  trailing: (
                    <span className="inline-flex h-5.5 items-center rounded-full bg-error-fg px-2.25 text-meta font-semibold text-white">
                      {pending.length}
                    </span>
                  ),
                }
              : {})}
          />
        )}
        <RowLink
          href="/settings/notifications"
          linkAs={Link}
          leading={icon(Bell)}
          title={t('notifications')}
          meta={t('notificationsMeta')}
        />
        <RowLink
          href="/settings/security"
          linkAs={Link}
          leading={icon(ShieldCheck)}
          title={t('security')}
          meta={t('securityMeta')}
        />
        <RowLink
          href="/support"
          linkAs={Link}
          leading={icon(MessageSquare)}
          title={t('contact')}
          meta={t('contactMeta')}
        />
      </MobileCard>
      <MobileCard>
        <RowLink
          href="/connections"
          linkAs={Link}
          leading={icon(Plug)}
          title={t('connections')}
          meta={t('connectionsMeta', { count: conns.size, broken })}
        />
        {admin && (
          <>
            <RowLink
              href="/settings/team"
              linkAs={Link}
              leading={icon(Users)}
              title={t('team')}
              meta={ctx.tenant.tenantName}
            />
            <RowLink
              href="/settings/audit-log"
              linkAs={Link}
              leading={icon(ScrollText)}
              title={t('auditLog')}
              meta={t('auditLogMeta')}
            />
          </>
        )}
      </MobileCard>
      <HideWhenInstalled>
        <MobileCard>
          <RowLink
            href="/install"
            linkAs={Link}
            leading={icon(Download)}
            title={t('install')}
            meta={t('installMeta')}
          />
        </MobileCard>
      </HideWhenInstalled>
      <LogoutButton />
    </MobileShell>
  );
  return <Responsive desktop={<DesktopRedirect href="/" label={t('title')} />} mobile={mobile} />;
}
