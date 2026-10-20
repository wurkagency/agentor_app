import type { Status } from '@agentor/core';
import { formatDate, formatDateTime, formatRelative, formatTime, type Locale } from '@agentor/i18n';
import { StatusPill, cn } from '@agentor/ui';
import {
  ChipGroup,
  ExpandCard,
  KV,
  MobileCallout,
  MobileCard,
  MobileEmpty,
  MobileShell,
  Row,
  RowIcon,
  RowLink,
  SectionHeading,
} from '@agentor/ui/mobile';
import { CircleCheck, CircleX, Clock, Lock, MessageSquare, Unplug, Workflow } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { initials } from '@/server/platform-data';
import {
  CustomerSheets,
  CustomerTopActions,
  GrantButtons,
  type MobileCustomer,
} from './mobile-actions';

export type CustomerTab = 'overview' | 'flows' | 'cases' | 'log' | 'notes';

export interface CustomerMobileProps {
  customer: MobileCustomer & {
    status: string;
    statusLabel: string;
    /** "CVR 12345678 · Business · kunde siden 2. sep. 2026". */
    facts: string;
    plan: string;
    flows: number;
    brokenConnections: number;
    openFailures: number;
    requiresApproval: boolean;
  };
  tab: CustomerTab;
  openRequest: boolean;
  created: { text: string; ok: boolean } | null;
  active: {
    expiresAt: Date;
    approvedByName: string | null;
    caseRef: string;
    scope: 'view' | 'help';
  } | null;
  pendingSince: Date | null;
  contacts: { role: string; name: string; email: string }[];
  broken: { id: string; name: string }[];
  flows: { id: string; name: string; status: Status; openFailures: number }[];
  cases: {
    id: string;
    number: number;
    title: string;
    status: string;
    assigneeName: string | null;
    updatedAt: Date;
  }[];
  log: {
    at: Date;
    actorName: string;
    actorKind: string;
    action: string;
    after: Record<string, unknown> | null;
  }[];
  notes: { id: string; authorName: string; body: string; pinned: boolean; createdAt: Date }[];
}

const LOG_PREVIEW = 4;

/**
 * MP08 Kunde (P2): the customer, the access state with "Åbn kundens app", then Oversigt (Kræver
 * handling, Kunde og kontakt, the latest access log), Flows, Sager, Adgangslog and Noter as chips.
 * Contacts, flows and the customer's own problems only while this staff member holds an active
 * grant (decision 16); without one only the counts from P1.
 */
export async function CustomerMobile(p: CustomerMobileProps) {
  const t = await getTranslations('mobile.customer');
  const tp = await getTranslations('platform.customer');
  const ts = await getTranslations('status');
  const tcase = await getTranslations('platform.case');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const c = p.customer;
  const href = (tab: CustomerTab) => `?tab=${tab}`;

  const left = (until: Date) => {
    const ms = Math.max(0, until.getTime() - now.getTime());
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return h > 0 ? t('leftHm', { h, m }) : t('leftM', { m });
  };
  const actionLabel = (a: string) => {
    const key = `log.${a.replace('.', '_')}`;
    return tp.has(key as 'log.support_requested') ? tp(key as 'log.support_requested') : a;
  };
  const logRow = (r: CustomerMobileProps['log'][number], i: number) => (
    <Row
      key={i}
      className={cn(r.actorKind === 'support' && 'bg-navy-tint')}
      leading={
        <span className="w-10 flex-none font-mono text-meta tabular">
          {formatTime(r.at, locale)}
        </span>
      }
      title={actionLabel(r.action)}
      meta={[
        r.actorKind === 'support' ? r.actorName : `${r.actorName} (${tp('customerRole')})`,
        r.at.toDateString() === now.toDateString() ? null : formatDate(r.at, locale),
        r.after?.caseRef,
        r.after?.hours ? tp('hoursShort', { count: Number(r.after.hours) }) : null,
      ]
        .filter(Boolean)
        .map(String)
        .join(' · ')}
    />
  );

  const callout = p.active ? (
    <MobileCallout
      tone="ok"
      icon={Clock}
      title={t('grantTitle', { when: formatDateTime(p.active.expiresAt, locale) })}
      actions={<GrantButtons customer={c} />}
    >
      {t('grantMeta', {
        left: left(p.active.expiresAt),
        by: p.active.approvedByName ?? t('autoApproved'),
        case: p.active.caseRef,
        scope: tp(`scope.${p.active.scope}`),
      })}
    </MobileCallout>
  ) : c.grant.kind === 'pending' && p.pendingSince ? (
    <MobileCallout tone="warn" icon={Clock} title={t('pendingTitle')}>
      {t('pendingMeta', { when: formatRelative(p.pendingSince, now, locale) })}
    </MobileCallout>
  ) : c.grant.kind === 'direct' ? (
    <MobileCallout
      tone="info"
      icon={Lock}
      title={t('noGrantTitle')}
      actions={<GrantButtons customer={c} />}
    >
      {t('directBody')}
    </MobileCallout>
  ) : (
    <MobileCallout
      tone="info"
      icon={Lock}
      title={t('noGrantTitle')}
      actions={<GrantButtons customer={c} />}
    >
      {t('noGrantBody')}
    </MobileCallout>
  );

  const owner = p.contacts.find((x) => x.role === 'owner');

  return (
    <CustomerSheets customer={c} openRequest={p.openRequest}>
      <MobileShell
        topBar={
          <PlatformTopBar
            back="/platform/customers"
            title={c.name}
            subtitle={t('subtitle')}
            actions={<CustomerTopActions name={c.name} />}
          />
        }
      >
        {p.created && (
          <MobileCallout
            tone={p.created.ok ? 'info' : 'warn'}
            icon={CircleCheck}
            title={p.created.text}
          />
        )}
        <MobileCard>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="grid size-10 flex-none place-items-center rounded-sm border border-border bg-bg-base text-micro font-semibold box-border">
              <span role="img" aria-label={c.name}>
                {initials(c.name)}
              </span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col leading-snug">
              <strong className="text-body">{c.name}</strong>
              <span className="text-meta font-medium text-fg-2">{c.facts}</span>
            </span>
            {c.status !== 'none' && (
              <StatusPill status={c.status as Status}>{c.statusLabel}</StatusPill>
            )}
          </div>
        </MobileCard>
        {callout}
        <ChipGroup
          label={tp('tabs')}
          value={p.tab}
          linkAs={Link}
          items={[
            { key: 'overview', label: tp('tab.overview'), href: href('overview') },
            { key: 'flows', label: t('tabFlows', { count: c.flows }), href: href('flows') },
            { key: 'cases', label: t('tabCases', { count: p.cases.length }), href: href('cases') },
            { key: 'log', label: tp('tab.log'), href: href('log') },
            { key: 'notes', label: t('tabNotes', { count: p.notes.length }), href: href('notes') },
          ]}
        />

        {p.tab === 'overview' && (
          <>
            <SectionHeading>{tp('needsAction')}</SectionHeading>
            {!p.active ? (
              <MobileCard>
                <p className="m-0 px-4 py-3.5 text-table text-fg-2">
                  {tp('needsActionCounts', {
                    broken: c.brokenConnections,
                    failures: c.openFailures,
                  })}
                </p>
              </MobileCard>
            ) : p.broken.length === 0 && p.flows.every((f) => !NEEDS.includes(f.status)) ? (
              <MobileCard>
                <p className="m-0 px-4 py-3.5 text-table text-fg-2">{tp('allRunning')}</p>
              </MobileCard>
            ) : (
              <MobileCard>
                {p.broken.map((b) => (
                  <Row
                    key={b.id}
                    leading={<RowIcon icon={Unplug} tone="error" />}
                    title={tp('connectionBroken', { name: b.name })}
                    meta={tp('onlyCustomer')}
                  />
                ))}
                {p.flows
                  .filter((f) => NEEDS.includes(f.status))
                  .map((f) => (
                    <Row
                      key={f.id}
                      leading={
                        <RowIcon icon={CircleX} tone={f.status === 'warn' ? 'warn' : 'error'} />
                      }
                      title={f.name}
                      meta={tp('openFailures', { count: f.openFailures })}
                      trailing={
                        <StatusPill status={f.status} compact>
                          {ts(f.status)}
                        </StatusPill>
                      }
                    />
                  ))}
              </MobileCard>
            )}
            <ExpandCard
              title={t('contactTitle')}
              meta={owner ? t('contactMeta', { name: owner.name }) : t('contactHidden')}
            >
              {p.contacts.map((x) => (
                <KV
                  key={`${x.role}-${x.email}`}
                  k={tp(`contact.${x.role === 'owner' ? 'owner' : 'admin'}`)}
                >
                  {`${x.name} · ${x.email}`}
                </KV>
              ))}
              <KV k={tp('plan')}>{c.plan}</KV>
              <KV k={tp('flows')}>{c.flows}</KV>
              <KV k={tp('approval')}>
                {c.requiresApproval ? tp('approvalRequired') : tp('approvalNot')}
              </KV>
              {!p.active && (
                <p className="m-0 pt-2 text-meta font-medium text-fg-2">{tp('contactsHidden')}</p>
              )}
            </ExpandCard>
            <SectionHeading>{tp('accessLog')}</SectionHeading>
            {p.log.length === 0 ? (
              <MobileCard>
                <p className="m-0 px-4 py-3.5 text-table text-fg-2">{tp('logEmptyBody')}</p>
              </MobileCard>
            ) : (
              <MobileCard>
                {p.log.slice(0, LOG_PREVIEW).map(logRow)}
                {p.log.length > LOG_PREVIEW && (
                  <RowLink href={href('log')} linkAs={Link} title={t('showAllLog')} />
                )}
              </MobileCard>
            )}
          </>
        )}

        {p.tab === 'flows' &&
          (!p.active ? (
            <MobileCard>
              <p className="m-0 px-4 py-3.5 text-table text-fg-2">{t('flowsHidden')}</p>
            </MobileCard>
          ) : p.flows.length === 0 ? (
            <MobileEmpty icon={Workflow} title={t('flowsEmpty')} />
          ) : (
            <MobileCard>
              {p.flows.map((f) => (
                <Row
                  key={f.id}
                  title={f.name}
                  meta={tp('openFailures', { count: f.openFailures })}
                  trailing={
                    <StatusPill status={f.status} compact>
                      {ts(f.status)}
                    </StatusPill>
                  }
                />
              ))}
            </MobileCard>
          ))}

        {p.tab === 'cases' &&
          (p.cases.length === 0 ? (
            <MobileEmpty icon={MessageSquare} title={tp('noCases')}>
              {tp('noCasesBody')}
            </MobileEmpty>
          ) : (
            <MobileCard>
              {p.cases.map((x) => (
                <RowLink
                  key={x.id}
                  href={`/platform/cases/${x.id}`}
                  linkAs={Link}
                  title={`#${x.number} · ${x.title}`}
                  meta={[
                    tcase(`status.${x.status}` as 'status.new'),
                    x.assigneeName,
                    formatRelative(x.updatedAt, now, locale),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))}
            </MobileCard>
          ))}

        {p.tab === 'log' && (
          <>
            <p className="m-0 px-1 text-meta font-medium text-fg-2">{tp('alsoInAudit')}</p>
            {p.log.length === 0 ? (
              <MobileEmpty icon={Lock} title={tp('logEmpty')}>
                {tp('logEmptyBody')}
              </MobileEmpty>
            ) : (
              <MobileCard>{p.log.map(logRow)}</MobileCard>
            )}
          </>
        )}

        {p.tab === 'notes' && (
          <>
            <p className="m-0 px-1 text-meta font-medium text-fg-2">{tp('notesHelp')}</p>
            {p.notes.length === 0 ? (
              <MobileCard>
                <p className="m-0 px-4 py-3.5 text-table text-fg-2">{tp('notesEmpty')}</p>
              </MobileCard>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {p.notes.map((n) => (
                  <li key={n.id} className="rounded-bubble bg-note-bg px-4 py-3 text-table">
                    <span className="mb-1 flex flex-wrap items-center gap-x-2 text-meta text-fg-2">
                      <strong className="text-fg-1">{n.authorName}</strong>
                      {formatDate(n.createdAt, locale)}
                      {n.pinned && <span className="font-semibold">· {tp('pinned')}</span>}
                    </span>
                    {n.body}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </MobileShell>
    </CustomerSheets>
  );
}

const NEEDS: Status[] = ['broken', 'error', 'warn'];
