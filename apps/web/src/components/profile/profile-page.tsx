import {
  AchievementMedal,
  ActivityHeatmap,
  ProfileCard,
  ProfileHero,
  StreakBand,
} from '@agentor/ui';
import { Responsive } from '@agentor/ui/mobile';
import { formatDate, type Locale } from '@agentor/i18n';
import { getTranslations } from 'next-intl/server';
import type { ProfileView } from '@/server/profile/view';
import { DetailsCard } from './details-card';
import { EditProfileButton, ProfileAnchorNav } from './profile-nav';
import { HeroAvatar } from './profile-avatar';
import { NotifyCard } from './notify-card';
import { ProfileMobile } from './profile-mobile';
import { LogoutCard, SecurityCard } from './security-section';

/**
 * The profile dashboard (README decision 25): one component set for staff (PR1, MP29) and
 * customers (D15, MA36), with the role's data. A centred column, max 1040 px on desktop; stacked
 * cards on the phone.
 */
export async function ProfilePage({ view, locale }: { view: ProfileView; locale: Locale }) {
  const t = await getTranslations('profile');
  const heat = view.heat.map((h) => ({
    date: h.date,
    level: h.level,
    title: t('heatDay', {
      date: formatDate(new Date(`${h.date}T12:00:00Z`), locale),
      count: h.count,
    }),
  }));
  const earned = view.achievements.filter((a) => a.earned).length;
  const desktop = (
    <main id="main" className="flex-1 px-gutter pb-12 pt-6">
      <div className="mx-auto flex w-full max-w-profile flex-col gap-5">
        <ProfileHero
          avatar={
            <HeroAvatar
              kind={view.kind}
              userId={view.userId}
              version={view.avatarVersion}
              initials={view.initials}
            />
          }
          eyebrow={view.eyebrow}
          name={view.name}
          chips={view.chips}
          actions={<EditProfileButton label={t('edit')} />}
          since={view.since}
          stats={view.kpis}
        />
        <ProfileAnchorNav
          label={t('nav.label')}
          items={[
            { id: 'overblik', label: t('nav.overview') },
            { id: 'oplysninger', label: t('nav.details') },
            { id: 'sikkerhed', label: t('nav.security') },
            { id: 'notifikationer', label: t('nav.notifications') },
          ]}
        />
        <div className="grid items-start gap-5 lg:grid-cols-profile">
          <ProfileCard
            id="overblik"
            title={t('achievementsTitle')}
            meta={
              <span className="text-meta text-fg-2">
                {t('achievementsEarned', { earned, total: view.achievements.length })}
              </span>
            }
          >
            {view.achievements.length ? (
              <ul className="m-0 grid list-none grid-cols-3 gap-3 p-0">
                {view.achievements.map((a) => (
                  <AchievementMedal
                    key={a.key}
                    icon={a.icon}
                    title={a.title}
                    description={a.description}
                    earned={a.earned}
                    value={a.value}
                    threshold={a.threshold}
                    progressLabel={t('progress', { value: a.value, threshold: a.threshold })}
                  />
                ))}
              </ul>
            ) : (
              <p className="m-0 text-body text-fg-2">{t('noAchievements')}</p>
            )}
          </ProfileCard>
          <ProfileCard
            title={t('engagementTitle')}
            meta={<span className="text-meta text-fg-2">{t('lastWeeks')}</span>}
          >
            <StreakBand headline={view.streak.headline} sub={view.streak.sub} />
            <ActivityHeatmap days={heat} label={view.heatLabel} less={t('less')} more={t('more')} />
            <dl className="m-0 flex flex-col gap-1.5">
              {view.summary.map((s) => (
                <div key={s.label} className="flex justify-between gap-3 text-table">
                  <dt className="text-fg-2">{s.label}</dt>
                  <dd className="m-0 font-semibold">{s.value}</dd>
                </div>
              ))}
            </dl>
          </ProfileCard>
        </div>
        <DetailsCard view={view} />
        <div className="grid items-start gap-5 lg:grid-cols-profile">
          <SecurityCard kind={view.kind} s={view.security} />
          <NotifyCard items={view.notifications} />
        </div>
        <LogoutCard kind={view.kind} />
      </div>
    </main>
  );
  return <Responsive desktop={desktop} mobile={<ProfileMobile view={view} heat={heat} />} />;
}
