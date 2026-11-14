'use client';

import { formatDate, formatDateTime, formatRelative, formatTime, type Locale } from '@agentor/i18n';
import { Banner, StatusPill, toast } from '@agentor/ui';
import {
  BigButton,
  CardButton,
  Chevron,
  MobileCard,
  MobileField,
  MobileInput,
  MobilePageTitle,
  MobileShell,
  Modal,
  Row,
  RowIcon,
  SectionHeading,
  Switch,
} from '@agentor/ui/mobile';
import { Fingerprint, KeyRound, Laptop, Smartphone } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition, type ReactNode } from 'react';
import { AppTopBar } from '@/components/mobile/chrome';
import { authClient } from '@/lib/auth-client';
import { decideSupportState, type SecurityProps } from './security-state';
import { logoutOtherSessions, logoutSession, setSecurity } from './actions';

/** Section heading with a small link-style action on its baseline (MA31 "Tilføj"). */
function Heading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-1 mt-3.5 flex items-baseline justify-between gap-3">
      <SectionHeading flush>{children}</SectionHeading>
      {action}
    </div>
  );
}

const LINK_ACTION =
  'touch-target cursor-pointer border-0 bg-transparent p-0 font-sans text-table font-semibold text-fg-1 disabled:cursor-not-allowed disabled:opacity-45';

/**
 * MA31 Sikkerhed: two-step for me and for the team, passkeys (add and remove), active sessions
 * and the support approval. Same actions as D12-Sikkerhed.
 */
export function SecurityMobile({
  isAdmin,
  mfaEnabled,
  requireMfaAll,
  missingMfa,
  supportRequiresApproval,
  grants,
  sessions,
}: SecurityProps) {
  const t = useTranslations('security');
  const tm = useTranslations('mobile.security');
  const common = useTranslations('common');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [codesOpen, setCodesOpen] = useState(false);
  const latest = grants[0];

  const done = (title: string) => {
    toast.ok({ title, closeLabel: common('close') });
    router.refresh();
  };

  const latestText = () => {
    if (!latest) return t('noRequests');
    const state = decideSupportState(latest);
    const status =
      state === 'active'
        ? t('statusActive', {
            time: `${formatDate(new Date(latest.expiresAt), locale)} ${formatTime(new Date(latest.expiresAt), locale)}`,
          })
        : t(`status${state.charAt(0).toUpperCase()}${state.slice(1)}` as 'statusPending');
    return tm('latest', {
      case: latest.caseRef,
      date: formatDateTime(new Date(latest.requestedAt), locale),
      status,
    });
  };

  return (
    <MobileShell topBar={<AppTopBar back="/more" title={t('title')} />}>
      <MobilePageTitle title={t('title')} subtitle={t('intro')} />

      <SectionHeading>{t('mfa')}</SectionHeading>
      <MobileCard>
        <Row
          title={tm('mfaMe')}
          meta={mfaEnabled ? tm('mfaOnMeta') : tm('mfaOffMeta')}
          trailing={
            // Turning it on is the setup flow; turning it off isn't offered, as on desktop.
            mfaEnabled ? (
              <StatusPill status="ok">{t('mfaOn')}</StatusPill>
            ) : (
              <Switch
                label={tm('mfaMe')}
                checked={false}
                onCheckedChange={(v) => v && router.push('/login/mfa/setup')}
              />
            )
          }
        />
        {mfaEnabled && (
          <button
            type="button"
            onClick={() => setCodesOpen(true)}
            className="flex min-h-14 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 text-left font-sans text-fg-1 shadow-row-divider last:shadow-none hover:bg-row-hover"
          >
            <RowIcon icon={KeyRound} tone="neutral" size={32} />
            <span className="flex-1 py-2.5 text-body font-semibold">{t('newCodes')}</span>
            <Chevron />
          </button>
        )}
        {isAdmin && (
          <Row
            title={t('requireAll')}
            meta={
              missingMfa.length
                ? tm('requireAllMeta', { names: missingMfa.join(', ') })
                : tm('requireAllNone')
            }
            trailing={
              <Switch
                label={t('requireAll')}
                checked={requireMfaAll}
                disabled={pending}
                onCheckedChange={(v) =>
                  startTransition(async () => {
                    const r = await setSecurity({ requireMfaAll: v });
                    if (r.ok) done(t('saved'));
                  })
                }
              />
            }
          />
        )}
      </MobileCard>

      <Passkeys />

      <Heading
        action={
          sessions.length > 1 && (
            <button
              type="button"
              className={LINK_ACTION}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await logoutOtherSessions();
                  if (r.ok) done(t('loggedOutOthers', { count: r.data?.count ?? 0 }));
                })
              }
            >
              {t('logoutOthers')}
            </button>
          )
        }
      >
        {t('sessions')}
      </Heading>
      <MobileCard>
        {sessions.map((s) => {
          const phone = /iOS|Android/.test(s.device);
          return (
            <Row
              key={s.id}
              leading={
                <RowIcon
                  icon={phone ? Smartphone : Laptop}
                  tone={s.current ? 'ok' : 'neutral'}
                  size={32}
                />
              }
              title={s.device}
              meta={
                s.current
                  ? tm('sessionCurrent', { ip: s.ip ?? '–' })
                  : tm('sessionMeta', {
                      ip: s.ip ?? '–',
                      time: formatRelative(new Date(s.lastActive), new Date(), locale),
                    })
              }
              trailing={
                s.current ? (
                  <span className="text-meta font-medium text-fg-2">{t('now')}</span>
                ) : (
                  <CardButton
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const r = await logoutSession(s.id);
                        if (r.ok) router.refresh();
                      })
                    }
                  >
                    <span aria-hidden>{t('logoutSession')}</span>
                    <span className="sr-only">{tm('logoutSession', { device: s.device })}</span>
                  </CardButton>
                )
              }
            />
          );
        })}
      </MobileCard>

      {isAdmin && (
        <>
          <SectionHeading>{t('support')}</SectionHeading>
          <MobileCard>
            <Row
              title={tm('supportRequire')}
              meta={tm('supportRequireMeta')}
              trailing={
                <Switch
                  label={tm('supportRequire')}
                  checked={supportRequiresApproval}
                  disabled={pending}
                  onCheckedChange={(v) =>
                    startTransition(async () => {
                      const r = await setSecurity({ supportRequiresApproval: v });
                      if (r.ok) done(t('saved'));
                    })
                  }
                />
              }
            />
            <p className="m-0 px-4 pb-3.5 pt-2.5 text-m-note text-fg-2">
              {latestText()}{' '}
              {latest && decideSupportState(latest) === 'pending' ? (
                <Link href={`/support-access/${latest.id}`} className="font-semibold text-fg-1">
                  {tm('seeRequest')}
                </Link>
              ) : (
                <Link href="/settings/audit-log?group=support" className="font-semibold text-fg-1">
                  {t('seeAudit')}
                </Link>
              )}
            </p>
          </MobileCard>
        </>
      )}

      <BackupCodesModal open={codesOpen} onOpenChange={setCodesOpen} />
    </MobileShell>
  );
}

/* ---- Passkeys: Better Auth's passkey plugin, as on desktop ---------------------------------------- */

interface PasskeyItem {
  id: string;
  name?: string | null;
  createdAt: string | Date;
}

function Passkeys() {
  const t = useTranslations('security');
  const tm = useTranslations('mobile.security');
  const common = useTranslations('common');
  const locale = useLocale() as Locale;
  const [items, setItems] = useState<PasskeyItem[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await authClient.passkey.listUserPasskeys();
    setItems((r.data as PasskeyItem[] | null) ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    const r = await authClient.passkey.addPasskey({ name: navigator.platform || 'Passkey' });
    setBusy(false);
    if (r?.error) toast.error({ title: t('passkeyError'), closeLabel: common('close') });
    else {
      toast.ok({ title: t('passkeyAdded'), closeLabel: common('close') });
      void load();
    }
  };

  return (
    <>
      <Heading
        action={
          <button
            type="button"
            className={LINK_ACTION}
            disabled={busy}
            aria-label={t('addPasskey')}
            onClick={() => void add()}
          >
            {tm('add')}
          </button>
        }
      >
        {t('passkeys')}
      </Heading>
      <MobileCard>
        {items && items.length === 0 && (
          <p className="m-0 px-4 py-3.5 text-table text-fg-2">{t('passkeysEmpty')}</p>
        )}
        {items?.map((p) => {
          const name = p.name || 'Passkey';
          return (
            <Row
              key={p.id}
              leading={<RowIcon icon={Fingerprint} tone="neutral" size={32} />}
              title={name}
              meta={t('passkeyCreated', { date: formatDate(new Date(p.createdAt), locale) })}
              trailing={
                <CardButton
                  onClick={async () => {
                    await authClient.passkey.deletePasskey({ id: p.id });
                    toast.ok({ title: t('passkeyRemoved'), closeLabel: common('close') });
                    void load();
                  }}
                >
                  <span aria-hidden>{t('removePasskey')}</span>
                  <span className="sr-only">{tm('removePasskey', { name })}</span>
                </CardButton>
              }
            />
          );
        })}
      </MobileCard>
    </>
  );
}

function BackupCodesModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('security');
  const auth = useTranslations('auth');
  const common = useTranslations('common');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setPassword('');
          setCodes(null);
          setError(false);
        }
        onOpenChange(o);
      }}
      title={t('newCodes')}
      closeLabel={common('close')}
      footer={
        codes ? (
          <BigButton onClick={() => onOpenChange(false)}>{auth('backupDone')}</BigButton>
        ) : (
          <BigButton
            loading={busy}
            disabled={!password}
            onClick={async () => {
              setBusy(true);
              const r = await authClient.twoFactor.generateBackupCodes({ password });
              setBusy(false);
              if (r.error || !r.data) setError(true);
              else setCodes(r.data.backupCodes);
            }}
          >
            {auth('setupStart')}
          </BigButton>
        )
      }
    >
      {codes ? (
        <>
          <Banner tone="warn">{t('newCodesDone')}</Banner>
          <ol className="m-0 grid grid-cols-2 gap-2 rounded-sm bg-bg-base p-4 pl-8 font-mono text-mono">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
        </>
      ) : (
        <>
          {error && <Banner tone="error">{auth('errors.invalid')}</Banner>}
          <MobileField label={t('newCodesPassword')}>
            <MobileInput
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </MobileField>
        </>
      )}
    </Modal>
  );
}
