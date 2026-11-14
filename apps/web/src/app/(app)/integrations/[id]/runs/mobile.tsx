import { getRun, listRuns } from '@agentor/db';
import { formatMoney, formatTime, type Locale } from '@agentor/i18n';
import { cn, StatusPill } from '@agentor/ui';
import {
  CardActions,
  CardButton,
  ChipGroup,
  ExpandCard,
  KV,
  MobileEmpty,
  MobileShell,
} from '@agentor/ui/mobile';
import { Activity } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AppTopBar } from '@/components/mobile/chrome';
import type { FlowView } from '@/server/flows';
import { db } from '@/server/infra';
import { RetryFailedButton } from './retry-button';

type Ctx = { tenantId: string; userId: string };
const RANGES = ['today', 'failed', 'week'] as const;
export type RunsRange = (typeof RANGES)[number];
export const runsRange = (v: string | undefined): RunsRange =>
  (RANGES as readonly string[]).includes(v ?? '') ? (v as RunsRange) : 'today';

/** MA24 Kørsler: runs as folding rows with their records, retry and a way to the failure. */
export async function RunsMobile({
  f,
  ctx,
  range = 'today',
  canEdit = false,
}: {
  f: FlowView;
  ctx: Ctx;
  range?: RunsRange;
  canEdit?: boolean;
}) {
  const t = await getTranslations('mobile.runs');
  const tr = await getTranslations('runs');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const since =
    range === 'week'
      ? new Date(now.getTime() - 7 * 86_400_000)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const runs = (await listRuns(db(), ctx, f.id, since, range === 'failed')).slice(0, 20);
  // The first six runs show their records; older ones open the run screen.
  const details = await Promise.all(runs.slice(0, 6).map((r) => getRun(db(), ctx, r.id)));
  const entities = [
    ...new Set(
      (f.definition?.routes ?? []).map((r) => (r as { entity?: string }).entity ?? 'record'),
    ),
  ].map((e, i) => {
    const name = t(`entity.${e}` as 'entity.order');
    return i === 0 ? name : name.toLowerCase();
  });
  const entityLine =
    entities.length > 1
      ? `${entities.slice(0, -1).join(', ')} ${t('and')} ${entities[entities.length - 1]}`
      : (entities[0] ?? '');
  const base = `/integrations/${f.id}/runs`;

  return (
    <MobileShell
      topBar={<AppTopBar back={`/integrations/${f.id}`} title={t('title')} subtitle={f.name} />}
    >
      <ChipGroup
        label={t('filterLabel')}
        value={range}
        linkAs={Link}
        items={[
          { key: 'today', label: t('today'), href: base },
          { key: 'failed', label: t('failedOnly'), href: `${base}?range=failed` },
          { key: 'week', label: t('week'), href: `${base}?range=week` },
        ]}
      />
      {runs.length === 0 && (
        <MobileEmpty icon={Activity} title={t('none')}>
          {t('noneBody')}
        </MobileEmpty>
      )}
      {runs.map((r, i) => {
        const d = details[i];
        const total = r.recordsTotal - r.recordsSkipped;
        const pill =
          r.recordsFailed > 0 ? (
            <StatusPill status="error">{t('errors', { count: r.recordsFailed })}</StatusPill>
          ) : r.kind === 'test' ? (
            <StatusPill status="info">{t('test')}</StatusPill>
          ) : (
            <StatusPill status="ok">{t('ok')}</StatusPill>
          );
        const time = (
          <span className="w-10.5 flex-none font-mono text-table font-semibold">
            {formatTime(r.startedAt, locale)}
          </span>
        );
        return (
          <ExpandCard
            key={r.id}
            open={i === 0}
            leading={time}
            title={t('records', { count: total })}
            meta={entityLine}
            trailing={pill}
          >
            <span className="pt-2 text-meta font-medium text-fg-2">
              {t('summary', {
                total,
                ok: r.recordsOk,
                failed: r.recordsFailed,
                seconds: r.durationMs
                  ? t('seconds', {
                      s: (r.durationMs / 1000).toLocaleString(locale === 'da' ? 'da-DK' : 'en-GB', {
                        maximumFractionDigits: 1,
                      }),
                    })
                  : '',
              })}
            </span>
            {d?.records
              .filter((x) => x.outcome !== 'skipped')
              .slice(0, 5)
              .map((x) => (
                <KV
                  key={x.id}
                  k={
                    <>
                      <span className="font-mono">{x.label}</span> ·{' '}
                      {t(`entity.${x.entity}` as 'entity.order')}
                    </>
                  }
                >
                  <span className={cn(x.outcome === 'failed' && 'font-semibold text-error-fg')}>
                    {tr(`outcome.${x.outcome}` as 'outcome.created')}
                  </span>
                  {' · '}
                  {x.amountOre === null ? '–' : formatMoney(x.amountOre / 100, locale)}
                </KV>
              ))}
            <CardActions>
              {canEdit && r.recordsFailed > 0 && (
                <RetryFailedButton flowId={f.id} label={t('retryFailed')} />
              )}
              <CardButton href={`${base}/${r.id}`} linkAs={Link}>
                {r.recordsFailed > 0
                  ? t('seeErrors')
                  : tr('showRun', { time: formatTime(r.startedAt, locale) })}
              </CardButton>
            </CardActions>
          </ExpandCard>
        );
      })}
    </MobileShell>
  );
}
