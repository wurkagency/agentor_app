'use client';

import { toast } from '@agentor/ui';
import {
  BigButton,
  CardButton,
  MobileCallout,
  MobileCard,
  MobileFootnote,
  Row,
  SectionHeading,
  Switch,
} from '@agentor/ui/mobile';
import { BellRing, Download, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { devicePush, setDevicePush, subscribePush, unsubscribePush } from '@/app/actions/push';
import { useStandalone } from '@/components/mobile/standalone';
import { saveNotifications } from './actions';

type Toggles = {
  errors: boolean;
  connection: boolean;
  support: boolean;
  quota: boolean;
  weekly: boolean;
};
type State = 'checking' | 'unsupported' | 'install' | 'denied' | 'off' | 'on';

const KEYS = ['errors', 'connection', 'support', 'quota', 'weekly'] as const;

function base64Url(key: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (key.length % 4)) % 4);
  const raw = atob((key + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : 'Computer';
  const browser = /CriOS|Chrome/.test(ua)
    ? 'Chrome'
    : /Firefox|FxiOS/.test(ua)
      ? 'Firefox'
      : /Safari/.test(ua)
        ? 'Safari'
        : 'Browser';
  return `${os} · ${browser}`;
}

/**
 * MA11: push on this device per event, and quiet hours (22.00–07.00, errors collected for the
 * morning). Says plainly when push can't work here: unsupported browser, iPhone outside the home
 * screen (MA13), or notifications blocked.
 */
export function PushSettings({
  vapidKey,
  quiet,
  settings,
}: {
  vapidKey: string | null;
  quiet: { enabled: boolean; start: string; end: string };
  /** The whole D12 form value, saved again with the quiet-hours change. */
  settings: unknown;
}) {
  const t = useTranslations('mobile.pushSettings');
  const tc = useTranslations('common');
  const standalone = useStandalone();
  const [state, setState] = useState<State>('checking');
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [toggles, setToggles] = useState<Toggles | null>(null);
  const [quietOn, setQuietOn] = useState(quiet.enabled);
  const [pending, start] = useTransition();

  useEffect(() => {
    void (async () => {
      const supported =
        'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      if (!supported) return setState(ios && !standalone ? 'install' : 'unsupported');
      if (Notification.permission === 'denied') return setState('denied');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return setState('off');
      const res = await devicePush(sub.endpoint);
      if (res.ok && res.data?.toggles) {
        setEndpoint(sub.endpoint);
        setToggles(res.data.toggles);
        setState('on');
      } else setState('off');
    })();
  }, [standalone]);

  const fail = () => {
    toast.error({ title: t('failed'), closeLabel: tc('close') });
  };

  const turnOn = () =>
    start(async () => {
      if (!vapidKey) return;
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return setState(permission === 'denied' ? 'denied' : 'off');
        const reg = await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64Url(vapidKey),
          }));
        const res = await subscribePush(sub.toJSON(), deviceLabel());
        if (!res.ok || !res.data) {
          fail();
          return;
        }
        setEndpoint(sub.endpoint);
        setToggles(res.data.toggles);
        setState('on');
        toast.ok({ title: t('on'), closeLabel: tc('close') });
      } catch {
        fail();
      }
    });

  const turnOff = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
      setEndpoint(null);
      setToggles(null);
      setState('off');
      toast.ok({ title: t('off'), closeLabel: tc('close') });
    });

  const flip = (key: (typeof KEYS)[number], value: boolean) => {
    if (!toggles || !endpoint) return;
    const next = { ...toggles, [key]: value };
    setToggles(next);
    start(async () => {
      const res = await setDevicePush(endpoint, next);
      if (!res.ok) {
        setToggles(toggles);
        fail();
      }
    });
  };

  const flipQuiet = (value: boolean) => {
    setQuietOn(value);
    start(async () => {
      const s = settings as { quiet: typeof quiet };
      const res = await saveNotifications({ ...s, quiet: { ...s.quiet, enabled: value } });
      if (!res.ok) {
        setQuietOn(!value);
        fail();
      }
    });
  };

  const on = state === 'on';
  const meta: Record<(typeof KEYS)[number], string> = {
    errors: t('errorsMeta'),
    connection: t('connectionMeta'),
    support: t('supportMeta'),
    quota: t('quotaMeta'),
    weekly: t('weeklyMeta'),
  };

  return (
    <>
      {!vapidKey && <MobileCallout tone="warn" icon={TriangleAlert} title={t('notConfigured')} />}
      {state === 'unsupported' && (
        <MobileCallout tone="warn" icon={TriangleAlert} title={t('unsupported')}>
          {t('unsupportedBody')}
        </MobileCallout>
      )}
      {state === 'install' && (
        <MobileCallout
          tone="info"
          icon={Download}
          title={t('needsInstall')}
          actions={
            <CardButton href="/install" linkAs={Link}>
              {t('howToInstall')}
            </CardButton>
          }
        >
          {t('needsInstallBody')}
        </MobileCallout>
      )}
      {state === 'denied' && (
        <MobileCallout tone="error" icon={TriangleAlert} title={t('denied')}>
          {t('deniedBody')}
        </MobileCallout>
      )}
      <SectionHeading>{t('device')}</SectionHeading>
      <MobileCard>
        {KEYS.map((k) => (
          <Row
            key={k}
            title={t(k)}
            meta={meta[k]}
            trailing={
              <Switch
                label={t(k)}
                checked={on && Boolean(toggles?.[k])}
                disabled={!on || pending}
                onCheckedChange={(v) => flip(k, v)}
              />
            }
          />
        ))}
      </MobileCard>
      {state === 'off' && vapidKey && (
        <BigButton icon={BellRing} loading={pending} onClick={turnOn}>
          {pending ? t('turningOn') : t('turnOn')}
        </BigButton>
      )}
      <SectionHeading>{t('quiet')}</SectionHeading>
      <MobileCard>
        <Row
          title={t('quietTitle')}
          meta={t('quietMeta', {
            start: quiet.start.replace(':', '.'),
            end: quiet.end.replace(':', '.'),
          })}
          trailing={
            <Switch label={t('quietTitle')} checked={quietOn} onCheckedChange={flipQuiet} />
          }
        />
      </MobileCard>
      <MobileFootnote>{t('channels')}</MobileFootnote>
      {on && (
        <button
          type="button"
          onClick={turnOff}
          disabled={pending}
          className="touch-target self-center border-0 bg-transparent font-sans text-table font-semibold text-error-fg"
        >
          {t('turnOff')}
        </button>
      )}
    </>
  );
}
