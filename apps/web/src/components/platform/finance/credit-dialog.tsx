'use client';

import {
  Banner,
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  RadioCard,
  RadioGroup,
  Segmented,
  Textarea,
  toast,
} from '@agentor/ui';
import type { CreditableLine } from '@agentor/db';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  createCreditNoteAction,
  creditStateAction,
  retryCreditRefundAction,
} from '@/app/platform/finance/actions';

const KNOWN = [
  'CREDIT_EXCEEDS_INVOICE',
  'NOTHING_TO_CREDIT',
  'REASON_REQUIRED',
  'REFUND_NOT_POSSIBLE',
  'INVOICE_NOT_ISSUED',
  'LINE_INVALID',
];

/** "2,25" → 2.25; anything else → NaN. */
const num = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

interface Pick {
  on: boolean;
  /** Hours for hour lines, kroner for the rest. */
  value: string;
}

/**
 * "Kreditér" on an invoice (F4, F6; I02): full or partial credit, the reason and how the money
 * goes back. The database checks again that nothing exceeds what is left of the invoice.
 */
export function CreditButton({
  tenantId,
  invoiceId,
  number,
}: {
  tenantId: string;
  invoiceId: string;
  number: string;
}) {
  const t = useTranslations('platform.finance.credit');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<CreditableLine[] | null>(null);
  const [canRefund, setCanRefund] = useState(false);
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [picks, setPicks] = useState<Record<number, Pick>>({});
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState<'card' | 'offset'>('offset');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const kr = (ore: number) =>
    new Intl.NumberFormat(locale === 'da' ? 'da-DK' : 'en-GB', {
      style: 'currency',
      currency: 'DKK',
    }).format(ore / 100);

  const load = () => {
    setOpen(true);
    setError(null);
    start(async () => {
      const res = await creditStateAction({ tenantId, invoiceId });
      if (!res.ok) return setError(t('errors.generic'));
      setLines(res.data!.lines);
      setCanRefund(res.data!.canRefund);
      setRefund(res.data!.canRefund ? 'card' : 'offset');
      setPicks(
        Object.fromEntries(res.data!.lines.map((l) => [l.idx, { on: false, value: '' }])) as Record<
          number,
          Pick
        >,
      );
    });
  };

  const left = (l: CreditableLine) => l.amountOre - l.creditedOre;
  const chosen = (lines ?? [])
    .filter((l) => left(l) > 0)
    .map((l) => {
      if (mode === 'full')
        return {
          idx: l.idx,
          amountOre: left(l),
          quantityMilli: Math.max(1, l.quantityMilli - l.creditedMilli),
        };
      const p = picks[l.idx];
      if (!p?.on) return null;
      const v = num(p.value);
      if (!(v > 0)) return null;
      if (l.unit === 'hours' && l.unitPriceOre) {
        const quantityMilli = Math.round(v * 1000);
        return {
          idx: l.idx,
          quantityMilli,
          amountOre: Math.round((quantityMilli / 1000) * l.unitPriceOre),
        };
      }
      const amountOre = Math.round(v * 100);
      const unit = l.unitPriceOre || l.amountOre || 1;
      return {
        idx: l.idx,
        amountOre,
        quantityMilli: Math.max(1, Math.round((amountOre / unit) * 1000)),
      };
    })
    .filter((x): x is { idx: number; amountOre: number; quantityMilli: number } => x !== null);
  const net = chosen.reduce((a, c) => a + c.amountOre, 0);
  const over = chosen.some((c) => {
    const l = lines?.find((x) => x.idx === c.idx);
    return !l || c.amountOre > left(l);
  });

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await createCreditNoteAction({
        tenantId,
        invoiceId,
        full: mode === 'full',
        lines: mode === 'full' ? [] : chosen,
        reason,
        refund,
      });
      if (!res.ok)
        return setError(
          t(KNOWN.includes(res.error ?? '') ? `errors.${res.error}` : 'errors.generic'),
        );
      setOpen(false);
      const r = res.data!.refund;
      toast[r === 'failed' ? 'error' : 'ok']({
        title: t('created', { number: res.data!.number }),
        ...(r === 'done'
          ? { description: t('refunded') }
          : r === 'pending'
            ? { description: t('refundPending') }
            : r === 'failed'
              ? { description: t('refundFailed') }
              : {}),
        closeLabel: tc('close'),
      });
      router.refresh();
    });

  return (
    <>
      <Button variant="secondary" size="s" onClick={load} aria-label={t('actionOf', { number })}>
        {t('action')}
      </Button>
      {open && (
        <Dialog
          open
          onOpenChange={setOpen}
          width={720}
          title={t('title', { number })}
          description={t('intro')}
          closeLabel={tc('close')}
          footer={
            <span className="flex items-center gap-4">
              {net > 0 && (
                <span className="text-table text-fg-2">
                  {t('total', { amount: kr(Math.round(net * 1.25)) })}
                </span>
              )}
              <Button
                variant="primary"
                size="m"
                loading={pending}
                disabled={!lines || net <= 0 || over || !reason.trim()}
                onClick={submit}
              >
                {t('submit')}
              </Button>
            </span>
          }
        >
          {error && <Banner tone="error">{error}</Banner>}
          {!lines ? (
            <p className="m-0 text-table text-fg-2">{t('loading')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              <Segmented
                aria-label={t('mode')}
                value={mode}
                onValueChange={setMode}
                options={[
                  { value: 'full', label: t('full') },
                  { value: 'partial', label: t('partial') },
                ]}
              />
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {lines.map((l) => {
                  const rest = left(l);
                  const p = picks[l.idx] ?? { on: false, value: '' };
                  return (
                    <li
                      key={l.idx}
                      className="flex items-center gap-3 rounded-sm p-3 shadow-ring-chip"
                    >
                      {mode === 'partial' && (
                        <Checkbox
                          aria-label={l.text}
                          disabled={rest <= 0}
                          checked={p.on}
                          onCheckedChange={(v) =>
                            setPicks((s) => ({ ...s, [l.idx]: { ...p, on: v === true } }))
                          }
                        />
                      )}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-table font-semibold">{l.text}</span>
                        <span className="text-meta text-fg-2">
                          {rest > 0 ? t('left', { amount: kr(rest) }) : t('nothingLeft')}
                        </span>
                      </span>
                      {mode === 'partial' && p.on && (
                        <Input
                          aria-label={`${l.text}: ${l.unit === 'hours' ? t('hours') : t('amount')}`}
                          inputMode="decimal"
                          className="w-28 tabular"
                          placeholder={l.unit === 'hours' ? t('hours') : 'kr.'}
                          value={p.value}
                          onChange={(e) =>
                            setPicks((s) => ({ ...s, [l.idx]: { ...p, value: e.target.value } }))
                          }
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
              <Field label={t('reason')} help={t('reasonHelp')}>
                {({ id, describedBy }) => (
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                )}
              </Field>
              <RadioGroup
                aria-label={t('refund')}
                value={refund}
                onValueChange={(v) => setRefund(v as 'card' | 'offset')}
              >
                <RadioCard
                  value="card"
                  disabled={!canRefund}
                  title={t('refundCard')}
                  description={canRefund ? t('refundCardHelp') : t('refundCardOff')}
                />
                <RadioCard
                  value="offset"
                  title={t('refundOffset')}
                  description={t('refundOffsetHelp')}
                />
              </RadioGroup>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

/** "Prøv tilbageførsel igen" on a credit note whose card refund failed. */
export function RetryRefundButton({
  tenantId,
  creditNoteId,
}: {
  tenantId: string;
  creditNoteId: string;
}) {
  const t = useTranslations('platform.finance.credit');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="s"
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await retryCreditRefundAction({ tenantId, creditNoteId });
          const r = res.ok ? res.data!.refund : 'failed';
          toast[r === 'failed' ? 'error' : 'ok']({
            title:
              r === 'done'
                ? t('refunded')
                : r === 'pending'
                  ? t('refundPending')
                  : t('refundFailed'),
            closeLabel: tc('close'),
          });
          router.refresh();
        })
      }
    >
      {t('retry')}
    </Button>
  );
}
