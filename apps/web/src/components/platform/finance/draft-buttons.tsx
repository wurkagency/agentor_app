'use client';

import { Button, Icon, toast } from '@agentor/ui';
import { Check, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { approveInvoiceAction, buildDraftsAction } from '@/app/platform/finance/actions';

/** "Forhåndsvis fakturaer" (F3): builds the month's drafts and opens the first one (F5). */
export function PreviewInvoicesButton({
  month,
  firstTenantId,
  label,
  variant = 'primary',
}: {
  month: string;
  firstTenantId: string | null;
  label: string;
  variant?: 'primary' | 'secondary';
}) {
  const t = useTranslations('platform.finance.draft');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      size={variant === 'primary' ? 'l' : 'm'}
      loading={pending}
      disabled={!firstTenantId}
      onClick={() =>
        start(async () => {
          const res = await buildDraftsAction(month);
          if (!res.ok) {
            toast.error({ title: t('error'), closeLabel: tc('close') });
            return;
          }
          router.push(`/platform/finance/support/${firstTenantId}?month=${month}`);
          router.refresh();
        })
      }
    >
      {!pending && <Icon icon={FileText} size={16} />}
      {label}
    </Button>
  );
}

/** "Godkend" (F5). */
export function ApproveButton({
  tenantId,
  invoiceId,
  approved,
}: {
  tenantId: string;
  invoiceId: string;
  approved: boolean;
}) {
  const t = useTranslations('platform.finance.draft');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="primary"
      size="l"
      loading={pending}
      disabled={approved}
      onClick={() =>
        start(async () => {
          const res = await approveInvoiceAction({ tenantId, invoiceId });
          if (!res.ok) {
            toast.error({ title: t('error'), closeLabel: tc('close') });
            return;
          }
          toast.ok({ title: t('approvedToast'), closeLabel: tc('close') });
          router.refresh();
        })
      }
    >
      {!pending && <Icon icon={Check} size={16} />}
      {approved ? t('approved') : t('approve')}
    </Button>
  );
}
