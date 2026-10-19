import { cn, Icon } from '@agentor/ui';
import { Check } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

const STEPS = ['company', 'plan', 'flow'] as const;

/** Onboarding card with the three-step header (D14-Onboarding-1..3). */
export async function OnboardingCard({
  step,
  title,
  intro,
  narrow,
  children,
}: {
  step: 1 | 2 | 3;
  title: ReactNode;
  intro: ReactNode;
  narrow?: boolean;
  children: ReactNode;
}) {
  const t = await getTranslations('onboarding');
  return (
    <section
      className={cn(
        'box-border flex w-full flex-col gap-5 rounded-md bg-surface p-6 shadow-sm md:p-8',
        narrow ? 'max-w-onboarding-narrow' : 'max-w-onboarding',
      )}
    >
      <ol className="m-0 flex list-none items-center gap-3 p-0" aria-label={t('steps')}>
        {STEPS.map((key, i) => {
          const n = i + 1;
          const done = n < step;
          const current = n === step;
          return (
            <li
              key={key}
              className={cn('flex items-center gap-2', i < STEPS.length - 1 && 'flex-1')}
              aria-current={current ? 'step' : undefined}
            >
              <span
                className={cn(
                  'grid size-6 flex-none place-items-center rounded-full text-meta font-semibold box-border',
                  done && 'bg-fg-1 text-primary',
                  current && 'border border-fg-1 bg-primary text-fg-1',
                  !done && !current && 'border border-border text-fg-2',
                )}
              >
                {done ? <Icon icon={Check} size={14} /> : n}
              </span>
              <span
                className={cn(
                  'whitespace-nowrap text-meta font-medium',
                  current || done ? 'text-fg-1' : 'text-fg-2',
                  !current && 'max-md:sr-only',
                )}
              >
                {t(`step.${key}`)}
                {done && <span className="sr-only"> ({t('stepDone')})</span>}
              </span>
              {i < STEPS.length - 1 && <span aria-hidden className="h-px flex-1 bg-border" />}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-stat-compact font-semibold tracking-snug">{title}</h1>
        <p className="m-0 text-fg-2">{intro}</p>
      </div>
      {children}
    </section>
  );
}
