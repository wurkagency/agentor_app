'use client';

import { withVat } from '@agentor/core';
import { formatMoney } from '@agentor/i18n';
import { Banner, Button, Icon } from '@agentor/ui';
import { CircleCheck, CreditCard } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { brandName } from '@/components/billing/card';
import { PlanRadioCards, type PlanCardData } from '@/components/billing/plan-cards';
import { addCardStep, continuePlanStep } from '../actions';

export function PlanStep({
  plans,
  initialPlan,
  recommended,
  ordersPerMonth,
  card,
  returning,
  cancelled,
}: {
  plans: PlanCardData[];
  initialPlan: string;
  recommended: string | null;
  ordersPerMonth: string | null;
  card: { brand: string | null; last4: string | null } | null;
  returning: boolean;
  cancelled: boolean;
}) {
  const t = useTranslations('onboarding');
  const locale = useLocale() as 'da' | 'en';
  const router = useRouter();
  const [plan, setPlan] = useState(recommended ?? initialPlan);
  const [busy, setBusy] = useState<'card' | 'continue' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waited, setWaited] = useState(0);

  // Back from the card form: QuickPay's callback reaches us via ingest and the worker, usually
  // within seconds. Poll the server for it rather than trusting the redirect.
  const waiting = returning && !card && waited < 30;
  useEffect(() => {
    if (!waiting) return;
    const id = setTimeout(() => {
      setWaited((w) => w + 1);
      router.refresh();
    }, 1500);
    return () => clearTimeout(id);
  }, [waiting, waited, router]);

  const selected = plans.find((p) => p.id === plan) ?? plans[0]!;
  const price = withVat(selected.priceOre);
  const money = (ore: number) => formatMoney(ore / 100, locale);

  async function onAddCard() {
    setError(null);
    setBusy('card');
    const res = await addCardStep(plan);
    if (res.ok && res.data) {
      window.location.assign(res.data.url);
      return;
    }
    setBusy(null);
    setError('generic');
  }

  async function onContinue() {
    setError(null);
    setBusy('continue');
    const res = await continuePlanStep(plan);
    setBusy(null);
    if (!res.ok) setError(res.error === 'cardRequired' ? 'cardRequired' : 'generic');
  }

  return (
    <div className="flex flex-col gap-5">
      {error && <Banner tone="error">{t(`errors.${error}`)}</Banner>}
      {cancelled && !card && <Banner tone="info">{t('cardCancelled')}</Banner>}
      {returning && !card && waited >= 30 && <Banner tone="warn">{t('cardSlow')}</Banner>}
      <PlanRadioCards
        plans={plans}
        value={plan}
        onChange={setPlan}
        recommended={recommended}
        recommendedLabel={
          ordersPerMonth ? t('recommendedFor', { orders: t(`ordersOption.${ordersPerMonth}`) }) : ''
        }
        label={t('planTitle')}
      />
      <div className="flex flex-wrap items-center gap-3 rounded-sm bg-bg-base px-4 py-3">
        <Icon
          icon={card ? CircleCheck : CreditCard}
          size={16}
          className={card ? 'text-ok-fg' : ''}
        />
        <div className="flex min-w-0 flex-1 flex-col" aria-live="polite">
          <span className="text-table font-semibold">
            {card
              ? t('cardAdded', { brand: brandName(card.brand), last4: card.last4 ?? '' })
              : waiting
                ? t('cardWaiting')
                : t('payByCard')}
          </span>
          <span className="text-meta text-fg-2">
            {t('priceLine', {
              plan: selected.name,
              net: money(price.net),
              vat: money(price.vat),
              gross: money(price.gross),
            })}
          </span>
        </div>
        <Button
          variant={card ? 'secondary' : 'dark'}
          size="s"
          onClick={onAddCard}
          loading={busy === 'card' || waiting}
        >
          {card ? t('changeCard') : t('addCard')}
        </Button>
      </div>
      {/* The company exists from step 1 on; it is edited under Indstillinger, so no Tilbage here. */}
      <div className="flex items-center justify-end gap-3">
        <Button
          variant="primary"
          size="l"
          onClick={onContinue}
          loading={busy === 'continue'}
          disabled={!card}
        >
          {t('continue')}
        </Button>
      </div>
    </div>
  );
}
