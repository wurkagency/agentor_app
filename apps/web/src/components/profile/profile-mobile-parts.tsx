'use client';

import { formatDate, type Locale } from '@agentor/i18n';
import { Banner, Button, Icon, Switch } from '@agentor/ui';
import { BigButton, MobileCard, Modal, Row, RowIcon, SectionHeading } from '@agentor/ui/mobile';
import {
  ChevronRight,
  Fingerprint,
  Globe,
  KeyRound,
  Laptop,
  LogOut,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { forgetDevice } from '@/components/mobile/pwa';
import { authClient } from '@/lib/auth-client';
import type { ProfileView } from '@/server/profile/view';
import { DetailsFields, useDetails } from './details-form';
import { SecurityDialogs, useSecurity } from './security-section';

/** "+45 •• •• 31 07": the phone number with its middle hidden, as on MP29/MA36. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\s+/g, ' ').trim();
  if (digits.length < 6) return digits;
  return `${digits.slice(0, 3)} •• •• ${digits.slice(-5).trim()}`;
}

/** Personlige oplysninger as rows; "Redigér" and every row open the edit sheet. */
export function MobileDetails({ view }: { view: ProfileView }) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const state = useDetails(view.kind, view.details);
  const [open, setOpen] = useState(false);
  const d = view.details;
  const tz = t(`tz.${d.timeZone.replace('/', '_')}` as 'tz.UTC');
  const row = (icon: typeof UserRound, title: string, meta: string) => (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex min-h-14 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 text-left font-sans text-fg-1 shadow-row-divider last:shadow-none"
    >
      <RowIcon icon={icon} />
      <span className="flex min-w-0 flex-1 flex-col py-2.5 leading-snug">
        <strong className="truncate text-body font-semibold">{title}</strong>
        <span className="truncate text-meta font-medium text-fg-2">{meta}</span>
      </span>
      <Icon icon={ChevronRight} size={18} className="text-fg-2" />
    </button>
  );
  return (
    <>
      <div className="mx-1 mt-3.5 flex items-center justify-between">
        <SectionHeading flush>{t('details.heading')}</SectionHeading>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-11 cursor-pointer border-0 bg-transparent px-2 font-sans text-table font-semibold text-fg-1"
        >
          {t('details.edit')}
        </button>
      </div>
      <MobileCard>
        {row(UserRound, t('details.name'), view.name)}
        {row(Mail, t('details.email'), d.email)}
        {row(Phone, t('details.phone'), d.phone ? maskPhone(d.phone) : t('details.none'))}
        {row(
          Globe,
          t('details.languageAndZone'),
          `${d.locale === 'en' ? t('lang.en') : t('lang.da')} · ${tz}`,
        )}
      </MobileCard>
      <Modal
        open={open}
        onOpenChange={(o) => {
          if (!o) state.reset();
          setOpen(o);
        }}
        title={t('details.heading')}
        closeLabel={tc('close')}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <BigButton
              variant="secondary"
              onClick={() => {
                state.reset();
                setOpen(false);
              }}
            >
              {t('details.cancel')}
            </BigButton>
            <BigButton
              variant="primary"
              loading={state.pending}
              onClick={() => state.save(() => setOpen(false))}
            >
              {t('details.save')}
            </BigButton>
          </div>
        }
      >
        {state.error && <Banner tone="error">{t('details.error')}</Banner>}
        <DetailsFields kind={view.kind} state={state} columns={1} />
      </Modal>
    </>
  );
}

/** Login og sikkerhed on the phone: the same actions as desktop, as rows. */
export function MobileSecurity({
  kind,
  s,
}: {
  kind: 'staff' | 'customer';
  s: ProfileView['security'];
}) {
  const t = useTranslations('profile.security');
  const locale = useLocale() as Locale;
  const sec = useSecurity(kind);
  const others = s.sessions.filter((x) => !x.current).length;
  return (
    <>
      <SectionHeading>{t('heading')}</SectionHeading>
      <MobileCard>
        <Row
          leading={<RowIcon icon={KeyRound} />}
          title={t('password')}
          meta={
            s.passwordChangedAt
              ? t('passwordChanged', { date: formatDate(new Date(s.passwordChangedAt), locale) })
              : t('noPassword')
          }
          trailing={
            s.hasPassword ? (
              <Button variant="secondary" size="s" onClick={() => sec.setDialog('password')}>
                {t('changeShort')}
              </Button>
            ) : undefined
          }
        />
        <Row
          leading={<RowIcon icon={ShieldCheck} />}
          title={t('twoFactor')}
          meta={s.twoFactorEnabled ? t('twoFactorOnShort') : t('twoFactorOff')}
          trailing={
            <Switch
              aria-label={t('twoFactor')}
              checked={s.twoFactorEnabled}
              disabled={s.twoFactorEnabled && s.mustKeepTwoFactor}
              onCheckedChange={(on) => {
                if (on) window.location.assign('/login/mfa/setup');
                else sec.setDialog('disable2fa');
              }}
            />
          }
        />
        <Row
          leading={<RowIcon icon={Fingerprint} />}
          title={t('passkeys')}
          meta={
            s.passkeys.length
              ? s.passkeys.map((p) => p.name || t('passkey')).join(' · ')
              : t('noPasskeys')
          }
          trailing={
            <Button variant="secondary" size="s" loading={sec.pending} onClick={sec.addPasskey}>
              {t('add')}
            </Button>
          }
        />
        <Row
          leading={<RowIcon icon={Laptop} />}
          title={t('sessions')}
          meta={t('otherDevices', { count: others })}
          trailing={
            <Button
              variant="secondary"
              size="s"
              disabled={others === 0}
              loading={sec.pending}
              onClick={sec.logoutOthers}
            >
              {t('logoutShort')}
            </Button>
          }
        />
        <Row
          leading={<RowIcon icon={Mail} />}
          title={t('loginEmail')}
          meta={s.email}
          trailing={
            <Button variant="secondary" size="s" onClick={() => sec.setDialog('email')}>
              {t('changeShort')}
            </Button>
          }
        />
      </MobileCard>
      <SecurityDialogs sec={sec} email={s.email} />
    </>
  );
}

export function MobileLogout() {
  const t = useTranslations('profile');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <BigButton
      variant="secondary"
      className="mt-3 text-error-fg shadow-ring-error"
      loading={pending}
      onClick={() =>
        start(async () => {
          await forgetDevice();
          await authClient.signOut();
          router.replace('/login');
          router.refresh();
        })
      }
    >
      <Icon icon={LogOut} size={18} />
      {t('logout.button')}
    </BigButton>
  );
}
