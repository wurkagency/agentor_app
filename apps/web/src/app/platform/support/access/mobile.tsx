import { StatusPill } from '@agentor/ui';
import {
  ExpandCard,
  KV,
  MobileCard,
  MobileEmpty,
  MobileLogo,
  MobilePageTitle,
  MobileShell,
  Row,
  SectionHeading,
  Segmented,
} from '@agentor/ui/mobile';
import { KeyRound } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { PlatformSubTabs } from '@/components/mobile/sub-tabs';
import { GrantCardActions, RequestAccessFab } from '@/components/platform/access-page-controls';
import type { AccessTarget } from '@/components/platform/request-access-dialog';

export interface AccessMobileGrant {
  grantId: string;
  tenantId: string;
  tenantName: string;
  state: 'active' | 'pending';
  scope: string;
  caseLabel: string;
  /** "i morgen 11:14", or "venter på kunden". */
  expires: string;
  /** "23 t", "1 t 50 min."; null while waiting. */
  left: string | null;
  /** Two hours or less left. */
  soon: boolean;
  staff: string;
  mine: boolean;
  extensionRequested: boolean;
}

export interface AccessMobileClosed {
  grantId: string;
  tenantName: string;
  /** "#2287 · Kun se · udløb 16. okt." */
  meta: string;
  actions: number;
}

/**
 * MP24 Adgange: support grants, the staff member's own or everyone's (?filter=mine), as cards
 * that fold out to case, scope, expiry and the actions on one's own grants. Same data as S9.
 */
export async function AccessMobile({
  filter,
  mineCount,
  allCount,
  active,
  activeSub,
  pending,
  pendingSub,
  open,
  closed,
  targets,
}: {
  filter: 'mine' | 'all';
  mineCount: number;
  allCount: number;
  active: number;
  activeSub: string;
  pending: number;
  pendingSub: string;
  open: AccessMobileGrant[];
  closed: AccessMobileClosed[];
  targets: AccessTarget[];
}) {
  const t = await getTranslations('platform.grants');
  const tm = await getTranslations('mobile.platform.access');
  return (
    <MobileShell topBar={<PlatformTopBar />}>
      <PlatformSubTabs />
      <MobilePageTitle title={t('title')} aside={t('kpiActiveMax')} />
      <Segmented
        label={t('filterLabel')}
        linkAs={Link}
        value={filter}
        items={[
          {
            key: 'mine',
            label: tm('mine', { count: mineCount }),
            href: '/platform/support/access?filter=mine',
          },
          { key: 'all', label: tm('all', { count: allCount }), href: '/platform/support/access' },
        ]}
      />
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: t('kpiActive'), value: active, sub: activeSub },
          { label: tm('pending'), value: pending, sub: pendingSub },
        ].map((k) => (
          <MobileCard key={k.label} className="flex flex-col gap-1 px-3.5 py-3">
            <span className="text-meta font-medium text-fg-2">{k.label}</span>
            <strong className="text-m-kpi tabular">{k.value}</strong>
            <span className="truncate text-micro text-fg-2">{k.sub}</span>
          </MobileCard>
        ))}
      </div>
      {open.length === 0 ? (
        <MobileEmpty icon={KeyRound} title={t('emptyActive')} />
      ) : (
        <div className="flex flex-col gap-2">
          {open.map((g) => (
            <ExpandCard
              key={g.grantId}
              leading={<MobileLogo name={g.tenantName} size={32} />}
              title={g.tenantName}
              meta={`${g.scope} · ${g.expires}`}
              trailing={
                <StatusPill status={g.state === 'pending' || g.soon ? 'warn' : 'ok'}>
                  {g.left ?? t('waiting')}
                </StatusPill>
              }
            >
              <KV k={t('colCase')}>{g.caseLabel}</KV>
              <KV k={t('colScope')}>{g.scope}</KV>
              <KV k={t('colExpires')}>{g.expires}</KV>
              <KV k={t('colStaff')}>{g.mine ? `${g.staff} ${t('youShort')}` : g.staff}</KV>
              {g.mine && (
                <GrantCardActions
                  tenantId={g.tenantId}
                  grantId={g.grantId}
                  state={g.state}
                  extensionRequested={g.extensionRequested}
                />
              )}
            </ExpandCard>
          ))}
        </div>
      )}
      <SectionHeading>{t('expiredTitle')}</SectionHeading>
      {closed.length === 0 ? (
        <p className="m-0 px-1 text-body text-fg-2">{t('emptyExpired')}</p>
      ) : (
        <MobileCard>
          {closed.map((g) => (
            <Row
              key={g.grantId}
              leading={<MobileLogo name={g.tenantName} size={32} />}
              title={g.tenantName}
              meta={g.meta}
              trailing={
                <span className="flex-none text-meta font-medium text-fg-2">
                  {tm('actions', { count: g.actions })}
                </span>
              }
            />
          ))}
        </MobileCard>
      )}
      <RequestAccessFab targets={targets} />
    </MobileShell>
  );
}
