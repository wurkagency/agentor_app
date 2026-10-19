'use client';

import { Icon, Kbd } from '@agentor/ui';
import { Command } from 'cmdk';
import {
  Activity,
  ArrowRight,
  LayoutDashboard,
  Plug,
  Plus,
  Receipt,
  RotateCw,
  Search,
  Settings,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { searchPalette } from '@/app/actions/notifications';

interface Item {
  id: string;
  label: string;
  /** Second line, e.g. "Flow · 5 ruter" or "Fejlet 14:06 · Webshop → regnskab og CRM". */
  detail?: string;
  icon: LucideIcon;
  href: string;
  shortcut?: string;
}

export interface PaletteEntities {
  flows: { id: string; name: string; routes: number }[];
  connections: { id: string; label: string }[];
  /** Open failures today, for "Gentag alle fejlede records". */
  failuresToday: number;
}

/**
 * ⌘K "Søg eller hop til" (D1-Soeg): 640 px dialog with order numbers and customers (searched on
 * the server), flows and connections, quick actions and pages.
 */
export function CommandPalette({
  trigger,
  entities,
}: {
  trigger: ReactNode;
  entities: PaletteEntities;
}) {
  const t = useTranslations('palette');
  const nav = useTranslations('nav');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [records, setRecords] = useState<Item[]>([]);

  // Order numbers and customers are searched on the server as you type (D1-Søg).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setRecords([]);
      return;
    }
    const id = setTimeout(() => {
      void searchPalette(q).then((rows) =>
        setRecords(
          rows.map((r) => ({
            id: `record-${r.label}`,
            label: r.customer ? `${r.label} · ${r.customer}` : r.label,
            detail: `${t(`outcome.${r.outcome}` as 'outcome.created')} · ${
              entities.flows.find((f) => f.id === r.flowId)?.name ?? ''
            }`,
            icon: Receipt,
            href: `/activity?q=${encodeURIComponent(r.label)}&period=30d`,
          })),
        ),
      );
    }, 200);
    return () => clearTimeout(id);
  }, [query, entities.flows, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pages: Item[] = [
    { id: 'overview', label: nav('overview'), icon: LayoutDashboard, href: '/' },
    { id: 'integrations', label: nav('integrations'), icon: Workflow, href: '/integrations' },
    { id: 'connections', label: nav('connections'), icon: Plug, href: '/connections' },
    { id: 'activity', label: nav('activity'), icon: Activity, href: '/activity' },
    { id: 'settings', label: nav('settings'), icon: Settings, href: '/settings/company' },
  ];
  const actions: Item[] = [
    {
      id: 'new-flow',
      label: t('newFlow'),
      detail: t('newFlowDetail'),
      icon: Plus,
      href: '/integrations/new',
      shortcut: 'N',
    },
    ...(entities.failuresToday
      ? [
          {
            id: 'retry-all',
            label: t('retryAll'),
            detail: t('failuresToday', { count: entities.failuresToday }),
            icon: RotateCw,
            href: '/activity?outcome=failed',
          },
        ]
      : []),
  ];
  const things: Item[] = [
    ...entities.flows.map((f) => ({
      id: `flow-${f.id}`,
      label: f.name,
      detail: t('flowDetail', { count: f.routes }),
      icon: Workflow,
      href: `/integrations/${f.id}`,
    })),
    ...entities.connections.map((c) => ({
      id: `conn-${c.id}`,
      label: c.label,
      detail: t('connectionDetail'),
      icon: Plug,
      href: `/connections/${c.id}`,
    })),
  ];

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <DialogPrimitive.Content className="dialog-frame fixed left-1/2 z-50 w-160 -translate-x-1/2 overflow-hidden rounded-md bg-surface shadow-card outline-none">
          <DialogPrimitive.Title className="sr-only">{t('title')}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {t('description')}
          </DialogPrimitive.Description>
          <Command loop label={t('title')}>
            <div className="flex items-center gap-3 px-5 shadow-hairline-b">
              <Icon icon={Search} size={18} className="text-fg-2" />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder={t('placeholder')}
                className="h-14 flex-1 border-0 bg-transparent font-sans text-card font-medium text-fg-1 outline-none"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-96 overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-table text-fg-2">
                {t('empty')}
              </Command.Empty>
              {[
                { heading: t('records'), items: records },
                { heading: t('flowsAndConnections'), items: things },
                { heading: t('quickActions'), items: actions },
                { heading: t('pages'), items: pages },
              ]
                .filter((g) => g.items.length > 0)
                .map((group) => (
                  <Command.Group
                    key={group.heading}
                    heading={group.heading}
                    className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3"
                  >
                    {group.items.map((item) => (
                      <Command.Item
                        key={item.id}
                        value={`${item.label} ${item.id}`}
                        onSelect={() => go(item.href)}
                        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-3 py-1.5 text-body data-[selected=true]:bg-bg-base"
                      >
                        <Icon icon={item.icon} size={16} className="text-fg-2" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{item.label}</span>
                          {item.detail && (
                            <span className="truncate text-meta text-fg-2">{item.detail}</span>
                          )}
                        </span>
                        {item.shortcut ? (
                          <Kbd>{item.shortcut}</Kbd>
                        ) : (
                          <Icon icon={ArrowRight} size={14} className="text-fg-3" />
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
            </Command.List>
            <div className="flex gap-4 px-5 py-3 text-meta font-medium text-fg-2 shadow-hairline-t">
              <span className="inline-flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> {t('hintMove')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Kbd>↵</Kbd> {t('hintOpen')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Kbd>Esc</Kbd> {t('hintClose')}
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
