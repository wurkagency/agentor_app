'use client';

import { Banner, toast } from '@agentor/ui';
import { BigButton, MobileField, MobileInput } from '@agentor/ui/mobile';
import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { inviteMember } from './actions';
import {
  MobileAccessFields,
  MobileSheet,
  RoleCards,
  type AccessState,
  type Role,
} from './mobile-fields';

type InviteRole = Exclude<Role, 'owner'>;

function in30Days() {
  return new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

const fresh = (): AccessState => ({
  flowScope: 'selected',
  flowIds: [],
  accessExpiresAt: in30Days(),
  isExternal: false,
});

/** MA30 Invitér bruger: the desktop invite (D11-Inviter) as a sheet, same action and rules. */
export function InviteSheet({
  open,
  onOpenChange,
  flows,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  flows: { id: string; name: string }[];
}) {
  const t = useTranslations('team');
  const roles = useTranslations('profile.roles');
  const common = useTranslations('common');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('developer');
  const [access, setAccess] = useState<AccessState>(fresh);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setEmail('');
    setRole('developer');
    setAccess(fresh());
    setError(null);
  };

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const scoped = role === 'developer' || role === 'reader';
      const selected = scoped && access.flowScope === 'selected';
      const r = await inviteMember({
        email,
        role,
        flowScope: scoped ? access.flowScope : 'all',
        flowIds: selected ? access.flowIds : [],
        accessExpiresAt: selected && access.accessExpiresAt ? access.accessExpiresAt : null,
        isExternal: access.isExternal,
      });
      if (r.ok) {
        toast.ok({
          title: t('invited', { email: email.trim().toLowerCase() }),
          closeLabel: common('close'),
        });
        reset();
        onOpenChange(false);
      } else {
        setError(r.error);
      }
    });

  return (
    <MobileSheet
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title={t('inviteTitle')}
      description={t('inviteIntro')}
      closeLabel={common('close')}
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (email.includes('@')) submit();
        }}
      >
        {error && <Banner tone="error">{t(`errors.${error}` as 'errors.generic')}</Banner>}
        <MobileField label={t('email')}>
          <MobileInput
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </MobileField>
        <RoleCards<InviteRole>
          name="invite-role"
          value={role}
          onChange={setRole}
          options={[
            { value: 'admin', title: roles('admin'), description: t('roleAdminShort') },
            { value: 'developer', title: roles('developer'), description: t('roleDeveloperShort') },
            { value: 'reader', title: roles('reader'), description: t('roleReaderShort') },
          ]}
        />
        <MobileAccessFields role={role} value={access} onChange={setAccess} flows={flows} />
        <BigButton type="submit" icon={Send} loading={pending} disabled={!email.includes('@')}>
          {pending ? t('sending') : t('send')}
        </BigButton>
      </form>
    </MobileSheet>
  );
}
