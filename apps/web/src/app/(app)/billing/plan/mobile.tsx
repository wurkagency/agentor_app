'use client';

import { formatMoney, formatNumber } from '@agentor/i18n';
import { cn, Icon, toast } from '@agentor/ui';
import { BigButton, MobileFootnote, MobileShell, Modal, Segmented } from '@agentor/ui/mobile';
import { Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { usePlanLines, type PlanCardData } from '@/components/billing/plan-cards';
import { AppTopBar } from '@/components/mobile/chrome';
import { switchInterval, switchPlan } from '../actions';

interface PlanVM extends PlanCardData {
  sortOrder: number;
  blockers: string[];
  grossOre: number;
}

type Interval = 'month' | 'year';

/**
 * MA33 Skift plan: monthly or yearly prices (a year costs 10 months, decision 18), one card per
 * plan with its lines, upgrade or downgrade with a confirm modal, and a downgrade the tenant
 * doesn't fit disabled with the reason (§7.8). Same actions as D13.
 */
export function PlanMobile({
  plans,
  current,
  currentName,
  interval,
  renewsOn,
}: {
  plans: PlanVM[];
  current: string;
  currentName: string;
  interval: Interval;
  renewsOn: string | null;
}) {
  const t = useTranslations('mobile.plan');
  const tb = useTranslations('billing');
  const tp = useTranslations('plans');
  const tc = useTranslations('common');
  const locale = useLocale() as 'da' | 'en';
  const router = useRouter();
  const lines = usePlanLines();
  const [shown, setShown] = useState<Interval>(interval);
  const [target, setTarget] = useState<PlanVM | null>(null);
  const [intervalOpen, setIntervalOpen] = useState(false);
  const [pending, start] = useTransition();
  const currentOrder = plans.find((p) => p.id === current)?.sortOrder ?? 0;
  const yearly = shown === 'year';
  const price = (ore: number) =>
    yearly
      ? t('perYear', { price: formatNumber(Math.round((ore * 10) / 100), locale) })
      : t('perMonth', { price: formatNumber(Math.round(ore / 100), locale) });

  const confirmPlan = () =>
    start(async () => {
      if (!target) return;
      const res = await switchPlan(target.id);
      if (!res.ok) {
        toast.error({
          title:
            res.error === 'DOWNGRADE_BLOCKED' ? tb('downgradeBlocked') : tb('planChangeFailed'),
          closeLabel: tc('close'),
        });
        return;
      }
      // The chosen billing interval comes with the plan change, from the next renewal.
      if (shown !== interval) await switchInterval(shown);
      toast.ok({ title: tb('planChanged', { plan: target.name }), closeLabel: tc('close') });
      setTarget(null);
      router.refresh();
    });

  const confirmInterval = () =>
    start(async () => {
      const res = await switchInterval(shown);
      if (res.ok) {
        toast.ok({
          title: tb(shown === 'year' ? 'yearlyDone' : 'monthlyDone'),
          closeLabel: tc('close'),
        });
        setIntervalOpen(false);
        router.refresh();
      } else toast.error({ title: tb('planChangeFailed'), closeLabel: tc('close') });
    });

  const isUpgrade = target ? target.sortOrder > currentOrder : false;
  const currentPlan = plans.find((p) => p.id === current);

  return (
    <MobileShell
      topBar={
        <AppTopBar
          back="/billing"
          title={t('title')}
          {...(renewsOn ? { subtitle: t('subtitle', { plan: currentName, date: renewsOn }) } : {})}
        />
      }
    >
      <Segmented
        label={t('interval')}
        value={shown}
        onChange={(k) => setShown(k as Interval)}
        items={[
          { key: 'month', label: t('monthly') },
          { key: 'year', label: t('yearly') },
        ]}
      />
      {plans.map((p) => {
        const isCurrent = p.id === current;
        const up = p.sortOrder > currentOrder;
        const blocked = !isCurrent && p.blockers.length > 0;
        return (
          <section
            key={p.id}
            aria-label={p.name}
            className={cn(
              'flex flex-col gap-2.5 rounded-md bg-surface p-4 shadow-sm',
              isCurrent && 'shadow-ring-dark-2',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="m-0 text-m-hero">{p.name}</h2>
              {isCurrent && (
                <span className="inline-flex h-5.5 items-center rounded-full bg-primary px-2.5 text-meta font-semibold">
                  {tb('yourPlan')}
                </span>
              )}
            </div>
            <p className="m-0 flex items-baseline gap-1.5">
              <strong className="text-m-heading tracking-snug tabular">{price(p.priceOre)}</strong>
              <span className="text-meta font-medium text-fg-2">{t('exVat')}</span>
            </p>
            <span className="-mt-1.5 text-meta font-medium text-fg-2">{tp(`tagline.${p.id}`)}</span>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {lines(p).map((l) => (
                <li key={l} className="flex gap-2 text-table">
                  <Icon icon={Check} size={14} className="mt-0.5 flex-none text-ok-fg" />
                  <span>{l}</span>
                </li>
              ))}
            </ul>
            {isCurrent ? (
              shown !== interval ? (
                <BigButton variant="secondary" onClick={() => setIntervalOpen(true)}>
                  {tb(shown === 'year' ? 'switchYearly' : 'switchMonthly')}
                </BigButton>
              ) : (
                <span className="text-meta font-medium text-fg-2">{tb('currentPlanNote')}</span>
              )
            ) : (
              <>
                <BigButton
                  variant={up ? 'primary' : 'secondary'}
                  disabled={blocked}
                  aria-describedby={blocked ? `blocked-${p.id}` : undefined}
                  onClick={() => setTarget(p)}
                >
                  {up ? tb('upgradeTo', { plan: p.name }) : tb('downgrade')}
                </BigButton>
                {blocked && (
                  <span id={`blocked-${p.id}`} className="text-meta font-medium text-fg-2">
                    {tb('overLimit', {
                      plan: p.name,
                      what: p.blockers.map((b) => tb(`blocker.${b}` as 'blocker.seats')).join(', '),
                    })}
                  </span>
                )}
              </>
            )}
          </section>
        );
      })}
      <MobileFootnote>{t('footnote')}</MobileFootnote>

      <Modal
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={
          isUpgrade
            ? tb('upgradeTitle', { plan: target?.name ?? '' })
            : tb('downgradeTitle', { plan: target?.name ?? '' })
        }
        closeLabel={tc('close')}
        footer={
          <>
            <BigButton variant="secondary" onClick={() => setTarget(null)}>
              {tc('cancel')}
            </BigButton>
            <BigButton loading={pending} onClick={confirmPlan}>
              {isUpgrade ? tb('upgrade') : tb('downgrade')}
            </BigButton>
          </>
        }
      >
        {target && (
          <p className="m-0 text-body">
            {yearly
              ? t('changeBodyYear', { price: formatMoney((target.grossOre * 10) / 100, locale) })
              : tb('changeBody', { price: formatMoney(target.grossOre / 100, locale) })}
          </p>
        )}
      </Modal>

      <Modal
        open={intervalOpen}
        onOpenChange={setIntervalOpen}
        title={tb(shown === 'year' ? 'switchYearly' : 'switchMonthly')}
        closeLabel={tc('close')}
        footer={
          <>
            <BigButton variant="secondary" onClick={() => setIntervalOpen(false)}>
              {tc('cancel')}
            </BigButton>
            <BigButton loading={pending} onClick={confirmInterval}>
              {tb(shown === 'year' ? 'switchYearly' : 'switchMonthly')}
            </BigButton>
          </>
        }
      >
        {currentPlan && (
          <p className="m-0 text-body">
            {tb(shown === 'year' ? 'switchYearlyBody' : 'switchMonthlyBody', {
              date: renewsOn ?? '–',
              price: formatMoney(
                (shown === 'year' ? currentPlan.grossOre * 10 : currentPlan.grossOre) / 100,
                locale,
              ),
            })}
          </p>
        )}
      </Modal>
    </MobileShell>
  );
}
