import type { ConnectorManifest } from '@agentor/connectors';
import { formatDate, formatRelative, formatTime } from '@agentor/i18n';
import { cn, ConnectorLogo, KeyValueList, StatusPill } from '@agentor/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/button-link';

export interface ConnectionCardData {
  id: string;
  connectorId: string;
  name: string;
  status: 'checking' | 'ok' | 'broken';
  brokenSince: Date | null;
  lastCheckedAt: Date | null;
  lastWebhookAt: Date | null;
  tokenExpiresAt: Date | null;
  usedInFlows: number;
}

export const STATUS_PILL = { ok: 'ok', broken: 'broken', checking: 'info' } as const;

/** One connection in "Mine forbindelser" (D9-Forbindelser). */
export async function ConnectionCard({
  c,
  manifest,
  canManage,
}: {
  c: ConnectionCardData;
  manifest: ConnectorManifest;
  canManage: boolean;
}) {
  const t = await getTranslations('connections');
  const locale = (await getLocale()) as 'da' | 'en';
  const now = new Date();
  const rel = (d: Date | null) => (d ? formatRelative(d, now, locale) : t('never'));
  const oauth = manifest.auth.type === 'oauth2';
  const access: { label: string; value: ReactNode } =
    oauth && c.status === 'broken'
      ? {
          label: t('tokenExpired'),
          value: c.brokenSince
            ? `${formatDate(c.brokenSince, locale)} kl. ${formatTime(c.brokenSince, locale)}`
            : '–',
        }
      : oauth
        ? {
            label: t('tokenExpires'),
            value: c.tokenExpiresAt
              ? formatDate(c.tokenExpiresAt, locale)
              : t('renewsAutomatically'),
          }
        : { label: t('access'), value: t(`accessKind.${manifest.auth.type}`) };

  return (
    <article
      aria-labelledby={`conn-${c.id}`}
      className={cn(
        'flex flex-col gap-4 rounded-md bg-surface p-5 shadow-sm',
        c.status === 'broken' && 'shadow-ring-error',
      )}
    >
      <header className="flex items-start gap-3">
        <ConnectorLogo connector={{ name: manifest.name, logoUrl: manifest.logo }} size={32} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id={`conn-${c.id}`} className="m-0 text-body font-semibold">
            <Link href={`/connections/${c.id}`} className="text-fg-1 no-underline hover:underline">
              {manifest.name}
            </Link>
          </h2>
          <span className="truncate text-meta text-fg-2">{c.name}</span>
        </div>
        <StatusPill status={STATUS_PILL[c.status]}>{t(`status.${c.status}`)}</StatusPill>
      </header>
      <KeyValueList
        items={[
          access,
          {
            label: t('usedIn'),
            value:
              c.usedInFlows === 0
                ? t('notUsed')
                : t('flows', { count: c.usedInFlows }) +
                  (c.status === 'broken' ? ` · ${t('notRunning')}` : ''),
          },
          { label: t('lastChecked'), value: rel(c.lastCheckedAt) },
        ]}
      />
      <footer className="mt-auto flex min-h-8 items-center justify-between gap-3 shadow-hairline-t pt-3">
        {c.status === 'broken' && canManage ? (
          <ButtonLink variant="dark" size="s" href={`/connections/${c.id}?reconnect=1`}>
            {t('reconnect')}
          </ButtonLink>
        ) : manifest.webhook ? (
          <span className="text-meta text-fg-2">
            {c.lastWebhookAt
              ? t('webhookReceived', { when: rel(c.lastWebhookAt) })
              : t('noWebhookYet')}
          </span>
        ) : (
          <ButtonLink variant="secondary" size="s" href={`/connections/${c.id}`}>
            {t('details')}
          </ButtonLink>
        )}
      </footer>
    </article>
  );
}
