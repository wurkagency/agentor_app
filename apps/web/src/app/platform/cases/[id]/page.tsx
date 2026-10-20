import type { Status } from '@agentor/core';
import { getCase, getTimer, isUuid, listStaff } from '@agentor/db';
import { formatDate, formatTime, type Locale } from '@agentor/i18n';
import { Card, CardHeader, Icon, StatusPill } from '@agentor/ui';
import { ArrowLeft, Check, CircleCheck, Mail } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ButtonLink } from '@/components/button-link';
import { OpenAppButton, RequestAccessButton } from '@/components/platform/access-controls';
import { CaseComposer } from '@/components/platform/case-composer';
import { CaseMetaBar } from '@/components/platform/case-meta-bar';
import { CaseTimeline } from '@/components/platform/case-timeline';
import { TimePanel } from '@/components/platform/time-panel';
import { PageBody } from '@/components/shell/secondary-nav';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';
import { customersFor, initials, planNames } from '@/server/platform-data';
import { Responsive } from '@agentor/ui/mobile';
import { CaseMobile } from './mobile';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('platform.case');
  return { title: isUuid(id) ? t('title') : t('title') };
}

/** Supportsag (S3): the timeline, status and ownership, time and the customer at a glance. */
export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { actor } = await requireStaff();
  const data = await getCase(db(), actor.userId, id);
  if (!data) notFound();
  const t = await getTranslations('platform.case');
  const ts = await getTranslations('status');
  const locale = (await getLocale()) as Locale;
  const c = data.case;
  const [customers, staff, timer, plans] = await Promise.all([
    customersFor(actor.userId),
    listStaff(db(), actor),
    getTimer(db(), actor.userId),
    planNames(),
  ]);
  const customer = customers.find((x) => x.tenantId === c.tenantId);
  const plan = (customer?.planId && plans.get(customer.planId)) || '–';
  const grant = customer?.myGrant;
  const active = grant?.state === 'active' ? grant : null;
  const created = c.createdAt;
  const creator = c.createdVia === 'customer' ? t('byCustomer') : c.createdByName;

  const desktop = (
    <PageBody>
      <Link
        href="/platform/cases"
        className="inline-flex items-center gap-1.5 text-table text-fg-2 no-underline"
      >
        <Icon icon={ArrowLeft} size={16} />
        {t('back')}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-1">
          <p className="m-0 font-mono text-mono text-fg-2">
            #{c.number} ·{' '}
            {t('created', {
              when: `${formatDate(created, locale)} ${formatTime(created, locale)}`,
              by: creator,
            })}
          </p>
          <h1 className="m-0 text-page">{c.title}</h1>
        </div>
        <span className="flex items-center gap-3">
          <ButtonLink variant="secondary" href="#composer">
            <Icon icon={Mail} size={16} />
            {t('replyCustomer')}
          </ButtonLink>
          {c.status !== 'resolved' && c.status !== 'closed' ? (
            <ButtonLink variant="primary" size="l" href={`/platform/cases/${c.id}/resolve`}>
              <Icon icon={Check} size={16} />
              {t('markResolved')}
            </ButtonLink>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-table font-semibold text-ok-fg">
              <Icon icon={CircleCheck} size={16} />
              {t(`status.${c.status}`)}
            </span>
          )}
        </span>
      </div>
      <CaseMetaBar
        caseId={c.id}
        status={c.status}
        priority={c.priority}
        assigneeId={c.assigneeId}
        category={c.category}
        dueAt={c.dueAt?.toISOString() ?? null}
        staff={staff.filter((s) => !s.disabled).map((s) => ({ id: s.userId, name: s.name }))}
        followers={data.followers.map((f) => f.name)}
        following={data.followers.some((f) => f.userId === actor.userId)}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-5 lg:col-span-2">
          <CaseTimeline
            events={data.events.map((e) => ({
              id: e.id,
              kind: e.kind,
              authorName: e.authorName,
              body: e.body,
              meta: e.meta,
              createdAt: e.createdAt.toISOString(),
            }))}
          />
          <div id="composer">
            <CaseComposer caseId={c.id} defaultKind="reply" />
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <TimePanel
            caseId={c.id}
            caseLabel={`#${c.number} · ${customer?.name ?? ''}`}
            plan={plan}
            timer={
              timer ? { caseId: timer.caseId, startedAt: timer.startedAt.toISOString() } : null
            }
            entries={data.time.map((e) => ({
              id: e.id,
              kind: e.kind,
              source: e.source,
              staffName: e.staffName,
              description: e.description,
              minutes: e.minutes,
              createdAt: e.createdAt.toISOString(),
              billable: e.billable,
            }))}
          />
          {customer && (
            <Card className="flex flex-col gap-3">
              <CardHeader
                title={t('customer')}
                action={
                  <Link
                    href={`/platform/customers/${customer.tenantId}`}
                    className="text-table font-semibold text-fg-1"
                  >
                    {t('open')}
                  </Link>
                }
              />
              <span className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-sm bg-bg-base text-table font-semibold shadow-ring-chip">
                  {initials(customer.name)}
                </span>
                <span className="flex flex-col">
                  <span className="font-semibold">{customer.name}</span>
                  <span className="text-meta text-fg-2">{plan}</span>
                </span>
              </span>
              <span className="flex flex-wrap gap-2">
                {customer.status !== 'none' && customer.status !== 'ok' && (
                  <StatusPill status={customer.status as Status}>{ts(customer.status)}</StatusPill>
                )}
                {customer.openFailures > 0 && (
                  <StatusPill status="error">
                    {t('failures', { count: customer.openFailures })}
                  </StatusPill>
                )}
              </span>
              {active ? (
                <div className="flex items-center justify-between gap-3 rounded-sm bg-ok-bg px-3 py-2 text-table">
                  <span className="flex items-center gap-2">
                    <Icon icon={CircleCheck} size={16} className="text-ok-fg" />
                    {t('grantUntil', {
                      when: `${formatDate(active.expiresAt, locale)} ${formatTime(active.expiresAt, locale)}`,
                    })}
                  </span>
                  <OpenAppButton grantId={active.grantId} size="s" />
                </div>
              ) : grant?.state === 'pending' ? (
                <p className="m-0 text-table text-fg-2">{t('grantPending')}</p>
              ) : (
                <RequestAccessButton
                  variant="secondary"
                  defaultCaseId={c.id}
                  target={{
                    tenantId: customer.tenantId,
                    name: customer.name,
                    cvr: customer.cvr,
                    requiresApproval: customer.requiresApproval,
                    cases: [{ id: c.id, label: `#${c.number} · ${c.title}` }],
                  }}
                />
              )}
              {data.pinnedNotes.map((n) => (
                <div key={n.id} className="rounded-sm bg-note-bg px-3 py-2 text-table">
                  <p className="m-0 mb-1 text-meta font-semibold">{t('pinnedNote')}</p>
                  {n.body}
                </div>
              ))}
            </Card>
          )}
          {data.previous.length > 0 && (
            <Card className="flex flex-col gap-2">
              <CardHeader title={t('previous')} />
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {data.previous.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 text-table">
                    <Link href={`/platform/cases/${p.id}`} className="truncate text-fg-1">
                      #{p.number} {p.title}
                    </Link>
                    <span className="flex-none text-meta text-fg-2">{t(`status.${p.status}`)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </PageBody>
  );
  const timerView = timer
    ? { caseId: timer.caseId, startedAt: timer.startedAt.toISOString() }
    : null;
  return (
    <Responsive
      desktop={desktop}
      mobile={
        <CaseMobile
          c={{ ...c, tenantName: customer?.name ?? '' }}
          events={data.events}
          plan={customer?.planId ? plan : null}
          timer={timerView}
        />
      }
    />
  );
}
