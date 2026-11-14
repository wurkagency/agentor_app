'use client';

import type { Status } from '@agentor/core';
import { formatRelative, type Locale } from '@agentor/i18n';
import {
  Button,
  Card,
  EmptyState,
  FilterChip,
  Icon,
  SearchInput,
  StatusPill,
  Table,
  Td,
  Th,
  Tr,
  cn,
} from '@agentor/ui';
import { CircleCheck, Clock, Eye, Lock, Users, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { openAsSuperadminAction, openSupportViewAction } from '@/app/platform/actions';
import { FilterMenu } from '../filter-menu';
import { RequestAccessDialog, type AccessTarget } from './request-access-dialog';
import { useNow } from '@/components/now';

export interface CustomerItem {
  tenantId: string;
  name: string;
  initials: string;
  cvr: string | null;
  plan: string;
  status: 'broken' | 'error' | 'warn' | 'ok' | 'paused' | 'none';
  flows: number;
  errorsToday: number;
  lastRunAt: string | null;
  requiresApproval: boolean;
  grant: { id: string; state: string; expiresAt: string } | null;
  mineCases: boolean;
  cases: { id: string; label: string }[];
}

const SEVERITY: Record<CustomerItem['status'], number> = {
  broken: 0,
  error: 1,
  warn: 2,
  ok: 4,
  paused: 5,
  none: 6,
};

/** Kundeliste (P1): search, filters and the access action per customer. */
export function CustomersTable({
  items,
  initialQuery,
  superadmin = false,
}: {
  items: CustomerItem[];
  initialQuery: string;
  /** Superadmin opens any customer's app directly. */
  superadmin?: boolean;
}) {
  const t = useTranslations('platform.customers');
  const ts = useTranslations('status');
  const locale = useLocale() as Locale;
  const [q, setQ] = useState(initialQuery);
  const [attention, setAttention] = useState(false);
  const [plan, setPlan] = useState('all');
  const [access, setAccess] = useState('all');
  const [mine, setMine] = useState(false);
  const [target, setTarget] = useState<AccessTarget | null>(null);
  const [pending, start] = useTransition();
  const now = useNow();

  const plans = [...new Set(items.map((i) => i.plan))].sort();
  const needsAttention = items.filter((i) => i.status === 'broken' || i.status === 'error');
  const rows = useMemo(
    () =>
      items
        .filter((i) => {
          const query = q.trim().toLowerCase();
          if (query && !`${i.name} ${i.cvr ?? ''}`.toLowerCase().includes(query)) return false;
          if (attention && i.status !== 'broken' && i.status !== 'error') return false;
          if (plan !== 'all' && i.plan !== plan) return false;
          if (access === 'active' && i.grant?.state !== 'active') return false;
          if (access === 'pending' && i.grant?.state !== 'pending') return false;
          if (access === 'none' && (i.grant?.state === 'active' || i.grant?.state === 'pending'))
            return false;
          if (mine && !i.mineCases) return false;
          return true;
        })
        .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || b.errorsToday - a.errorsToday),
    [items, q, attention, plan, access, mine],
  );

  const accessCell = (i: CustomerItem) => {
    const g = i.grant;
    if (g?.state === 'active')
      return (
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Icon icon={CircleCheck} size={16} className="text-ok-fg" />
          {t('grantActive', { when: formatRelative(new Date(g.expiresAt), now, locale) })}
        </span>
      );
    if (g?.state === 'pending')
      return (
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Icon icon={Clock} size={16} className="text-warn-fg" />
          {t('grantPending')}
        </span>
      );
    return (
      <span className="inline-flex items-center gap-1.5 text-fg-2">
        <Icon icon={Lock} size={16} />
        {g?.state === 'expired' || g?.state === 'ended'
          ? t('grantExpired', { when: formatRelative(new Date(g.expiresAt), now, locale) })
          : t('grantNone')}
      </span>
    );
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          aria-label={t('search')}
          placeholder={t('search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full md:w-96"
        />
        <FilterChip active={attention} onClick={() => setAttention(!attention)}>
          {t('attention', { count: needsAttention.length })}
          {attention && <Icon icon={X} size={14} />}
        </FilterChip>
        <FilterMenu
          label={t('plan')}
          allLabel={t('allPlans')}
          value={plan === 'all' ? null : plan}
          onChange={(v) => setPlan(v ?? 'all')}
          options={plans.map((p) => ({ value: p, label: p }))}
        />
        <FilterMenu
          label={t('access')}
          allLabel={t('accessAll')}
          value={access === 'all' ? null : access}
          onChange={(v) => setAccess(v ?? 'all')}
          options={[
            { value: 'active', label: t('accessActive') },
            { value: 'pending', label: t('accessPending') },
            { value: 'none', label: t('accessNone') },
          ]}
        />
        <FilterChip active={mine} onClick={() => setMine(!mine)}>
          {t('mineCases')}
        </FilterChip>
        <span className="ml-auto text-meta text-fg-2">{t('sorted')}</span>
      </div>
      <Card padding="none" className="overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState icon={Users} title={t('empty')}>
            {t('emptyBody')}
          </EmptyState>
        ) : (
          <Table aria-label={t('title')}>
            <thead>
              <tr>
                <Th className="pl-5">{t('colCustomer')}</Th>
                <Th>{t('colPlan')}</Th>
                <Th>{t('colStatus')}</Th>
                <Th numeric>{t('colFlows')}</Th>
                <Th numeric>{t('colErrors')}</Th>
                <Th>{t('colLastRun')}</Th>
                <Th>{t('colAccess')}</Th>
                <Th className="pr-5">
                  <span className="sr-only">{t('colAction')}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <Tr key={i.tenantId}>
                  <Td className="pl-5">
                    <Link
                      href={`/platform/customers/${i.tenantId}`}
                      className="flex items-center gap-3 text-fg-1 no-underline"
                    >
                      <span className="grid size-8 flex-none place-items-center rounded-sm bg-bg-base text-micro font-semibold shadow-ring-chip">
                        {i.initials}
                      </span>
                      <span className="flex flex-col leading-tight">
                        <span className="font-semibold">{i.name}</span>
                        <span className="text-meta text-fg-2">{i.cvr ? `CVR ${i.cvr}` : '–'}</span>
                      </span>
                    </Link>
                  </Td>
                  <Td>{i.plan}</Td>
                  <Td>
                    {i.status === 'none' ? (
                      <span className="text-fg-2">{t('noFlows')}</span>
                    ) : (
                      <StatusPill status={i.status as Status}>{ts(i.status)}</StatusPill>
                    )}
                  </Td>
                  <Td numeric>{i.flows}</Td>
                  <Td numeric className={cn(i.errorsToday > 0 && 'font-semibold text-error-fg')}>
                    {i.errorsToday}
                  </Td>
                  <Td className="text-fg-2">
                    {i.lastRunAt ? formatRelative(new Date(i.lastRunAt), now, locale) : '–'}
                  </Td>
                  <Td>{accessCell(i)}</Td>
                  <Td className="pr-5 text-right">
                    {i.grant?.state === 'active' ? (
                      <Button
                        variant="primary"
                        size="s"
                        loading={pending}
                        onClick={() =>
                          start(async () => void (await openSupportViewAction(i.grant!.id)))
                        }
                      >
                        <Icon icon={Eye} size={14} />
                        {t('openAsSupport')}
                      </Button>
                    ) : superadmin ? (
                      <Button
                        variant="primary"
                        size="s"
                        loading={pending}
                        onClick={() =>
                          start(async () => void (await openAsSuperadminAction(i.tenantId)))
                        }
                      >
                        <Icon icon={Eye} size={14} />
                        {t('openApp')}
                      </Button>
                    ) : i.grant?.state === 'pending' ? (
                      <Button variant="secondary" size="s" disabled>
                        {t('awaiting')}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="s"
                        onClick={() =>
                          setTarget({
                            tenantId: i.tenantId,
                            name: i.name,
                            cvr: i.cvr,
                            requiresApproval: i.requiresApproval,
                            cases: i.cases,
                          })
                        }
                      >
                        {t('requestAccess')}
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {target && (
        <RequestAccessDialog
          key={target.tenantId}
          target={target}
          open
          onOpenChange={(o) => !o && setTarget(null)}
        />
      )}
    </>
  );
}
