'use client';

import { Banner, ProfileCard } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import type { ProfileView } from '@/server/profile/view';
import { DetailsActions, DetailsFields, useDetails } from './details-form';
import { AvatarField } from './profile-avatar';

/** Personlige oplysninger (PR1/D15): photo, then the form, with Annullér / Gem ændringer. */
export function DetailsCard({ view }: { view: ProfileView }) {
  const t = useTranslations('profile');
  const state = useDetails(view.kind, view.details);
  return (
    <ProfileCard
      id="oplysninger"
      title={t('details.heading')}
      meta={<DetailsActions state={state} />}
    >
      <AvatarField
        kind={view.kind}
        userId={view.userId}
        version={view.avatarVersion}
        initials={view.initials}
      />
      {state.error && <Banner tone="error">{t('details.error')}</Banner>}
      <DetailsFields kind={view.kind} state={state} />
    </ProfileCard>
  );
}
