import type { ErrorGroup } from '@agentor/db';
import { cn } from '@agentor/ui';
import {
  MobileCard,
  MobileEmpty,
  MobileFootnote,
  MobilePageTitle,
  MobileShell,
  Row,
} from '@agentor/ui/mobile';
import { CircleCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { PlatformTopBar } from '@/components/mobile/chrome';

/**
 * MP05 Fejl: the last 24 hours across customers, as error codes and counts only. Which customers
 * a code hits stays on the server (decision 16).
 */
export async function ErrorsMobile({
  groups,
  describe,
}: {
  groups: ErrorGroup[];
  describe: (code: string) => string;
}) {
  const t = await getTranslations('mobile.platform.errors');
  const records = groups.reduce((a, g) => a + g.records, 0);
  const customers = new Set(groups.flatMap((g) => g.tenantIds)).size;
  const noCase = groups.filter((g) => g.caseNumbers.length === 0).length;
  const sorted = [...groups].sort((a, b) => b.records - a.records);
  const trend = (g: ErrorGroup) =>
    g.previousCustomers === 0
      ? { text: `↑ ${t('new')}`, bad: true }
      : g.trend === 'rising'
        ? { text: `↑ ${t('rising')}`, bad: true }
        : g.trend === 'falling'
          ? { text: `↓ ${t('falling')}`, bad: false }
          : { text: t('stable'), bad: false };

  return (
    <MobileShell topBar={<PlatformTopBar />}>
      <MobilePageTitle title={t('title')} aside={t('last24')} />
      <MobileCard>
        <dl className="m-0 grid grid-cols-3 divide-x divide-border">
          {[
            { value: records, label: t('records'), bad: false },
            { value: customers, label: t('customers'), bad: false },
            { value: noCase, label: t('noCase'), bad: noCase > 0 },
          ].map((s) => (
            <div key={s.label} className="flex flex-col-reverse px-4 py-3.5">
              <dt className="text-meta font-medium text-fg-2">{s.label}</dt>
              <dd className={cn('m-0 text-m-hero tabular', s.bad && 'text-error-fg')}>{s.value}</dd>
            </div>
          ))}
        </dl>
      </MobileCard>
      {sorted.length === 0 ? (
        <MobileEmpty icon={CircleCheck} title={t('empty')} />
      ) : (
        <MobileCard>
          {sorted.map((g) => {
            const tr = trend(g);
            const explain = describe(g.code);
            const meta =
              g.caseNumbers.length === 0
                ? t('metaNoCase', { explain, count: g.customers })
                : t('meta', { explain, count: g.customers });
            return (
              <Row
                key={`${g.connectorId}:${g.code}`}
                title={<span className="font-mono text-mono">{g.code}</span>}
                meta={explain ? meta : meta.replace(/^ · /, '')}
                trailing={
                  <span className="flex flex-none flex-col items-end">
                    <strong className="text-card tabular">{g.records}</strong>
                    <span
                      className={cn(
                        'text-micro font-semibold',
                        tr.bad ? 'text-error-fg' : 'text-fg-2',
                      )}
                    >
                      {tr.text}
                    </span>
                  </span>
                }
              />
            );
          })}
        </MobileCard>
      )}
      <MobileFootnote>{t('note')}</MobileFootnote>
    </MobileShell>
  );
}
