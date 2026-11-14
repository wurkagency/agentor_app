'use client';

import { Button, cn, Dialog, toast } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { switchInterval, switchPlan } from './actions';

/** "Nuværende plan" card in brand lime (D13). */
export function PlanHero({
  planName,
  price,
  renewal,
  upgradeTo,
  interval,
  switchPrice,
  renewsOn,
  className,
}: {
  planName: string;
  price: string;
  renewal: string;
  upgradeTo: { id: string; name: string } | null;
  interval: 'month' | 'year';
  /** The price after switching, e.g. "1.590 kr./år". */
  switchPrice: string;
  renewsOn: string | null;
  className?: string;
}) {
  const t = useTranslations('billing');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [yearly, setYearly] = useState(false);
  const [pending, start] = useTransition();
  const target = interval === 'year' ? 'month' : 'year';

  const switchTo = () =>
    start(async () => {
      const res = await switchInterval(target);
      if (res.ok) {
        setYearly(false);
        toast.ok({
          title: t(target === 'year' ? 'yearlyDone' : 'monthlyDone'),
          closeLabel: tc('close'),
        });
        router.refresh();
      } else {
        toast.error({ title: t('planChangeFailed'), closeLabel: tc('close') });
      }
    });

  const upgrade = () =>
    start(async () => {
      if (!upgradeTo) return;
      const res = await switchPlan(upgradeTo.id);
      if (res.ok) {
        setOpen(false);
        toast.ok({ title: t('planChanged', { plan: upgradeTo.name }), closeLabel: tc('close') });
        router.refresh();
      } else {
        toast.error({ title: t('planChangeFailed'), closeLabel: tc('close') });
      }
    });

  return (
    <section
      className={cn('flex flex-col gap-3 rounded-md bg-primary p-6 text-fg-1 shadow-sm', className)}
      aria-labelledby="current-plan"
    >
      <span className="eyebrow text-fg-1">{t('currentPlan')}</span>
      <p id="current-plan" className="m-0 flex items-baseline gap-2">
        <span className="text-stat font-semibold tracking-snug">{planName}</span>
        <span className="text-body font-medium">{price}</span>
      </p>
      <p className="m-0 text-table">{renewal}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {upgradeTo && (
          <Button variant="dark" size="m" onClick={() => setOpen(true)}>
            {t('upgradeTo', { plan: upgradeTo.name })}
          </Button>
        )}
        <Button variant="secondary" size="m" onClick={() => setYearly(true)}>
          {t(target === 'year' ? 'switchYearly' : 'switchMonthly')}
        </Button>
      </div>
      <Dialog
        open={yearly}
        onOpenChange={setYearly}
        title={t(target === 'year' ? 'switchYearly' : 'switchMonthly')}
        description={t(target === 'year' ? 'switchYearlyBody' : 'switchMonthlyBody', {
          price: switchPrice,
          date: renewsOn ?? '–',
        })}
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="secondary" size="m" onClick={() => setYearly(false)}>
              {tc('cancel')}
            </Button>
            <Button variant="primary" size="m" onClick={switchTo} loading={pending}>
              {t(target === 'year' ? 'switchYearly' : 'switchMonthly')}
            </Button>
          </>
        }
      />
      {upgradeTo && (
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title={t('upgradeTitle', { plan: upgradeTo.name })}
          description={t('upgradeBody')}
          closeLabel={tc('close')}
          footer={
            <>
              <Button variant="secondary" size="m" onClick={() => setOpen(false)}>
                {tc('cancel')}
              </Button>
              <Button variant="primary" size="m" onClick={upgrade} loading={pending}>
                {t('upgradeTo', { plan: upgradeTo.name })}
              </Button>
            </>
          }
        />
      )}
    </section>
  );
}
