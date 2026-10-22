'use client';

import { Button, Card, Dialog, Icon, Switch, Table, Td, Th, Tr, cn, toast } from '@agentor/ui';
import { Check, History } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition, type ReactNode } from 'react';
import {
  saveProductAction,
  type ProductFeature,
  type ProductInput,
} from '@/app/platform/admin/product/actions';

export interface ProductPlan {
  id: 'startup' | 'business' | 'enterprise';
  name: string;
  priceKr: number;
  transactionsPerMonth: number | null;
  seats: number | null;
  pollingIntervalMinutes: number;
  integrationSets: number | null;
  payloadRetentionDays: number | null;
  trialDays: number | null | undefined;
  features: Record<ProductFeature, boolean>;
}

export interface ProductHistoryRow {
  id: string;
  what: string;
  change: string;
  appliesTo: string;
  effective: string;
  by: string;
}

/** Rows of switches on A2, in the board's order. */
const SWITCHES: { key: ProductFeature; label: string }[] = [
  { key: 'moreDestinations', label: 'moreDestinations' },
  { key: 'externalUsers', label: 'externalUsers' },
  { key: 'sso', label: 'sso' },
  { key: 'whiteLabel', label: 'whiteLabel' },
  { key: 'supportAudit', label: 'supportAudit' },
];

const parseKr = (v: string) => Number(v.replace(/\./g, '').replace(',', '.'));
const parseLimit = (v: string): number | null => (v.trim() === '' ? null : Math.round(parseKr(v)));

/** Form state and saving, shared by A2 (desktop) and MP26 (phone). */
export function useProductForm(
  support: { rateInclKr: number; roundingMinutes: number; nonBillable: string[] },
  plans: ProductPlan[],
) {
  const t = useTranslations('platform.product');
  const tc = useTranslations('common');
  const router = useRouter();
  const [rate, setRate] = useState(String(support.rateInclKr));
  const [rounding, setRounding] = useState(String(support.roundingMinutes));
  const [nonBillable, setNonBillable] = useState(new Set(support.nonBillable));
  const [rows, setRows] = useState(
    plans.map((p) => ({
      ...p,
      price: String(p.priceKr),
      transactions: p.transactionsPerMonth === null ? '' : String(p.transactionsPerMonth),
      seatsText: p.seats === null ? '' : String(p.seats),
    })),
  );
  const [appliesTo, setAppliesTo] = useState<ProductInput['appliesTo']>('new');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const rateKr = parseKr(rate);
  const exVat = Number.isFinite(rateKr) ? Math.round(rateKr / 1.25) : null;

  const update = (planId: string, patch: Partial<(typeof rows)[number]>) =>
    setRows((rs) => rs.map((r) => (r.id === planId ? { ...r, ...patch } : r)));
  const toggleNonBillable = (r: string) =>
    setNonBillable((s) => {
      const n = new Set(s);
      if (n.has(r)) n.delete(r);
      else n.add(r);
      return n;
    });

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveProductAction({
        support: {
          rateInclKr: rateKr,
          roundingMinutes: Number(rounding) as ProductInput['support']['roundingMinutes'],
          nonBillable: [...nonBillable] as ProductInput['support']['nonBillable'],
        },
        plans: rows.map((r) => ({
          planId: r.id,
          priceKr: parseKr(r.price),
          transactionsPerMonth: parseLimit(r.transactions),
          seats: parseLimit(r.seatsText),
          features: r.features,
        })),
        appliesTo,
      });
      if (!res.ok) {
        setError(t('error'));
        return;
      }
      toast.ok({
        title:
          res.data!.plans === 0 && !res.data!.support
            ? t('nothingChanged')
            : t('saved', { plans: res.data!.plans, notices: res.data!.notices }),
        closeLabel: tc('close'),
      });
      router.refresh();
    });

  return {
    rate,
    setRate,
    rounding,
    setRounding,
    nonBillable,
    toggleNonBillable,
    rows,
    update,
    appliesTo,
    setAppliesTo,
    error,
    pending,
    save,
    exVat,
  };
}

export const yearPrice = (price: string) => {
  const kr = parseKr(price);
  return Number.isFinite(kr) ? Math.round(kr * 10) : null;
};

/**
 * Administration › Produkt (A2): the support price and the plans' prices and features. Values come
 * from the support price versions and plan_entitlements; "Gem ændringer" stores new versions.
 */
export function ProductForm({
  support,
  plans,
  history,
}: {
  support: { rateInclKr: number; roundingMinutes: number; nonBillable: string[] };
  plans: ProductPlan[];
  history: ProductHistoryRow[];
}) {
  const t = useTranslations('platform.product');
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale === 'da' ? 'da-DK' : 'en-GB');
  const tf = useTranslations('plans.features');
  const id = useId();
  const f = useProductForm(support, plans);
  const { rate, setRate, rounding, setRounding, nonBillable, rows, update, appliesTo } = f;
  const { setAppliesTo, error, pending, save, exVat } = f;
  const [historyOpen, setHistoryOpen] = useState(false);

  const input =
    'h-9 rounded-sm border border-border bg-surface px-3 text-right font-sans text-body tabular-nums text-fg-1';
  const cellRow = (label: ReactNode, sub: ReactNode, cells: ReactNode[], key?: string) => (
    <Tr key={key}>
      <Td className="whitespace-normal pl-5">
        <strong className="font-semibold">{label}</strong>
        {sub && <span className="block text-meta text-fg-2">{sub}</span>}
      </Td>
      {cells.map((c, i) => (
        <Td key={i}>{c}</Td>
      ))}
    </Tr>
  );
  const limitText = (v: number | null | undefined, unit: (n: number) => string, none: string) =>
    v === undefined ? '–' : v === null ? none : unit(v);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-page">{t('title')}</h1>
          <p className="m-0 text-fg-2">{t('intro')}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="m" onClick={() => setHistoryOpen(true)}>
            <Icon icon={History} size={16} />
            {t('history')}
          </Button>
          <Button variant="primary" size="m" loading={pending} onClick={save}>
            {!pending && <Icon icon={Check} size={16} />}
            {t('save')}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="m-0 text-body text-error-fg">
          {error}
        </p>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-product">
        <Card padding="none" className="overflow-hidden">
          <h2 className="m-0 px-5 py-4 text-card shadow-hairline-b">{t('supportTitle')}</h2>
          <div className="flex flex-col gap-1 px-5 py-4">
            <div className="grid grid-cols-form-row items-center gap-4 py-2">
              <label htmlFor={`${id}-rate`} className="text-table font-medium">
                {t('rateIncl')}
                <span className="block text-meta text-fg-2">
                  {exVat === null ? '–' : t('rateEx', { amount: nf.format(exVat) })}
                </span>
              </label>
              <span className="inline-flex items-center gap-2">
                <input
                  id={`${id}-rate`}
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  className={cn(input, 'w-28')}
                />
                <span className="text-meta text-fg-2">{t('kr')}</span>
              </span>
            </div>
            <div className="grid grid-cols-form-row items-center gap-4 py-2">
              <label htmlFor={`${id}-rounding`} className="text-table font-medium">
                {t('rounding')}
              </label>
              <span className="inline-flex items-center gap-2">
                <select
                  id={`${id}-rounding`}
                  value={rounding}
                  onChange={(e) => setRounding(e.target.value)}
                  className={cn(input, 'w-20 text-left')}
                >
                  {[1, 5, 6, 10, 15, 30, 60].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <span className="text-meta text-fg-2">{t('roundingUnit')}</span>
              </span>
            </div>
            <div className="grid grid-cols-form-row items-center gap-4 py-2">
              <span className="text-table font-medium">{t('billing')}</span>
              <span className="text-body">{t('billingRule')}</span>
            </div>
            <div
              role="group"
              aria-labelledby={`${id}-nonbillable`}
              className="grid grid-cols-form-row items-center gap-4 py-2"
            >
              <span id={`${id}-nonbillable`} className="text-table font-medium">
                {t('nonBillable')}
              </span>
              <span className="flex flex-wrap gap-1.5">
                {(['agentor_error', 'goodwill'] as const).map((r) => {
                  const on = nonBillable.has(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={on}
                      onClick={() => f.toggleNonBillable(r)}
                      className={cn(
                        'inline-flex h-8 cursor-pointer items-center rounded-full border-0 px-3.5 font-sans text-table',
                        on ? 'bg-primary font-semibold' : 'bg-surface shadow-ring-chip',
                      )}
                    >
                      {t(`reason.${r}`)}
                    </button>
                  );
                })}
                {/* Time without a case is never billed (decision 18); shown, not a choice. */}
                <span
                  className="inline-flex h-8 items-center rounded-full bg-bg-base px-3.5 text-table font-semibold"
                  title={t('noCaseRule')}
                >
                  {t('reason.no_case')}
                </span>
              </span>
            </div>
            <p className="m-0 mt-2 text-meta text-fg-2">{t('supportNote')}</p>
          </div>
        </Card>

        <Card padding="none" className="overflow-x-auto">
          <h2 className="m-0 px-5 py-4 text-card shadow-hairline-b">{t('plansTitle')}</h2>
          <Table aria-label={t('plansTitle')}>
            <thead>
              <tr>
                <Th className="pl-5">
                  <span className="sr-only">{t('colWhat')}</span>
                </Th>
                {rows.map((r) => (
                  <Th key={r.id}>{r.name}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cellRow(
                t('priceMonth'),
                t('exVat'),
                rows.map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-2">
                    <input
                      aria-label={t('priceFor', { plan: r.name })}
                      inputMode="decimal"
                      value={r.price}
                      onChange={(e) => update(r.id, { price: e.target.value })}
                      className={cn(input, 'w-24')}
                    />
                    <span className="text-meta text-fg-2">{t('kr')}</span>
                  </span>
                )),
              )}
              {cellRow(
                t('priceYear'),
                t('priceYearSub'),
                rows.map((r) => {
                  const y = yearPrice(r.price);
                  return y === null ? '–' : t('krAmount', { amount: nf.format(y) });
                }),
              )}
              {cellRow(
                t('transactions'),
                null,
                rows.map((r) => (
                  <input
                    key={r.id}
                    aria-label={t('transactionsFor', { plan: r.name })}
                    inputMode="numeric"
                    placeholder={t('unlimited')}
                    value={r.transactions}
                    onChange={(e) => update(r.id, { transactions: e.target.value })}
                    className={cn(input, 'w-24')}
                  />
                )),
              )}
              {cellRow(
                t('interval'),
                null,
                rows.map((r) => t('minutes', { count: r.pollingIntervalMinutes })),
              )}
              {cellRow(
                t('integrationSets'),
                t('integrationSetsSub'),
                rows.map((r) =>
                  r.integrationSets === null ? t('all') : String(r.integrationSets),
                ),
              )}
              {SWITCHES.slice(0, 1).map((s) => switchRow(s))}
              {cellRow(
                t('seats'),
                null,
                rows.map((r) => (
                  <input
                    key={r.id}
                    aria-label={t('seatsFor', { plan: r.name })}
                    inputMode="numeric"
                    placeholder={t('placeholder')}
                    value={r.seatsText}
                    onChange={(e) => update(r.id, { seatsText: e.target.value })}
                    className={cn(input, 'w-20')}
                  />
                )),
              )}
              {SWITCHES.slice(1).map((s) => switchRow(s))}
              {cellRow(
                t('retention'),
                null,
                rows.map((r) =>
                  limitText(
                    r.payloadRetentionDays,
                    (n) => t('days', { count: n }),
                    t('placeholder'),
                  ),
                ),
              )}
              {cellRow(
                t('trial'),
                null,
                rows.map((r) =>
                  limitText(r.trialDays, (n) => t('days', { count: n }), t('byAgreement')),
                ),
              )}
              {switchRow({ key: 'eanInvoice', label: 'eanInvoice' })}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card padding="none" className="overflow-hidden">
        <h2 className="m-0 px-5 py-4 text-card shadow-hairline-b">{t('whenTitle')}</h2>
        <fieldset className="m-0 flex flex-col gap-2.5 border-0 px-5 py-4">
          <legend className="sr-only">{t('whenTitle')}</legend>
          {(['new', 'all_from_renewal'] as const).map((v) => (
            <label key={v} className="flex cursor-pointer items-start gap-2.5">
              <input
                type="radio"
                name={`${id}-applies`}
                value={v}
                checked={appliesTo === v}
                onChange={() => setAppliesTo(v)}
                className="mt-0.5 size-5 accent-fg-1"
              />
              <span>
                <strong>{t(`applies.${v}`)}</strong>
                <span className="block text-meta text-fg-2">{t(`applies.${v}Sub`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Card>

      <ProductHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} history={history} />
    </>
  );

  function switchRow(s: { key: ProductFeature; label: string }) {
    return cellRow(
      tf(s.label as 'sso'),
      null,
      rows.map((r) => (
        <Switch
          key={r.id}
          aria-label={`${tf(s.label as 'sso')} · ${r.name}`}
          checked={r.features[s.key]}
          onCheckedChange={(on) => update(r.id, { features: { ...r.features, [s.key]: on } })}
        />
      )),
      s.key,
    );
  }
}

/** "Historik" (A2, MP26): every price version, newest first. */
export function ProductHistoryDialog({
  open,
  onOpenChange,
  history,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: ProductHistoryRow[];
}) {
  const t = useTranslations('platform.product');
  const tc = useTranslations('common');
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={720}
      title={t('history')}
      description={t('historyIntro')}
      closeLabel={tc('close')}
    >
      {history.length === 0 ? (
        <p className="m-0 text-body text-fg-2">{t('historyEmpty')}</p>
      ) : (
        <Table aria-label={t('history')}>
          <thead>
            <tr>
              <Th>{t('colWhat')}</Th>
              <Th>{t('colChange')}</Th>
              <Th>{t('colApplies')}</Th>
              <Th>{t('colEffective')}</Th>
              <Th>{t('colBy')}</Th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <Tr key={h.id}>
                <Td className="font-semibold">{h.what}</Td>
                <Td className="whitespace-normal">{h.change}</Td>
                <Td>{h.appliesTo}</Td>
                <Td>{h.effective}</Td>
                <Td>{h.by}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Dialog>
  );
}
