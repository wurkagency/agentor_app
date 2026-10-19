'use client';

import { Banner, Button } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { completeMockOAuth } from '@/app/(app)/connections/actions';

export function ConsentForm({
  connectorId,
  reconnectId,
  name,
}: {
  connectorId: string;
  reconnectId: string | null;
  name: string;
}) {
  const t = useTranslations('connections');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      {error && <Banner tone="error">{t('errors.generic')}</Banner>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="m" asChild>
          <Link href={reconnectId ? `/connections/${reconnectId}` : '/connections/new'}>
            {tc('cancel')}
          </Link>
        </Button>
        <Button
          variant="primary"
          size="m"
          loading={pending}
          onClick={() =>
            start(async () => {
              const res = await completeMockOAuth(connectorId, reconnectId);
              if (res.ok && res.data) router.push(`/connections/${res.data.id}`);
              else setError(true);
            })
          }
        >
          {t('consentApprove', { name })}
        </Button>
      </div>
    </div>
  );
}
