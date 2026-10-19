import { listOwnTenants } from '@agentor/db';
import { formatPercent } from '@agentor/i18n';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/shell/app-header';
import { requireAppContext } from '@/server/auth/session';
import { billingOverview } from '@/server/billing-overview';
import { db } from '@/server/infra';

/** "Nordlys Cykler ApS" → "Nordlys Cykler" for the account chip (App-skal-B). */
function shortName(name: string): string {
  return name.replace(/\s+(ApS|A\/S|I\/S|IVS|K\/S|P\/S)$/i, '');
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAppContext();
  // A company that hasn't finished onboarding (D14) goes back there; only the owner can finish.
  if (!ctx.tenant.onboardingCompleted && ctx.tenant.role === 'owner') redirect('/onboarding/plan');
  const tenants = ctx.tenantCount > 1 ? await listOwnTenants(db(), ctx.user.id) : [];
  const t = await getTranslations('nav');
  // Profile menu hint next to "Abonnement" (App-skal-B): this month's transaction usage.
  const overview = ctx.tenant.role === 'owner' ? await billingOverview(ctx) : null;
  const usageHint =
    overview && overview.quota.limit !== null
      ? formatPercent(overview.quota.ratio, (await getLocale()) as 'da' | 'en', 0)
      : undefined;
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:shadow-card"
      >
        {t('skipToContent')}
      </a>
      <AppHeader
        user={{ name: ctx.user.name, email: ctx.user.email }}
        tenant={{
          id: ctx.tenant.tenantId,
          name: ctx.tenant.tenantName,
          shortName: shortName(ctx.tenant.tenantName),
          role: ctx.tenant.role,
        }}
        tenants={tenants.map((t) => ({ id: t.tenantId, name: t.name }))}
        attention={{ count: 0, severe: false }}
        usageHint={usageHint}
      />
      {children}
    </div>
  );
}
