'use client';

import { toast } from '@agentor/ui';
import { BigButton, type BigButtonVariant } from '@agentor/ui/mobile';
import { Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { sendDeskLink } from '@/app/actions/desk-link';

/** "Send link til min computer": e-mails the user a link to this page (README decision 20). */
export function SendDeskLinkButton({
  path,
  title,
  variant = 'secondary',
}: {
  /** Defaults to the current page with its query. */
  path?: string;
  /** Page name for the e-mail's subject. */
  title?: string;
  variant?: BigButtonVariant;
}) {
  const t = useTranslations('mobile.desk');
  const tc = useTranslations('common');
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, start] = useTransition();
  const target = path ?? (search.size ? `${pathname}?${search.toString()}` : pathname);
  return (
    <BigButton
      variant={variant}
      icon={Mail}
      loading={pending}
      onClick={() =>
        start(async () => {
          try {
            const res = await sendDeskLink(target, title ?? document.title);
            const closeLabel = tc('close');
            if (res.ok)
              toast.ok({ title: t('sent', { email: res.data?.email ?? '' }), closeLabel });
            else
              toast.error({
                title: res.error === 'rateLimited' ? t('rateLimited') : t('failed'),
                closeLabel,
              });
          } catch {
            toast.error({ title: t('failed'), closeLabel: tc('close') });
          }
        })
      }
    >
      {pending ? t('sending') : t('send')}
    </BigButton>
  );
}
