'use client';

import { Button, Input, Select, toast } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { changeLocale } from '@/app/actions/session';
import { saveProfileAction } from '@/server/profile/actions';
import type { ProfileView } from '@/server/profile/view';

export const TIME_ZONES = [
  'Europe/Copenhagen',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Berlin',
  'Europe/London',
  'UTC',
] as const;

type Details = ProfileView['details'];

/** Shared state and save for the desktop form and the mobile edit sheet. */
export function useDetails(kind: 'staff' | 'customer', initial: Details) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const reset = () => {
    setD(initial);
    setError(false);
  };
  const save = (onDone?: () => void) =>
    start(async () => {
      setError(false);
      const res = await saveProfileAction(kind, {
        givenName: d.givenName,
        familyName: d.familyName,
        phone: d.phone,
        locale: d.locale,
        timeZone: d.timeZone as (typeof TIME_ZONES)[number],
        city: d.city,
        ...(kind === 'staff' ? { title: d.title } : {}),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      if (d.locale !== initial.locale) await changeLocale(d.locale);
      toast.ok({ title: t('details.saved'), closeLabel: tc('close') });
      onDone?.();
      router.refresh();
    });
  return { d, setD, save, reset, pending, error };
}

/** The fields of Personlige oplysninger (PR1/D15): two columns on desktop, one in the sheet. */
export function DetailsFields({
  kind,
  state,
  columns = 2,
}: {
  kind: 'staff' | 'customer';
  state: ReturnType<typeof useDetails>;
  columns?: 1 | 2;
}) {
  const t = useTranslations('profile');
  const id = useId();
  const { d, setD } = state;
  const field = (key: string, label: string, control: React.ReactNode, wide = false) => (
    <div className={`flex flex-col gap-1.5 ${wide && columns === 2 ? 'col-span-2' : ''}`}>
      <label htmlFor={`${id}-${key}`} className="text-table font-semibold">
        {label}
      </label>
      {control}
    </div>
  );
  return (
    <div className={columns === 2 ? 'grid grid-cols-2 gap-x-4 gap-y-3.5' : 'flex flex-col gap-3.5'}>
      {field(
        'given',
        t('details.givenName'),
        <Input
          id={`${id}-given`}
          autoComplete="given-name"
          maxLength={80}
          value={d.givenName}
          onChange={(e) => setD({ ...d, givenName: e.target.value })}
        />,
      )}
      {field(
        'family',
        t('details.familyName'),
        <Input
          id={`${id}-family`}
          autoComplete="family-name"
          maxLength={80}
          value={d.familyName}
          onChange={(e) => setD({ ...d, familyName: e.target.value })}
        />,
      )}
      {field(
        'email',
        t('details.email'),
        <Input id={`${id}-email`} value={d.email} readOnly aria-describedby={`${id}-email-help`} />,
      )}
      {field(
        'phone',
        t('details.phone'),
        <Input
          id={`${id}-phone`}
          type="tel"
          autoComplete="tel"
          maxLength={30}
          value={d.phone}
          onChange={(e) => setD({ ...d, phone: e.target.value })}
        />,
      )}
      {field(
        'locale',
        t('details.language'),
        <Select
          id={`${id}-locale`}
          value={d.locale}
          onValueChange={(v) => setD({ ...d, locale: v as 'da' | 'en' })}
          options={[
            { value: 'da', label: t('lang.da') },
            { value: 'en', label: t('lang.en') },
          ]}
        />,
      )}
      {field(
        'tz',
        t('details.timeZone'),
        <Select
          id={`${id}-tz`}
          value={d.timeZone}
          onValueChange={(v) => setD({ ...d, timeZone: v })}
          options={TIME_ZONES.map((z) => ({
            value: z,
            label: t(`tz.${z.replace('/', '_')}` as 'tz.UTC'),
          }))}
        />,
      )}
      {field(
        'city',
        t('details.city'),
        <Input
          id={`${id}-city`}
          autoComplete="address-level2"
          maxLength={80}
          value={d.city}
          onChange={(e) => setD({ ...d, city: e.target.value })}
        />,
      )}
      {kind === 'staff'
        ? field(
            'title',
            t('details.title'),
            <Input
              id={`${id}-title`}
              maxLength={80}
              value={d.title}
              onChange={(e) => setD({ ...d, title: e.target.value })}
            />,
          )
        : field(
            'role',
            t('details.role'),
            <Input id={`${id}-role`} value={d.roleLabel ?? ''} readOnly />,
          )}
      <p id={`${id}-email-help`} className="m-0 text-meta text-fg-2 col-span-full">
        {t('details.emailHelp')}
      </p>
    </div>
  );
}

/** Desktop: the card's own Annullér / Gem ændringer. */
export function DetailsActions({ state }: { state: ReturnType<typeof useDetails> }) {
  const t = useTranslations('profile');
  return (
    <span className="flex gap-2">
      <Button variant="secondary" size="s" onClick={state.reset}>
        {t('details.cancel')}
      </Button>
      <Button variant="primary" size="s" loading={state.pending} onClick={() => state.save()}>
        {t('details.save')}
      </Button>
    </span>
  );
}
