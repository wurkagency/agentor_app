'use client';

import { Banner, Button, Dialog, Field, Icon, Input, toast } from '@agentor/ui';
import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { savePlanAction } from '@/app/platform/settings/actions';

export interface PlanValues {
  id: string;
  name: string;
  priceKr: number;
  seats: number | null;
  transactionsPerMonth: number | null;
  integrationSets: number | null;
  destinationsPerFlow: number | null;
  pollingIntervalMinutes: number;
}

const LIMITS = ['seats', 'transactionsPerMonth', 'integrationSets', 'destinationsPerFlow'] as const;

/**
 * Platformindstillinger: Superadmin edits a plan's monthly price and limits (P6 "Ændre planer,
 * priser"). An empty limit means unlimited. Customers see new limits at once; a new price
 * applies from their next renewal.
 */
export function PlanEditButton({ plan }: { plan: PlanValues }) {
  const t = useTranslations('platform.settings.plan');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const [price, setPrice] = useState(String(plan.priceKr));
  const [polling, setPolling] = useState(String(plan.pollingIntervalMinutes));
  const [limits, setLimits] = useState<Record<(typeof LIMITS)[number], string>>({
    seats: plan.seats === null ? '' : String(plan.seats),
    transactionsPerMonth:
      plan.transactionsPerMonth === null ? '' : String(plan.transactionsPerMonth),
    integrationSets: plan.integrationSets === null ? '' : String(plan.integrationSets),
    destinationsPerFlow: plan.destinationsPerFlow === null ? '' : String(plan.destinationsPerFlow),
  });
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/\D/g, '')));
  const save = () =>
    start(async () => {
      const res = await savePlanAction({
        planId: plan.id,
        priceKr: Number(price.replace(',', '.')),
        seats: num(limits.seats),
        transactionsPerMonth: num(limits.transactionsPerMonth),
        integrationSets: num(limits.integrationSets),
        destinationsPerFlow: num(limits.destinationsPerFlow),
        pollingIntervalMinutes: Number(polling),
      });
      if (!res.ok) return setError(true);
      setOpen(false);
      toast.ok({ title: t('saved', { plan: plan.name }), closeLabel: tc('close') });
      router.refresh();
    });
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('edit', { plan: plan.name })}
        onClick={() => setOpen(true)}
      >
        <Icon icon={Pencil} size={14} />
      </Button>
      {open && (
        <Dialog
          open
          onOpenChange={setOpen}
          width={560}
          title={t('title', { plan: plan.name })}
          description={t('help')}
          closeLabel={tc('close')}
          footer={
            <Button variant="primary" size="m" loading={pending} onClick={save}>
              {t('save')}
            </Button>
          }
        >
          {error && <Banner tone="error">{t('error')}</Banner>}
          <Field label={t('price')} inline>
            {({ id }) => (
              <Input
                id={id}
                inputMode="decimal"
                className="w-32 tabular"
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/[^\d,.]/g, ''))}
              />
            )}
          </Field>
          {LIMITS.map((k) => (
            <Field key={k} label={t(`limit.${k}`)} help={t('unlimitedHelp')} inline>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="numeric"
                  className="w-32 tabular"
                  placeholder={t('unlimited')}
                  value={limits[k]}
                  onChange={(e) =>
                    setLimits((l) => ({ ...l, [k]: e.target.value.replace(/\D/g, '') }))
                  }
                />
              )}
            </Field>
          ))}
          <Field label={t('polling')} inline>
            {({ id }) => (
              <Input
                id={id}
                inputMode="numeric"
                className="w-32 tabular"
                value={polling}
                onChange={(e) => setPolling(e.target.value.replace(/\D/g, ''))}
              />
            )}
          </Field>
        </Dialog>
      )}
    </>
  );
}
