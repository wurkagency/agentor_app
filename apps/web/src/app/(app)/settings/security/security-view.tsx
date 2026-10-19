'use client';

import { formatDate, formatDateTime, formatRelative, formatTime, type Locale } from '@agentor/i18n';
import {
  Banner,
  Button,
  Card,
  Dialog,
  Field,
  Icon,
  Input,
  StatusPill,
  Switch,
  toast,
} from '@agentor/ui';
import { Fingerprint, KeyRound, Laptop, Plus, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition, type ReactNode } from 'react';
import { authClient } from '@/lib/auth-client';
import { decideSupport, logoutOtherSessions, logoutSession, setSecurity } from './actions';

interface Grant {
  id: string;
  caseRef: string;
  supportName: string;
  requestedAt: string;
  approvedAt: string | null;
  deniedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
}

interface Props {
  isAdmin: boolean;
  mfaEnabled: boolean;
  requireMfaAll: boolean;
  missingMfa: string[];
  supportRequiresApproval: boolean;
  grants: Grant[];
  sessions: {
    id: string;
    device: string;
    ip: string | null;
    lastActive: string;
    current: boolean;
  }[];
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="m-0 text-card">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function SecurityView({
  isAdmin,
  mfaEnabled,
  requireMfaAll,
  missingMfa,
  supportRequiresApproval,
  grants,
  sessions,
}: Props) {
  const t = useTranslations('security');
  const common = useTranslations('common');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [codesOpen, setCodesOpen] = useState(false);

  const done = (title: string) => {
    toast.ok({ title, closeLabel: common('close') });
    router.refresh();
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Section
        title={t('mfa')}
        action={
          mfaEnabled ? (
            <StatusPill status="ok">{t('mfaOn')}</StatusPill>
          ) : (
            <StatusPill status="warn">{t('mfaOff')}</StatusPill>
          )
        }
      >
        <p className="m-0 text-table">{mfaEnabled ? t('mfaOnBody') : t('mfaOffBody')}</p>
        <div>
          {mfaEnabled ? (
            <Button size="s" variant="secondary" icon={KeyRound} onClick={() => setCodesOpen(true)}>
              {t('newCodes')}
            </Button>
          ) : (
            <Button size="s" variant="primary" asChild>
              <Link href="/login/mfa/setup">
                <Icon icon={ShieldCheck} size={16} />
                {t('mfaSetup')}
              </Link>
            </Button>
          )}
        </div>
        {isAdmin && (
          <div className="flex flex-col gap-2 pt-3 shadow-hairline-t">
            <label className="flex items-center justify-between gap-4 text-table font-semibold">
              {t('requireAll')}
              <Switch
                checked={requireMfaAll}
                disabled={pending}
                onCheckedChange={(v) =>
                  startTransition(async () => {
                    const r = await setSecurity({ requireMfaAll: v });
                    if (r.ok) done(t('saved'));
                  })
                }
              />
            </label>
            <p className="m-0 text-meta text-fg-2">
              {missingMfa.length
                ? t('requireAllMissing', { names: missingMfa.join(', ') })
                : t('requireAllNone')}
            </p>
          </div>
        )}
      </Section>

      <Passkeys />

      <Section
        title={t('sessions')}
        action={
          sessions.length > 1 && (
            <Button
              size="s"
              variant="secondary"
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await logoutOtherSessions();
                  if (r.ok) done(t('loggedOutOthers', { count: r.data?.count ?? 0 }));
                })
              }
            >
              {t('logoutOthers')}
            </Button>
          )
        }
      >
        <ul className="m-0 flex list-none flex-col p-0">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex h-14 items-center gap-3 text-table shadow-hairline-b last:shadow-none"
            >
              <Icon icon={Laptop} size={18} className="text-fg-2" />
              <span className="flex flex-1 flex-col">
                <span className="font-semibold">{s.device}</span>
                <span className="text-meta font-medium text-fg-2">{s.ip ?? '–'}</span>
              </span>
              <span className="text-meta font-medium text-fg-2">
                {s.current ? t('now') : formatRelative(new Date(s.lastActive), new Date(), locale)}
              </span>
              {s.current ? (
                <span className="text-meta font-semibold">{t('thisDevice')}</span>
              ) : (
                <Button
                  size="s"
                  variant="ghost"
                  onClick={() =>
                    startTransition(async () => {
                      const r = await logoutSession(s.id);
                      if (r.ok) router.refresh();
                    })
                  }
                >
                  {t('logoutSession')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {isAdmin && (
        <Section title={t('support')}>
          <label className="flex items-center justify-between gap-4 text-table font-semibold">
            {t('supportRequire')}
            <Switch
              checked={supportRequiresApproval}
              disabled={pending}
              onCheckedChange={(v) =>
                startTransition(async () => {
                  const r = await setSecurity({ supportRequiresApproval: v });
                  if (r.ok) done(t('saved'));
                })
              }
            />
          </label>
          <p className="m-0 text-meta text-fg-2">{t('supportRequireHelp')}</p>
          <div className="flex flex-col gap-3 pt-3 shadow-hairline-t">
            {grants.length === 0 ? (
              <p className="m-0 text-table text-fg-2">{t('noRequests')}</p>
            ) : (
              grants.map((g) => {
                const now = Date.now();
                const expired = new Date(g.expiresAt).getTime() <= now;
                const state = g.revokedAt
                  ? 'revoked'
                  : g.deniedAt
                    ? 'denied'
                    : expired
                      ? 'expired'
                      : g.approvedAt
                        ? 'active'
                        : 'pending';
                return (
                  <div key={g.id} className="flex flex-col gap-2 text-table">
                    <p className="m-0">
                      <span className="font-semibold">{t('latestRequest')}</span>{' '}
                      {t('request', {
                        name: g.supportName,
                        date: formatDateTime(new Date(g.requestedAt), locale),
                        case: g.caseRef,
                      })}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill
                        status={
                          state === 'active' ? 'warn' : state === 'pending' ? 'info' : 'paused'
                        }
                      >
                        {state === 'active'
                          ? t('statusActive', {
                              time: `${formatDate(new Date(g.expiresAt), locale)} ${formatTime(new Date(g.expiresAt), locale)}`,
                            })
                          : t(
                              `status${state.charAt(0).toUpperCase()}${state.slice(1)}` as 'statusPending',
                            )}
                      </StatusPill>
                      {state === 'pending' && (
                        <>
                          <Button
                            size="s"
                            variant="primary"
                            onClick={() =>
                              startTransition(
                                async () =>
                                  void (
                                    (await decideSupport(g.id, 'approve')).ok && done(t('saved'))
                                  ),
                              )
                            }
                          >
                            {t('approve')}
                          </Button>
                          <Button
                            size="s"
                            variant="secondary"
                            onClick={() =>
                              startTransition(
                                async () =>
                                  void ((await decideSupport(g.id, 'deny')).ok && done(t('saved'))),
                              )
                            }
                          >
                            {t('deny')}
                          </Button>
                        </>
                      )}
                      {state === 'active' && (
                        <Button
                          size="s"
                          variant="destructive"
                          onClick={() =>
                            startTransition(
                              async () =>
                                void ((await decideSupport(g.id, 'revoke')).ok && done(t('saved'))),
                            )
                          }
                        >
                          {t('revokeAccess')}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <Link
              href="/settings/audit-log?support=1"
              className="text-table font-semibold text-fg-1"
            >
              {t('seeAudit')}
            </Link>
          </div>
        </Section>
      )}

      <BackupCodesDialog open={codesOpen} onOpenChange={setCodesOpen} />
    </div>
  );
}

/* ---- Passkeys: managed through Better Auth's passkey plugin --------------------------------------- */

interface PasskeyItem {
  id: string;
  name?: string | null;
  createdAt: string | Date;
}

function Passkeys() {
  const t = useTranslations('security');
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

  return (
    <Section
      title={t('passkeys')}
      action={
        <Button
          size="s"
          variant="secondary"
          icon={Plus}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const r = await authClient.passkey.addPasskey({
              name: navigator.platform || 'Passkey',
            });
            setBusy(false);
            if (r?.error) toast.error({ title: t('passkeyError'), closeLabel: common('close') });
            else {
              toast.ok({ title: t('passkeyAdded'), closeLabel: common('close') });
              void load();
            }
          }}
        >
          {t('addPasskey')}
        </Button>
      }
    >
      {items && items.length === 0 && (
        <p className="m-0 text-table text-fg-2">{t('passkeysEmpty')}</p>
      )}
      <ul className="m-0 flex list-none flex-col p-0">
        {items?.map((p) => (
          <li
            key={p.id}
            className="flex h-14 items-center gap-3 text-table shadow-hairline-b last:shadow-none"
          >
            <Icon icon={Fingerprint} size={18} className="text-fg-2" />
            <span className="flex-1">
              <span className="font-semibold">{p.name || 'Passkey'}</span>{' '}
              <span className="text-meta font-medium text-fg-2">
                · {t('passkeyCreated', { date: formatDate(new Date(p.createdAt), locale) })}
              </span>
            </span>
            <Button
              size="s"
              variant="ghost"
              onClick={async () => {
                await authClient.passkey.deletePasskey({ id: p.id });
                toast.ok({ title: t('passkeyRemoved'), closeLabel: common('close') });
                void load();
              }}
            >
              {t('removePasskey')}
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function BackupCodesDialog({
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
    <Dialog
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
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            {auth('backupDone')}
          </Button>
        ) : (
          <Button
            variant="primary"
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
          </Button>
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
          <Field label={t('newCodesPassword')}>
            {({ id }) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
        </>
      )}
    </Dialog>
  );
}
