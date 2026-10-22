'use client';

import type { PrefMatrix } from '@agentor/db';
import { cn, toast } from '@agentor/ui';
import {
  MobileCard,
  MobileFootnote,
  MobileShell,
  Row,
  RowLink,
  SectionHeading,
} from '@agentor/ui/mobile';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { AppTopBar } from '@/components/mobile/chrome';
import { saveNotifications } from '../actions';

// The same events and rules as D12 (notifications-form.tsx).
const EVENTS = [
  'connection_broken',
  'systematic_error',
  'record_failed',
  'quota',
  'payment_failed',
  'connector_update',
  'weekly_summary',
] as const;
const CRITICAL = new Set<string>(['connection_broken', 'systematic_error']);
const CHANNELS = ['inApp', 'email', 'push', 'sms'] as const;
/** SMS only for critical events (produktspecifikation §7.8), as on D12. */
const SMS_EVENTS = new Set<string>(['connection_broken', 'systematic_error', 'payment_failed']);

type Event = (typeof EVENTS)[number];
type Channel = (typeof CHANNELS)[number];

interface Settings {
  matrix: PrefMatrix;
  quiet: { enabled: boolean; start: string; end: string };
  smsPhone: string;
  thresholds?: { errorRatePct: number; consecutiveFailures: number };
}

const CHIP =
  'touch-target inline-flex h-7.5 items-center rounded-full border-0 px-3 font-sans text-meta box-border';

/** "+4512345678" → "+45 •• •• 56 78": enough to recognise the number. */
function maskPhone(p: string) {
  const d = p.replace(/\s/g, '');
  return `${d.slice(0, 3)} •• •• ${d.slice(-4, -2)} ${d.slice(-2)}`;
}

/** MA35 Notifikationskanaler: app, e-mail, push and SMS per event, saved with "Gem". */
export function ChannelsMobile({
  initial,
  firstName,
  thresholds,
}: {
  /** The whole D12 form value; thresholds only for owners and admins (saved back unchanged). */
  initial: Settings;
  firstName: string;
  /** Shown read-only for everyone. */
  thresholds: { errorRatePct: number; consecutiveFailures: number };
}) {
  const t = useTranslations('notifications');
  const tm = useTranslations('mobile.channels');
  const tc = useTranslations('common');
  const [matrix, setMatrix] = useState<PrefMatrix>(initial.matrix);
  const [saved, setSaved] = useState<PrefMatrix>(initial.matrix);
  const [pending, start] = useTransition();
  const dirty = useMemo(() => JSON.stringify(matrix) !== JSON.stringify(saved), [matrix, saved]);

  const toggle = (e: Event, ch: Channel) =>
    setMatrix((m) => ({ ...m, [e]: { ...m[e], [ch]: !m[e][ch] } }));

  const save = () =>
    start(async () => {
      const res = await saveNotifications({ ...initial, matrix });
      if (res.ok) {
        setSaved(matrix);
        toast.ok({ title: tm('saved'), closeLabel: tc('close') });
      } else toast.error({ title: tm('failed'), closeLabel: tc('close') });
    });

  const label = (ch: Channel) => (ch === 'inApp' ? tm('app') : t(ch));

  return (
    <MobileShell
      topBar={
        <AppTopBar
          back="/settings/notifications"
          title={tm('title')}
          bell={false}
          actions={
            <button
              type="button"
              onClick={save}
              disabled={!dirty || pending}
              className="touch-target inline-flex h-9 cursor-pointer items-center rounded-full border-0 bg-primary px-4 font-sans text-table font-semibold text-fg-1 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {pending ? tc('saving') : tc('save')}
            </button>
          }
        />
      }
    >
      <MobileFootnote>{tm('intro', { name: firstName })}</MobileFootnote>
      <MobileCard>
        {EVENTS.map((e) => {
          const name = t(`events.${e}`);
          return (
            <div
              key={e}
              className="flex flex-col gap-2 px-4 py-3 shadow-row-divider last:shadow-none"
            >
              <span className="flex flex-col leading-snug">
                <strong className="text-body">{name}</strong>
                <span className="text-meta font-medium text-fg-2">
                  {t(`events.${e}_help`, {
                    failures: thresholds.consecutiveFailures,
                    rate: thresholds.errorRatePct,
                  })}
                </span>
              </span>
              <div
                role="group"
                aria-label={tm('channelsFor', { event: name })}
                className="flex flex-wrap gap-1.5"
              >
                {CHANNELS.filter((ch) => ch !== 'sms' || SMS_EVENTS.has(e)).map((ch) => {
                  const locked = ch === 'inApp' && CRITICAL.has(e);
                  const on = locked || matrix[e][ch];
                  return (
                    <button
                      key={ch}
                      type="button"
                      aria-pressed={on}
                      disabled={locked}
                      onClick={() => toggle(e, ch)}
                      {...(locked ? { 'aria-label': `${label(ch)} (${t('locked')})` } : {})}
                      className={cn(
                        CHIP,
                        on
                          ? 'bg-fg-1 font-semibold text-white'
                          : 'cursor-pointer bg-white font-medium text-fg-1 shadow-ring-chip',
                        locked && 'cursor-not-allowed',
                      )}
                    >
                      {label(ch)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </MobileCard>
      <MobileFootnote>{t('criticalNote')}</MobileFootnote>

      <SectionHeading>{tm('thresholdTitle')}</SectionHeading>
      <MobileCard>
        <Row
          title={t('events.systematic_error')}
          meta={tm('threshold', {
            failures: thresholds.consecutiveFailures,
            rate: thresholds.errorRatePct,
          })}
        />
        <RowLink
          href="/settings/notifications"
          linkAs={Link}
          title={
            initial.quiet.enabled
              ? tm('quietOn', { start: initial.quiet.start, end: initial.quiet.end })
              : tm('quietOff')
          }
          meta={tm('quietMeta')}
        />
      </MobileCard>
      <MobileFootnote>{tm('thresholdNote')}</MobileFootnote>
      <MobileFootnote>
        {initial.smsPhone ? tm('smsTo', { phone: maskPhone(initial.smsPhone) }) : tm('smsNoPhone')}
      </MobileFootnote>
    </MobileShell>
  );
}
