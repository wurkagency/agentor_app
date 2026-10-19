'use client';

import { Button, Icon, toast } from '@agentor/ui';
import { Mail, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { ActionResult } from '@/server/actor';
import {
  notifyInvoiceAction,
  sendReportAction,
  sendStatementAction,
} from '@/app/platform/finance/actions';

function useRun() {
  const t = useTranslations('platform.finance.actions');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult<{ email: string }>>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        const known = ['NO_EMAIL', 'NO_BOOKKEEPER', 'NOT_FOUND'].includes(res.error ?? '');
        toast.error({
          title: t(known ? `error.${res.error}` : 'error.generic'),
          closeLabel: tc('close'),
        });
        return;
      }
      toast.ok({ title: t('sent', { email: res.data!.email }), closeLabel: tc('close') });
      router.refresh();
    });
  return { pending, run };
}

/** "Send rykker" / "Send betalingslink" (F6). */
export function NotifyButton({
  tenantId,
  invoiceId,
  kind,
  label,
}: {
  tenantId: string;
  invoiceId: string;
  kind: 'reminder' | 'payment_link';
  label: string;
}) {
  const { pending, run } = useRun();
  return (
    <Button
      variant="secondary"
      size="s"
      loading={pending}
      onClick={() => run(() => notifyInvoiceAction({ tenantId, invoiceId, kind }))}
    >
      {!pending && <Icon icon={Send} size={14} />}
      {label}
    </Button>
  );
}

/** "Send kontoudtog" (F4). */
export function StatementButton({ tenantId, label }: { tenantId: string; label: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      variant="secondary"
      size="m"
      loading={pending}
      onClick={() => run(() => sendStatementAction(tenantId))}
    >
      {!pending && <Icon icon={Mail} size={16} />}
      {label}
    </Button>
  );
}

/** "Send til bogholder" (F7). */
export function SendReportButton({ month, label }: { month: string; label: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      variant="primary"
      size="l"
      loading={pending}
      onClick={() => run(() => sendReportAction(month))}
    >
      {!pending && <Icon icon={Mail} size={16} />}
      {label}
    </Button>
  );
}
