'use client';

import { Button, toast } from '@agentor/ui';
import { CirclePause, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { pauseFlows, resumeFlows } from '../actions';

/**
 * "Pausér flow" / "Genoptag flow" on mobile (MA05): the same server actions as desktop, a toast
 * with "Fortryd" for 6 s instead of a dialog (designspecifikation §5.5).
 */
export function FlowPauseButton({ flowId, paused }: { flowId: string; paused: boolean }) {
  const t = useTranslations('mobile.flow');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (pause: boolean) =>
    start(async () => {
      const res = await (pause ? pauseFlows : resumeFlows)([flowId]);
      if (!res.ok) {
        toast.error({ title: t('failed'), closeLabel: tc('close') });
        return;
      }
      router.refresh();
      toast.ok({
        title: pause ? t('pausedToast') : t('resumedToast'),
        closeLabel: tc('close'),
        action: {
          label: tc('undo'),
          onClick: () =>
            start(async () => {
              await (pause ? resumeFlows : pauseFlows)([flowId]);
              router.refresh();
            }),
        },
      });
    });
  return (
    <Button
      variant="secondary"
      icon={paused ? Play : CirclePause}
      loading={pending}
      onClick={() => act(!paused)}
      className="h-11 flex-1"
    >
      {paused ? t('resume') : t('pause')}
    </Button>
  );
}
