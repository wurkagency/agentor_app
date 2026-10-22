import { ActivityHeatmap, ProfileHero, StreakBand } from '@agentor/ui';
import { MobileCard, MobileShell, SectionHeading } from '@agentor/ui/mobile';
import { getTranslations } from 'next-intl/server';
import { AppTopBar, PlatformTopBar } from '@/components/mobile/chrome';
import type { ProfileView } from '@/server/profile/view';
import { HeroAvatar } from './profile-avatar';
import { MobileDetails, MobileLogout, MobileSecurity } from './profile-mobile-parts';

/**
 * MP29 (Platform) and MA36 (customer app): the profile as stacked cards under a full-bleed hero.
 * Personal details open an edit sheet. No medals and no notification switches on the phone, as on
 * the boards (PLAN-2026-10-21 Q2).
 */
export async function ProfileMobile({
  view,
  heat,
}: {
  view: ProfileView;
  heat: { date: string; level: 0 | 1 | 2 | 3 | 4; title: string }[];
}) {
  const t = await getTranslations('profile');
  // MP29 swaps "Registreret tid" for the streak; MA36 keeps the four key figures.
  const stats =
    view.kind === 'staff'
      ? [
          {
            value: view.kpis[0]!.value,
            label: t('staff.kpiResolvedShort', { month: view.monthShort }),
          },
          view.kpis[2]!,
          view.kpis[3]!,
          { value: t('days', { count: view.streak.value }), label: t('staff.kpiStreak') },
        ]
      : view.kpis;
  return (
    <MobileShell topBar={view.kind === 'staff' ? <PlatformTopBar /> : <AppTopBar />}>
      <ProfileHero
        mobile
        avatar={
          <HeroAvatar
            kind={view.kind}
            userId={view.userId}
            version={view.avatarVersion}
            initials={view.initials}
            mobile
          />
        }
        eyebrow={view.eyebrow}
        name={view.name}
        chips={view.chips}
        since={view.since}
        stats={stats}
      />
      <SectionHeading>{t('engagementTitle')}</SectionHeading>
      <MobileCard>
        <div className="flex flex-col gap-3 px-4 py-3.5">
          <StreakBand headline={view.streak.headline} sub={view.streak.sub} />
          <ActivityHeatmap
            days={heat}
            label={view.heatLabel}
            less={t('less')}
            more={t('more')}
            cell="mobile"
          />
          <dl className="m-0 flex flex-col gap-1.5">
            {view.summary.slice(0, 2).map((s) => (
              <div key={s.label} className="flex justify-between gap-3 text-table">
                <dt className="text-fg-2">{s.label}</dt>
                <dd className="m-0 text-right font-semibold">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </MobileCard>
      <MobileDetails view={view} />
      <MobileSecurity kind={view.kind} s={view.security} />
      <MobileLogout />
    </MobileShell>
  );
}
