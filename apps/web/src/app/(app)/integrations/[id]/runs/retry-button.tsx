'use client';

import { toast } from '@agentor/ui';
import { BigButton, CardButton } from '@agentor/ui/mobile';
import { RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { retryFailures } from '../../actions';

/** Retry the open failures of a flow (or one route): the same action as desktop D7/D8. */
export function RetryFailedButton({
  flowId,
  routeId,
  label,
  big = false,
}: {
  flowId: string;
  routeId?: string;
  label: string;
  /** The 52 px button at the bottom of MA06; otherwise the 40 px card button (MA24). */
  big?: boolean;
}) {
  const t = useTranslations('mobile.runs');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const res = await retryFailures(flowId, routeId);
      if (res.ok) {
        toast.info({ title: t('retryStarted'), closeLabel: tc('close') });
        setTimeout(() => router.refresh(), 2500);
      } else toast.error({ title: t('failed'), closeLabel: tc('close') });
    });
  return big ? (
    <BigButton icon={RotateCw} loading={pending} onClick={run}>
      {label}
    </BigButton>
  ) : (
    <CardButton icon={RotateCw} variant="primary" disabled={pending} onClick={run}>
      {label}
    </CardButton>
  );
}
