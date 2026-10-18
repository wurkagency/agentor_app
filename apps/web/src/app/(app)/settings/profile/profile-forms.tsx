'use client';

import { Banner, Button, Card, Field, Input, LockedValue, Select, toast } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { changeLocale } from '@/app/actions/session';
import { authClient } from '@/lib/auth-client';

export function ProfileForms({
  name,
  email,
  locale,
}: {
  name: string;
  email: string;
  locale: 'da' | 'en';
}) {
  const t = useTranslations('profile');
  const company = useTranslations('company');
  const form = useTranslations('form');
  const common = useTranslations('common');
  const auth = useTranslations('auth');
  const router = useRouter();
  const [newName, setNewName] = useState(name);
  const [lang, setLang] = useState(locale);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwError, setPwError] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    if (newName.trim() !== name) await authClient.updateUser({ name: newName.trim() });
    if (lang !== locale) await changeLocale(lang);
    setSaving(false);
    toast.ok({ title: t('saved'), closeLabel: common('close') });
    router.refresh();
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwSaving(true);
    setPwError(false);
    const r = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    setPwSaving(false);
    if (r.error) {
      setPwError(true);
      return;
    }
    setCurrent('');
    setNext('');
    toast.ok({ title: t('passwordChanged'), closeLabel: common('close') });
  };

  return (
    <div className="grid max-w-form grid-cols-1 gap-5">
      <form onSubmit={saveProfile}>
        <Card className="flex flex-col gap-5">
          <Field label={t('name')}>
            {({ id }) => (
              <Input
                id={id}
                autoComplete="name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('email')} help={t('emailHelp')}>
            {() => <LockedValue>{email}</LockedValue>}
          </Field>
          <Field label={t('language')}>
            {({ id }) => (
              <Select
                id={id}
                value={lang}
                onValueChange={(v) => setLang(v === 'en' ? 'en' : 'da')}
                options={[
                  { value: 'da', label: company('danish') },
                  { value: 'en', label: company('english') },
                ]}
                className="w-48"
              />
            )}
          </Field>
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              loading={saving}
              disabled={newName.trim().length < 2 || (newName.trim() === name && lang === locale)}
            >
              {saving ? form('saving') : form('save')}
            </Button>
          </div>
        </Card>
      </form>
      <form onSubmit={savePassword}>
        <Card className="flex flex-col gap-5">
          <h2 className="m-0 text-card">{t('password')}</h2>
          {pwError && <Banner tone="error">{t('passwordError')}</Banner>}
          <Field label={t('currentPassword')}>
            {({ id }) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('newPassword')} help={auth('resetHelp')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            )}
          </Field>
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="secondary"
              loading={pwSaving}
              disabled={!current || next.length < 12}
            >
              {t('changePassword')}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
