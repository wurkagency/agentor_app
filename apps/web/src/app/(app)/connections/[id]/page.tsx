import { manifestFor } from '@agentor/connectors';
import { getConnection, isUuid, listAudit } from '@agentor/db';
import { formatDate, formatDateTime, formatRelative, formatTime } from '@agentor/i18n';
import {
  Card,
  CardHeader,
  ConnectorLogo,
  EmptyState,
  Icon,
  KeyValueList,
  StatusPill,
} from '@agentor/ui';
import { ArrowLeft, Workflow } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckingRefresh } from '@/components/connections/checking-refresh';
import { STATUS_PILL } from '@/components/connections/connection-card';
import { PageBody } from '@/components/shell/secondary-nav';
import { requireAppContext } from '@/server/auth/session';
import { db } from '@/server/infra';
import {
  BrokenBanner,
  ConnectionActions,
  ConnectionTabs,
  WebhookAddress,
} from './connection-actions';

export async function generateMetadata() {
  const t = await getTranslations('connections');
  return { title: t('title') };
}

/** One connection (D9-Dinero-Afbrudt): status, account, what depends on it, history. */
export default async function ConnectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; reconnect?: string }>;
}) {
  const ctx = await requireAppContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const c0 = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const c = await getConnection(db(), c0, id);
  const m = c ? manifestFor(c.connectorId) : null;
  if (!c || !m) notFound();
  const { tab, reconnect } = await searchParams;
  const t = await getTranslations('connections');
  const locale = (await getLocale()) as 'da' | 'en';
  const now = new Date();
  const canManage = ['owner', 'admin', 'developer'].includes(ctx.tenant.role);
  const canSeeAudit = ['owner', 'admin'].includes(ctx.tenant.role);
  const history =
    tab === 'history' && canSeeAudit
      ? (await listAudit(db(), c0, { actionPrefix: 'connection.', limit: 100 })).filter(
          (e) => e.objectId === id,
        )
      : [];
  const at = (d: Date) => `${formatDate(d, locale)} kl. ${formatTime(d, locale)}`;
  const oauth = m.auth.type === 'oauth2';
  const rights = [...m.inputs, ...m.outputs].map((p) => p.label.toLowerCase());

  return (
    <PageBody>
      <CheckingRefresh active={c.status === 'checking'} />
      <Link
        href="/connections"
        className="flex items-center gap-1.5 text-meta font-medium text-fg-2"
      >
        <Icon icon={ArrowLeft} size={14} />
        {t('title')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <ConnectorLogo connector={{ name: m.name, logoUrl: m.logo }} size={48} />
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 text-page">
              {m.name} · {c.name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-meta text-fg-2">
              <StatusPill status={STATUS_PILL[c.status]}>
                {c.status === 'broken' && c.brokenSince
                  ? t('brokenSince', { time: formatTime(c.brokenSince, locale) })
                  : t(`status.${c.status}`)}
              </StatusPill>
              {c.accountId && <span>{t('accountId', { id: c.accountId })}</span>}
            </div>
          </div>
        </div>
        {canManage && (
          <ConnectionActions id={c.id} name={`${m.name} · ${c.name}`} usedInFlows={c.usedInFlows} />
        )}
      </div>

      {c.status === 'broken' && (
        <BrokenBanner
          connectionId={c.id}
          connectorId={m.id}
          oauth={oauth}
          canManage={canManage}
          openReconnect={reconnect === '1'}
          fields={m.auth.type === 'oauth2' ? [] : m.auth.fields}
          title={t('brokenTitle', { name: m.name })}
          body={[
            c.statusReason ?? t('brokenGeneric'),
            c.brokenSince ? t('brokenAt', { when: at(c.brokenSince) }) : '',
            c.usedInFlows ? t('brokenImpact', { count: c.usedInFlows, name: m.name }) : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
      )}

      <ConnectionTabs
        active={tab === 'history' ? 'history' : 'overview'}
        showHistory={canSeeAudit}
      />

      {tab === 'history' && canSeeAudit ? (
        <Card padding="compact">
          {history.length === 0 ? (
            <EmptyState icon={Workflow} title={t('noHistory')} />
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {history.map((e) => (
                <li
                  key={e.id}
                  className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 text-table last:border-0"
                >
                  <span>
                    <span className="font-semibold">{e.actorName ?? 'Agentor'}</span>{' '}
                    {t(`history.${e.action.replace('.', '_')}` as 'history.connection_created')}
                  </span>
                  <span className="text-meta text-fg-2">{formatDateTime(e.createdAt, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-12">
          <Card className="flex flex-col gap-4 lg:col-span-5">
            <CardHeader title={t('details')} />
            <KeyValueList
              items={[
                { label: t('account'), value: c.name },
                {
                  label: t('configuredBy'),
                  value: `${c.configuredByName ?? '–'} · ${formatDate(c.createdAt, locale)}`,
                },
                {
                  label: t('rights'),
                  value: rights.join(', ').replace(/^./, (s) => s.toUpperCase()),
                },
                {
                  label: oauth ? t('token') : t('access'),
                  value:
                    c.status === 'broken'
                      ? t('invalidSince', {
                          time: c.brokenSince ? formatTime(c.brokenSince, locale) : '–',
                        })
                      : oauth
                        ? t('renewsAutomatically')
                        : t(`accessKind.${m.auth.type}`),
                },
                {
                  label: t('lastChecked'),
                  value: c.lastCheckedAt
                    ? formatRelative(c.lastCheckedAt, now, locale)
                    : t('never'),
                },
                {
                  label: t('rateLimit'),
                  value: t('rateLimitShared', { perMinute: m.rateLimit.perMinute }),
                },
                { label: t('version'), value: m.version },
              ]}
            />
            <p className="m-0 text-meta text-fg-2">{t('keysNeverShown')}</p>
          </Card>
          <div className="flex flex-col gap-4 lg:col-span-7">
            <Card padding="none" className="flex flex-col">
              <div className="flex items-baseline justify-between gap-3 px-5 pb-2 pt-5">
                <h2 className="m-0 text-card">{t('usedInFlows', { count: c.usedInFlows })}</h2>
                {c.status === 'broken' && (
                  <span className="text-meta text-fg-2">{t('standingStill')}</span>
                )}
              </div>
              <EmptyState icon={Workflow} title={t('noFlowsYet')}>
                {t('noFlowsYetBody')}
              </EmptyState>
            </Card>
            {m.webhook && canManage && (
              <WebhookAddress
                connectionId={c.id}
                lastWebhook={c.lastWebhookAt ? formatRelative(c.lastWebhookAt, now, locale) : null}
              />
            )}
          </div>
        </div>
      )}
    </PageBody>
  );
}
