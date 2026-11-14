'use client';

import { Button, Icon, cn, toast } from '@agentor/ui';
import { Camera, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useTransition } from 'react';
import { removeAvatarAction, uploadAvatarAction } from '@/server/profile/actions';

export const avatarSrc = (userId: string, version: string | null) =>
  version ? `/api/avatar/${userId}?v=${version}` : null;

/** The picture itself: the photo, or initials on lime. */
export function AvatarImage({
  userId,
  version,
  initials,
  size,
}: {
  userId: string;
  version: string | null;
  initials: string;
  size: 'hero' | 'hero-mobile' | 'card';
}) {
  const src = avatarSrc(userId, version);
  return (
    <span
      className={cn(
        'relative grid flex-none place-items-center overflow-hidden rounded-full bg-avatar-lime font-bold text-navy',
        size === 'hero'
          ? 'size-28 text-profile-name shadow-avatar-ring'
          : size === 'hero-mobile'
            ? 'size-24 text-profile-stat shadow-avatar-ring'
            : 'size-16 text-section',
      )}
    >
      <span aria-hidden>{initials}</span>
      {src && (
        // A small private image from our own API; next/image adds nothing here.
        <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
      )}
    </span>
  );
}

function useAvatarUpload(kind: 'staff' | 'customer') {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const pick = () => input.current?.click();
  const field = (
    <input
      ref={input}
      type="file"
      accept="image/png,image/jpeg"
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      data-testid="avatar-file"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const form = new FormData();
        form.set('file', file);
        start(async () => {
          const res = await uploadAvatarAction(kind, form);
          if (!res.ok) {
            toast.error({
              title: t(`avatar.error.${res.error}` as 'avatar.error.TYPE'),
              closeLabel: tc('close'),
            });
            return;
          }
          toast.ok({ title: t('avatar.saved'), closeLabel: tc('close') });
          router.refresh();
        });
      }}
    />
  );
  return { pick, field, pending };
}

/** The hero avatar with the camera button ("Skift profilbillede"). */
export function HeroAvatar({
  kind,
  userId,
  version,
  initials,
  mobile = false,
}: {
  kind: 'staff' | 'customer';
  userId: string;
  version: string | null;
  initials: string;
  mobile?: boolean;
}) {
  const t = useTranslations('profile');
  const { pick, field, pending } = useAvatarUpload(kind);
  return (
    <span className="relative flex-none">
      <AvatarImage
        userId={userId}
        version={version}
        initials={initials}
        size={mobile ? 'hero-mobile' : 'hero'}
      />
      <button
        type="button"
        onClick={pick}
        disabled={pending}
        aria-label={t('avatar.change')}
        // A 44 px target around the smaller badge drawn on PR1/D15 (36 px) and MP29/MA36 (32 px).
        className="absolute -right-2 -bottom-1.5 grid size-11 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-navy disabled:opacity-60"
      >
        <span
          className={cn(
            'grid place-items-center rounded-full bg-surface shadow-camera',
            mobile ? 'size-8' : 'size-9',
          )}
        >
          <Icon icon={Camera} size={mobile ? 14 : 16} />
        </span>
      </button>
      {field}
    </span>
  );
}

/** "Profilbillede" in Personlige oplysninger: upload or remove. */
export function AvatarField({
  kind,
  userId,
  version,
  initials,
}: {
  kind: 'staff' | 'customer';
  userId: string;
  version: string | null;
  initials: string;
}) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const router = useRouter();
  const { pick, field, pending } = useAvatarUpload(kind);
  const [removing, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-5 rounded-md bg-surface-soft px-4 py-3.5 shadow-soft-line">
      <AvatarImage userId={userId} version={version} initials={initials} size="card" />
      <span className="flex min-w-0 flex-1 flex-col leading-snug">
        <strong>{t('avatar.title')}</strong>
        <span className="text-meta text-fg-2">{t('avatar.help')}</span>
      </span>
      <Button variant="secondary" size="s" loading={pending} onClick={pick}>
        {!pending && <Icon icon={Camera} size={14} />}
        {t('avatar.upload')}
      </Button>
      {version && (
        <Button
          // PR1 draws "Fjern" red, D15 as a plain text button.
          variant={kind === 'staff' ? 'destructive' : 'ghost'}
          size="s"
          loading={removing}
          onClick={() =>
            start(async () => {
              await removeAvatarAction(kind);
              toast.ok({ title: t('avatar.removed'), closeLabel: tc('close') });
              router.refresh();
            })
          }
        >
          {!removing && <Icon icon={Trash2} size={14} />}
          {t('avatar.remove')}
        </Button>
      )}
      {field}
    </div>
  );
}
