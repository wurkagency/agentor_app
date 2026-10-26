'use client';

import { toast } from '@agentor/ui';
import { BigButton } from '@agentor/ui/mobile';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { decideSupport } from '@/app/(app)/settings/security/actions';

/** MA12 Godkend / Afvis (and stop): the same server action as desktop D8/Sikkerhed. */
export function DecideSupport({
  grantId,
  hours,
  mode,
}: {
  grantId: string;
  hours: number;
  /** "pending" shows Afvis + Godkend; "active" shows stop. */
  mode: 'pending' | 'active';
}) {
  const t = useTranslations('mobile.support');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (decision: 'approve' | 'deny' | 'revoke') =>
    start(async () => {
      const res = await decideSupport(grantId, decision);
      if (!res.ok) {
        toast.error({ title: t('failed'), closeLabel: tc('close') });
        router.refresh();
        return;
      }
      toast.ok({
        title:
          decision === 'approve'
            ? t('approved', { hours })
            : decision === 'deny'
              ? t('denied')
              : t('stopped'),
        closeLabel: tc('close'),
      });
      router.refresh();
    });
  if (mode === 'active')
    return (
      <BigButton variant="destructive" loading={pending} onClick={() => act('revoke')}>
        {t('stop')}
      </BigButton>
    );
  return (
    <div className="flex gap-2">
      <BigButton
        variant="secondary"
        className="flex-1"
        disabled={pending}
        onClick={() => act('deny')}
      >
        {t('deny')}
      </BigButton>
      <BigButton icon={Check} className="flex-1" loading={pending} onClick={() => act('approve')}>
        {t('approve')}
      </BigButton>
    </div>
  );
}
