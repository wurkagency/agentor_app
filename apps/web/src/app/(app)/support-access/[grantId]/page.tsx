import { getSupportGrant, isUuid } from '@agentor/db';
import { formatDateTime, type Locale } from '@agentor/i18n';
import { Card, StatusPill } from '@agentor/ui';
import {
  BigButtonLink,
  DeskNote,
  MobileCard,
  MobileFootnote,
  MobileShell,
  Responsive,
  Row,
  RowIcon,
} from '@agentor/ui/mobile';
import { Eye, Headset, Lock, Timer } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppTopBar } from '@/components/mobile/chrome';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireAppContext } from '@/server/auth/session';
import { db } from '@/server/infra';
import { DecideSupport } from './decide';

export async function generateMetadata() {
  const t = await getTranslations('mobile.support');
  return { title: t('title') };
}

/**
 * MA12 Supportadgang: approve or decline an Agentor support request (case, scope, at most 24 h,
 * audit-logged), opened from push or Mere. Calls the same action as the desktop page (D8).
 */
export default async function SupportAccessPage({
  params,
}: {
  params: Promise<{ grantId: string }>;
}) {
  const ctx = await requireAppContext();
  const { grantId } = await params;
  if (!isUuid(grantId)) notFound();
  const g = await getSupportGrant(
    db(),
    { tenantId: ctx.tenant.tenantId, userId: ctx.user.id },
    grantId,
  );
  if (!g) notFound();
  const t = await getTranslations('mobile.support');
  const locale = (await getLocale()) as Locale;
  const admin = ctx.tenant.role === 'owner' || ctx.tenant.role === 'admin';
  const now = Date.now();
  const first = g.supportName.split(' ')[0] ?? g.supportName;
  const lapsed = !g.approvedAt && !g.deniedAt && g.requestedAt.getTime() <= now - 86_400_000;
  const state =
    g.revokedAt || g.endedAt
      ? 'revoked'
      : g.deniedAt
        ? 'denied'
        : g.approvedAt
          ? g.expiresAt.getTime() > now
            ? 'active'
            : 'expired'
          : lapsed
            ? 'lapsed'
            : 'pending';
  const stateText =
    state === 'active'
      ? t('stateApproved', { when: formatDateTime(g.expiresAt, locale) })
      : state === 'denied'
        ? t('stateDenied')
        : state === 'expired'
          ? t('stateExpired')
          : state === 'revoked'
            ? t('stateRevoked')
            : state === 'lapsed'
              ? t('stateLapsed')
              : null;

  const body = (
    <>
      <MobileCard>
        <div className="flex flex-col items-center gap-2.5 p-5 text-center">
          <RowIcon icon={Headset} tone="lime" size={52} />
          <strong className="text-m-request">{t('asks', { name: first })}</strong>
          <p className="m-0 text-fg-2">
            {g.reason
              ? t('forCase', { case: g.caseRef, reason: g.reason })
              : t('forCaseShort', { case: g.caseRef })}
          </p>
          {stateText && (
            <StatusPill
              status={state === 'active' ? 'ok' : state === 'pending' ? 'info' : 'paused'}
            >
              {stateText}
            </StatusPill>
          )}
        </div>
      </MobileCard>
      <MobileCard>
        <Row
          leading={<RowIcon icon={Eye} size={30} />}
          title={t('canSee', { name: first })}
          meta={g.scope === 'help' ? t('canSeeHelp') : t('canSeeView')}
        />
        <Row
          leading={<RowIcon icon={Lock} size={30} />}
          title={t('cannot', { name: first })}
          meta={t('cannotBody')}
        />
        <Row
          leading={<RowIcon icon={Timer} size={30} />}
          title={t('duration')}
          meta={t('durationBody', { hours: g.hours })}
        />
      </MobileCard>
      <MobileFootnote>{t('audit', { name: first })}</MobileFootnote>
    </>
  );
  const actions = !admin ? (
    <DeskNote>{t('onlyAdmins')}</DeskNote>
  ) : state === 'pending' ? (
    <DecideSupport grantId={g.id} hours={g.hours} mode="pending" />
  ) : state === 'active' ? (
    <DecideSupport grantId={g.id} hours={g.hours} mode="active" />
  ) : (
    <BigButtonLink href="/settings/security" variant="secondary" linkAs={Link}>
      {t('toSecurity')}
    </BigButtonLink>
  );

  return (
    <Responsive
      mobile={
        <MobileShell topBar={<AppTopBar back="/more" title={t('title')} bell={false} />}>
          {body}
          <div className="mt-auto">{actions}</div>
        </MobileShell>
      }
      desktop={
        <PageBody>
          <PageHeader title={t('title')} />
          <Card className="flex max-w-form flex-col gap-4">
            {body}
            {actions}
          </Card>
        </PageBody>
      }
    />
  );
}
