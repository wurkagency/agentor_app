import type { Status } from '@agentor/core';
import {
  customerAccessLog,
  customerContacts,
  isUuid,
  listCases,
  listCustomerNotes,
} from '@agentor/db';
import { formatDate, formatDateTime, formatRelative, formatTime, type Locale } from '@agentor/i18n';
import {
  Card,
  Banner,
  CardHeader,
  EmptyState,
  Icon,
  KeyValueList,
  StatusPill,
  Table,
  Td,
  Th,
  Tr,
  cn,
} from '@agentor/ui';
import { ArrowLeft, CircleCheck, Clock, Lock, MessageSquare, ShieldCheck } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LinkTabs } from '@/components/link-tabs';
import {
  GrantActions,
  NoteButton,
  OpenAppButton,
  OpenDirectButton,
  RequestAccessButton,
} from '@/components/platform/access-controls';
import { CaseComposer } from '@/components/platform/case-composer';
import { PageBody } from '@/components/shell/secondary-nav';
import { flowViews, connectionMap, NEEDS_ACTION } from '@/server/flows';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';
import { customersFor, initials, planNames, tenantNames } from '@/server/platform-data';

const TABS = ['overview', 'cases', 'log', 'notes'] as const;

/**
 * Kundedetalje (P2): name, plan and status for everyone; contacts and the customer's own
 * "Kræver handling" only while this staff member holds an active grant there.
 */
export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; created?: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { actor } = await requireStaff();
  const customer = (await customersFor(actor.userId)).find((c) => c.tenantId === id);
  if (!customer) notFound();
  const sp = await searchParams;
  const tab = TABS.includes(sp.tab as (typeof TABS)[number])
    ? (sp.tab as (typeof TABS)[number])
    : 'overview';
  const t = await getTranslations('platform.customer');
  const ts = await getTranslations('status');
  const tcase = await getTranslations('platform.case');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const grant = customer.myGrant;
  const active = grant?.state === 'active' ? grant : null;
  const [plans, names, log, notes] = await Promise.all([
    planNames(),
    tenantNames(actor.userId),
    customerAccessLog(db(), actor.userId, id),
    listCustomerNotes(db(), actor.userId, id),
  ]);
  const cases = await listCases(db(), actor.userId, names, { tenantId: id });
  const openCases = cases.filter(
    (c) => c.status === 'new' || c.status === 'in_progress' || c.status === 'waiting',
  );
  const contacts = active ? await customerContacts(db(), actor.userId, id) : [];
  const views = active ? await flowViews(id, actor.userId, 7) : [];
  const conns = active ? await connectionMap(id, actor.userId) : new Map();
  const broken = [...conns.values()].filter((c) => c.status === 'broken');
  const needing = views.filter((v) => NEEDS_ACTION.includes(v.status));
  const latest = openCases[0];
  const plan = (customer.planId && plans.get(customer.planId)) || '–';
  const target = {
    tenantId: id,
    name: customer.name,
    cvr: customer.cvr,
    requiresApproval: customer.requiresApproval,
    cases: openCases.map((c) => ({ id: c.id, label: `#${c.number} · ${c.title}` })),
  };
  const statusLabel =
    customer.status === 'none'
      ? t('noFlows')
      : customer.status === 'broken'
        ? t('brokenCount', { count: customer.brokenConnections })
        : ts(customer.status);
  const actionLabel = (a: string) => {
    const key = `log.${a.replace('.', '_')}`;
    return t.has(key as 'log.support_requested') ? t(key as 'log.support_requested') : a;
  };

  const created =
    sp.created === '1' ? t('created') : sp.created === 'nomail' ? t('createdNoMail') : null;
  return (
    <PageBody>
      {created && <Banner tone={sp.created === '1' ? 'info' : 'warn'}>{created}</Banner>}
      <Link
        href="/platform/customers"
        className="inline-flex items-center gap-1.5 text-table text-fg-2 no-underline"
      >
        <Icon icon={ArrowLeft} size={16} />
        {t('back')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-center gap-4">
          <span className="grid size-12 place-items-center rounded-sm bg-bg-base text-body font-semibold shadow-ring-chip">
            {initials(customer.name)}
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="m-0 text-page">{customer.name}</h1>
            <p className="m-0 flex flex-wrap items-center gap-3 text-meta text-fg-2">
              {customer.status !== 'none' && (
                <StatusPill status={customer.status as Status}>{statusLabel}</StatusPill>
              )}
              <span>
                {[
                  customer.cvr ? `CVR ${customer.cvr}` : null,
                  plan,
                  t('since', { date: formatDate(customer.createdAt, locale) }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </p>
          </div>
        </div>
        <span className="flex items-center gap-3">
          <NoteButton tenantId={id} />
          {active ? (
            <OpenAppButton grantId={active.grantId} />
          ) : actor.role === 'superadmin' ? (
            <OpenDirectButton tenantId={id} />
          ) : grant?.state !== 'pending' ? (
            <RequestAccessButton target={target} />
          ) : null}
        </span>
      </div>

      {active ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-ok-bg px-4 py-3 text-table">
          <span className="flex items-start gap-2.5">
            <Icon icon={CircleCheck} size={16} className="mt-0.5 text-ok-fg" />
            <span>
              <strong>
                {t('grantActive', { when: formatDateTime(active.expiresAt, locale) })}
              </strong>{' '}
              {t('grantDetail', {
                left: formatRelative(active.expiresAt, now, locale),
                by: active.approvedByName ?? t('autoApproved'),
                case: active.caseRef,
                scope: t(`scope.${active.scope}`),
              })}
            </span>
          </span>
          <GrantActions tenantId={id} grantId={active.grantId} />
        </div>
      ) : grant?.state === 'pending' ? (
        <div className="flex items-center gap-2.5 rounded-md bg-warn-bg px-4 py-3 text-table">
          <Icon icon={Clock} size={16} className="text-warn-fg" />
          {t('grantPending', { when: formatRelative(grant.requestedAt, now, locale) })}
        </div>
      ) : (
        <div className="flex items-center gap-2.5 rounded-md bg-surface px-4 py-3 text-table shadow-sm">
          <Icon icon={Lock} size={16} className="text-fg-2" />
          {t('noGrant')}
        </div>
      )}

      <LinkTabs
        label={t('tabs')}
        active={tab}
        items={[
          { key: 'overview', href: `?tab=overview`, label: t('tab.overview') },
          { key: 'cases', href: `?tab=cases`, label: t('tab.cases', { count: cases.length }) },
          { key: 'log', href: `?tab=log`, label: t('tab.log') },
          { key: 'notes', href: `?tab=notes`, label: t('tab.notes', { count: notes.length }) },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="flex flex-col gap-4">
            <CardHeader title={t('customerCard')} />
            <KeyValueList
              items={[
                ...contacts.map((c) => ({
                  label: t(`contact.${c.role === 'owner' ? 'owner' : 'admin'}`),
                  value: `${c.name} · ${c.email}`,
                })),
                { label: t('plan'), value: plan },
                { label: t('flows'), value: String(customer.flows) },
                {
                  label: t('approval'),
                  value: customer.requiresApproval ? t('approvalRequired') : t('approvalNot'),
                },
              ]}
            />
            {!active && <p className="m-0 text-meta text-fg-2">{t('contactsHidden')}</p>}
          </Card>
          <Card className="flex flex-col gap-3">
            <CardHeader title={t('needsAction')} meta={active ? t('sameAsCustomer') : undefined} />
            {!active ? (
              <p className="m-0 text-table text-fg-2">
                {t('needsActionCounts', {
                  broken: customer.brokenConnections,
                  failures: customer.openFailures,
                })}
              </p>
            ) : broken.length === 0 && needing.length === 0 ? (
              <p className="m-0 text-table text-fg-2">{t('allRunning')}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0">
                {broken.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-col gap-0.5 border-t border-border py-3 first:border-0"
                  >
                    <span className="font-semibold">{t('connectionBroken', { name: c.name })}</span>
                    <span className="text-meta text-fg-2">{t('onlyCustomer')}</span>
                  </li>
                ))}
                {needing.map((v) => (
                  <li
                    key={v.id}
                    className="flex flex-col gap-0.5 border-t border-border py-3 first:border-0"
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      <StatusPill status={v.status} compact>
                        {ts(v.status)}
                      </StatusPill>
                      {v.name}
                    </span>
                    <span className="text-meta text-fg-2">
                      {t('openFailures', { count: v.openFailures })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="flex flex-col gap-3">
            {latest ? (
              <>
                <CardHeader
                  title={
                    <Link href={`/platform/cases/${latest.id}`} className="text-fg-1">
                      {t('caseTitle', { n: latest.number })}
                    </Link>
                  }
                  meta={latest.title}
                  action={
                    <span className="text-meta font-semibold">
                      {tcase(`status.${latest.status}`)}
                    </span>
                  }
                />
                <CaseComposer caseId={latest.id} compact />
              </>
            ) : (
              <EmptyState icon={MessageSquare} title={t('noCases')}>
                {t('noCasesBody')}
              </EmptyState>
            )}
          </Card>
        </div>
      )}

      {tab === 'cases' && (
        <Card padding="none" className="overflow-x-auto">
          {cases.length === 0 ? (
            <EmptyState icon={MessageSquare} title={t('noCases')}>
              {t('noCasesBody')}
            </EmptyState>
          ) : (
            <Table aria-label={t('tab.cases', { count: cases.length })}>
              <thead>
                <tr>
                  <Th className="pl-5">{t('colCase')}</Th>
                  <Th>{t('colTitle')}</Th>
                  <Th>{t('colStatus')}</Th>
                  <Th>{t('colAssignee')}</Th>
                  <Th className="pr-5">{t('colUpdated')}</Th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <Tr key={c.id}>
                    <Td className="pl-5 font-mono text-mono">#{c.number}</Td>
                    <Td>
                      <Link href={`/platform/cases/${c.id}`} className="font-semibold text-fg-1">
                        {c.title}
                      </Link>
                    </Td>
                    <Td>{tcase(`status.${c.status}`)}</Td>
                    <Td>{c.assigneeName ?? '–'}</Td>
                    <Td className="pr-5 text-fg-2">{formatRelative(c.updatedAt, now, locale)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'log' && (
        <Card padding="none" className="overflow-x-auto">
          <div className="flex items-center justify-between px-5 pb-2 pt-5">
            <h2 className="m-0 text-card">{t('accessLog')}</h2>
            <span className="text-meta text-fg-2">{t('alsoInAudit')}</span>
          </div>
          {log.length === 0 ? (
            <EmptyState icon={ShieldCheck} title={t('logEmpty')}>
              {t('logEmptyBody')}
            </EmptyState>
          ) : (
            <Table aria-label={t('accessLog')}>
              <thead>
                <tr>
                  <Th className="pl-5">{t('colTime')}</Th>
                  <Th>{t('colWho')}</Th>
                  <Th>{t('colAction')}</Th>
                  <Th className="pr-5">{t('colDetail')}</Th>
                </tr>
              </thead>
              <tbody>
                {log.map((r, i) => (
                  <Tr key={i} className={cn(r.actorKind === 'support' && 'bg-navy-tint')}>
                    <Td className="pl-5 tabular text-fg-2">
                      {formatDate(r.at, locale)} {formatTime(r.at, locale)}
                    </Td>
                    <Td>
                      {r.actorName}
                      {r.actorKind !== 'support' && (
                        <span className="text-fg-2"> ({t('customerRole')})</span>
                      )}
                    </Td>
                    <Td>{actionLabel(r.action)}</Td>
                    <Td className="whitespace-normal pr-5 text-fg-2">
                      {[
                        r.after?.caseRef,
                        r.after?.reason,
                        r.after?.hours ? t('hoursShort', { count: Number(r.after.hours) }) : null,
                      ]
                        .filter(Boolean)
                        .map(String)
                        .join(' · ')}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'notes' && (
        <Card className="flex flex-col gap-3">
          <CardHeader title={t('notesTitle')} meta={t('notesHelp')} />
          {notes.length === 0 ? (
            <p className="m-0 text-table text-fg-2">{t('notesEmpty')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {notes.map((n) => (
                <li key={n.id} className="rounded-sm bg-note-bg px-4 py-3 text-table">
                  <span className="mb-1 flex items-center gap-2 text-meta text-fg-2">
                    <strong className="text-fg-1">{n.authorName}</strong>
                    {formatDate(n.createdAt, locale)}
                    {n.pinned && <span className="font-semibold">· {t('pinned')}</span>}
                  </span>
                  {n.body}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </PageBody>
  );
}
