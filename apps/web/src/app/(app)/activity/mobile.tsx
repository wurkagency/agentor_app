import { manifestFor } from '@agentor/connectors';
import { listActivity, listAudit } from '@agentor/db';
import { formatDate, formatTime, type Locale } from '@agentor/i18n';
import {
  ChipGroup,
  MobileCard,
  MobileEmpty,
  MobilePageTitle,
  MobileShell,
  Row,
  RowIcon,
  RowLink,
  SectionHeading,
  type RowTone,
} from '@agentor/ui/mobile';
import {
  Activity,
  CircleCheck,
  CirclePause,
  CircleX,
  FlaskConical,
  Play,
  Unplug,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { explain } from '@/components/flows/record-error';
import { routeTarget } from '@/components/flows/helpers';
import { AppTopBar } from '@/components/mobile/chrome';
import { SnapshotWriter } from '@/components/mobile/pwa';
import type { AppContext } from '@/server/auth/session';
import type { connectionMap, FlowView } from '@/server/flows';
import { db } from '@/server/infra';
import { FlowPickerChip } from './flow-picker';

interface Item {
  key: string;
  at: Date;
  icon: LucideIcon;
  tone: RowTone;
  title: string;
  meta: string;
  href?: string;
}

/** MA07 Aktivitet: what happened, grouped by day; filter on errors or one flow. Read-only. */
export async function ActivityMobile({
  ctx,
  views,
  conns,
  query,
}: {
  ctx: AppContext;
  views: FlowView[];
  conns: Awaited<ReturnType<typeof connectionMap>>;
  query: { outcome?: string | undefined; flow?: string | undefined };
}) {
  const t = await getTranslations('mobile.activity');
  const ta = await getTranslations('activity');
  const tc = await getTranslations('common');
  const te = await getTranslations('recordErrors');
  const locale = (await getLocale()) as Locale;
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const flowId = views.some((v) => v.id === query.flow) ? query.flow : undefined;
  const failedOnly = query.outcome === 'failed';
  const admin = ctx.tenant.role === 'owner' || ctx.tenant.role === 'admin';
  const [records, failedToday, audit] = await Promise.all([
    listActivity(db(), c, {
      since,
      flowId,
      ...(failedOnly ? { outcome: 'failed' as const } : {}),
      limit: 400,
    }),
    listActivity(db(), c, { since, flowId, outcome: 'failed', limit: 1000 }),
    admin && !failedOnly ? listAudit(db(), c, { since, actionPrefix: 'flow.', limit: 60 }) : [],
  ]);

  const flowName = (id: string) => views.find((v) => v.id === id)?.name ?? '';
  const sysOf = (flow: string, route: string) =>
    routeTarget(views.find((v) => v.id === flow)?.definition ?? null, conns, route).system;

  // One row per run, route and outcome, as on the board ("12 kontakter opdateret").
  const clusters = new Map<string, typeof records>();
  for (const r of records) {
    const outcome = r.mode === 'test' ? 'test' : r.outcome;
    const k = `${r.runId}:${r.routeId}:${outcome}`;
    clusters.set(k, [...(clusters.get(k) ?? []), r]);
  }
  const items: Item[] = [];
  for (const [key, rows] of clusters) {
    const r = rows[0]!;
    const outcome = r.mode === 'test' ? 'test' : r.outcome;
    const entity = ['order', 'creditNote', 'customer', 'product', 'stock'].includes(r.entity)
      ? r.entity
      : 'record';
    const verb =
      outcome === 'created' && entity === 'order'
        ? t('verb.createdOrder')
        : t(`verb.${outcome}` as 'verb.created');
    const system = sysOf(r.flowId, r.routeId);
    let meta = `${system} · ${flowName(r.flowId)}`;
    if (outcome === 'failed') {
      const target = routeTarget(
        views.find((v) => v.id === r.flowId)?.definition ?? null,
        conns,
        r.routeId,
      );
      const why = explain((k2, p) => te(k2, p), {
        errorCode: r.errorCode,
        errorParams: r.errorParams,
        label: r.label,
        entity: r.entity,
        system: target.system,
        fieldLabel: target.fieldLabel(r.errorParams?.field),
      }).short;
      meta = `${system} · ${why.replace(/\.$/, '').replace(/^./, (x) => x.toLowerCase())}`;
    }
    items.push({
      key,
      at: rows.reduce((a, x) => (x.createdAt > a ? x.createdAt : a), r.createdAt),
      icon:
        outcome === 'failed'
          ? CircleX
          : outcome === 'test'
            ? FlaskConical
            : outcome === 'skipped' || outcome === 'waiting'
              ? CirclePause
              : CircleCheck,
      tone:
        outcome === 'failed'
          ? 'error'
          : outcome === 'test'
            ? 'info'
            : outcome === 'skipped' || outcome === 'waiting'
              ? 'neutral'
              : 'ok',
      title:
        // Order and credit-note numbers are fine to show; customer labels can be names or e-mails.
        rows.length === 1 && (entity === 'order' || entity === 'creditNote')
          ? t('single', { entity: t(`entity.${entity}` as 'entity.order'), label: r.label, verb })
          : t('many', {
              count: rows.length,
              entity: t(`entity.${entity}` as 'entity.order').toLowerCase(),
              entities: t(`entities.${entity}` as 'entities.order'),
              verb,
            }),
      meta,
      href:
        outcome === 'failed'
          ? `/integrations/${r.flowId}/runs/${r.runId}`
          : `/integrations/${r.flowId}`,
    });
  }
  for (const a of audit) {
    const after = (a.after ?? {}) as { name?: string; number?: number; version?: number };
    const id = a.objectId ?? '';
    if (flowId && id !== flowId) continue;
    const name = flowName(id) || after.name || '';
    if (a.action === 'flow.paused' || a.action === 'flow.resumed')
      items.push({
        key: a.id,
        at: a.createdAt,
        icon: a.action === 'flow.paused' ? CirclePause : Play,
        tone: 'neutral',
        title: t(a.action === 'flow.paused' ? 'paused' : 'resumed', { flow: name }),
        meta: a.actorName ?? '',
        href: `/integrations/${id}`,
      });
    else if (a.action === 'flow.published')
      items.push({
        key: a.id,
        at: a.createdAt,
        icon: Upload,
        tone: 'neutral',
        title: t('published', { name: a.actorName ?? '', n: after.number ?? after.version ?? '' }),
        meta: name,
        href: `/integrations/${id}`,
      });
  }
  if (!failedOnly)
    for (const conn of conns.values())
      if (conn.status === 'broken' && conn.brokenSince && conn.brokenSince >= since) {
        const flows = views
          .filter((v) => [v.source, ...v.destinations].some((x) => x?.id === conn.id))
          .filter((v) => !flowId || v.id === flowId);
        if (flowId && !flows.length) continue;
        items.push({
          key: `broken-${conn.id}`,
          at: conn.brokenSince,
          icon: Unplug,
          tone: 'error',
          title: t('broken', { system: manifestFor(conn.connectorId)?.name ?? conn.name }),
          meta: t('brokenMeta', { flows: flows.map((v) => v.name).join(', ') || conn.name }),
          href: `/connections/${conn.id}/reconnect`,
        });
      }
  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  const shown = items.slice(0, 60);

  const dayKey = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = dayKey(now);
  const days = new Map<number, Item[]>();
  for (const i of shown) days.set(dayKey(i.at), [...(days.get(dayKey(i.at)) ?? []), i]);
  const dayTitle = (k: number) =>
    k === today
      ? t('today')
      : k === today - 86_400_000
        ? t('yesterday')
        : formatDate(new Date(k), locale);

  const failedCount = new Set(failedToday.map((r) => `${r.runId}:${r.routeId}:${r.sourceId}`)).size;
  const href = (p: { outcome?: string; flow?: string }) => {
    const q = new URLSearchParams();
    if (p.outcome) q.set('outcome', p.outcome);
    if (p.flow) q.set('flow', p.flow);
    return `/activity${q.size ? `?${q}` : ''}`;
  };
  const active = flowId ? 'flow' : failedOnly ? 'failed' : 'all';

  return (
    <MobileShell topBar={<AppTopBar />}>
      {!ctx.support && active === 'all' && (
        <SnapshotWriter
          owner={`${ctx.user.id}:${ctx.tenant.tenantId}`}
          company={ctx.tenant.tenantName}
          page="activity"
          data={shown.slice(0, 20).map((i) => ({
            day: dayTitle(dayKey(i.at)),
            title: i.title,
            meta: i.meta,
            time: formatTime(i.at, locale),
          }))}
        />
      )}
      <MobilePageTitle title={ta('title')} />
      <div className="flex flex-wrap items-center gap-2">
        <ChipGroup
          label={t('filterLabel')}
          value={active}
          linkAs={Link}
          wrap
          items={[
            { key: 'all', label: t('all'), href: href({}) },
            {
              key: 'failed',
              label: t('failed', { count: failedCount }),
              href: href({ outcome: 'failed' }),
            },
          ]}
        />
        <FlowPickerChip
          label={flowId ? t('flowNamed', { name: flowName(flowId) }) : t('flow')}
          title={t('pickFlow')}
          closeLabel={tc('close')}
          allLabel={t('allFlows')}
          active={flowId ?? null}
          flows={views.map((v) => ({ id: v.id, name: v.name }))}
          hrefFor={Object.fromEntries([
            ['all', href(failedOnly ? { outcome: 'failed' } : {})],
            ...views.map((v) => [
              v.id,
              href({ ...(failedOnly ? { outcome: 'failed' } : {}), flow: v.id }),
            ]),
          ])}
        />
      </div>
      {shown.length === 0 && (
        <MobileEmpty icon={Activity} title={t('empty')}>
          {t('emptyBody')}
        </MobileEmpty>
      )}
      {[...days].map(([k, list]) => (
        <section key={k} aria-label={dayTitle(k)} className="flex flex-col gap-3">
          <SectionHeading>{dayTitle(k)}</SectionHeading>
          <MobileCard>
            {list.map((i) => {
              const props = {
                leading: <RowIcon icon={i.icon} tone={i.tone} size={30} />,
                title: i.title,
                meta: i.meta,
                trailing: (
                  <span className="flex-none text-meta font-medium text-fg-2">
                    {formatTime(i.at, locale)}
                  </span>
                ),
              };
              return i.href ? (
                <RowLink key={i.key} href={i.href} linkAs={Link} {...props} />
              ) : (
                <Row key={i.key} {...props} />
              );
            })}
          </MobileCard>
        </section>
      ))}
    </MobileShell>
  );
}
