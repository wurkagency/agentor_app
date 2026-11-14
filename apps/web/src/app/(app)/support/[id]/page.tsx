import { getCustomerCase, isUuid } from '@agentor/db';
import { formatDateTime, type Locale } from '@agentor/i18n';
import { Card, Icon, cn } from '@agentor/ui';
import { ArrowLeft } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ReplyForm } from '@/components/support/support-forms';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireCustomerArea } from '@/server/auth/session';
import { db } from '@/server/infra';

/** One support case as the customer sees it: messages, replies and status, never internal notes. */
export default async function SupportCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCustomerArea();
  const data = await getCustomerCase(
    db(),
    { tenantId: ctx.tenant.tenantId, userId: ctx.user.id, name: ctx.user.name },
    id,
  );
  if (!data) notFound();
  const t = await getTranslations('support');
  const locale = (await getLocale()) as Locale;
  const c = data.case;
  return (
    <PageBody>
      <Link
        href="/support"
        className="inline-flex items-center gap-1.5 text-table text-fg-2 no-underline"
      >
        <Icon icon={ArrowLeft} size={16} />
        {t('back')}
      </Link>
      <PageHeader eyebrow={`#${c.number} · ${t(`status.${c.status}`)}`} title={c.title} />
      <Card className="flex max-w-form flex-col gap-4">
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {data.events.map((e) => (
            <li
              key={e.id}
              className={cn(
                'flex flex-col gap-1 rounded-md px-4 py-3 text-table',
                e.kind === 'customer_message'
                  ? 'bg-bg-base'
                  : e.kind === 'reply'
                    ? 'bg-surface shadow-ring-chip'
                    : 'text-fg-2',
              )}
            >
              <span className="text-meta">
                <strong className="text-fg-1">
                  {e.kind === 'reply'
                    ? t('agentor', { name: e.authorName })
                    : e.kind === 'status'
                      ? t('statusChange')
                      : e.authorName}
                </strong>{' '}
                <span className="text-fg-2">{formatDateTime(e.createdAt, locale)}</span>
              </span>
              <span className="whitespace-pre-wrap">
                {e.kind === 'status' ? t('statusNow', { status: e.body }) : e.body}
              </span>
            </li>
          ))}
        </ol>
        {c.status !== 'closed' && <ReplyForm caseId={c.id} />}
        {c.status === 'resolved' && <p className="m-0 text-meta text-fg-2">{t('reopen')}</p>}
      </Card>
    </PageBody>
  );
}
