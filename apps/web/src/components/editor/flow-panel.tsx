'use client';

import type { FlowDefinition } from '@agentor/flows';
import { Button, ConnectorLogo, Field, Icon, ModeBadge, Select, StatusPill } from '@agentor/ui';
import { ExternalLink, PanelRightClose, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { describeFilters, nodeManifest, routeLabel, type ConnMap } from './model';

const POLL_OPTIONS = [1, 5, 15, 30, 60];

function Shell({
  eyebrow,
  title,
  onClose,
  children,
  footer,
}: {
  eyebrow: string;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useTranslations('editor');
  return (
    <aside
      aria-label={t('inspectorLabel')}
      className="flex h-full w-110 flex-none flex-col bg-surface shadow-hairline-l"
    >
      <div className="flex items-start justify-between gap-2 px-5 pb-3 pt-4 shadow-hairline-b">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="eyebrow">{eyebrow}</span>
          <h2 className="m-0 text-card">{title}</h2>
        </div>
        <Button variant="ghost" size="icon" aria-label={t('closeInspector')} onClick={onClose}>
          <Icon icon={PanelRightClose} size={16} />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">{children}</div>
      {footer && (
        <div className="flex items-center justify-between gap-2 px-5 py-3 shadow-hairline-t">
          {footer}
        </div>
      )}
    </aside>
  );
}

/**
 * Nothing selected (§5.1): the flow's own settings and a plain-language explanation of what it
 * does, route by route, so a reader can check it without opening each route.
 */
export function FlowPanel(p: {
  name: string;
  def: FlowDefinition;
  conns: ConnMap;
  readOnly: boolean;
  minPollMinutes: number;
  guide: ReactNode;
  footer: ReactNode;
  onSelectRoute: (id: string) => void;
  updateFlow: (fn: (d: FlowDefinition) => void) => void;
  onClose: () => void;
}) {
  const t = useTranslations('editor');
  const tm = useTranslations('mode');
  const src = p.def.nodes.find((n) => n.role === 'source');
  const srcManifest = src ? nodeManifest(p.def, p.conns, src.id) : undefined;
  return (
    <Shell eyebrow={t('flow.eyebrow')} title={p.name} onClose={p.onClose} footer={p.footer}>
      {p.guide}
      <section className="flex flex-col gap-2" aria-labelledby="flow-explain">
        <h3 id="flow-explain" className="m-0 text-body font-semibold">
          {t('flow.explainTitle')}
        </h3>
        {p.def.routes.length === 0 ? (
          <p className="m-0 text-table text-fg-2">{t('flow.noRoutes')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {p.def.routes.map((r) => {
              const dst = nodeManifest(p.def, p.conns, r.to);
              const from =
                srcManifest?.outputs.find((o) => o.entity === r.entity)?.label ?? r.entity;
              const to =
                dst?.inputs.find((i) => i.entity === r.targetEntity)?.label ?? r.targetEntity;
              const filters = describeFilters((k, q) => t(k, q), r.filters);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => p.onSelectRoute(r.id)}
                    className="flex w-full cursor-pointer items-start justify-between gap-3 rounded-sm border-0 bg-bg-base px-3 py-2.5 text-left font-sans text-table text-fg-1 hover:bg-row-hover"
                    aria-label={t('selectRoute', { route: routeLabel(p.def, p.conns, r) })}
                  >
                    <span>
                      {t('flow.sentence', {
                        from: from.toLowerCase(),
                        source: srcManifest?.name ?? '',
                        to: to.toLowerCase(),
                        dest: dst?.name ?? '',
                      })}
                      {filters ? ` ${t('flow.only', { filters })}` : ''}
                      {r.paused ? ` ${t('flow.paused')}` : ''}
                    </span>
                    <ModeBadge mode={r.mode}>{tm(r.mode)}</ModeBadge>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="flow-settings">
        <h3 id="flow-settings" className="m-0 text-body font-semibold">
          {t('flow.settings')}
        </h3>
        <Field
          label={t('run.interval')}
          help={t('run.intervalHelp', { min: p.minPollMinutes })}
          inline
        >
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              disabled={p.readOnly}
              value={String(p.def.pollMinutes)}
              onValueChange={(v) => p.updateFlow((d) => void (d.pollMinutes = Number(v)))}
              options={POLL_OPTIONS.filter((m) => m >= p.minPollMinutes).map((m) => ({
                value: String(m),
                label: t('run.every', { count: m }),
              }))}
            />
          )}
        </Field>
        <p className="m-0 text-meta text-fg-2">{t('run.note')}</p>
      </section>
    </Shell>
  );
}

/** A node selected: the connection behind it, its routes, and removing a destination. */
export function NodePanel(p: {
  nodeId: string;
  def: FlowDefinition;
  conns: ConnMap;
  readOnly: boolean;
  onSelectRoute: (id: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('editor');
  const ts = useTranslations('status');
  const node = p.def.nodes.find((n) => n.id === p.nodeId);
  const conn = node ? p.conns[node.connectionId] : undefined;
  const m = node ? nodeManifest(p.def, p.conns, node.id) : undefined;
  if (!node) return null;
  const routes = p.def.routes.filter((r) => r.from === node.id || r.to === node.id);
  return (
    <Shell
      eyebrow={node.role === 'source' ? t('node.source') : t('node.destination')}
      title={
        <span className="flex items-center gap-2">
          {m && <ConnectorLogo connector={{ name: m.name, logoUrl: m.logo }} size={24} />}
          {m?.name ?? node.id}
        </span>
      }
      onClose={p.onClose}
    >
      <dl className="m-0 grid grid-cols-2 gap-y-2 text-table">
        <dt className="text-fg-2">{t('node.account')}</dt>
        <dd className="m-0">{conn?.name ?? '–'}</dd>
        <dt className="text-fg-2">{t('node.status')}</dt>
        <dd className="m-0">
          {conn && (
            <StatusPill status={conn.status === 'broken' ? 'broken' : 'ok'} compact>
              {ts(conn.status === 'broken' ? 'broken' : 'ok')}
            </StatusPill>
          )}
        </dd>
      </dl>
      {conn && (
        <Link
          href={`/connections/${conn.id}`}
          className="inline-flex items-center gap-1.5 text-table font-semibold text-fg-1"
        >
          {t('node.openConnection')}
          <Icon icon={ExternalLink} size={14} />
        </Link>
      )}
      <section className="flex flex-col gap-2" aria-labelledby="node-routes">
        <h3 id="node-routes" className="m-0 text-body font-semibold">
          {t('routesCount', { count: routes.length })}
        </h3>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {routes.map((r) => (
            <li key={r.id}>
              <Button variant="ghost" size="s" onClick={() => p.onSelectRoute(r.id)}>
                {routeLabel(p.def, p.conns, r)}
              </Button>
            </li>
          ))}
        </ul>
      </section>
      {node.role === 'destination' && !p.readOnly && (
        <div>
          <Button variant="destructive" size="s" onClick={p.onRemove}>
            <Icon icon={Trash2} size={14} />
            {t('node.remove')}
          </Button>
        </div>
      )}
    </Shell>
  );
}
