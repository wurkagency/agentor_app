import { manifestFor } from '@agentor/connectors';
import { listNotifications, listOwnTenants, myGrants, openFailures } from '@agentor/db';
import { formatPercent, type Locale } from '@agentor/i18n';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SupportBar } from '@/components/platform/support-bar';
import { AppHeader } from '@/components/shell/app-header';
import { requireAppContext } from '@/server/auth/session';
import { billingOverview } from '@/server/billing-overview';
import { connectionMap, viewsFor } from '@/server/flows';
import { db } from '@/server/infra';
import { staffRole } from '@/server/platform';
import { gearCounts, initials } from '@/server/platform-data';

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
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const [notes, views, conns, failures] = await Promise.all([
    listNotifications(db(), c),
    viewsFor(ctx),
    connectionMap(ctx.tenant.tenantId, ctx.user.id),
    openFailures(db(), c),
  ]);
  const needs = notes.filter((n) => n.needsAction && !n.resolvedAt);
  const role = await staffRole(ctx.user.id);
  const locale = (await getLocale()) as Locale;
  const staff = role
    ? { role, counts: await gearCounts(ctx.user.id, locale), supportView: Boolean(ctx.support) }
    : undefined;
  const switcher = ctx.support
    ? (await myGrants(db(), ctx.user.id)).map((g) => ({
        grantId: g.grantId,
        tenantId: g.tenantId,
        tenantName: g.tenantName,
        initials: initials(g.tenantName),
        caseRef: g.caseRef,
        state: g.state,
        expiresAt: g.expiresAt.toISOString(),
      }))
    : [];
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:shadow-card"
      >
        {t('skipToContent')}
      </a>
      {ctx.support && (
        <SupportBar
          tenantName={ctx.tenant.tenantName}
          initials={initials(ctx.tenant.tenantName)}
          scope={ctx.support.scope}
          caseRef={ctx.support.caseRef}
          approvedBy={ctx.support.approvedByName}
          expiresAt={ctx.support.expiresAt.toISOString()}
          grants={switcher}
        />
      )}
      <AppHeader
        staff={staff}
        user={{ name: ctx.user.name, email: ctx.user.email }}
        tenant={{
          id: ctx.tenant.tenantId,
          name: ctx.tenant.tenantName,
          shortName: shortName(ctx.tenant.tenantName),
          role: ctx.tenant.role,
        }}
        tenants={tenants.map((t) => ({ id: t.tenantId, name: t.name }))}
        attention={{
          count: needs.length,
          severe: needs.some((n) => n.event === 'connection_broken' || n.event === 'record_failed'),
        }}
        notifications={notes.map((n) => ({
          id: n.id,
          event: n.event,
          messageKey: n.messageKey,
          params: n.params,
          href: n.href,
          needsAction: n.needsAction,
          resolved: n.resolvedAt !== null,
          read: n.readAt !== null,
          createdAt: n.createdAt.toISOString(),
        }))}
        search={{
          flows: views.map((v) => ({ id: v.id, name: v.name, routes: v.routes.length })),
          connections: [...conns.values()].map((x) => ({
            id: x.id,
            label: `${manifestFor(x.connectorId)?.name ?? x.connectorId} · ${x.name}`,
          })),
          failuresToday: new Set(
            failures
              .filter((f) => f.createdAt >= startOfDay)
              .map((f) => `${f.routeId}:${f.sourceId}`),
          ).size,
        }}
        usageHint={usageHint}
      />
      {children}
    </div>
  );
}
