'use client';

import { Icon, toast } from '@agentor/ui';
import {
  BigButton,
  CardButton,
  MOBILE_INPUT,
  MobileField,
  MobileInput,
  Modal,
  Switch,
  TopBarAction,
} from '@agentor/ui/mobile';
import { Check, FileText, Plus, Send, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import type { ActionResult } from '@/server/actor';
import {
  addDraftLineAction,
  approveInvoiceAction,
  buildDraftsAction,
  removeDraftLineAction,
  sendReportAction,
  sendStatementAction,
  setDiscountAction,
  setTimelogAction,
} from '@/app/platform/finance/actions';

// Client actions on the mobile finance boards (MP18–MP23): the same server actions as desktop.

/** Toasts for the "send to e-mail" actions, with the desktop texts (F4, F7). */
function useSend() {
  const t = useTranslations('platform.finance.actions');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult<{ email: string }>>, done?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        const known = ['NO_EMAIL', 'NO_BOOKKEEPER', 'NOT_FOUND'].includes(res.error);
        toast.error({
          title: t(known ? `error.${res.error}` : 'error.generic'),
          closeLabel: tc('close'),
        });
        return;
      }
      toast.ok({ title: t('sent', { email: res.data!.email }), closeLabel: tc('close') });
      done?.();
      router.refresh();
    });
  return { pending, run };
}

/** MP18 "Tilføj rabat" in the top bar: customer, percent and an optional end date. */
export function MobileDiscount({
  customers,
}: {
  customers: { tenantId: string; name: string; discountPct: number | null }[];
}) {
  const t = useTranslations('platform.finance.discount');
  const tm = useTranslations('mobile.subscriptions');
  const tc = useTranslations('common');
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [tenantId, setTenantId] = useState(customers[0]?.tenantId ?? '');
  const [pct, setPct] = useState('10');
  const [until, setUntil] = useState('');
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const current = customers.find((c) => c.tenantId === tenantId);
  const valid = Boolean(tenantId) && Number(pct) >= 1 && Number(pct) <= 100;
  const save = (value: number | null) =>
    start(async () => {
      const res = await setDiscountAction({
        tenantId,
        pct: value,
        until: value && until ? until : null,
      });
      if (!res.ok) return setError(true);
      setOpen(false);
      setError(false);
      toast.ok({ title: value ? t('saved') : t('removed'), closeLabel: tc('close') });
      router.refresh();
    });
  return (
    <>
      <TopBarAction icon={Plus} label={t('add')} onNavy onClick={() => setOpen(true)} />
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('title')}
        closeLabel={tc('close')}
        footer={
          current?.discountPct ? (
            <div className="grid grid-cols-m-actions gap-2">
              <BigButton variant="secondary" loading={pending} onClick={() => save(null)}>
                {t('remove')}
              </BigButton>
              <BigButton disabled={!valid || pending} onClick={() => save(Number(pct))}>
                {t('save')}
              </BigButton>
            </div>
          ) : (
            <BigButton loading={pending} disabled={!valid} onClick={() => save(Number(pct))}>
              {t('save')}
            </BigButton>
          )
        }
      >
        <p className="m-0 text-body text-fg-2">{t('help')}</p>
        {error && (
          <p role="alert" className="m-0 text-body font-medium text-error-fg">
            {t('error')}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-customer`} className="text-table font-semibold">
            {t('customer')}
          </label>
          <select
            id={`${id}-customer`}
            className={MOBILE_INPUT}
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
          >
            {customers.map((c) => (
              <option key={c.tenantId} value={c.tenantId}>
                {c.discountPct ? tm('withDiscount', { name: c.name, pct: c.discountPct }) : c.name}
              </option>
            ))}
          </select>
        </div>
        <MobileField label={t('pct')}>
          <MobileInput
            inputMode="numeric"
            value={pct}
            onChange={(e) => setPct(e.target.value.replace(/\D/g, '').slice(0, 3))}
          />
        </MobileField>
        <MobileField label={t('until')} hint={t('untilHelp')}>
          <MobileInput type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </MobileField>
      </Modal>
    </>
  );
}

/** MP20 "Send kontoudtog" in the top bar, behind a confirm modal (one tap on an icon is easy). */
export function MobileStatement({
  tenantId,
  name,
  email,
}: {
  tenantId: string;
  name: string;
  email: string | null;
}) {
  const t = useTranslations('mobile.customerFinance');
  const tf = useTranslations('platform.finance.customer');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const { pending, run } = useSend();
  return (
    <>
      <TopBarAction icon={Send} label={tf('statement')} onNavy onClick={() => setOpen(true)} />
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('statementTitle', { name })}
        closeLabel={tc('close')}
        footer={
          <div className="grid grid-cols-m-actions gap-2">
            <BigButton variant="secondary" onClick={() => setOpen(false)}>
              {t('cancel')}
            </BigButton>
            <BigButton
              loading={pending}
              disabled={!email}
              onClick={() =>
                run(
                  () => sendStatementAction(tenantId),
                  () => setOpen(false),
                )
              }
            >
              {t('send')}
            </BigButton>
          </div>
        }
      >
        <p className="m-0 text-body text-fg-2">
          {email ? t('statementBody', { email }) : t('statementNoEmail')}
        </p>
      </Modal>
    </>
  );
}

/** MP23 "Send til bogholder" in a month's row. */
export function MobileSendReport({ month, label }: { month: string; label: string }) {
  const { pending, run } = useSend();
  return (
    <CardButton icon={Send} disabled={pending} onClick={() => run(() => sendReportAction(month))}>
      {label}
    </CardButton>
  );
}

/** MP21 "Vedhæft tidslog". */
export function MobileTimelogSwitch({
  tenantId,
  invoiceId,
  attach,
  disabled,
  label,
}: {
  tenantId: string;
  invoiceId: string;
  attach: boolean;
  disabled: boolean;
  label: string;
}) {
  const router = useRouter();
  const [on, setOn] = useState(attach);
  const [pending, start] = useTransition();
  return (
    <Switch
      checked={on}
      label={label}
      disabled={disabled || pending}
      onCheckedChange={(next) => {
        setOn(next);
        start(async () => {
          const res = await setTimelogAction({ tenantId, invoiceId, attach: next });
          if (!res.ok) setOn(!next);
          router.refresh();
        });
      }}
    />
  );
}

/** MP21 "Vis oprunding pr. linje": a view setting kept in the URL, as on desktop. */
export function MobileRoundingSwitch({
  checked,
  href,
  label,
}: {
  checked: boolean;
  href: string;
  label: string;
}) {
  const router = useRouter();
  return (
    <Switch
      checked={checked}
      label={label}
      onCheckedChange={() => router.replace(href, { scroll: false })}
    />
  );
}

/** MP21: removes a line added by hand. */
export function MobileRemoveLine({
  tenantId,
  month,
  index,
  text,
}: {
  tenantId: string;
  month: string;
  index: number;
  text: string;
}) {
  const t = useTranslations('platform.finance.draft');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label={t('removeLine', { text })}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await removeDraftLineAction({ tenantId, month, index });
          router.refresh();
        })
      }
      className="-mr-2.5 grid size-11 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent text-fg-2 disabled:opacity-45"
    >
      <Icon icon={X} size={16} />
    </button>
  );
}

/**
 * MP21 actions under the draft: "Tilføj linje" (a modal) and "Godkend"; before the month's
 * drafts exist, "Opret kladde" builds them (F3 "Forhåndsvis fakturaer").
 */
export function MobileDraftActions({
  tenantId,
  month,
  invoiceId,
  approved,
  editable,
}: {
  tenantId: string;
  month: string;
  invoiceId: string | null;
  approved: boolean;
  editable: boolean;
}) {
  const t = useTranslations('platform.finance.draft');
  const tm = useTranslations('mobile.supportInvoice');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState(false);
  const [adding, startAdd] = useTransition();
  const [pending, start] = useTransition();
  const value = Number(amount.replace(/\./g, '').replace(',', '.'));
  const fail = () => toast.error({ title: t('error'), closeLabel: tc('close') });
  const primary = invoiceId ? (
    <BigButton
      icon={approved ? undefined : Check}
      loading={pending}
      disabled={approved}
      onClick={() =>
        start(async () => {
          const res = await approveInvoiceAction({ tenantId, invoiceId });
          if (!res.ok) return void fail();
          toast.ok({ title: t('approvedToast'), closeLabel: tc('close') });
          router.refresh();
        })
      }
    >
      {approved ? t('approved') : t('approve')}
    </BigButton>
  ) : (
    <BigButton
      icon={FileText}
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await buildDraftsAction(month);
          if (!res.ok) return void fail();
          router.refresh();
        })
      }
    >
      {t('create')}
    </BigButton>
  );
  return (
    <>
      <div className="mt-auto flex gap-2 pt-1">
        {editable && (
          <BigButton variant="secondary" icon={Plus} onClick={() => setOpen(true)}>
            {t('addLine')}
          </BigButton>
        )}
        {primary}
      </div>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('addLine')}
        closeLabel={tc('close')}
        footer={
          <div className="grid grid-cols-m-actions gap-2">
            <BigButton variant="secondary" onClick={() => setOpen(false)}>
              {tm('cancel')}
            </BigButton>
            <BigButton
              loading={adding}
              disabled={!text.trim() || !amount || Number.isNaN(value)}
              onClick={() =>
                startAdd(async () => {
                  const res = await addDraftLineAction({ tenantId, month, text, amountKr: value });
                  if (!res.ok) return setError(true);
                  setOpen(false);
                  setError(false);
                  setText('');
                  setAmount('');
                  toast.ok({ title: t('lineAdded'), closeLabel: tc('close') });
                  router.refresh();
                })
              }
            >
              {tm('add')}
            </BigButton>
          </div>
        }
      >
        <p className="m-0 text-body text-fg-2">{t('addLineHelp')}</p>
        {error && (
          <p role="alert" className="m-0 text-body font-medium text-error-fg">
            {t('error')}
          </p>
        )}
        <MobileField label={t('lineText')}>
          <MobileInput maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
        </MobileField>
        <MobileField label={t('lineAmount')} hint={t('lineAmountHelp')}>
          <MobileInput
            inputMode="decimal"
            className="tabular"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d,.-]/g, ''))}
          />
        </MobileField>
      </Modal>
    </>
  );
}
