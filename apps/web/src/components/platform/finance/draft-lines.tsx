'use client';

import { Banner, Button, Checkbox, Dialog, Field, Icon, Input, toast } from '@agentor/ui';
import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  addDraftLineAction,
  removeDraftLineAction,
  setTimelogAction,
} from '@/app/platform/finance/actions';

/** F5 "Tilføj linje": a line by hand on the draft (a negative amount is a discount). */
export function AddLineButton({ tenantId, month }: { tenantId: string; month: string }) {
  const t = useTranslations('platform.finance.draft');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const value = Number(amount.replace(/\./g, '').replace(',', '.'));
  return (
    <>
      <Button variant="secondary" size="m" className="w-full" onClick={() => setOpen(true)}>
        <Icon icon={Plus} size={16} />
        {t('addLine')}
      </Button>
      {open && (
        <Dialog
          open
          onOpenChange={setOpen}
          width={560}
          title={t('addLine')}
          description={t('addLineHelp')}
          closeLabel={tc('close')}
          footer={
            <Button
              variant="primary"
              size="m"
              loading={pending}
              disabled={!text.trim() || !amount || Number.isNaN(value)}
              onClick={() =>
                start(async () => {
                  const res = await addDraftLineAction({ tenantId, month, text, amountKr: value });
                  if (!res.ok) return setError(true);
                  setOpen(false);
                  setText('');
                  setAmount('');
                  toast.ok({ title: t('lineAdded'), closeLabel: tc('close') });
                  router.refresh();
                })
              }
            >
              {t('addLine')}
            </Button>
          }
        >
          {error && <Banner tone="error">{t('error')}</Banner>}
          <Field label={t('lineText')}>
            {({ id }) => (
              <Input
                id={id}
                maxLength={200}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('lineAmount')} help={t('lineAmountHelp')} inline>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                inputMode="decimal"
                className="w-40 tabular"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d,.-]/g, ''))}
              />
            )}
          </Field>
        </Dialog>
      )}
    </>
  );
}

export function RemoveLineButton({
  tenantId,
  month,
  index,
  label,
}: {
  tenantId: string;
  month: string;
  index: number;
  label: string;
}) {
  const t = useTranslations('platform.finance.draft');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      loading={pending}
      aria-label={t('removeLine', { text: label })}
      onClick={() =>
        start(async () => {
          await removeDraftLineAction({ tenantId, month, index });
          router.refresh();
        })
      }
    >
      <Icon icon={X} size={14} />
    </Button>
  );
}

/** F5 "Vedhæft tidslog": date and minutes per registration on the invoice PDF. */
export function TimelogToggle({
  tenantId,
  invoiceId,
  attach,
  disabled,
}: {
  tenantId: string;
  invoiceId: string;
  attach: boolean;
  disabled: boolean;
}) {
  const t = useTranslations('platform.finance.draft');
  const router = useRouter();
  const [on, setOn] = useState(attach);
  const [pending, start] = useTransition();
  return (
    <label className="flex items-start gap-3">
      <Checkbox
        className="mt-0.5"
        checked={on}
        disabled={disabled || pending}
        onCheckedChange={(v) => {
          const next = v === true;
          setOn(next);
          start(async () => {
            const res = await setTimelogAction({ tenantId, invoiceId, attach: next });
            if (!res.ok) setOn(!next);
            router.refresh();
          });
        }}
      />
      <span className="flex flex-col">
        <span className="text-body font-semibold">{t('attachTimelog')}</span>
        <span className="text-meta text-fg-2">{t('attachTimelogHelp')}</span>
      </span>
    </label>
  );
}
