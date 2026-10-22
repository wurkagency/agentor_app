'use client';

import { Button, cn, Icon } from '@agentor/ui';
import { Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

export type GuideStep = 'route' | 'mapping' | 'test' | 'publish';
const STEPS: GuideStep[] = ['route', 'mapping', 'test', 'publish'];

/**
 * In-editor guide (D4-Guide): four steps from template to first publish, with progress. Steps
 * tick off from what the editor already knows; nothing here is stored.
 */
export function Guide({
  done,
  onClose,
}: {
  done: Record<GuideStep, boolean>;
  onClose: () => void;
}) {
  const t = useTranslations('editor');
  const current = STEPS.find((s) => !done[s]) ?? 'publish';
  const count = STEPS.filter((s) => done[s]).length;
  return (
    <section
      aria-labelledby="guide-title"
      className="flex flex-col gap-3 rounded-md bg-info-bg px-4 py-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 id="guide-title" className="m-0 text-body font-semibold">
            {t('guide.title')}
          </h3>
          <p className="m-0 text-meta text-fg-1">
            {t('guide.progress', { n: Math.min(count + 1, STEPS.length), total: STEPS.length })}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label={t('guide.close')} onClick={onClose}>
          <Icon icon={X} size={14} />
        </Button>
      </div>
      <div
        className="flex gap-1"
        role="progressbar"
        aria-label={t('guide.title')}
        aria-valuemin={0}
        aria-valuemax={STEPS.length}
        aria-valuenow={count}
      >
        {STEPS.map((s) => (
          <span
            key={s}
            className={cn('h-1 flex-1 rounded-full', done[s] ? 'bg-fg-1' : 'bg-surface')}
          />
        ))}
      </div>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={s === current ? 'step' : undefined}
            className={cn(
              'flex items-start gap-2 text-table',
              s === current ? 'font-semibold text-fg-1' : 'text-fg-1',
            )}
          >
            <span
              className={cn(
                'grid size-5 flex-none place-items-center rounded-full text-micro',
                done[s] ? 'bg-fg-1 text-white' : 'bg-surface',
              )}
            >
              {done[s] ? <Icon icon={Check} size={14} /> : i + 1}
            </span>
            <span className="flex flex-col">
              <span>{t(`guide.steps.${s}.title`)}</span>
              {s === current && (
                <span className="text-meta font-normal">{t(`guide.steps.${s}.body`)}</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
