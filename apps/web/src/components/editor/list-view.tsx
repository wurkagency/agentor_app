'use client';

import { manifestFor } from '@agentor/connectors';
import type { Status } from '@agentor/core';
import type { Finding, FlowDefinition } from '@agentor/flows';
import { cn, ConnectorLogo, Icon, ModeBadge, StatusPill } from '@agentor/ui';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, useRef, type KeyboardEvent } from 'react';
import { describeFilters, nodeManifest, portLabel, type ConnMap } from './model';

/**
 * Listevisning (D6): the same flow as a table grouped by destination. Every canvas action can
 * be done here with the keyboard (§5.6): arrow keys move between routes, Enter opens one.
 */
export function ListView({
  def,
  conns,
  findings,
  selectedRouteId,
  onSelectRoute,
  routeStatus,
}: {
  def: FlowDefinition;
  conns: ConnMap;
  findings: Finding[];
  selectedRouteId: string | null;
  onSelectRoute: (id: string) => void;
  routeStatus: (id: string) => Status;
}) {
  const t = useTranslations('editor');
  const tm = useTranslations('mode');
  const ts = useTranslations('status');
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const src = def.nodes.find((n) => n.role === 'source');
  const srcConn = src ? conns[src.connectionId] : undefined;
  const srcManifest = srcConn ? manifestFor(srcConn.connectorId) : null;
  const order = def.nodes
    .filter((n) => n.role === 'destination')
    .flatMap((d) => def.routes.filter((r) => r.to === d.id));

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      rows.current[
        Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
      ]?.focus();
    }
  };

  return (
    <div className="flex flex-col gap-3 p-5">
      {srcManifest && (
        <div className="flex items-center gap-3 rounded-md bg-surface px-4 py-3 shadow-sm">
          <ConnectorLogo connector={{ name: srcManifest.name, logoUrl: srcManifest.logo }} />
          <div className="flex flex-col">
            <span className="text-body font-semibold">
              {t('sourceTitle', { name: srcManifest.name })}
            </span>
            <span className="text-meta text-fg-2">
              {srcConn?.name} ·{' '}
              {t('routesTo', { routes: def.routes.length, destinations: def.nodes.length - 1 })}
            </span>
          </div>
        </div>
      )}
      <div className="overflow-hidden rounded-md bg-surface shadow-sm">
        <div className="grid grid-cols-12 gap-3 px-4 py-2.5 text-meta font-semibold shadow-hairline-b">
          <span className="col-span-4">{t('list.route')}</span>
          <span className="col-span-2">{t('list.mode')}</span>
          <span className="col-span-2">{t('list.status')}</span>
          <span className="col-span-4">{t('list.filters')}</span>
        </div>
        {def.nodes
          .filter((n) => n.role === 'destination')
          .map((d) => {
            const m = nodeManifest(def, conns, d.id);
            return (
              <Fragment key={d.id}>
                <div className="flex items-center gap-2 bg-bg-base px-4 py-2 text-table">
                  {m && <ConnectorLogo connector={{ name: m.name, logoUrl: m.logo }} size={24} />}
                  <span className="font-semibold">{m?.name}</span>
                  <span className="text-fg-2">{conns[d.connectionId]?.name}</span>
                </div>
                {def.routes
                  .filter((r) => r.to === d.id)
                  .map((r) => {
                    const i = order.findIndex((x) => x.id === r.id);
                    const status = routeStatus(r.id);
                    const err = findings.some((f) => f.routeId === r.id && f.severity === 'error');
                    return (
                      <button
                        key={r.id}
                        ref={(el) => {
                          rows.current[i] = el;
                        }}
                        type="button"
                        onClick={() => onSelectRoute(r.id)}
                        onKeyDown={(e) => onKey(e, i)}
                        aria-current={selectedRouteId === r.id ? 'true' : undefined}
                        className={cn(
                          'grid w-full cursor-pointer grid-cols-12 items-center gap-3 border-0 border-t border-border bg-surface px-4 py-3 text-left font-sans text-table text-fg-1 hover:bg-row-hover',
                          selectedRouteId === r.id && 'bg-row-hover shadow-row-selected',
                        )}
                      >
                        <span className="col-span-4 flex items-center gap-2">
                          {portLabel(srcManifest, r.entity, 'outputs')}
                          <Icon icon={ArrowRight} size={14} className="text-fg-2" />
                          {portLabel(m, r.targetEntity, 'inputs')}
                        </span>
                        <span className="col-span-2">
                          <ModeBadge mode={r.mode}>{tm(r.mode)}</ModeBadge>
                        </span>
                        <span className="col-span-2">
                          <StatusPill status={err ? 'error' : status} compact>
                            {err ? t('needsFix') : ts(status)}
                          </StatusPill>
                        </span>
                        <span className="col-span-3 truncate text-fg-2">
                          {r.filters.length
                            ? describeFilters((k, p) => t(k, p), r.filters)
                            : t('list.all')}
                        </span>
                        <span className="col-span-1 flex justify-end">
                          <Icon icon={ChevronRight} size={16} className="text-fg-2" />
                        </span>
                      </button>
                    );
                  })}
              </Fragment>
            );
          })}
      </div>
      <p className="m-0 text-meta text-fg-2">{t('list.keyboard')}</p>
    </div>
  );
}
