import { activeGrantsAll, listCases, myGrants } from '@agentor/db';
import { formatRelative, type Locale } from '@agentor/i18n';
import { Banner, Icon, StatCard } from '@agentor/ui';
import { Download } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { ButtonLink } from '@/components/button-link';
import { CustomersTable, type CustomerItem } from '@/components/platform/customers-table';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';
import { customersFor, initials, planNames, statsFor, tenantNames } from '@/server/platform-data';

/**
 * Kunder (P1): name, plan and overall status only. Customer data needs a support grant, which
 * lasts at most 24 hours and is logged in the customer's audit log.
 */
export async function CustomersView({
  view,
  query,
  expired,
}: {
  view: 'all' | 'mine' | 'recent';
  query: string;
  expired: boolean;
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
  const recent = new Set(mine.map((g) => g.tenantId));
  const mineCase = (tenantId: string) =>
    open.some((o) => o.tenantId === tenantId && o.assigneeId === actor.userId);
  const visible = customers.filter((c) =>
    view === 'mine'
      ? c.myGrant && (c.myGrant.state === 'active' || c.myGrant.state === 'pending')
      : view === 'recent'
        ? recent.has(c.tenantId) || mineCase(c.tenantId)
        : true,
  );
  const items: CustomerItem[] = visible.map((c) => ({
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
  const broken = customers.filter((c) => c.status === 'broken').length;
  const errors = customers.filter((c) => c.status === 'error').length;

  return (
    <PageBody>
      {expired && <Banner tone="warn">{t('expired')}</Banner>}
      <PageHeader
        title={t('title')}
        subtitle={t('intro')}
        actions={
          <ButtonLink variant="secondary" href="/platform/customers/export">
            <Icon icon={Download} size={16} />
            {t('export')}
          </ButtonLink>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('statCustomers')}
          value={String(customers.length)}
          footer={t('statCustomersSub', { count: activeThisMonth })}
        />
        <StatCard
          label={t('statAttention')}
          value={String(broken + errors)}
          footer={t('statAttentionSub', { broken, errors })}
        />
        <StatCard
          label={t('statGrants')}
          value={String(grants.length)}
          footer={
            nextExpiry
              ? t('statGrantsMine', {
                  count: myActive.length,
                  when: formatRelative(nextExpiry, now, locale),
                })
              : t('statGrantsNone')
          }
        />
        <StatCard
          label={t('statCases')}
          value={String(stats.open)}
          footer={t('statCasesSub', { count: stats.waiting })}
        />
      </div>
      <CustomersTable items={items} initialQuery={query} />
    </PageBody>
  );
}
