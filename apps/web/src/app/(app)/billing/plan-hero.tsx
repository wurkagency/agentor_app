'use client';

import { Button, cn, Dialog, toast } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { switchPlan } from './actions';

/** "Nuværende plan" card in brand lime (D13). */
export function PlanHero({
  planName,
  price,
  renewal,
  upgradeTo,
  className,
}: {
  planName: string;
  price: string;
  renewal: string;
  upgradeTo: { id: string; name: string } | null;
  className?: string;
}) {
  const t = useTranslations('billing');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

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
      {upgradeTo && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="dark" size="m" onClick={() => setOpen(true)}>
            {t('upgradeTo', { plan: upgradeTo.name })}
          </Button>
        </div>
      )}
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
