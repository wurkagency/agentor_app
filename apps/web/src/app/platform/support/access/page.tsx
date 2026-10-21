import { allGrants, listCases, type PlatformGrant } from '@agentor/db';
import { formatDate, formatTime, type Locale } from '@agentor/i18n';
import {
  Avatar,
  Card,
  CardHeader,
  EmptyState,
  KpiCard,
  StatusPill,
  Table,
  Td,
  Th,
  Tr,
} from '@agentor/ui';
import { Clock, History, Hourglass, KeyRound, Lock } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { GrantRowActions, RequestAccessPicker } from '@/components/platform/access-page-controls';
import { Countdown } from '@/components/platform/countdown';
import type { AccessTarget } from '@/components/platform/request-access-dialog';
import { FilterStatus, UrlSegmented } from '@/components/platform/url-segmented';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { copenhagenToday } from '@/server/date-range';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';
import { customersFor, initials, tenantNames } from '@/server/platform-data';

export async function generateMetadata() {
  const t = await getTranslations('platform.grants');
  return { title: t('title') };
}

const DAY = 86_400_000;
const isOpen = (g: PlatformGrant) => g.state === 'active' || g.state === 'pending';

/**
 * Support › Adgange (S9): active, pending and recently expired support grants, the staff
 * member's own or everyone's (?filter=mine|all). Reads support_access_grants through
 * app.platform_grants (0046); the actions are the existing ones and only work on one's own grants.
 */
export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { actor } = await requireStaff();
  const sp = await searchParams;
  const filter = sp.filter === 'mine' ? 'mine' : 'all';
  const t = await getTranslations('platform.grants');
  const locale = (await getLocale()) as Locale;
  const [grants, customers, names] = await Promise.all([
    allGrants(db(), actor.userId),
    customersFor(actor.userId),
    tenantNames(actor.userId),
  ]);
  const open = await listCases(db(), actor.userId, names, {
    status: ['new', 'in_progress', 'waiting'],
  });
  const now = new Date();
  const mine = (g: PlatformGrant) => g.staffUserId === actor.userId;
  const scoped = filter === 'mine' ? grants.filter(mine) : grants;
  const recent = (g: PlatformGrant) => g.requestedAt.getTime() > now.getTime() - 30 * DAY;

  const active = scoped.filter((g) => g.state === 'active');
  const pending = scoped.filter((g) => g.state === 'pending');
  const expiring = active.filter((g) => g.expiresAt.getTime() - now.getTime() <= 2 * 3_600_000);
  const myNext = active
    .filter(mine)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())[0];
  // Requests made by staff (not Superadmin's direct openings), this 30 days and the 30 before.
  const requests = scoped.filter((g) => recent(g));
  const before = scoped.filter((g) => !recent(g)).length;
  const approved = requests.filter((g) => g.approvedAt).length;
  const denied = requests.filter((g) => g.state === 'denied').length;

  const today = copenhagenToday(now);
  const tomorrow = copenhagenToday(new Date(now.getTime() + DAY));
  const dayIso = (d: Date) => copenhagenToday(d);
  const when = (d: Date) =>
    dayIso(d) === today
      ? t('today', { time: formatTime(d, locale) })
      : dayIso(d) === tomorrow
        ? t('tomorrow', { time: formatTime(d, locale) })
        : `${formatDate(d, locale).replace(/ \d{4}$/, '')} ${formatTime(d, locale)}`;
  const caseLabel = (g: PlatformGrant) =>
    g.caseNumber !== null ? `#${g.caseNumber} · ${g.caseTitle ?? ''}` : g.caseRef || t('noCase');
  const scope = (g: PlatformGrant) => (g.scope === 'view' ? t('scopeView') : t('scopeHelp'));

  const openRows = scoped
    .filter(isOpen)
    .sort(
      (a, b) =>
        Number(b.state === 'active') - Number(a.state === 'active') ||
        a.expiresAt.getTime() - b.expiresAt.getTime(),
    );
  const closedRows = scoped
    .filter(
      (g) =>
        (g.state === 'expired' || g.state === 'ended' || g.state === 'revoked') &&
        g.approvedAt &&
        (g.closedAt ?? g.expiresAt).getTime() > now.getTime() - 30 * DAY,
    )
    .sort((a, b) => (b.closedAt ?? b.expiresAt).getTime() - (a.closedAt ?? a.expiresAt).getTime())
    .slice(0, 10);

  const targets: AccessTarget[] = customers.map((c) => ({
    tenantId: c.tenantId,
    name: c.name,
    cvr: c.cvr,
    requiresApproval: c.requiresApproval,
    cases: open
      .filter((o) => o.tenantId === c.tenantId)
      .map((o) => ({ id: o.id, label: `#${o.number} · ${o.title}` })),
  }));
  const mineCount = grants.filter((g) => mine(g) && isOpen(g)).length;
  const allCount = grants.filter(isOpen).length;

  const customerCell = (g: PlatformGrant) => (
    <span className="flex items-center gap-2.5">
      <span className="grid size-7 flex-none place-items-center rounded-sm bg-bg-base text-nano font-semibold shadow-ring-chip">
        {initials(g.tenantName)}
      </span>
      <span className="flex flex-col leading-tight">
        <Link href={`/platform/customers/${g.tenantId}`} className="font-semibold text-fg-1">
          {g.tenantName}
        </Link>
        {g.tenantCvr && (
          <span className="text-meta text-fg-2">{t('cvr', { cvr: g.tenantCvr })}</span>
        )}
      </span>
    </span>
  );
  const staffCell = (g: PlatformGrant) => (
    <span className="flex items-center gap-2">
      <Avatar name={g.staffName || '?'} size={28} />
      {g.staffName}
      {mine(g) && <span className="text-fg-2">{t('youShort')}</span>}
    </span>
  );

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        subtitle={t('intro')}
        actions={
          <>
            <UrlSegmented
              label={t('filterLabel')}
              segments={[
                {
                  href: '/platform/support/access?filter=mine',
                  label: t('mine', { count: mineCount }),
                  active: filter === 'mine',
                },
                {
                  href: '/platform/support/access',
                  label: t('all', { count: allCount }),
                  active: filter === 'all',
                },
              ]}
            />
            <RequestAccessPicker targets={targets} />
          </>
        }
      />
      <FilterStatus>
        {filter === 'mine' ? t('mine', { count: mineCount }) : t('all', { count: allCount })}
      </FilterStatus>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-kpi-hero-3">
        <KpiCard
          compact
          hero
          icon={Lock}
          label={t('kpiActive')}
          growth={{ direction: 'flat', tone: 'neutral', text: t('kpiActiveMax') }}
          value={String(active.length)}
          footer={
            myNext ? t('kpiActiveMine', { when: when(myNext.expiresAt) }) : t('kpiActiveNone')
          }
        />
        <KpiCard
          compact
          icon={Hourglass}
          label={t('kpiPending')}
          value={String(pending.length)}
          footer={
            pending[0]
              ? t('kpiPendingSub', {
                  name: pending[0].tenantName,
                  time: formatTime(pending[0].requestedAt, locale),
                })
              : t('kpiNone')
          }
        />
        <KpiCard
          compact
          icon={Clock}
          iconTone={expiring.length ? 'error' : 'muted'}
          label={t('kpiExpiring')}
          value={String(expiring.length)}
          footer={
            expiring[0]
              ? t('kpiExpiringSub', {
                  name: expiring[0].tenantName,
                  time: formatTime(expiring[0].expiresAt, locale),
                })
              : t('kpiNone')
          }
        />
        <KpiCard
          compact
          icon={History}
          label={t('kpiRequests')}
          {...(requests.length !== before
            ? {
                growth: {
                  direction: requests.length > before ? 'up' : 'down',
                  tone: 'neutral',
                  text: String(Math.abs(requests.length - before)),
                } as const,
              }
            : {})}
          value={String(requests.length)}
          footer={t('kpiRequestsSub', { approved, denied })}
        />
      </div>

      <Card padding="none" className="overflow-x-auto">
        <div className="px-5 pb-2 pt-5">
          <CardHeader title={t('activeTitle')} />
        </div>
        {openRows.length === 0 ? (
          <EmptyState icon={KeyRound} title={t('emptyActive')}>
            {t('emptyActiveBody')}
          </EmptyState>
        ) : (
          <Table aria-label={t('activeTitle')}>
            <thead>
              <tr>
                <Th className="pl-5">{t('colCustomer')}</Th>
                <Th>{t('colCase')}</Th>
                <Th>{t('colScope')}</Th>
                <Th>{t('colApprovedBy')}</Th>
                <Th>{t('colExpires')}</Th>
                <Th>{t('colStaff')}</Th>
                <Th className="pr-5">
                  <span className="sr-only">{t('colActions')}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {openRows.map((g) => (
                <Tr key={g.grantId}>
                  <Td className="pl-5">{customerCell(g)}</Td>
                  <Td className="whitespace-normal">
                    {g.caseId ? (
                      <Link href={`/platform/support/cases/${g.caseId}`} className="text-fg-1">
                        {caseLabel(g)}
                      </Link>
                    ) : (
                      caseLabel(g)
                    )}
                  </Td>
                  <Td>{scope(g)}</Td>
                  <Td>
                    {g.state === 'pending' ? (
                      <StatusPill status="warn" compact>
                        {t('waiting')}
                      </StatusPill>
                    ) : (
                      (g.approvedByName ?? '–')
                    )}
                  </Td>
                  <Td>
                    {g.state === 'pending' ? (
                      '–'
                    ) : (
                      <span className="flex flex-col leading-tight">
                        <strong className="font-semibold">{when(g.expiresAt)}</strong>
                        <span className="text-meta text-fg-2">
                          <Countdown
                            expiresAt={g.expiresAt.toISOString()}
                            template={t('left', { time: '{time}' })}
                          />
                        </span>
                      </span>
                    )}
                  </Td>
                  <Td>{staffCell(g)}</Td>
                  <Td className="pr-5 text-right">
                    {mine(g) && (g.state === 'active' || g.state === 'pending') ? (
                      <GrantRowActions
                        tenantId={g.tenantId}
                        grantId={g.grantId}
                        state={g.state}
                        extensionRequested={Boolean(g.extensionRequestedAt)}
                      />
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card padding="none" className="overflow-x-auto">
        <div className="px-5 pb-2 pt-5">
          <CardHeader title={t('expiredTitle')} />
        </div>
        {closedRows.length === 0 ? (
          <p className="m-0 px-5 pb-5 text-body text-fg-2">{t('emptyExpired')}</p>
        ) : (
          <Table aria-label={t('expiredTitle')}>
            <thead>
              <tr>
                <Th className="pl-5">{t('colCustomer')}</Th>
                <Th>{t('colCase')}</Th>
                <Th>{t('colScope')}</Th>
                <Th>{t('colApprovedBy')}</Th>
                <Th>{t('colPeriod')}</Th>
                <Th>{t('colStaff')}</Th>
                <Th className="pr-5">{t('colActions')}</Th>
              </tr>
            </thead>
            <tbody>
              {closedRows.map((g) => {
                const end = g.closedAt ?? g.expiresAt;
                const start = g.approvedAt ?? g.requestedAt;
                return (
                  <Tr key={g.grantId}>
                    <Td className="pl-5">{customerCell(g)}</Td>
                    <Td className="whitespace-normal">{caseLabel(g)}</Td>
                    <Td>{scope(g)}</Td>
                    <Td>{g.approvedByName ?? '–'}</Td>
                    <Td className="text-fg-2">
                      {`${formatDate(start, locale).replace(/ \d{4}$/, '')} ${formatTime(start, locale)} – ${formatDate(end, locale).replace(/ \d{4}$/, '')} ${formatTime(end, locale)}`}
                      {g.state !== 'expired' ? ` · ${t('ended')}` : ''}
                    </Td>
                    <Td>{staffCell(g)}</Td>
                    <Td className="pr-5">
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{g.actions}</span>
                        <span aria-hidden>·</span>
                        <Link
                          href={`/platform/customers/${g.tenantId}?tab=log`}
                          className="text-fg-1"
                        >
                          {t('seeLog')}
                        </Link>
                      </span>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="m-0 text-meta text-fg-2">{t('footer')}</p>
    </PageBody>
  );
}
