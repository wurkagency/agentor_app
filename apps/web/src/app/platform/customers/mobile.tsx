import { STATUSES, type Status } from '@agentor/core';
import { formatRelative, type Locale } from '@agentor/i18n';
import { StatusPill } from '@agentor/ui';
import {
  ChipGroup,
  KpiStrip,
  type KpiStripItem,
  MobileCard,
  MobileEmpty,
  MobileLogo,
  MobileShell,
  RowLink,
} from '@agentor/ui/mobile';
import { Search, Users } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { CustomerItem } from '@/components/platform/customers-table';
import { PlatformTopBar } from '@/components/mobile/chrome';

/**
 * MP01 Kunder: search and filter; each customer shows only name, plan or access state, errors
 * and overall status, as on desktop P1. No customer data without a grant (decision 16).
 */
export async function CustomersMobile({
  items,
  query,
  filter,
  kpis,
}: {
  items: CustomerItem[];
  query: string;
  filter: 'all' | 'attention';
  kpis: KpiStripItem[];
}) {
  const t = await getTranslations('mobile.platform.customers');
  const ts = await getTranslations('status');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const q = query.trim().toLowerCase();
  const matches = items.filter(
    (c) => !q || c.name.toLowerCase().includes(q) || (c.cvr ?? '').includes(q.replace(/\s/g, '')),
  );
  const attention = matches.filter((c) => ['error', 'broken', 'warn'].includes(c.status));
  const shown = filter === 'attention' ? attention : matches;
  const href = (f: string) => {
    const p = new URLSearchParams();
    if (q) p.set('q', query);
    if (f === 'attention') p.set('filter', 'attention');
    return `/platform/customers${p.size ? `?${p}` : ''}`;
  };

  return (
    <MobileShell topBar={<PlatformTopBar />}>
      <KpiStrip label={t('kpiLabel')} items={kpis} />
      <form action="/platform/customers" role="search" className="flex">
        <label className="flex h-11 flex-1 items-center gap-2 rounded-full bg-surface px-4 text-fg-2 shadow-sm">
          <Search aria-hidden width={18} height={18} />
          <span className="sr-only">{t('searchLabel')}</span>
          <input
            name="q"
            type="search"
            defaultValue={query}
            placeholder={t('search')}
            className="min-w-0 flex-1 border-0 bg-transparent font-sans text-m-input text-fg-1 outline-none"
          />
          {filter === 'attention' && <input type="hidden" name="filter" value="attention" />}
        </label>
      </form>
      <ChipGroup
        label={t('filterLabel')}
        value={filter}
        linkAs={Link}
        items={[
          { key: 'all', label: t('all', { count: matches.length }), href: href('all') },
          {
            key: 'attention',
            label: t('attention', { count: attention.length }),
            href: href('attention'),
          },
        ]}
      />
      {shown.length === 0 ? (
        <MobileEmpty icon={Users} title={t('empty')}>
          {t('emptyBody')}
        </MobileEmpty>
      ) : (
        <MobileCard>
          {shown.map((c) => {
            const access = c.grant
              ? c.grant.state === 'active'
                ? t('grantActive', {
                    when: formatRelative(new Date(c.grant.expiresAt), now, locale),
                  })
                : c.grant.state === 'pending'
                  ? t('grantPending')
                  : t('grantNone')
              : t('grantNone');
            return (
              <RowLink
                key={c.tenantId}
                href={`/platform/customers/${c.tenantId}`}
                linkAs={Link}
                leading={<MobileLogo name={c.name} size={32} />}
                title={c.name}
                meta={[access, c.errorsToday ? t('errors', { count: c.errorsToday }) : null]
                  .filter(Boolean)
                  .join(' · ')}
                // No flows yet ("none"): no status to show, just the chevron.
                {...((STATUSES as readonly string[]).includes(c.status)
                  ? {
                      trailing: <StatusPill status={c.status as Status}>{ts(c.status)}</StatusPill>,
                    }
                  : {})}
              />
            );
          })}
        </MobileCard>
      )}
    </MobileShell>
  );
}
