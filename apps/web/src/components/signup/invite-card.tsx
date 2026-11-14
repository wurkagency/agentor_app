'use client';

import { Button, Icon } from '@agentor/ui';
import { SignupInput } from '@agentor/ui/signup';
import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { inviteMember } from '@/app/(app)/settings/team/actions';

/** OB5 "Invitér dit team": invites as Læser (the bookkeeper case); roles change under Team. */
export function InviteCard({ domain }: { domain: string }) {
  const t = useTranslations('onboardingFlow.done');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle');
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      const r = await inviteMember({ email: email.trim(), role: 'reader', flowScope: 'all' });
      setState(r.ok ? 'sent' : 'error');
      if (r.ok) setEmail('');
    });
  return (
    <section className="flex flex-col gap-3 rounded-md bg-surface p-5.5 shadow-sm">
      <span className="grid size-10 place-items-center rounded-node bg-bg-base">
        <Icon icon={Users} size={18} />
      </span>
      <strong className="text-card">{t('inviteTitle')}</strong>
      <span className="text-table text-fg-2">{t('inviteText')}</span>
      <SignupInput
        label={<span className="sr-only">{t('inviteEmail')}</span>}
        type="email"
        autoComplete="off"
        placeholder={t('invitePlaceholder', { domain })}
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setState('idle');
        }}
        error={state === 'error' ? t('inviteError') : undefined}
        help={state === 'sent' ? t('inviteSent') : undefined}
      />
      <Button
        variant="secondary"
        size="s"
        className="self-start"
        loading={pending}
        disabled={!email}
        onClick={send}
      >
        {t('inviteSend')}
      </Button>
    </section>
  );
}
