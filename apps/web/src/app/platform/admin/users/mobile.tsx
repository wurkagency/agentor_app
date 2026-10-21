import type { StaffMember } from '@agentor/db';
import { formatDate, formatRelative, type Locale } from '@agentor/i18n';
import { Avatar, StatusPill } from '@agentor/ui';
import { ExpandCard, KV, MobileFootnote, MobileShell } from '@agentor/ui/mobile';
import { getLocale, getTranslations } from 'next-intl/server';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { InviteStaffAction, RulesEdit, StaffActions } from './mobile-controls';
import { RIGHTS } from './rights';

/** Off in RulesForm is stored as 50, the highest the setting allows. */
const WARN_OFF = 50;

/**
 * MP12 Platformbrugere (P6, Superadmin only): one foldable row per staff member with role,
 * access, last activity, two-step and active grants; the rights per role and the access rules
 * below. No customer data here (decision 16).
 */
export async function PlatformUsersMobile({
  staff,
  grantCounts,
  selfId,
  warnConcurrent,
}: {
  staff: StaffMember[];
  grantCounts: Record<string, number>;
  selfId: string;
  warnConcurrent: number;
}) {
  const t = await getTranslations('platform.users');
  const tm = await getTranslations('mobile.platformUsers');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const lastActive = (d: Date | null) =>
    !d
      ? '–'
      : now.getTime() - d.getTime() < 5 * 60_000
        ? tm('activeNow')
        : formatRelative(d, now, locale);
  const firstOther = staff.find((s) => s.userId !== selfId)?.userId;
  const cell = (on: boolean) =>
    on ? (
      <StatusPill status="ok">{t('yes')}</StatusPill>
    ) : (
      <span className="text-meta text-fg-2">{t('no')}</span>
    );
  const warnOn = warnConcurrent < WARN_OFF;

  return (
    <MobileShell
      topBar={
        <PlatformTopBar
          back="/platform/customers"
          title={t('nav')}
          subtitle={tm('count', { count: staff.length })}
          actions={<InviteStaffAction />}
        />
      }
    >
      <MobileFootnote>{tm('intro')}</MobileFootnote>
      {staff.map((s) => {
        const role = t(`roles.${s.role}`);
        const access = s.disabled
          ? t('disabled')
          : s.probationUntil
            ? tm('probation', { date: formatDate(s.probationUntil, locale).replace(/ \d{4}$/, '') })
            : s.role === 'superadmin'
              ? t('accessAll')
              : t('accessSupport');
        return (
          <ExpandCard
            key={s.userId}
            open={s.userId === firstOther}
            {...(s.disabled ? { className: 'opacity-60' } : {})}
            leading={
              <Avatar name={s.name} size={32} tone={s.role === 'superadmin' ? 'navy' : 'light'} />
            }
            title={s.name}
            meta={`${role} · ${s.disabled ? t('disabled') : lastActive(s.lastActiveAt)}`}
          >
            <KV k={t('email')}>{s.email}</KV>
            <KV k={t('role')}>{role}</KV>
            <KV k={t('colAccess')}>{access}</KV>
            <KV k={t('colLastActive')}>{lastActive(s.lastActiveAt)}</KV>
            <KV k={t('colMfa')}>
              <StatusPill status={s.twoFactor ? 'ok' : 'warn'}>
                {s.twoFactor ? t('mfaOn') : t('mfaOff')}
              </StatusPill>
            </KV>
            <KV k={t('colGrants')}>{grantCounts[s.userId] ?? 0}</KV>
            {s.userId !== selfId && !s.disabled && (
              <StaffActions userId={s.userId} name={s.name} email={s.email} role={s.role} />
            )}
          </ExpandCard>
        );
      })}
      <ExpandCard
        title={t('rightsTitle')}
        meta={`${t('roles.superadmin')} · ${t('roles.supporter')}`}
      >
        {RIGHTS.map(([key, sa, sup]) => (
          <KV key={key} k={tm(`rights.${key}`)}>
            <span className="sr-only">
              {tm('rightsCell', {
                superadmin: sa ? t('yes') : t('no'),
                supporter: sup ? t('yes') : t('no'),
              })}
            </span>
            <span aria-hidden className="inline-flex items-center gap-1.5">
              {cell(sa)}·{cell(sup)}
            </span>
          </KV>
        ))}
      </ExpandCard>
      <ExpandCard title={t('rulesTitle')} meta={tm('rulesMeta')}>
        <KV k={tm('maxDuration')}>{t('hours24')}</KV>
        <KV k={t('requireCase')}>
          <StatusPill status="ok">{tm('on')}</StatusPill>
        </KV>
        <KV k={tm('warnAt')}>
          {warnOn ? tm('warnAtValue', { count: warnConcurrent }) : tm('off')}
        </KV>
        <RulesEdit warnConcurrent={warnOn ? warnConcurrent : 0} />
        <p className="m-0 pt-2 text-meta font-medium text-fg-2">{tm('noStanding')}</p>
      </ExpandCard>
    </MobileShell>
  );
}
