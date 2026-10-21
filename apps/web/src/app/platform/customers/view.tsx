import { activeGrantsAll, listCases, listPlans, myGrants } from '@agentor/db';
import { formatRelative, type Locale } from '@agentor/i18n';
import { Banner, HeroCurve, Icon, KpiCard, SegmentBar } from '@agentor/ui';
import { Download, Lock, MessageSquare, TriangleAlert, UserRound } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { ButtonLink } from '@/components/button-link';
import { CreateCustomerButton } from '@/components/platform/create-customer-button';
import { CustomersTable, type CustomerItem } from '@/components/platform/customers-table';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';
import { customersFor, initials, planNames, statsFor, tenantNames } from '@/server/platform-data';
import { Responsive } from '@agentor/ui/mobile';
import { CustomersMobile } from './mobile';

/**
 * Kunder (P1): name, plan and overall status only. Customer data needs a support grant, which
 * lasts at most 24 hours and is logged in the customer's audit log.
 */
export async function CustomersView({
  query,
  expired,
  filter = 'all',
}: {
  query: string;
  expired: boolean;
  /** Mobile chips (MP01). */
  filter?: 'all' | 'attention';
}) {
  const { actor } = await requireStaff();
  const t = await getTranslations('platform.customers');
  const locale = (await getLocale()) as Locale;
  const [customers, stats, grants, mine, plans, names] = await Promise.all([
    customersFor(actor.userId),
    statsFor(actor.userId),
    activeGrantsAll(db(), actor.userId),
    myGrants(db(), actor.userId),
    planNames(),
    tenantNames(actor.userId),
  ]);
  const open = await listCases(db(), actor.userId, names, {
    status: ['new', 'in_progress', 'waiting'],
  });
  const now = new Date();
  const myActive = mine.filter((g) => g.state === 'active');
  const nextExpiry = myActive.map((g) => g.expiresAt).sort((a, b) => a.getTime() - b.getTime())[0];
  const mineCase = (tenantId: string) =>
    open.some((o) => o.tenantId === tenantId && o.assigneeId === actor.userId);
  const items: CustomerItem[] = customers.map((c) => ({
    tenantId: c.tenantId,
    name: c.name,
    initials: initials(c.name),
    cvr: c.cvr,
    plan: (c.planId && plans.get(c.planId)) || '–',
    status: c.status,
    flows: c.flows,
    errorsToday: c.errorsToday,
    lastRunAt: c.lastRunAt?.toISOString() ?? null,
    requiresApproval: c.requiresApproval,
    grant: c.myGrant
      ? {
          id: c.myGrant.grantId,
          state: c.myGrant.state,
          expiresAt: c.myGrant.expiresAt.toISOString(),
        }
      : null,
    mineCases: mineCase(c.tenantId),
    cases: open
      .filter((o) => o.tenantId === c.tenantId)
      .map((o) => ({ id: o.id, label: `#${o.number} · ${o.title}` })),
  }));
  const activeThisMonth = customers.filter(
    (c) =>
      c.lastRunAt &&
      c.lastRunAt.getMonth() === now.getMonth() &&
      c.lastRunAt.getFullYear() === now.getFullYear(),
  ).length;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const newThisMonth = customers.filter((c) => c.createdAt >= monthStart).length;
  // Customers over the last 12 months, by when they joined.
  const growthCurve = Array.from({ length: 12 }, (_, i) => {
    const end = new Date(now.getFullYear(), now.getMonth() - 10 + i, 1);
    return customers.filter((c) => c.createdAt < end).length;
  });
  const broken = customers.filter((c) => c.status === 'broken').length;
  const errors = customers.filter((c) => c.status === 'error').length;

  const desktop = (
    <PageBody>
      {expired && <Banner tone="warn">{t('expired')}</Banner>}
      <PageHeader
        title={t('title')}
        subtitle={t('intro')}
        actions={
          <span className="flex gap-2">
            <ButtonLink variant="secondary" href="/platform/customers/export">
              <Icon icon={Download} size={16} />
              {t('export')}
            </ButtonLink>
            {actor.role === 'superadmin' && (
              <CreateCustomerButton
                plans={(await listPlans(db())).map((p) => ({ id: p.id, name: p.name }))}
              />
            )}
          </span>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-kpi-hero-3">
        <KpiCard
          compact
          hero
          icon={UserRound}
          label={t('statCustomers')}
          {...(newThisMonth
            ? {
                growth: {
                  direction: 'up',
                  tone: 'good',
                  text: t('statNew', { count: newThisMonth }),
                } as const,
              }
            : {})}
          value={String(customers.length)}
          visual={<HeroCurve compact data={growthCurve} />}
          footer={t('statCustomersSub', { count: activeThisMonth })}
        />
        <KpiCard
          compact
          icon={TriangleAlert}
          iconTone="error"
          label={t('statAttention')}
          value={String(broken + errors)}
          visual={
            <SegmentBar
              compact
              segments={[
                { value: broken, tone: 'error' },
                { value: errors, tone: 'warn' },
                { value: Math.max(0, customers.length - broken - errors), tone: 'muted' },
              ]}
            />
          }
          footer={t('statAttentionSub', { broken, errors })}
        />
        <KpiCard
          compact
          icon={Lock}
          label={t('statGrants')}
          growth={{ direction: 'down', tone: 'neutral', text: t('statMax') }}
          value={String(grants.length)}
          visual={
            <SegmentBar
              compact
              segments={[
                { value: myActive.length, tone: 'ink' },
                { value: Math.max(0, grants.length - myActive.length), tone: 'hatch' },
              ]}
            />
          }
          footer={
            nextExpiry
              ? t('statGrantsMine', {
                  count: myActive.length,
                  when: formatRelative(nextExpiry, now, locale),
                })
              : t('statGrantsNone')
          }
        />
        <KpiCard
          compact
          icon={MessageSquare}
          label={t('statCases')}
          value={String(stats.open)}
          visual={
            <SegmentBar
              compact
              segments={[
                { value: open.filter((o) => o.status === 'in_progress').length, tone: 'ink' },
                { value: open.filter((o) => o.status === 'waiting').length, tone: 'hatch' },
                { value: open.filter((o) => o.status === 'new').length, tone: 'navy' },
              ]}
            />
          }
          footer={t('statCasesSplit', {
            progress: open.filter((o) => o.status === 'in_progress').length,
            waiting: open.filter((o) => o.status === 'waiting').length,
            fresh: open.filter((o) => o.status === 'new').length,
          })}
        />
      </div>
      <CustomersTable items={items} initialQuery={query} superadmin={actor.role === 'superadmin'} />
    </PageBody>
  );
  return (
    <Responsive
      desktop={desktop}
      mobile={<CustomersMobile items={items} query={query} filter={filter} />}
    />
  );
}
