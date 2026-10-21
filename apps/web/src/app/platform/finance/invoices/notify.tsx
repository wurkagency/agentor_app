'use client';

import { Icon, toast } from '@agentor/ui';
import { Send } from 'lucide-react';
import { BigButton, Modal } from '@agentor/ui/mobile';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { notifyInvoiceAction } from '../actions';

/** MP07 "Send rykker" / "Betalingslink": a confirm modal, then the same action as desktop F6. */
export function NotifyInvoice({
  tenantId,
  invoiceId,
  kind,
  label,
  name,
  body,
  hasEmail,
}: {
  tenantId: string;
  invoiceId: string;
  kind: 'reminder' | 'payment_link';
  label: string;
  name: string;
  /** "SUP-2026-0042 · 2.000,00 kr. Mailen går til …". */
  body: string;
  /** Without a billing e-mail there is no one to send to. */
  hasEmail: boolean;
}) {
  const t = useTranslations('mobile.platform.overdue');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      const res = await notifyInvoiceAction({ tenantId, invoiceId, kind });
      if (!res.ok) return void toast.error({ title: t('failed'), closeLabel: tc('close') });
      const email = res.data!.email;
      toast.ok({
        title: kind === 'reminder' ? t('sentReminder', { email }) : t('sentLink', { email }),
        closeLabel: tc('close'),
      });
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="touch-target inline-flex h-8 flex-none cursor-pointer items-center gap-1.5 rounded-full border-0 bg-white px-3.5 font-sans text-meta font-semibold text-fg-1 shadow-ring-chip"
      >
        <Icon icon={Send} size={14} />
        {label}
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={kind === 'reminder' ? t('confirmReminder', { name }) : t('confirmLink', { name })}
        closeLabel={tc('close')}
        footer={
          <div className="grid grid-cols-m-actions gap-2">
            <BigButton variant="secondary" onClick={() => setOpen(false)}>
              {t('cancel')}
            </BigButton>
            <BigButton loading={pending} disabled={!hasEmail} onClick={send}>
              {t('send')}
            </BigButton>
          </div>
        }
      >
        <p className="m-0 text-body text-fg-2">{body}</p>
      </Modal>
    </>
  );
}
