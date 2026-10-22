'use client';

import { Banner, Icon, cn } from '@agentor/ui';
import {
  BigButton,
  MobileCard,
  Modal,
  SectionHeading,
  Segmented,
  Switch,
} from '@agentor/ui/mobile';
import { Check, ChevronRight, History } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';
import type { ProductFeature } from '@/app/platform/admin/product/actions';
import {
  useProductForm,
  yearPrice,
  type ProductHistoryRow,
  type ProductPlan,
} from './product-form';

/** The plan switches on MP26, in the board's order. */
const SWITCHES: { key: ProductFeature; sub?: 'externalUsersSub' }[] = [
  { key: 'externalUsers', sub: 'externalUsersSub' },
  { key: 'moreDestinations' },
  { key: 'sso' },
  { key: 'whiteLabel' },
  { key: 'supportAudit' },
  { key: 'eanInvoice' },
];

const INPUT =
  'h-10 w-24 min-w-0 rounded-field border border-border-strong bg-white px-3 text-right font-sans text-m-input tabular-nums text-fg-1 box-border';

/**
 * MP26 Produkt: the support price and one plan at a time (Startup · Business · Enterprise), with
 * "Historik" and "Gem ændringer" docked above the tab bar. Saving asks who the new prices apply to,
 * as A2 does. Same action and versions as desktop.
 */
export function ProductFormMobile({
  support,
  plans,
  history,
}: {
  support: { rateInclKr: number; roundingMinutes: number; nonBillable: string[] };
  plans: ProductPlan[];
  history: ProductHistoryRow[];
}) {
  const t = useTranslations('platform.product');
  const tc = useTranslations('common');
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale === 'da' ? 'da-DK' : 'en-GB');
  const id = useId();
  const f = useProductForm(support, plans);
  const [planId, setPlanId] = useState(plans.find((p) => p.id === 'business')?.id ?? plans[0]?.id);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const plan = f.rows.find((r) => r.id === planId);

  const row = (
    label: ReactNode,
    control: ReactNode,
    sub?: ReactNode,
    htmlFor?: string,
    key?: string,
  ) => (
    <div
      key={key}
      className="flex min-h-14 items-center gap-3 px-4 py-2 shadow-row-divider last:shadow-none"
    >
      <span className="flex min-w-0 flex-1 flex-col leading-snug">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-body font-semibold">
            {label}
          </label>
        ) : (
          <strong className="text-body font-semibold">{label}</strong>
        )}
        {sub && <span className="text-meta font-medium text-fg-2">{sub}</span>}
      </span>
      {control}
    </div>
  );
  const unit = (u: string) => <span className="text-meta font-medium text-fg-2">{u}</span>;

  return (
    <>
      {f.error && <Banner tone="error">{f.error}</Banner>}
      <SectionHeading>{t('supportTitle')}</SectionHeading>
      <MobileCard>
        {row(
          t('rateIncl'),
          <span className="flex items-center gap-2">
            <input
              id={`${id}-rate`}
              inputMode="decimal"
              value={f.rate}
              onChange={(e) => f.setRate(e.target.value)}
              className={INPUT}
            />
            {unit(t('kr'))}
          </span>,
          undefined,
          `${id}-rate`,
        )}
        {row(
          t('exVat'),
          <strong className="tabular-nums">
            {f.exVat === null ? '–' : t('krAmount', { amount: nf.format(f.exVat) })}
          </strong>,
          t('autoCalculated'),
        )}
        {row(
          t('rounding'),
          <span className="flex items-center gap-2">
            <select
              id={`${id}-rounding`}
              value={f.rounding}
              onChange={(e) => f.setRounding(e.target.value)}
              className={cn(INPUT, 'w-20 text-left')}
            >
              {[1, 5, 6, 10, 15, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {unit(t('roundingUnitShort'))}
          </span>,
          undefined,
          `${id}-rounding`,
        )}
        {row(
          t('billing'),
          <Icon icon={ChevronRight} size={18} className="text-fg-2" />,
          t('billingRule'),
        )}
      </MobileCard>

      <SectionHeading>{t('plansTitle')}</SectionHeading>
      {planId && (
        <Segmented
          label={t('plansTitle')}
          value={planId}
          onChange={(k) => setPlanId(k as ProductPlan['id'])}
          items={f.rows.map((r) => ({ key: r.id, label: r.name }))}
        />
      )}
      {plan && (
        <MobileCard>
          {row(
            t('priceMonth'),
            <span className="flex items-center gap-2">
              <input
                id={`${id}-price`}
                inputMode="decimal"
                value={plan.price}
                onChange={(e) => f.update(plan.id, { price: e.target.value })}
                className={INPUT}
              />
              {unit(t('kr'))}
            </span>,
            undefined,
            `${id}-price`,
          )}
          {row(
            t('priceYear'),
            <strong className="tabular-nums">
              {yearPrice(plan.price) === null
                ? '–'
                : t('krAmount', { amount: nf.format(yearPrice(plan.price)!) })}
            </strong>,
            t('priceYearSub'),
          )}
          {row(
            t('transactions'),
            <input
              id={`${id}-tx`}
              inputMode="numeric"
              placeholder={t('unlimited')}
              value={plan.transactions}
              onChange={(e) => f.update(plan.id, { transactions: e.target.value })}
              className={INPUT}
            />,
            undefined,
            `${id}-tx`,
          )}
          {row(
            t('seats'),
            <input
              id={`${id}-seats`}
              inputMode="numeric"
              placeholder={t('placeholder')}
              value={plan.seatsText}
              onChange={(e) => f.update(plan.id, { seatsText: e.target.value })}
              className={INPUT}
            />,
            undefined,
            `${id}-seats`,
          )}
          {row(
            t('interval'),
            <strong>{t('minutes', { count: plan.pollingIntervalMinutes })}</strong>,
          )}
          {SWITCHES.map((s) =>
            row(
              t(`featureShort.${s.key}`),
              <Switch
                label={t(`featureShort.${s.key}`)}
                checked={plan.features[s.key]}
                onCheckedChange={(on) =>
                  f.update(plan.id, { features: { ...plan.features, [s.key]: on } })
                }
              />,
              s.sub ? t(s.sub) : undefined,
              undefined,
              s.key,
            ),
          )}
        </MobileCard>
      )}
      <p className="m-0 px-1 text-meta text-fg-2">{t('mobileNote')}</p>

      <div className="sticky bottom-over-tabbar z-20 -mx-4 mt-1 flex gap-2.5 bg-white px-4 pt-3 pb-5 shadow-hairline-t">
        <BigButton variant="secondary" className="flex-1" onClick={() => setHistoryOpen(true)}>
          <Icon icon={History} size={18} />
          {t('history')}
        </BigButton>
        <BigButton
          variant="primary"
          className="flex-1"
          loading={f.pending}
          onClick={() => setConfirmOpen(true)}
        >
          <Icon icon={Check} size={18} />
          {t('save')}
        </BigButton>
      </div>

      <Modal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('whenTitle')}
        closeLabel={tc('close')}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <BigButton variant="secondary" onClick={() => setConfirmOpen(false)}>
              {tc('cancel')}
            </BigButton>
            <BigButton
              variant="primary"
              loading={f.pending}
              onClick={() => {
                f.save();
                setConfirmOpen(false);
              }}
            >
              {t('save')}
            </BigButton>
          </div>
        }
      >
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <legend className="sr-only">{t('whenTitle')}</legend>
          {(['new', 'all_from_renewal'] as const).map((v) => (
            <label key={v} className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name={`${id}-applies`}
                value={v}
                checked={f.appliesTo === v}
                onChange={() => f.setAppliesTo(v)}
                className="mt-0.5 size-5 accent-fg-1"
              />
              <span className="leading-snug">
                <strong>{t(`applies.${v}`)}</strong>
                <span className="block text-meta text-fg-2">{t(`applies.${v}Sub`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Modal>

      <Modal
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        title={t('history')}
        description={t('historyIntro')}
        closeLabel={tc('close')}
      >
        {history.length === 0 ? (
          <p className="m-0 text-body text-fg-2">{t('historyEmpty')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex flex-col gap-0.5 py-2.5 shadow-row-divider last:shadow-none"
              >
                <strong className="text-body">
                  {h.what} · {h.change}
                </strong>
                <span className="text-meta text-fg-2">
                  {h.appliesTo} · {h.effective} · {h.by}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
