import { formatDate, formatTime, type Locale } from '@agentor/i18n';
import { Avatar } from '@agentor/ui';
import {
  BigButtonLink,
  ChipGroup,
  ExpandCard,
  KV,
  MobileEmpty,
  MobilePageTitle,
  MobileShell,
  TopBarAction,
} from '@agentor/ui/mobile';
import { Download, History } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AppTopBar } from '@/components/mobile/chrome';
import { describeObject } from './filters';
import { PeriodChip } from './period-chip';

export interface AuditEntryVM {
  id: string;
  createdAt: Date;
  actorKind: string;
  actorName: string | null;
  action: string;
  objectType: string;
  before: unknown;
  after: unknown;
  ip: string | null;
}

/**
 * MA32 Audit-log: one folding card per event (object, who, IP), chips for all or only support
 * access (`?group=support`) and the period, export in the top bar. Same query as D12-Auditlog.
 */
export async function AuditLogMobile({
  entries,
  query,
  nextHref,
  actionLabel,
}: {
  entries: AuditEntryVM[];
  /** The current filters without `before`. */
  query: Record<string, string>;
  nextHref: string | null;
  actionLabel: (action: string) => string;
}) {
  const t = await getTranslations('audit');
  const tm = await getTranslations('mobile.auditLog');
  const locale = (await getLocale()) as Locale;
  const href = (group: string | null) => {
    const p = new URLSearchParams(query);
    if (group) p.set('group', group);
    else p.delete('group');
    return `/settings/audit-log${p.size ? `?${p}` : ''}`;
  };
  const exportParams = new URLSearchParams(query);

  return (
    <MobileShell
      topBar={
        <AppTopBar
          back="/more"
          title={t('title')}
          actions={
            <TopBarAction
              icon={Download}
              label={t('export')}
              href={`/settings/audit-log/export?${exportParams}`}
            />
          }
        />
      }
    >
      <MobilePageTitle title={t('title')} subtitle={t('intro')} />
      <div className="no-scrollbar -mx-4 -my-1.5 flex gap-2 overflow-x-auto px-4 py-1.5">
        <ChipGroup
          label={tm('filter')}
          linkAs={Link}
          value={query.group === 'support' ? 'support' : query.group ? null : 'all'}
          className="mx-0 my-0 overflow-visible px-0 py-0"
          items={[
            { key: 'all', label: tm('all'), href: href(null) },
            { key: 'support', label: t('supportOnly'), href: href('support') },
          ]}
        />
        <PeriodChip query={query} />
      </div>
      {entries.length === 0 ? (
        <MobileEmpty icon={History} title={t('empty')}>
          {t('emptyBody')}
        </MobileEmpty>
      ) : (
        entries.map((e) => {
          const support = e.actorKind === 'support';
          const system = e.actorKind === 'system';
          const who = system
            ? t('system')
            : support
              ? tm('supportWho', { name: e.actorName ?? '' })
              : (e.actorName ?? '–');
          const time = `${formatDate(e.createdAt, locale).replace(/ \d{4}$/, '')} ${formatTime(e.createdAt, locale)}`;
          return (
            <ExpandCard
              key={e.id}
              leading={
                support ? (
                  <span
                    aria-hidden
                    className="inline-grid size-7.5 flex-none place-items-center rounded-full bg-navy text-micro font-semibold text-on-navy"
                  >
                    AG
                  </span>
                ) : (
                  <Avatar name={system ? '· ·' : (e.actorName ?? '?')} />
                )
              }
              title={actionLabel(e.action)}
              meta={tm('meta', { who, time })}
            >
              <KV k={t('colObject')}>{describeObject(e)}</KV>
              <KV k={t('colWho')}>{who}</KV>
              <KV k={t('colIp')}>{e.ip ?? '–'}</KV>
            </ExpandCard>
          );
        })
      )}
      {nextHref && (
        <BigButtonLink href={nextHref} variant="secondary" linkAs={Link}>
          {t('loadMore')}
        </BigButtonLink>
      )}
    </MobileShell>
  );
}
