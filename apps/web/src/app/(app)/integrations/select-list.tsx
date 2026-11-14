'use client';

import type { Status } from '@agentor/core';
import { StatusPill, toast } from '@agentor/ui';
import {
  CardActions,
  CardButton,
  ExpandCard,
  KV,
  MobileCheckbox,
  MobileLogo,
  SelectionBar,
  type LogoRef,
} from '@agentor/ui/mobile';
import { Activity, CirclePause, Play, Unplug, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { pauseFlows, resumeFlows, runFlowsNow } from './actions';

export interface SelectableFlow {
  id: string;
  name: string;
  /** "5 ruter · for 4 min. siden". */
  meta: string;
  status: Status;
  statusLabel: string;
  connections: LogoRef[];
  modeLabel: string;
  routesLabel: string;
  records7d: string;
  lastRun: string;
  paused: boolean;
  published: boolean;
  /** Broken connection: "Genetablér" opens its reconnect screen (MA08). */
  reconnectHref: string | null;
}

/**
 * MA19: flows as folding rows with a checkbox each; selected flows get a floating bar with Pause,
 * Genoptag and Kør nu. The same server actions as the desktop table (D2-Valg).
 */
export function FlowSelectList({ flows }: { flows: SelectableFlow[] }) {
  const t = useTranslations('flows');
  const tm = useTranslations('mobile.integrations');
  const tc = useTranslations('common');
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const run = (fn: typeof pauseFlows, ids: string[], done: string, after?: () => void) =>
    start(async () => {
      const res = await fn(ids);
      if (res.ok) {
        toast.ok({ title: t(done, { count: res.data?.done ?? 0 }), closeLabel: tc('close') });
        after?.();
        router.refresh();
      } else toast.error({ title: t('actionFailed'), closeLabel: tc('close') });
    });

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const ids = [...selected];

  return (
    <>
      <div className="flex items-center justify-between px-1">
        <span className="text-meta font-medium text-fg-2">{tm('tapToExpand')}</span>
      </div>
      {flows.map((f, i) => (
        <ExpandCard
          key={f.id}
          open={i === 0}
          control={
            <MobileCheckbox
              label={t('selectFlow', { name: f.name })}
              checked={selected.has(f.id)}
              onCheckedChange={() => toggle(f.id)}
            />
          }
          title={f.name}
          meta={f.meta}
          trailing={<StatusPill status={f.status}>{f.statusLabel}</StatusPill>}
        >
          <KV k={tm('connections')}>
            <span className="flex items-center justify-end gap-1">
              {f.connections.map((c, j) => (
                <MobileLogo key={`${c.name}-${j}`} {...c} size={26} />
              ))}
            </span>
          </KV>
          <KV k={tm('status')}>
            <StatusPill status={f.status}>{f.statusLabel}</StatusPill>
          </KV>
          <KV k={tm('mode')}>{f.modeLabel}</KV>
          <KV k={tm('routes')}>{f.routesLabel}</KV>
          <KV k={tm('records7d')}>
            <strong className="tabular">{f.records7d}</strong>
          </KV>
          <KV k={tm('lastRun')}>{f.lastRun}</KV>
          <CardActions>
            {f.reconnectHref ? (
              <CardButton href={f.reconnectHref} linkAs={Link} variant="dark" icon={Unplug}>
                {tm('reconnect')}
              </CardButton>
            ) : (
              <>
                <CardButton href={`/integrations/${f.id}/runs`} linkAs={Link} icon={Activity}>
                  {tm('seeRuns')}
                </CardButton>
                {f.published && !f.paused && (
                  <CardButton
                    icon={Play}
                    disabled={pending}
                    onClick={() => run(runFlowsNow, [f.id], 'runToast')}
                  >
                    {t('runNow')}
                  </CardButton>
                )}
                {f.published &&
                  (f.paused ? (
                    <CardButton
                      icon={Play}
                      disabled={pending}
                      onClick={() => run(resumeFlows, [f.id], 'resumedToast')}
                    >
                      {t('resume')}
                    </CardButton>
                  ) : (
                    <CardButton
                      icon={CirclePause}
                      disabled={pending}
                      onClick={() => run(pauseFlows, [f.id], 'pausedToast')}
                    >
                      {t('pause')}
                    </CardButton>
                  ))}
              </>
            )}
          </CardActions>
        </ExpandCard>
      ))}
      {ids.length > 0 && (
        <SelectionBar label={t('selected', { count: ids.length })}>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(pauseFlows, ids, 'pausedToast', () => setSelected(new Set()))}
            className="touch-target h-9 cursor-pointer rounded-full border-0 bg-white-14 px-3 font-sans text-meta font-semibold text-white"
          >
            {t('pause')}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(resumeFlows, ids, 'resumedToast', () => setSelected(new Set()))}
            className="touch-target h-9 cursor-pointer rounded-full border-0 bg-white-14 px-3 font-sans text-meta font-semibold text-white"
          >
            {t('resume')}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(runFlowsNow, ids, 'runToast', () => setSelected(new Set()))}
            className="touch-target h-9 cursor-pointer rounded-full border-0 bg-primary px-3 font-sans text-meta font-semibold text-fg-1"
          >
            {t('runNow')}
          </button>
          <button
            type="button"
            aria-label={t('clearSelection')}
            onClick={() => setSelected(new Set())}
            className="grid size-9 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent text-white touch-target"
          >
            <X aria-hidden width={16} height={16} />
          </button>
        </SelectionBar>
      )}
    </>
  );
}
