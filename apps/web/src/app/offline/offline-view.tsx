'use client';

import { StatusPill } from '@agentor/ui';
import {
  MobileCard,
  MobileEmpty,
  MobilePageTitle,
  MobileShell,
  Row,
  SectionHeading,
  StatusHero,
  TopBar,
} from '@agentor/ui/mobile';
import type { Status } from '@agentor/core';
import { CircleCheck, CloudOff, TriangleAlert, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { readCurrentSnapshot, type OfflineSnapshot } from '@/lib/offline-snapshot';

/**
 * The offline page (PLAN-MOBILE M3): the last snapshot this device saved, read-only, with the
 * grey banner "Offline · data fra kl. 14:02" (B2). Served by the service worker when a page
 * can't load; nothing here talks to the server.
 */
export function OfflineView() {
  const t = useTranslations('mobile.offline');
  const [snap, setSnap] = useState<OfflineSnapshot | null | undefined>(undefined);
  useEffect(() => {
    void readCurrentSnapshot().then(setSnap);
    // Back online: reload the page the user wanted.
    const on = () => window.location.reload();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, []);
  const saved = snap ? new Date(snap.savedAt) : null;
  const time = saved
    ? new Intl.DateTimeFormat('da-DK', { hour: '2-digit', minute: '2-digit' }).format(saved)
    : '';
  const sameDay = saved ? saved.toDateString() === new Date().toDateString() : true;
  const date = saved
    ? new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short' }).format(saved)
    : '';

  return (
    <MobileShell topBar={<TopBar logo={{ href: '/', label: 'Agentor' }} />}>
      <div
        role="status"
        className="flex items-center gap-2.5 rounded-node bg-paused-bg px-3.5 py-2.5 text-m-note text-fg-1"
      >
        <WifiOff aria-hidden width={18} height={18} className="flex-none" />
        <span className="flex-1">
          <strong className="font-semibold">
            {saved
              ? sameDay
                ? t('banner', { time })
                : t('bannerDate', { date, time })
              : t('title')}
          </strong>
          <br />
          {t('actionsOff')}
        </span>
      </div>
      {snap === null && (
        <MobileEmpty icon={CloudOff} title={t('noneTitle')}>
          {t('noneBody')}
        </MobileEmpty>
      )}
      {snap?.overview && (
        <>
          <MobilePageTitle title={t('overview')} subtitle={snap.company} />
          <StatusHero
            tone={snap.overview.problems ? 'error' : 'ok'}
            icon={snap.overview.problems ? TriangleAlert : CircleCheck}
            headline={snap.overview.headline}
            meta={snap.overview.meta}
          >
            {snap.overview.rows.map((r) => (
              <Row key={r.title} title={r.title} meta={r.meta} />
            ))}
          </StatusHero>
          <MobileCard>
            {snap.overview.kpis.map((k) => (
              <Row
                key={k.label}
                title={k.label}
                meta={k.meta}
                trailing={<strong className="tabular">{k.value}</strong>}
              />
            ))}
          </MobileCard>
        </>
      )}
      {snap?.integrations && snap.integrations.length > 0 && (
        <>
          <SectionHeading>{t('integrations')}</SectionHeading>
          <MobileCard>
            {snap.integrations.map((f) => (
              <Row
                key={f.name}
                title={f.name}
                meta={f.meta}
                trailing={<StatusPill status={f.status as Status}>{f.statusLabel}</StatusPill>}
              />
            ))}
          </MobileCard>
        </>
      )}
      {snap?.activity && snap.activity.length > 0 && (
        <>
          <SectionHeading>{t('activity')}</SectionHeading>
          <MobileCard>
            {snap.activity.map((a, i) => (
              <Row
                key={`${a.title}-${i}`}
                title={a.title}
                meta={a.meta}
                trailing={<span className="text-meta font-medium text-fg-2">{a.time}</span>}
              />
            ))}
          </MobileCard>
        </>
      )}
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="touch-target self-center rounded-full border-0 bg-white px-4 py-2 font-sans text-table font-semibold text-fg-1 shadow-ring-strong"
      >
        {t('retry')}
      </button>
    </MobileShell>
  );
}
