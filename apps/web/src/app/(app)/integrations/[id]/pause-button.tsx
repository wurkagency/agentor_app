'use client';

import { Button, toast } from '@agentor/ui';
import { BigButton, Modal } from '@agentor/ui/mobile';
import { CirclePause, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { pauseFlows, resumeFlows } from '../actions';

/**
 * "Sæt på pause" / "Genoptag flow" on mobile (MA05): the same server actions as desktop. Pausing is
 * confirmed in a sheet first so a stray tap can't stop a live flow; the toast keeps "Fortryd".
 */
export function FlowPauseButton({ flowId, paused }: { flowId: string; paused: boolean }) {
  const t = useTranslations('mobile.flow');
  const tc = useTranslations('common');
  const router = useRouter();
  const tf = useTranslations('flows');
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
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
    <>
      <Button
        variant="secondary"
        icon={paused ? Play : CirclePause}
        loading={pending}
        onClick={() => (paused ? act(false) : setConfirm(true))}
        className="h-11 flex-1"
      >
        {paused ? t('resume') : t('pause')}
      </Button>
      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title={tf('pauseConfirmTitle')}
        closeLabel={tc('close')}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <BigButton variant="secondary" onClick={() => setConfirm(false)}>
              {tc('cancel')}
            </BigButton>
            <BigButton
              onClick={() => {
                setConfirm(false);
                act(true);
              }}
            >
              {t('pause')}
            </BigButton>
          </div>
        }
      >
        <p className="m-0 text-body text-fg-2">{tf('pauseConfirmBody')}</p>
      </Modal>
    </>
  );
}
