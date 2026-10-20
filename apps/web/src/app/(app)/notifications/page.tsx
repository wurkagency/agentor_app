import { pushUrl } from '@agentor/core';
import { getSecuritySettings, listNotifications } from '@agentor/db';
import { formatDate, formatRelative, formatTime, type Locale } from '@agentor/i18n';
import { Card } from '@agentor/ui';
import {
  CardButton,
  MobileCard,
  MobileEmpty,
  MobileShell,
  Responsive,
  RowIcon,
  RowLink,
  Row,
  type RowTone,
} from '@agentor/ui/mobile';
import {
  BellOff,
  CircleX,
  CreditCard,
  Headset,
  Info,
  Settings2,
  Unplug,
  Upload,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AppTopBar } from '@/components/mobile/chrome';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireAppContext } from '@/server/auth/session';
import { db } from '@/server/infra';
import { MarkAllRead } from './mark-all';

export async function generateMetadata() {
  const t = await getTranslations('mobile.notifications');
  return { title: t('title') };
}

const LOOK: Record<string, { icon: typeof Info; tone: RowTone }> = {
  connectionBroken: { icon: Unplug, tone: 'error' },
  recordsFailed: { icon: CircleX, tone: 'error' },
  creditNotesFailed: { icon: CircleX, tone: 'error' },
  supportRequested: { icon: Headset, tone: 'lime' },
  supportOpened: { icon: Headset, tone: 'neutral' },
  supportExtension: { icon: Headset, tone: 'lime' },
  paymentFailed: { icon: CreditCard, tone: 'warn' },
  published: { icon: Upload, tone: 'neutral' },
};

/**
 * Notifikationer (MA09 on mobile, the notification centre as a full page on desktop, sitemap §6):
 * every item deep-links to its screen; "Marker alle læst" uses the popover's action.
 */
export default async function NotificationsPage() {
  const ctx = await requireAppContext();
  const t = await getTranslations('mobile.notifications');
  const tp = await getTranslations('notificationsPanel');
  const locale = (await getLocale()) as Locale;
  const items = await listNotifications(
    db(),
    { tenantId: ctx.tenant.tenantId, userId: ctx.user.id },
    50,
  );
  const now = new Date();
  const when = (d: Date) => {
    const days = Math.round(
      (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
        new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
        86_400_000,
    );
    if (days === 0) return formatTime(d, locale);
    if (days === 1) return locale === 'da' ? 'i går' : 'yesterday';
    if (days < 7)
      return new Intl.DateTimeFormat(locale === 'da' ? 'da-DK' : 'en-GB', {
        weekday: 'short',
      }).format(d);
    return formatDate(d, locale);
  };
  // Support requests open MA12 for the request that is still waiting (admins only see grants).
  const admin = ctx.tenant.role === 'owner' || ctx.tenant.role === 'admin';
  const grants = admin
    ? (await getSecuritySettings(db(), { tenantId: ctx.tenant.tenantId, userId: ctx.user.id }))
        .grants
    : [];
  const pendingGrant = grants.find(
    (g) => !g.approvedAt && !g.deniedAt && g.requestedAt.getTime() > now.getTime() - 86_400_000,
  );
  const rows = items.map((n) => {
    const p = n.params as Record<string, string>;
    const known = n.messageKey in LOOK;
    const title = known
      ? t(`items.${n.messageKey}` as 'items.recordsFailed', p)
      : tp(`items.${n.messageKey}` as 'items.recordsFailed', p);
    const meta = n.messageKey.startsWith('support')
      ? t('meta.support', { name: String(p.name ?? '') })
      : n.messageKey === 'paymentFailed'
        ? t('meta.payment', { number: String(p.number ?? '') })
        : String(p.flow ?? p.name ?? p.system ?? '');
    return {
      id: n.id,
      // The screen it is about, as on the push (MA14): failure, reconnect or MA12.
      href: n.href
        ? pushUrl(n.href, {
            grantId:
              n.messageKey === 'supportRequested' && !n.resolvedAt
                ? (pendingGrant?.id ?? null)
                : null,
          })
        : null,
      title,
      meta: n.resolvedAt ? `${meta} · ${t('resolved')}` : meta,
      when: when(n.createdAt),
      unread: !n.readAt,
      look: LOOK[n.messageKey] ?? { icon: Info, tone: 'neutral' as RowTone },
      resolved: Boolean(n.resolvedAt),
      relative: formatRelative(n.createdAt, now, locale),
    };
  });
  const unread = rows.some((r) => r.unread);

  const trailing = (r: (typeof rows)[number]) => (
    <span className="flex flex-none flex-col items-end gap-1.5">
      <span className="text-meta font-medium text-fg-2">{r.when}</span>
      {r.unread ? (
        <span className="size-2 rounded-full bg-info-fg" role="img" aria-label={t('unread')} />
      ) : (
        <span className="size-2" aria-hidden />
      )}
    </span>
  );
  const list = rows.map((r) => {
    const props = {
      leading: <RowIcon icon={r.look.icon} tone={r.resolved ? 'neutral' : r.look.tone} />,
      title: r.title,
      meta: r.meta,
      trailing: trailing(r),
    };
    return r.href ? (
      <RowLink key={r.id} href={r.href} linkAs={Link} {...props} />
    ) : (
      <Row key={r.id} {...props} />
    );
  });

  const mobile = (
    <MobileShell
      topBar={
        <AppTopBar
          back="/"
          title={t('title')}
          bell={false}
          actions={<MarkAllRead disabled={!unread} />}
        />
      }
    >
      {rows.length === 0 ? (
        <MobileEmpty icon={BellOff} title={t('empty')}>
          {t('emptyBody')}
        </MobileEmpty>
      ) : (
        <MobileCard>{list}</MobileCard>
      )}
      <span className="self-center">
        <CardButton href="/settings/notifications" linkAs={Link} icon={Settings2}>
          {t('choose')}
        </CardButton>
      </span>
    </MobileShell>
  );
  const desktop = (
    <PageBody>
      <PageHeader title={t('title')} actions={<MarkAllRead disabled={!unread} />} />
      <Card padding="none">
        {rows.length === 0 ? (
          <MobileEmpty icon={BellOff} title={t('empty')}>
            {t('emptyBody')}
          </MobileEmpty>
        ) : (
          list
        )}
      </Card>
      <Link href="/settings/notifications" className="text-meta font-semibold text-fg-1">
        {tp('settings')}
      </Link>
    </PageBody>
  );
  return <Responsive desktop={desktop} mobile={mobile} />;
}
