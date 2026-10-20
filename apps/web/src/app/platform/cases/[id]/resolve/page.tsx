import { caseRecipients, getCase, isUuid } from '@agentor/db';
import { Icon } from '@agentor/ui';
import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ResolveForm } from '@/components/platform/resolve-form';
import { PageBody } from '@/components/shell/secondary-nav';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';
import { tenantNames } from '@/server/platform-data';
import { Responsive } from '@agentor/ui/mobile';
import { ResolveMobile } from './mobile';

export async function generateMetadata() {
  const t = await getTranslations('platform.resolve');
  return { title: t('title') };
}

export default async function ResolvePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { actor } = await requireStaff();
  const data = await getCase(db(), actor.userId, id);
  if (!data) notFound();
  const t = await getTranslations('platform.resolve');
  const [recipients, names] = await Promise.all([
    caseRecipients(db(), actor.userId, id),
    tenantNames(actor.userId),
  ]);
  const c = data.case;
  const minutes = data.time.reduce((a, e) => a + e.minutes, 0);
  const form = {
    caseId: c.id,
    number: c.number,
    title: c.title,
    tenantName: names.get(c.tenantId) ?? '',
    recipients: recipients.map((r) => ({ userId: r.userId, name: r.name, email: r.email })),
    defaultRecipient:
      c.createdVia === 'customer' && recipients.some((r) => r.userId === c.createdByUserId)
        ? c.createdByUserId
        : null,
    events: data.events
      .filter(
        (e) =>
          e.kind === 'customer_message' ||
          e.kind === 'reply' ||
          e.kind === 'status' ||
          e.kind === 'session',
      )
      .map((e) => ({
        kind: e.kind as 'reply',
        authorName: e.authorName,
        body: e.body,
        createdAt: e.createdAt.toISOString(),
      })),
    minutes,
    internalNotes: data.events.filter((e) => e.kind === 'internal_note').length,
  };
  const desktop = (
    <PageBody>
      <Link
        href={`/platform/cases/${c.id}`}
        className="inline-flex items-center gap-1.5 text-table text-fg-2 no-underline"
      >
        <Icon icon={ArrowLeft} size={16} />
        {t('back', { n: c.number })}
      </Link>
      <ResolveForm {...form} />
    </PageBody>
  );
  return <Responsive desktop={desktop} mobile={<ResolveMobile {...form} />} />;
}
