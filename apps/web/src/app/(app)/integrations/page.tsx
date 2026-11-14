import { canAdd } from '@agentor/core';
import { Banner, Icon } from '@agentor/ui';
import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ButtonLink } from '@/components/button-link';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireAppContext } from '@/server/auth/session';
import { billingOverview } from '@/server/billing-overview';
import { connectionMap, viewsFor } from '@/server/flows';
import { FlowsTable, type FlowTableRow } from './flows-table';
import { EmptyFlows } from './empty-flows';
import { manifestFor } from '@agentor/connectors';
import { formatDate, formatNumber, formatRelative, formatTime, type Locale } from '@agentor/i18n';
import { Responsive } from '@agentor/ui/mobile';
import { getLocale } from 'next-intl/server';
import { IntegrationsMobile, type MobileFlow } from './mobile';

export async function generateMetadata() {
  const t = await getTranslations('pages');
  return { title: t('integrations') };
}

/** Integrationer (D2): every flow with its routes, status, mode and recent records. */
export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; filter?: string; select?: string }>;
}) {
  const ctx = await requireAppContext();
  const [views, overview, conns] = await Promise.all([
    viewsFor(ctx),
    billingOverview(ctx),
    connectionMap(ctx.tenant.tenantId, ctx.user.id),
  ]);
  const t = await getTranslations('flows');
  const { view, filter, select } = await searchParams;
  const canEdit = ['owner', 'admin', 'developer'].includes(ctx.tenant.role);
  const count = (s: string) => views.filter((v) => v.status === s).length;
  const setsLimit = overview?.plan.entitlements.integrationSets ?? null;
  const atLimit = overview ? !canAdd(overview.usage.integrationSets, setsLimit) : false;

  const summary = views.length
    ? [
        t('count', { count: views.length }),
        ...(count('error') ? [t('withErrors', { count: count('error') })] : []),
        ...(count('broken') ? [t('broken', { count: count('broken') })] : []),
        ...(count('paused') ? [t('paused', { count: count('paused') })] : []),
      ].join(' · ')
    : t('noneYet', { connections: conns.size });

  const rows: FlowTableRow[] = views.map((v) => ({
    id: v.id,
    name: v.name,
    status: v.status,
    statusSince: v.statusSince?.toISOString() ?? null,
    pausedByName: v.pausedByName,
    mode: v.mode,
    records: v.records,
    openFailures: v.openFailures,
    lastRunAt: v.lastRunAt?.toISOString() ?? null,
    published: Boolean(v.published),
    connectors: [v.source, ...v.destinations]
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((c) => ({
        id: c.id,
        connectorId: c.connectorId,
        name: c.name,
        logo: c.logo,
        status: c.status,
      })),
    brokenConnectionId:
      [v.source, ...v.destinations].find((c) => c?.status === 'broken')?.id ?? null,
    routes: v.routes.map((r) => ({
      id: r.id,
      source: r.source,
      destination: r.destination,
      status: r.status,
      mode: r.mode,
      records: r.records,
      failed: r.failed,
      openFailures: r.openFailures,
      lastAt: r.lastAt?.toISOString() ?? null,
      pausedBy: r.pausedBy,
    })),
  }));

  const newFlow = canEdit ? (
    <ButtonLink
      variant="primary"
      size="l"
      href="/integrations/new"
      aria-disabled={atLimit || undefined}
    >
      <Icon icon={Plus} size={18} />
      {t('newFlow')}
    </ButtonLink>
  ) : undefined;

  const desktop = (
    <PageBody>
      <PageHeader
        title={t('title')}
        subtitle={atLimit ? t('allSetsUsed') : summary}
        actions={newFlow}
      />
      {atLimit && overview && (
        <Banner
          tone="warn"
          title={t('limitTitle', { plan: overview.plan.name })}
          action={
            ctx.tenant.role === 'owner' ? (
              <ButtonLink variant="dark" size="s" href="/billing">
                {t('seePlans')}
              </ButtonLink>
            ) : undefined
          }
        >
          {t('limitBody')}
        </Banner>
      )}
      {rows.length === 0 ? (
        <EmptyFlows
          connected={[...conns.values()].filter((c) => c.status === 'ok').map((c) => c.connectorId)}
          canEdit={canEdit}
        />
      ) : (
        <FlowsTable rows={rows} canEdit={canEdit} developer={view === 'developer'} />
      )}
    </PageBody>
  );

  // Mobile (MA04 cards, MA19 select list, MA18 empty, MA21 plan limit).
  const tm = await getTranslations('mobile.integrations');
  const ts = await getTranslations('status');
  const tmode = await getTranslations('mode');
  const to = await getTranslations('templates');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const when = (d: Date | null) => {
    if (!d) return t('never');
    const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
    if (days === 0) return formatRelative(d, now, locale);
    if (days === 1) return (locale === 'da' ? 'i går ' : 'yesterday ') + formatTime(d, locale);
    return formatDate(d, locale);
  };
  const logo = (c: { connectorId: string; name: string; logo: string }) => ({
    name: manifestFor(c.connectorId)?.name ?? c.name,
    ...(c.logo ? { logoUrl: c.logo } : {}),
  });
  const PROBLEMS: string[] = ['error', 'broken', 'warn'];
  const groups = {
    problems: views.filter((v) => PROBLEMS.includes(v.status)),
    paused: views.filter((v) => v.status === 'paused'),
    draft: views.filter((v) => !v.published),
  };
  const active =
    filter === 'problems' || filter === 'paused' || filter === 'draft' ? filter : 'all';
  // Problems first, as on the boards (MA04, MA19).
  const RANK: Record<string, number> = { error: 0, broken: 1, warn: 2, ok: 3, info: 4, paused: 5 };
  const shown = (active === 'all' ? views : groups[active])
    .slice()
    .sort(
      (x, y) =>
        (x.published ? (RANK[x.status] ?? 6) : 7) - (y.published ? (RANK[y.status] ?? 6) : 7),
    );
  const selectMode = select === '1';
  const qs = (f: string, sel = selectMode) => {
    const q = [f !== 'all' ? 'filter=' + f : '', sel ? 'select=1' : ''].filter(Boolean).join('&');
    return '/integrations' + (q ? '?' + q : '');
  };
  const flows: MobileFlow[] = shown.map((v) => {
    const routes = t('routes', { count: v.routes.length });
    const broken = [v.source, ...v.destinations].find((c) => c?.status === 'broken');
    const cardMeta = !v.published
      ? tm('metaDraft', { routes })
      : v.status === 'broken'
        ? tm('metaBroken', { routes, when: when(v.statusSince) })
        : v.status === 'paused' && v.pausedByName
          ? tm('metaPaused', { routes, name: v.pausedByName })
          : tm('metaRecords', {
              routes,
              records: t('records', { count: v.records }),
              ago: when(v.lastRunAt),
            });
    return {
      id: v.id,
      name: v.name,
      href: broken ? '/connections/' + broken.id + '/reconnect' : '/integrations/' + v.id,
      source: v.source ? logo(v.source) : { name: v.name },
      destinations: v.destinations.map(logo),
      status: v.published ? v.status : 'draft',
      statusLabel: ts(v.published ? v.status : 'draft'),
      cardMeta,
      meta: tm('metaShort', { routes, when: when(v.lastRunAt) }),
      connections: [v.source, ...v.destinations]
        .filter((c): c is NonNullable<typeof c> => Boolean(c))
        .map(logo),
      modeLabel: !v.published || !v.mode ? '–' : v.mode === 'mixed' ? t('mixed') : tmode(v.mode),
      routesLabel: routes,
      records7d: v.published ? formatNumber(v.records, locale) : '–',
      lastRun: when(v.lastRunAt),
      paused: v.status === 'paused',
      published: Boolean(v.published),
      reconnectHref: broken && canEdit ? '/connections/' + broken.id + '/reconnect' : null,
    };
  });
  const order = ['startup', 'business', 'enterprise'];
  const next = overview ? order[order.indexOf(overview.plan.id) + 1] : undefined;
  const nextName = next ? next.charAt(0).toUpperCase() + next.slice(1) : null;
  const connected = [...conns.values()].filter((c) => c.status === 'ok');
  const and = locale === 'da' ? ' og ' : ' and ';
  const mobile = (
    <IntegrationsMobile
      snapshot={
        ctx.support || active !== 'all'
          ? null
          : { owner: `${ctx.user.id}:${ctx.tenant.tenantId}`, company: ctx.tenant.tenantName }
      }
      title={t('title')}
      subtitle={atLimit ? tm('allSetsUsed', { count: views.length }) : summary}
      filter={{
        label: tm('filterLabel'),
        value: active,
        items: [
          { key: 'all', label: tm('all', { count: views.length }), href: qs('all') },
          {
            key: 'problems',
            label: tm('problems', { count: groups.problems.length }),
            href: qs('problems'),
          },
          {
            key: 'paused',
            label: tm('paused', { count: groups.paused.length }),
            href: qs('paused'),
          },
          ...(groups.draft.length
            ? [
                {
                  key: 'draft',
                  label: tm('draft', { count: groups.draft.length }),
                  href: qs('draft'),
                },
              ]
            : []),
        ],
      }}
      mode={{
        select: selectMode,
        label: selectMode ? tm('done') : tm('select'),
        href: qs(active, !selectMode),
      }}
      flows={flows}
      limit={
        atLimit && overview
          ? {
              title: t('limitTitle', { plan: overview.plan.name }),
              body: t('limitBody'),
              actions:
                ctx.tenant.role === 'owner'
                  ? [
                      { label: t('seePlans'), href: '/billing/plan' },
                      ...(nextName
                        ? [
                            {
                              label: tm('upgradeTo', { plan: nextName }),
                              href: '/billing/plan',
                              primary: true,
                            },
                          ]
                        : []),
                    ]
                  : [],
            }
          : null
      }
      empty={
        views.length === 0
          ? {
              title: t('emptyTitle'),
              body: connected.length
                ? t('emptyBodyConnected', {
                    names: [
                      ...new Set(connected.map((c) => manifestFor(c.connectorId)?.name ?? c.name)),
                    ].join(and),
                  })
                : t('emptyBody'),
              templates: [
                { id: 'webshop-dinero', from: 'woocommerce', to: 'dinero' },
                { id: 'customers-hubspot', from: 'woocommerce', to: 'hubspot' },
                { id: 'customers-brevo', from: 'woocommerce', to: 'brevo' },
              ].map((x) => ({
                id: x.id,
                title: to('catalog.' + x.id + '.title'),
                body: to('catalog.' + x.id + '.body'),
                source: {
                  name: manifestFor(x.from)?.name ?? x.from,
                  logoUrl: '/logos/' + x.from + '.svg',
                },
                destination: {
                  name: manifestFor(x.to)?.name ?? x.to,
                  logoUrl: '/logos/' + x.to + '.svg',
                },
              })),
              note: tm('emptyNote'),
            }
          : null
      }
      deskNote={tm('deskNote')}
      canEdit={canEdit}
    />
  );
  return <Responsive desktop={desktop} mobile={mobile} />;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
