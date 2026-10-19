'use client';

import { Button, Icon, Segmented, toast } from '@agentor/ui';
import { Code, History, Pause, Pencil, Play, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import {
  pauseFlows,
  restoreVersionAction,
  resumeFlows,
  retryFailures,
  runFlowsNow,
  setRoutePause,
} from '../actions';

/** Basic | Developer, Pause/Genoptag, Kør nu and Åbn editor (D7 header). */
export function FlowActions({
  id,
  canEdit,
  paused,
  published,
  developer,
}: {
  id: string;
  canEdit: boolean;
  paused: boolean;
  published: boolean;
  developer: boolean;
}) {
  const t = useTranslations('flows');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const act = (fn: typeof pauseFlows, done: string) =>
    start(async () => {
      const res = await fn([id]);
      if (res.ok) {
        toast.ok({ title: t(done, { count: 1 }), closeLabel: tc('close') });
        router.refresh();
      } else toast.error({ title: t('actionFailed'), closeLabel: tc('close') });
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        aria-label={t('viewLabel')}
        tone="dark"
        value={developer ? 'developer' : 'basic'}
        onValueChange={(v) => {
          const next = new URLSearchParams(params);
          if (v === 'developer') next.set('view', 'developer');
          else next.delete('view');
          router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
        }}
        options={[
          { value: 'basic', label: t('basic') },
          { value: 'developer', label: t('developer'), icon: <Icon icon={Code} size={14} /> },
        ]}
      />
      {canEdit && published && (
        <>
          {paused ? (
            <Button
              variant="secondary"
              size="m"
              disabled={pending}
              onClick={() => act(resumeFlows, 'resumedToast')}
            >
              <Icon icon={Play} size={16} />
              {t('resume')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="m"
              disabled={pending}
              onClick={() => act(pauseFlows, 'pausedToast')}
            >
              <Icon icon={Pause} size={16} />
              {t('pause')}
            </Button>
          )}
          <Button
            variant="secondary"
            size="m"
            disabled={pending || paused}
            onClick={() => act(runFlowsNow, 'runToast')}
          >
            {t('runNow')}
          </Button>
        </>
      )}
      {canEdit && (
        <Button variant="primary" size="m" asChild>
          <Link href={`/integrations/${id}/editor`}>
            <Icon icon={Pencil} size={16} />
            {t('openEditor')}
          </Link>
        </Button>
      )}
    </div>
  );
}

export function RetryButton({
  flowId,
  routeId,
  count,
}: {
  flowId: string;
  routeId?: string;
  count: number;
}) {
  const t = useTranslations('flows');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="s"
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await retryFailures(flowId, routeId);
          if (res.ok) {
            toast.info({ title: t('retryStarted'), closeLabel: tc('close') });
            // The worker usually finishes within a couple of seconds.
            setTimeout(() => router.refresh(), 2500);
          } else toast.error({ title: t('actionFailed'), closeLabel: tc('close') });
        })
      }
    >
      {!pending && <Icon icon={RotateCw} size={14} />}
      {t('retry', { count })}
    </Button>
  );
}

export function RouteResume({ flowId, routeId }: { flowId: string; routeId: string }) {
  const t = useTranslations('flows');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="s"
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await setRoutePause(flowId, routeId, false);
          if (res.ok) router.refresh();
        })
      }
    >
      {t('resume')}
    </Button>
  );
}

/** Gendan som kladde on an earlier version (Versioner); the editor opens on the new draft. */
export function RestoreVersionButton({
  flowId,
  versionId,
  number,
}: {
  flowId: string;
  versionId: string;
  number: number;
}) {
  const t = useTranslations('flows');
  const tc = useTranslations('common');
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="s"
      loading={pending}
      aria-label={t('restoreVersion', { n: number })}
      onClick={() =>
        start(async () => {
          const res = await restoreVersionAction(flowId, versionId);
          if (res && !res.ok)
            toast.error({
              title: res.error === 'LOCKED' ? t('restoreLocked') : t('actionFailed'),
              closeLabel: tc('close'),
            });
        })
      }
    >
      {!pending && <Icon icon={History} size={14} />}
      {t('restore')}
    </Button>
  );
}
