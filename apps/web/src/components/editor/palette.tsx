'use client';

import { CATEGORY_ORDER, manifestFor } from '@agentor/connectors';
import type { FlowDefinition } from '@agentor/flows';
import { cn, ConnectorLogo, Icon, SearchInput } from '@agentor/ui';
import { Plus, Unplug } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import type { EditorConnection } from './model';

/**
 * Left palette (§5.1): the tenant's connections by category. Clicking one that can receive
 * data adds it as a destination; the plan's destination limit is shown at the bottom.
 */
export function Palette({
  def,
  connections,
  readOnly,
  maxDestinations,
  planName,
  canSeePlans,
  onAdd,
}: {
  def: FlowDefinition;
  connections: EditorConnection[];
  readOnly: boolean;
  maxDestinations: number | null;
  planName: string;
  canSeePlans: boolean;
  onAdd: (connectionId: string) => void;
}) {
  const t = useTranslations('editor');
  const tc = useTranslations('connections');
  const [q, setQ] = useState('');
  const sourceId = def.nodes.find((n) => n.role === 'source')?.connectionId;
  const inFlow = new Set(def.nodes.map((n) => n.connectionId));
  const dests = def.nodes.filter((n) => n.role === 'destination').length;
  const full = maxDestinations !== null && dests >= maxDestinations;
  const term = q.trim().toLowerCase();
  const list = connections.filter((c) => {
    const m = manifestFor(c.connectorId);
    return m && (!term || `${m.name} ${c.name}`.toLowerCase().includes(term));
  });

  return (
    <aside
      aria-label={t('paletteLabel')}
      className="hidden h-full w-60 flex-none flex-col gap-4 overflow-y-auto bg-surface p-3 shadow-hairline-r lg:flex"
    >
      <SearchInput
        aria-label={t('searchConnections')}
        placeholder={t('searchConnections')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full"
      />
      {CATEGORY_ORDER.map((cat) => {
        const items = list.filter((c) => manifestFor(c.connectorId)?.category === cat);
        if (!items.length) return null;
        return (
          <section key={cat} aria-label={tc(`category.${cat}`)} className="flex flex-col gap-1">
            <h3 className="eyebrow m-0 px-2">{tc(`category.${cat}`)}</h3>
            {items.map((c) => {
              const m = manifestFor(c.connectorId)!;
              const isSource = c.id === sourceId;
              const used = inFlow.has(c.id);
              const canAdd =
                !readOnly && !used && m.inputs.length > 0 && !full && c.status !== 'broken';
              const sub = isSource
                ? t('palette.source', { name: c.name })
                : used
                  ? t('palette.inFlow', { name: c.name })
                  : c.status === 'broken'
                    ? t('palette.broken', { name: c.name })
                    : c.name;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={!canAdd}
                  onClick={() => onAdd(c.id)}
                  aria-label={
                    canAdd
                      ? t('palette.add', { name: `${m.name} · ${c.name}` })
                      : `${m.name} · ${sub}`
                  }
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-sm border-0 bg-transparent px-2 py-2 text-left font-sans text-fg-1',
                    canAdd ? 'cursor-pointer hover:bg-bg-base' : 'cursor-default',
                  )}
                >
                  <ConnectorLogo connector={{ name: m.name, logoUrl: m.logo }} size={24} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-table font-semibold">{m.name}</span>
                    <span className="truncate text-micro text-fg-2">{sub}</span>
                  </span>
                  {c.status === 'broken' ? (
                    <Icon icon={Unplug} size={14} className="text-error-fg" />
                  ) : (
                    <span className="size-2 rounded-full bg-ok-fg" aria-hidden />
                  )}
                </button>
              );
            })}
          </section>
        );
      })}
      <Link
        href="/connections/new"
        className="flex items-center gap-2 px-2 text-table font-semibold text-fg-1 no-underline"
      >
        <Icon icon={Plus} size={14} />
        {t('palette.addConnection')}
      </Link>
      <div className="mt-auto flex flex-col gap-2 rounded-md bg-bg-base p-3">
        <div className="flex items-center justify-between text-table font-semibold">
          <span>{t('palette.destinations')}</span>
          <span>
            {maxDestinations === null
              ? t('palette.unlimited', { count: dests })
              : t('palette.of', { count: dests, max: maxDestinations })}
          </span>
        </div>
        {maxDestinations !== null && (
          <div className="flex gap-1" aria-hidden>
            {Array.from({ length: maxDestinations }, (_, i) => (
              <span
                key={i}
                className={cn('h-1.5 flex-1 rounded-full', i < dests ? 'bg-fg-1' : 'bg-white')}
              />
            ))}
          </div>
        )}
        {maxDestinations !== null && (
          <p className="m-0 text-meta text-fg-2">
            {t('palette.moreNeedEnterprise', { plan: planName })}{' '}
            {canSeePlans && (
              <Link href="/billing" className="font-semibold text-fg-1">
                {t('palette.seePlans')}
              </Link>
            )}
          </p>
        )}
      </div>
    </aside>
  );
}
