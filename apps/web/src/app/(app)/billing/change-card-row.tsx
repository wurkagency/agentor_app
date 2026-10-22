'use client';

import { toast } from '@agentor/ui';
import { Chevron, RowIcon } from '@agentor/ui/mobile';
import { CreditCard, LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { changeCard } from './actions';

/** MA15 "Betalingskort": opens QuickPay's hosted card page; we never see the card number. */
export function ChangeCardRow({ title, meta }: { title: string; meta: string }) {
  const t = useTranslations('mobile.billing');
  const tc = useTranslations('common');
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label={`${title}: ${meta}. ${t('changeCard')}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await changeCard();
          if (res.ok && res.data) window.location.assign(res.data.url);
          else toast.error({ title: t('cardFailed'), closeLabel: tc('close') });
        })
      }
      className="flex min-h-14 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 text-left font-sans text-fg-1 shadow-row-divider last:shadow-none hover:bg-row-hover"
    >
      <RowIcon icon={CreditCard} size={30} />
      <span className="flex min-w-0 flex-1 flex-col py-2.5 leading-snug">
        <strong className="truncate text-body font-semibold">{title}</strong>
        <span className="truncate text-meta font-medium text-fg-2">{meta}</span>
      </span>
      {pending ? (
        <LoaderCircle aria-hidden width={18} height={18} className="animate-spin text-fg-2" />
      ) : (
        <Chevron />
      )}
    </button>
  );
}
