import { QUEUES } from '@agentor/jobs';
import { Card, CardHeader, Icon, StatusPill, Table, Td, Th, Tr } from '@agentor/ui';
import { Queue } from 'bullmq';
import { Info } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { redis } from '@/server/infra';
import { requireStaff } from '@/server/platform';
import { customersFor } from '@/server/platform-data';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getTranslations('platform.status');
  return { title: t('title') };
}

/**
 * Systemstatus (not drawn yet, README decision 16): queues, workers and the scheduler, read-only.
 * Nothing here is customer data. FOLLOW-UP: the full screen when its board exists.
 */
export default async function StatusPage() {
  const { actor } = await requireStaff();
  const t = await getTranslations('platform.status');
  const connection = redis();
  const queues = await Promise.all(
    Object.entries(QUEUES).map(async ([key, name]) => {
      const q = new Queue(name, { connection });
      try {
        const [counts, workers] = await Promise.all([
          q.getJobCounts('waiting', 'active', 'delayed', 'failed'),
          q.getWorkersCount(),
        ]);
        return { key, name, counts, workers };
      } finally {
        await q.close().catch(() => undefined);
      }
    }),
  );
  const leader = await connection.get('agentor:scheduler:leader');
  const customers = await customersFor(actor.userId);
  const broken = customers.filter((c) => c.status === 'broken').length;
  return (
    <PageBody>
      <PageHeader title={t('title')} subtitle={t('intro')} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-2">
          <CardHeader title={t('scheduler')} />
          {leader ? (
            <StatusPill status="ok">{t('leaderActive')}</StatusPill>
          ) : (
            <StatusPill status="error">{t('leaderMissing')}</StatusPill>
          )}
        </Card>
        <Card className="flex flex-col gap-2">
          <CardHeader title={t('workers')} />
          {queues.every((q) => q.workers > 0) ? (
            <StatusPill status="ok">{t('workersOk')}</StatusPill>
          ) : (
            <StatusPill status="error">{t('workersMissing')}</StatusPill>
          )}
        </Card>
        <Card className="flex flex-col gap-2">
          <CardHeader title={t('connectors')} />
          {broken === 0 ? (
            <StatusPill status="ok">{t('connectorsOk')}</StatusPill>
          ) : (
            <StatusPill status="warn">{t('connectorsBroken', { count: broken })}</StatusPill>
          )}
        </Card>
      </div>
      <Card padding="none" className="overflow-x-auto">
        <Table aria-label={t('queues')}>
          <thead>
            <tr>
              <Th className="pl-5">{t('queue')}</Th>
              <Th numeric>{t('workersCol')}</Th>
              <Th numeric>{t('waiting')}</Th>
              <Th numeric>{t('active')}</Th>
              <Th numeric>{t('delayed')}</Th>
              <Th numeric className="pr-5">
                {t('failed')}
              </Th>
            </tr>
          </thead>
          <tbody>
            {queues.map((q) => (
              <Tr key={q.key}>
                <Td className="pl-5 font-mono text-mono">{q.name}</Td>
                <Td numeric>{q.workers}</Td>
                <Td numeric>{q.counts.waiting ?? 0}</Td>
                <Td numeric>{q.counts.active ?? 0}</Td>
                <Td numeric>{q.counts.delayed ?? 0}</Td>
                <Td numeric className="pr-5">
                  {q.counts.failed ?? 0}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <p className="m-0 flex items-center gap-2 text-meta text-fg-2">
        <Icon icon={Info} size={14} />
        {t('note')}
      </p>
    </PageBody>
  );
}
