import { manifestFor } from '@agentor/connectors';
import { getConnection, isUuid, waitingRecords } from '@agentor/db';
import { formatDate, formatTime, type Locale } from '@agentor/i18n';
import { ConnectorLogo, Icon } from '@agentor/ui';
import {
  BigButtonLink,
  DeskNote,
  MobileCard,
  MobileShell,
  Responsive,
  Row,
  RowIcon,
} from '@agentor/ui/mobile';
import { CircleCheck, Clock, KeyRound, Unplug } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { AppTopBar } from '@/components/mobile/chrome';
import { DesktopRedirect } from '@/components/mobile/desktop-redirect';
import { SendDeskLinkButton } from '@/components/mobile/send-desk-link';
import { requireAppContext } from '@/server/auth/session';
import { viewsFor } from '@/server/flows';
import { db } from '@/server/infra';

export async function generateMetadata() {
  const t = await getTranslations('connections');
  return { title: t('reconnect') };
}

/**
 * MA08 Genforbind: why the connection stopped, what is waiting, and sign in again with OAuth in
 * the browser (the same /connect flow as desktop D9). On a computer: the connection page.
 */
export default async function ReconnectPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAppContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const c0 = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const conn = await getConnection(db(), c0, id);
  const m = conn ? manifestFor(conn.connectorId) : null;
  if (!conn || !m) notFound();
  const t = await getTranslations('mobile.reconnect');
  const locale = (await getLocale()) as Locale;
  const canManage = ['owner', 'admin', 'developer'].includes(ctx.tenant.role);
  const views = await viewsFor(ctx);
  const flows = views.filter((v) => [v.source, ...v.destinations].some((x) => x?.id === id));
  const waiting = await waitingRecords(
    db(),
    c0,
    flows.map((v) => v.id),
  );
  const now = new Date();
  const when = (d: Date) => {
    const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86_400_000);
    const time = formatTime(d, locale);
    return diff === 0
      ? t('today', { time })
      : diff === 1
        ? t('yesterday', { time })
        : t('on', { date: formatDate(d, locale), time });
  };
  const oauth = m.auth.type === 'oauth2';
  const other = flows[0]?.source && flows[0].source.id !== id ? flows[0].source : null;
  const top = waiting.sort((a, b) => b.count - a.count)[0];
  const entity = (e: string) =>
    ['order', 'customer', 'creditNote', 'product', 'stock'].includes(e) ? e : 'record';

  const mobile =
    conn.status !== 'broken' ? (
      <MobileShell topBar={<AppTopBar back="/" title={t('title', { system: m.name })} />}>
        <MobileCard>
          <div className="flex flex-col items-center gap-2.5 p-5 text-center">
            <RowIcon icon={CircleCheck} tone="ok" size={52} />
            <strong className="text-m-hero">{t('ok', { system: m.name })}</strong>
            <p className="m-0 text-fg-2">{t('okBody')}</p>
          </div>
        </MobileCard>
        <div className="mt-auto">
          <BigButtonLink href="/" variant="secondary" linkAs={Link}>
            {t('toOverview')}
          </BigButtonLink>
        </div>
      </MobileShell>
    ) : (
      <MobileShell topBar={<AppTopBar back="/" title={t('title', { system: m.name })} />}>
        <MobileCard>
          <div className="flex flex-col items-center gap-2.5 p-5 text-center">
            <span className="flex items-center gap-2.5">
              {other && (
                <>
                  <ConnectorLogo
                    connector={{
                      name: manifestFor(other.connectorId)?.name ?? other.name,
                      logoUrl: other.logo,
                    }}
                    size={48}
                    className="size-10"
                  />
                  <Icon icon={Unplug} size={18} className="text-error-fg" />
                </>
              )}
              <ConnectorLogo
                connector={{ name: m.name, logoUrl: m.logo }}
                size={48}
                className="size-10"
              />
            </span>
            <strong className="text-m-hero">{t('broken', { system: m.name })}</strong>
            <p className="m-0 text-fg-2">
              {conn.brokenSince
                ? flows.length
                  ? t('brokenBody', {
                      system: m.name,
                      when: when(conn.brokenSince),
                      flows: flows.map((v) => v.name).join(', '),
                    })
                  : t('brokenBodyNoFlows', { system: m.name, when: when(conn.brokenSince) })
                : (conn.statusReason ?? '')}
            </p>
          </div>
        </MobileCard>
        <MobileCard>
          <Row
            leading={<RowIcon icon={Clock} tone="warn" size={30} />}
            title={
              top
                ? t('waiting', {
                    count: waiting.reduce((a, w) => a + w.count, 0),
                    entity: t(`entity.${entity(top.entity)}` as 'entity.order'),
                    entities: t(`entities.${entity(top.entity)}` as 'entities.order'),
                  })
                : t('waitingNone')
            }
            meta={t('waitingMeta')}
          />
          {oauth && (
            <Row
              leading={<RowIcon icon={KeyRound} size={30} />}
              title={t('youLogIn', { system: m.name })}
              meta={t('neverPassword')}
            />
          )}
        </MobileCard>
        {!canManage && <DeskNote>{t('noAccess', { system: m.name })}</DeskNote>}
        {canManage && !oauth && <DeskNote>{t('keyNote')}</DeskNote>}
        <div className="mt-auto flex flex-col gap-2">
          {canManage && oauth && (
            <BigButtonLink href={`/connect/${m.id}?reconnect=${id}`} variant="dark" linkAs={Link}>
              {t('logIn', { system: m.name })}
            </BigButtonLink>
          )}
          {canManage && !oauth && (
            <Suspense>
              <SendDeskLinkButton
                path={`/connections/${id}?reconnect=1`}
                title={t('title', { system: m.name })}
              />
            </Suspense>
          )}
          <BigButtonLink href="/" variant="secondary" linkAs={Link}>
            {t('later')}
          </BigButtonLink>
        </div>
      </MobileShell>
    );

  return (
    <Responsive
      desktop={
        <DesktopRedirect
          href={`/connections/${id}?reconnect=1`}
          label={t('title', { system: m.name })}
        />
      }
      mobile={mobile}
    />
  );
}
