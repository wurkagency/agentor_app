import {
  achievementDefinitionsFor,
  customerProfileStats,
  getNotificationSettings,
  getProfile,
  listUserSessions,
  mustKeepTwoFactor,
  previousSignIn,
  recordAchievements,
  securityOverview,
  staffProfileStats,
  type AchievementDefinition,
  type CustomerProfileStats,
  type StaffProfileStats,
} from '@agentor/db';
import { formatDate, formatMinutes, formatNumber, formatTime, type Locale } from '@agentor/i18n';
import { getTranslations } from 'next-intl/server';
import { addDaysIso, copenhagenToday } from '../date-range';
import { db } from '../infra';
import type { ProfileOwner } from './owner';

/**
 * Everything the profile dashboard shows (PR1, D15, MP29, MA36), built on the server from data
 * that exists. A figure the data can't back is null and shows as "–"; an achievement whose metric
 * has no data is disabled in achievement_definitions and never reaches here.
 */

export const HEAT_DAYS = 84;

export interface HeatDay {
  date: string;
  count: number;
  /** 0 none, 1–4 the user's own quartiles of active days. */
  level: 0 | 1 | 2 | 3 | 4;
}

export interface AchievementView {
  key: string;
  icon: string;
  title: string;
  description: string;
  earned: boolean;
  earnedAt: string | null;
  value: number;
  threshold: number;
}

export interface ProfileView {
  kind: 'staff' | 'customer';
  userId: string;
  name: string;
  initials: string;
  email: string;
  hasAvatar: boolean;
  avatarVersion: string | null;
  eyebrow: string;
  chips: { icon: 'mail' | 'shield' | 'globe'; text: string }[];
  since: string;
  kpis: { value: string; label: string }[];
  /** "okt.": the month in the phone KPI label (MP29). */
  monthShort: string;
  achievements: AchievementView[];
  streak: { value: number; best: number; headline: string; sub: string };
  heat: HeatDay[];
  heatLabel: string;
  summary: { label: string; value: string }[];
  details: {
    givenName: string;
    familyName: string;
    email: string;
    phone: string;
    locale: 'da' | 'en';
    timeZone: string;
    city: string;
    title: string;
    /** Customers: the membership role, read-only. */
    roleLabel: string | null;
  };
  security: {
    email: string;
    hasPassword: boolean;
    passwordChangedAt: string | null;
    emailVerified: boolean;
    twoFactorEnabled: boolean;
    mustKeepTwoFactor: boolean;
    passkeys: { id: string; name: string | null; createdAt: string | null }[];
    sessions: { id: string; label: string; current: boolean }[];
  };
  /** Customers: the four alerts on D15. Staff have no notification settings yet (null). */
  notifications: { event: string; label: string; channels: string; on: boolean }[] | null;
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    (words[0]?.[0] ?? '') + (words.length > 1 ? (words.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

/** Levels from the user's own active days: quartiles, so the map compares the user with themselves. */
export function heatLevels(counts: Record<string, number>, today: string): HeatDay[] {
  const start = addDaysIso(today, -(HEAT_DAYS - 1));
  const days = Array.from({ length: HEAT_DAYS }, (_, i) => addDaysIso(start, i));
  const active = days
    .map((d) => counts[d] ?? 0)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const q = (p: number) => active[Math.min(active.length - 1, Math.floor(p * active.length))] ?? 0;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  return days.map((date) => {
    const count = counts[date] ?? 0;
    const level = count === 0 ? 0 : count <= q1 ? 1 : count <= q2 ? 2 : count <= q3 ? 3 : 4;
    return { date, count, level: level as HeatDay['level'] };
  });
}

/** Days in a row with activity, ending today (or yesterday if today has none yet), and the best run. */
export function streakOf(days: Set<string>, today: string): { current: number; best: number } {
  let current = 0;
  let d = days.has(today) ? today : addDaysIso(today, -1);
  while (days.has(d)) {
    current += 1;
    d = addDaysIso(d, -1);
  }
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const x of sorted) {
    run = prev && addDaysIso(prev, 1) === x ? run + 1 : 1;
    best = Math.max(best, run);
    prev = x;
  }
  return { current, best: Math.max(best, current) };
}

const dayOf = (d: Date) => copenhagenToday(d);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
}

/** "Chrome på macOS", "Safari på iPhone" from a user agent; never more than that. */
export function deviceLabel(
  ua: string | null,
  t: (k: string, v?: Record<string, string>) => string,
) {
  if (!ua) return t('device.unknown');
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : t('device.browser');
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  return os ? t('device.on', { browser, os }) : browser;
}

function progressStaff(d: AchievementDefinition, s: StaffProfileStats, today: string): number {
  switch (d.metric) {
    case 'cases_resolved_total':
      return s.resolvedAt.length;
    case 'colleagues_helped':
      return s.colleaguesHelped;
    case 'weeks_median_reply_under_45': {
      // Consecutive weeks (newest first) whose median first reply was under 45 minutes.
      let weeks = 0;
      for (let w = 0; w < d.threshold; w++) {
        const end = addDaysIso(today, -7 * w);
        const start = addDaysIso(end, -6);
        const m = median(
          s.replies.filter((r) => dayOf(r.at) >= start && dayOf(r.at) <= end).map((r) => r.minutes),
        );
        if (m === null || m >= 45) break;
        weeks += 1;
      }
      return weeks;
    }
    default:
      return 0;
  }
}

/** Days in a row (ending yesterday) without failed records, counted from the first run. */
function cleanDays(c: CustomerProfileStats, today: string): number {
  if (!c.firstRunDay) return 0;
  const failed = new Set(c.failedDays);
  let n = 0;
  let d = addDaysIso(today, -1);
  while (d >= c.firstRunDay && !failed.has(d) && n < 400) {
    n += 1;
    d = addDaysIso(d, -1);
  }
  return n;
}

function progressCustomer(
  d: AchievementDefinition,
  c: CustomerProfileStats,
  today: string,
): number {
  switch (d.metric) {
    case 'flows_live':
      return c.flowsLive;
    case 'max_records_one_day':
      return c.maxRecordsDay;
    case 'invitations_sent':
      return c.invitationsSent;
    case 'errors_fixed_within_hour':
      return c.fixedWithinHour;
    case 'days_without_failed_records':
      return cleanDays(c, today);
    case 'members_with_two_factor':
      return c.membersTwoFactor;
    default:
      return 0;
  }
}

export async function profileView(o: ProfileOwner, locale: Locale): Promise<ProfileView> {
  const t = await getTranslations({ locale, namespace: 'profile' });
  const now = new Date();
  const today = copenhagenToday(now);
  const userId = o.session.user.id;
  const audience = o.kind;
  const [profile, security, sessions, mustKeep, defs, prevSignIn] = await Promise.all([
    getProfile(db(), userId),
    securityOverview(db(), userId),
    listUserSessions(db(), userId),
    mustKeepTwoFactor(db(), userId),
    achievementDefinitionsFor(db(), userId, audience),
    previousSignIn(db(), userId, o.session.sessionId),
  ]);
  const monthName = new Intl.DateTimeFormat(locale === 'da' ? 'da-DK' : 'en-GB', {
    month: 'long',
    timeZone: 'Europe/Copenhagen',
  }).format(now);
  const monthShort = new Intl.DateTimeFormat(locale === 'da' ? 'da-DK' : 'en-GB', {
    month: 'short',
    timeZone: 'Europe/Copenhagen',
  }).format(now);
  const monthYear = (d: Date) =>
    new Intl.DateTimeFormat(locale === 'da' ? 'da-DK' : 'en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Copenhagen',
    }).format(d);
  const n = (v: number) => formatNumber(v, locale);
  const langName = profile.locale === 'en' ? t('lang.en') : t('lang.da');

  let kpis: ProfileView['kpis'];
  let progress: (d: AchievementDefinition) => number;
  let describe: (d: AchievementDefinition) => string;
  let streak: ProfileView['streak'];
  let activity: Record<string, number>;
  let summary: ProfileView['summary'];
  let eyebrow: string;
  let since: string;
  let roleLabel: string | null = null;
  let notifications: ProfileView['notifications'] = null;
  let customer: CustomerProfileStats | null = null;

  if (o.kind === 'staff') {
    const s = await staffProfileStats(
      db(),
      userId,
      new Date(now.getTime() - 120 * 86_400_000),
      `${today.slice(0, 7)}-01`,
    );
    const thisMonth = s.resolvedAt.filter((d) => dayOf(d).slice(0, 7) === today.slice(0, 7));
    const monthReplies = s.replies
      .filter((r) => dayOf(r.at).slice(0, 7) === today.slice(0, 7))
      .map((r) => r.minutes);
    const med = median(monthReplies);
    kpis = [
      { value: n(thisMonth.length), label: t('staff.kpiResolved', { month: monthName }) },
      { value: formatMinutes(s.minutesThisMonth, locale), label: t('staff.kpiTime') },
      {
        value: med === null ? '–' : formatMinutes(Math.round(med), locale),
        label: t('staff.kpiReply'),
      },
      // Customer satisfaction isn't recorded anywhere yet (PLAN-2026-10-21 Q7).
      { value: '–', label: t('staff.kpiSatisfied') },
    ];
    progress = (d) => progressStaff(d, s, today);
    describe = (d) =>
      d.key === 'cases_100'
        ? t('achievements.cases_100.earned', {
            total: n(s.resolvedAt.length),
            since: monthYear(s.staffSince ?? profile.createdAt),
          })
        : t(`achievements.${d.key}.description` as 'achievements.team_player.description');
    const resolvedDays = new Set(s.resolvedAt.map(dayOf));
    const st = streakOf(resolvedDays, today);
    streak = {
      value: st.current,
      best: st.best,
      headline: t('staff.streak', { count: st.current }),
      sub: t('staff.streakSub', { best: st.best }),
    };
    activity = {};
    for (const d of [...s.resolvedAt, ...s.sessions]) {
      const k = dayOf(d);
      activity[k] = (activity[k] ?? 0) + 1;
    }
    const weekday = new Map<number, number>();
    for (const [k, v] of Object.entries(activity)) {
      if (k < addDaysIso(today, -(HEAT_DAYS - 1))) continue;
      const wd = new Date(`${k}T12:00:00Z`).getUTCDay();
      weekday.set(wd, (weekday.get(wd) ?? 0) + v);
    }
    const busiest = [...weekday.entries()].sort((a, b) => b[1] - a[1])[0];
    summary = [
      { label: t('staff.totalResolved'), value: n(s.resolvedAt.length) },
      {
        label: t('staff.sessions'),
        value: t('staff.sessionsValue', { count: s.sessions.length, pct: s.autoShare }),
      },
      {
        label: t('staff.busiest'),
        value: busiest
          ? new Intl.DateTimeFormat(locale === 'da' ? 'da-DK' : 'en-GB', { weekday: 'long' })
              .format(new Date(Date.UTC(2026, 9, 18 + busiest[0])))
              .replace(/^./, (c) => c.toUpperCase())
          : '–',
      },
    ];
    eyebrow = t('staff.eyebrow', { role: t(`role.${o.role ?? 'supporter'}`) });
    since = t('staff.since', { date: monthYear(s.staffSince ?? profile.createdAt) });
  } else {
    const app = o.app!;
    const c = await customerProfileStats(db(), { tenantId: app.tenant.tenantId, userId }, now);
    customer = c;
    kpis = [
      { value: n(c.records7d), label: t('customer.kpiRecords') },
      { value: n(c.flowsLive), label: t('customer.kpiFlows') },
      { value: n(c.errorsFixed), label: t('customer.kpiFixed') },
      {
        value: c.runs30 === 0 ? '–' : `${formatNumber((c.runsOk30 / c.runs30) * 100, locale, 1)} %`,
        label: t('customer.kpiClean'),
      },
    ];
    progress = (d) => progressCustomer(d, c, today);
    describe = (d) =>
      d.key === 'first_flow_live' && c.firstLiveFlow
        ? c.firstLiveFlow
        : d.key === 'team_two_factor'
          ? t('achievements.team_two_factor.description')
          : t(`achievements.${d.key}.description` as 'achievements.team_player.description');
    // Days without broken connections (system entries in the audit log) and the record gap.
    const breaks = c.connectionBreaks.map((d) => d.getTime()).sort((a, b) => a - b);
    const startAt = c.tenantCreatedAt.getTime();
    const dayMs = 86_400_000;
    const current =
      c.brokenNow > 0 ? 0 : Math.floor((now.getTime() - (breaks.at(-1) ?? startAt)) / dayMs);
    let best = current;
    let prevAt = startAt;
    for (const b of breaks) {
      best = Math.max(best, Math.floor((b - prevAt) / dayMs));
      prevAt = b;
    }
    streak = {
      value: current,
      best,
      headline: t('customer.streak', { count: current }),
      sub: t('customer.streakSub', { best }),
    };
    activity = c.activity;
    summary = [
      { label: t('customer.totalRecords'), value: n(c.recordsTotal) },
      {
        label: t('customer.flowsCreated'),
        value: t('customer.flowsCreatedValue', { count: c.flowsCreated, drafts: c.draftFlows }),
      },
      {
        label: t('customer.lastSignIn'),
        value: prevSignIn
          ? `${dayOf(prevSignIn.at) === today ? t('today') : formatDate(prevSignIn.at, locale)} ${formatTime(prevSignIn.at, locale)} · ${deviceLabel(prevSignIn.userAgent, (k, v) => t(k as 'device.unknown', v))}`
          : '–',
      },
    ];
    roleLabel = t(`roles.${app.tenant.role}` as 'roles.owner');
    eyebrow = `${roleLabel} · ${app.tenant.tenantName}`;
    since = t('customer.since', { date: monthYear(c.tenantCreatedAt) });
    // D15 "Notifikationer": the four alerts, on when they reach you outside the app.
    const settings = await getNotificationSettings(db(), { tenantId: app.tenant.tenantId, userId });
    const channelText = (ch: { inApp: boolean; email: boolean; push: boolean; sms: boolean }) => {
      const list = [
        ch.inApp ? t('channel.app') : null,
        ch.email ? t('channel.email') : null,
        ch.push ? t('channel.push') : null,
        ch.sms ? t('channel.sms') : null,
      ].filter(Boolean) as string[];
      return list.length
        ? new Intl.ListFormat(locale === 'da' ? 'da' : 'en', { type: 'conjunction' })
            .format(list)
            .replace(/^./, (x) => x.toUpperCase())
        : t('channel.none');
    };
    notifications = (
      ['connection_broken', 'systematic_error', 'quota', 'weekly_summary'] as const
    ).map((event) => {
      const ch = settings.matrix[event];
      return {
        event,
        label: t(`notify.${event}`),
        channels: channelText(ch),
        on: ch.email || ch.push || ch.sms,
      };
    });
  }

  const values = new Map(defs.map((d) => [d.key, progress(d)]));
  // "Totrin for hele teamet" is earned when every member has two-step login; the rest at their
  // threshold.
  const allTwoFactor = (c: CustomerProfileStats | null) =>
    Boolean(c && c.members > 0 && c.membersTwoFactor === c.members);
  const thresholdOf = (d: AchievementDefinition) =>
    d.metric === 'members_with_two_factor' ? (customer?.members ?? 0) : d.threshold;
  const reachedNow = defs
    .filter((d) =>
      d.metric === 'members_with_two_factor'
        ? allTwoFactor(customer)
        : (values.get(d.key) ?? 0) >= d.threshold,
    )
    .map((d) => d.key);
  const earned = await recordAchievements(db(), userId, reachedNow);
  const achievements: AchievementView[] = defs.map((d) => {
    const threshold = thresholdOf(d);
    const at = earned.get(d.key);
    return {
      key: d.key,
      icon: d.icon,
      title: t(`achievements.${d.key}.title` as 'achievements.team_player.title'),
      description: describe(d),
      earned: Boolean(at),
      earnedAt: at?.toISOString() ?? null,
      value: Math.min(values.get(d.key) ?? 0, threshold),
      threshold,
    };
  });

  const heat = heatLevels(activity, today);
  const activeDays = heat.filter((h) => h.count > 0).length;
  const twoFactorChip = !security.twoFactorEnabled
    ? t('chip.twoFactorOff')
    : security.passkeys.length
      ? t('chip.twoFactorPasskey')
      : t('chip.twoFactorOn');
  return {
    kind: o.kind,
    userId,
    name: profile.name,
    initials: initialsOf(profile.name),
    email: profile.email,
    hasAvatar: Boolean(profile.avatarKey),
    avatarVersion: profile.avatarKey ? profile.avatarKey.slice(-21, -5) : null,
    eyebrow,
    chips: [
      { icon: 'mail', text: profile.email },
      { icon: 'shield', text: twoFactorChip },
      { icon: 'globe', text: profile.city ? `${langName} · ${profile.city}` : langName },
    ],
    since,
    kpis,
    monthShort,
    achievements,
    streak,
    heat,
    heatLabel: t('heatLabel', { days: activeDays }),
    summary,
    details: {
      givenName: profile.givenName,
      familyName: profile.familyName,
      email: profile.email,
      phone: profile.phone,
      locale: profile.locale,
      timeZone: profile.timeZone,
      city: profile.city,
      title: profile.title,
      roleLabel,
    },
    security: {
      email: profile.email,
      hasPassword: security.hasPassword,
      passwordChangedAt: security.passwordChangedAt?.toISOString() ?? null,
      emailVerified: security.emailVerified,
      twoFactorEnabled: security.twoFactorEnabled,
      mustKeepTwoFactor: mustKeep,
      passkeys: security.passkeys.map((p) => ({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt?.toISOString() ?? null,
      })),
      sessions: sessions.map((s) => ({
        id: s.id,
        label: deviceLabel(s.userAgent, (k, v) => t(k as 'device.unknown', v)),
        current: s.id === o.session.sessionId,
      })),
    },
    notifications,
  };
}
