'use client';

import { formatMoney } from '@agentor/i18n';
import { Button, cn, Dialog, toast } from '@agentor/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  FeatureLine,
  PlanPrice,
  usePlanLines,
  type PlanCardData,
} from '@/components/billing/plan-cards';
import { switchPlan } from './actions';

interface ComparePlan extends PlanCardData {
  sortOrder: number;
  blockers: string[];
  grossOre: number;
}

/**
 * "Sammenlign planer" (D13). A downgrade the tenant doesn't fit is disabled with the reason
 * (§7.8: blocked with clear guidance, nothing is deactivated silently).
 */
export function PlanCompare({ plans, current }: { plans: ComparePlan[]; current: string }) {
  const t = useTranslations('billing');
  const tp = useTranslations('plans');
  const tc = useTranslations('common');
  const locale = useLocale() as 'da' | 'en';
  const router = useRouter();
  const lines = usePlanLines();
  const [target, setTarget] = useState<ComparePlan | null>(null);
  const [pending, start] = useTransition();
  const currentOrder = plans.find((p) => p.id === current)?.sortOrder ?? 0;

  const confirm = () =>
    start(async () => {
      if (!target) return;
      const res = await switchPlan(target.id);
      if (res.ok) {
        toast.ok({ title: t('planChanged', { plan: target.name }), closeLabel: tc('close') });
        setTarget(null);
        router.refresh();
      } else {
        toast.error({
          title: res.error === 'DOWNGRADE_BLOCKED' ? t('downgradeBlocked') : t('planChangeFailed'),
          closeLabel: tc('close'),
        });
      }
    });

  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = p.id === current;
          const isUpgrade = p.sortOrder > currentOrder;
          const blocked = !isCurrent && p.blockers.length > 0;
          return (
            <section
              key={p.id}
              aria-label={p.name}
              className={cn(
                'flex flex-col gap-3 rounded-md bg-surface p-5 shadow-sm',
                isCurrent && 'shadow-ring-dark-2',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="m-0 text-body font-semibold">{p.name}</h3>
                {isCurrent && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-micro font-semibold">
                    {t('yourPlan')}
                  </span>
                )}
              </div>
              <PlanPrice priceOre={p.priceOre} suffix={tp('perMonthExVat')} />
              <p className="m-0 text-table text-fg-2">{tp(`tagline.${p.id}`)}</p>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-table">
                {lines(p).map((l) => (
                  <FeatureLine key={l} included>
                    {l}
                  </FeatureLine>
                ))}
                {(p.excluded ?? []).map((f) => (
                  <FeatureLine key={f} included={false}>
                    {tp(`features.${f}`)}
                  </FeatureLine>
                ))}
              </ul>
              <div className="mt-auto flex flex-col gap-2 pt-2">
                {isCurrent ? (
                  <span className="text-meta text-fg-2">{t('currentPlanNote')}</span>
                ) : (
                  <>
                    <Button
                      variant={isUpgrade ? 'primary' : 'secondary'}
                      size="m"
                      className="w-full"
                      disabled={blocked}
                      aria-describedby={blocked ? `blocked-${p.id}` : undefined}
                      onClick={() => setTarget(p)}
                    >
                      {isUpgrade ? t('upgrade') : t('downgrade')}
                    </Button>
                    {blocked && (
                      <span id={`blocked-${p.id}`} className="text-meta text-fg-2">
                        {t('overLimit', {
                          plan: p.name,
                          what: p.blockers.map((b) => t(`blocker.${b}`)).join(', '),
                        })}
                      </span>
                    )}
                  </>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <Dialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={
          target && target.sortOrder > currentOrder
            ? t('upgradeTitle', { plan: target.name })
            : t('downgradeTitle', { plan: target?.name ?? '' })
        }
        description={
          target
            ? t('changeBody', { price: formatMoney(target.grossOre / 100, locale) })
            : undefined
        }
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="secondary" size="m" onClick={() => setTarget(null)}>
              {tc('cancel')}
            </Button>
            <Button variant="primary" size="m" onClick={confirm} loading={pending}>
              {target && target.sortOrder > currentOrder ? t('upgrade') : t('downgrade')}
            </Button>
          </>
        }
      />
    </>
  );
}
