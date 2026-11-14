import type { ConnectorManifest } from '@agentor/connectors';
import { formatDate, formatRelative, formatTime, type Locale } from '@agentor/i18n';
import { StatusPill } from '@agentor/ui';
import {
  CardActions,
  CardButton,
  ExpandCard,
  KV,
  MobileEmpty,
  MobileFootnote,
  MobileLogo,
  MobilePageTitle,
  MobileShell,
  TopBarAction,
} from '@agentor/ui/mobile';
import { Plug, Plus, RefreshCw } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { STATUS_PILL, type ConnectionCardData } from '@/components/connections/connection-card';
import { AppTopBar } from '@/components/mobile/chrome';

/** MA26 Forbindelser: one foldable row per connection with status, access, use and expiry. */
export async function ConnectionsMobile({
  rows,
  canManage,
}: {
  rows: { c: ConnectionCardData; m: ConnectorManifest }[];
  canManage: boolean;
}) {
  const t = await getTranslations('connections');
  const tm = await getTranslations('mobile.connections');
  const tr = await getTranslations('mobile.reconnect');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const broken = rows.filter((r) => r.c.status === 'broken').length;
  const rel = (d: Date | null) => (d ? formatRelative(d, now, locale) : t('never'));
  const when = (d: Date) => {
    const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86_400_000);
    const time = formatTime(d, locale);
    return diff === 0
      ? tr('today', { time })
      : diff === 1
        ? tr('yesterday', { time })
        : tr('on', { date: formatDate(d, locale), time });
  };

  return (
    <MobileShell
      topBar={
        <AppTopBar
          back="/more"
          title={t('title')}
          {...(canManage
            ? {
                actions: (
                  <TopBarAction
                    icon={Plus}
                    label={t('add')}
                    href="/connections/new"
                    linkAs={Link}
                  />
                ),
              }
            : {})}
        />
      }
    >
      <MobilePageTitle
        title={t('title')}
        subtitle={[
          t('count', { count: rows.length }),
          ...(broken ? [t('brokenCount', { count: broken })] : []),
        ].join(' · ')}
      />
      {rows.length === 0 ? (
        <MobileEmpty
          icon={Plug}
          title={t('emptyTitle')}
          {...(canManage
            ? {
                action: (
                  <CardButton href="/connections/new" linkAs={Link} variant="primary" icon={Plus}>
                    {t('add')}
                  </CardButton>
                ),
              }
            : {})}
        >
          {t('emptyBody')}
        </MobileEmpty>
      ) : (
        rows.map(({ c, m }) => {
          const oauth = m.auth.type === 'oauth2';
          const isBroken = c.status === 'broken';
          return (
            <ExpandCard
              key={c.id}
              open={isBroken}
              leading={<MobileLogo name={m.name} logoUrl={m.logo} size={32} />}
              title={m.name}
              meta={c.name}
              trailing={
                <StatusPill status={STATUS_PILL[c.status]}>{t(`status.${c.status}`)}</StatusPill>
              }
            >
              {oauth ? (
                <KV k={tm('token')}>
                  {isBroken
                    ? c.brokenSince
                      ? tm('expired', { when: when(c.brokenSince) })
                      : '–'
                    : c.tokenExpiresAt
                      ? tm('expires', { date: formatDate(c.tokenExpiresAt, locale) })
                      : t('renewsAutomatically')}
                </KV>
              ) : (
                <KV k={t('access')}>{t(`accessKind.${m.auth.type}`)}</KV>
              )}
              <KV k={t('usedIn')}>
                {c.usedInFlows === 0
                  ? t('notUsed')
                  : isBroken
                    ? tm('usedInBroken', { flows: t('flows', { count: c.usedInFlows }) })
                    : t('flows', { count: c.usedInFlows })}
              </KV>
              {m.webhook && !isBroken ? (
                <KV k={tm('webhook')}>
                  {c.lastWebhookAt ? rel(c.lastWebhookAt) : tm('webhookNone')}
                </KV>
              ) : (
                <KV k={tm('checked')}>{rel(c.lastCheckedAt)}</KV>
              )}
              {isBroken &&
                (canManage ? (
                  <CardActions>
                    <CardButton
                      href={`/connections/${c.id}/reconnect`}
                      linkAs={Link}
                      variant="dark"
                      icon={RefreshCw}
                    >
                      {t('reconnect')}
                    </CardButton>
                  </CardActions>
                ) : (
                  <p className="m-0 pt-2 text-meta font-medium text-fg-2">{tm('noAccess')}</p>
                ))}
            </ExpandCard>
          );
        })
      )}
      <MobileFootnote>{tm('footnote')}</MobileFootnote>
    </MobileShell>
  );
}
