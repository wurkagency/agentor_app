import { Check, CircleAlert, Info, LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from '../icon';
import { LogoImg, type LogoRef } from './shell';

// Server-safe: no hooks. Onboarding (OB1–OB5 / MO1–MO5).

/* ---- ConnectionDiagram: source → Agentor → destinations, green per working connection ------------- */

export type NodeState = 'idle' | 'connecting' | 'connected' | 'later' | 'error';

export interface DiagramNode {
  logo: LogoRef;
  title: string;
  /** "Forbinder nu", "Forbundet · kontoplan hentet", "Regnskab", "Senere". */
  detail: string;
  state: NodeState;
}

/**
 * The navy diagram on OB1–OB4 (vertical, in the trust panel) and MO1–MO4 (compact row). A node
 * turns lime with a check when its connection works; the line to Agentor turns lime with it.
 * The list itself is the text alternative: each node says its state in words.
 */
export function ConnectionDiagram({
  source,
  agentor,
  destinations,
  compact = false,
  label,
}: {
  source: DiagramNode;
  agentor: { title: string; detail: string };
  destinations: DiagramNode[];
  compact?: boolean;
  label: string;
}) {
  const on = (n: DiagramNode) => n.state === 'connected';
  const live = on(source) || destinations.some(on);
  const all = [source, null, ...destinations] as (DiagramNode | null)[];
  if (compact)
    return (
      <ol aria-label={label} className="m-0 flex list-none items-center gap-2 p-0">
        {all.slice(0, 3).map((n, i) => (
          <li key={i} className="contents">
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  'h-0.75 flex-1 rounded-xs',
                  (i === 1 ? on(source) : on(destinations[0]!)) ? 'bg-primary' : 'bg-white-18',
                )}
              />
            )}
            {n ? (
              <span
                className={cn(
                  'relative grid size-12 flex-none place-items-center rounded-bubble bg-white',
                  on(n)
                    ? 'shadow-node-on'
                    : n.state === 'connecting'
                      ? 'shadow-node-active'
                      : 'opacity-55 shadow-node-off',
                )}
              >
                <LogoImg logo={n.logo} size="md" />
                <span className="sr-only">{`${n.title}: ${n.detail}`}</span>
                {on(n) && <CheckBadge small />}
              </span>
            ) : (
              <span
                className={cn(
                  'grid size-12 flex-none place-items-center rounded-bubble text-table font-bold',
                  live ? 'bg-primary text-fg-1' : 'bg-white-14 text-on-navy',
                )}
              >
                Ag<span className="sr-only">{` ${agentor.title}`}</span>
              </span>
            )}
          </li>
        ))}
      </ol>
    );
  return (
    <ol aria-label={label} className="m-0 flex list-none flex-col gap-1.5 p-0">
      {all.map((n, i) => {
        // The line under node i is lime when the node after it works (under the source: the source).
        const after = all[i + 1];
        const nextOn = i === 0 ? on(source) : !!after && on(after);
        return (
          <li key={i} className="flex flex-col gap-1.5">
            {n ? (
              <span className="flex items-center gap-3.5">
                {/* Not yet: the tile is dimmed, the text keeps full contrast (≥ 4.5:1). */}
                <span
                  className={cn(
                    'relative grid size-16 flex-none place-items-center rounded-order bg-white',
                    (n.state === 'idle' || n.state === 'later') && 'opacity-55',
                    on(n)
                      ? 'shadow-node-on'
                      : n.state === 'connecting'
                        ? 'shadow-node-active'
                        : n.state === 'error'
                          ? 'shadow-node-error'
                          : 'shadow-node-off',
                  )}
                >
                  <LogoImg logo={n.logo} size="lg" decorative />
                  {on(n) && <CheckBadge />}
                </span>
                <span className="flex flex-col leading-snug">
                  <strong className="text-su-input">{n.title}</strong>
                  <span className="text-table text-on-navy-soft">{n.detail}</span>
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-3.5">
                <span
                  aria-hidden
                  className={cn(
                    'grid size-16 flex-none place-items-center rounded-order text-su-input font-bold',
                    live && on(source) && destinations.some(on)
                      ? 'bg-primary text-fg-1'
                      : 'bg-white-14 text-on-navy',
                  )}
                >
                  Ag
                </span>
                <span className="flex flex-col leading-snug">
                  <strong className="text-su-input">{agentor.title}</strong>
                  <span className="text-table text-on-navy-soft">{agentor.detail}</span>
                </span>
              </span>
            )}
            {i < all.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'ml-7.5 h-7 w-0.75 rounded-3xs',
                  nextOn ? 'bg-primary' : 'bg-white-18',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function CheckBadge({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute grid place-items-center rounded-full bg-primary text-fg-1 shadow-cutout-navy',
        small ? '-right-1 -bottom-1 size-4.5' : '-right-1 -bottom-1 size-5.5',
      )}
    >
      <Icon icon={Check} size={14} />
    </span>
  );
}

/* ---- ConnectorTile (OB1/OB2 "sel" tiles) -------------------------------------------------------- */

export interface ConnectorTileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  logo: LogoRef;
  name: string;
  /** "Valgt ved oprettelse", "Log ind med Shopify", "API-nøgle", "På vej". */
  meta: string;
  selected: boolean;
  /** "Valgt" pill. */
  pill?: string | undefined;
  mobile?: boolean | undefined;
}

export function ConnectorTile({
  logo,
  name,
  meta,
  selected,
  pill,
  mobile = false,
  className,
  disabled,
  ...props
}: ConnectorTileProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      className={cn(
        'flex w-full cursor-pointer items-center border-0 bg-white text-left font-sans text-fg-1 box-border',
        'disabled:cursor-not-allowed disabled:opacity-60',
        selected ? 'shadow-ring-dark-2' : 'shadow-ring-border',
        mobile ? 'gap-2.5 rounded-node px-3 py-2.5' : 'gap-2.5 rounded-node px-4 py-3.5',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'grid flex-none place-items-center rounded-sm bg-white shadow-ring-border',
          mobile ? 'size-8' : 'size-10',
        )}
      >
        <LogoImg logo={logo} size={mobile ? 'sm' : 'md'} decorative />
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-snug">
        <span className={cn('font-semibold', mobile ? 'text-table' : 'text-body')}>{name}</span>
        <span className={cn('font-medium text-fg-2', mobile ? 'text-micro' : 'text-meta')}>
          {meta}
        </span>
      </span>
      {pill && (
        <span className="inline-flex h-6 flex-none items-center gap-1.5 rounded-full bg-info-bg px-2.5 text-meta font-semibold text-fg-1">
          <Icon icon={Check} size={14} />
          {pill}
        </span>
      )}
    </button>
  );
}

/** OB2's list of what Agentor may and may not do in the system. */
export function PermissionList({ items }: { items: { text: string; allowed: boolean }[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((it) => (
        <li key={it.text} className="flex items-start gap-2 text-table">
          <Icon
            icon={it.allowed ? Check : CircleAlert}
            size={16}
            className={cn('mt-px flex-none', it.allowed ? 'text-ok-fg' : 'text-fg-2')}
          />
          <span>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** "WooCommerce er forbundet." (OB2/MO2 banner above the heading). */
export function SuccessBanner({
  children,
  mobile = false,
}: {
  children: ReactNode;
  mobile?: boolean;
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2.5 rounded-node bg-ok-bg px-4 py-3 text-table',
        mobile && 'mt-10',
      )}
    >
      <Icon icon={Check} size={16} className="mt-px flex-none text-ok-fg" />
      <span>{children}</span>
    </div>
  );
}

/* ---- TemplateCard (OB3/MO3) ------------------------------------------------------------------------ */

export function TemplateCard({
  logos,
  title,
  body,
  routes,
  badge,
  badgeTone = 'primary',
  selected,
  disabled = false,
  onSelect,
  mobile = false,
  name,
}: {
  logos: LogoRef[];
  title: string;
  body?: string | undefined;
  routes: string[];
  badge?: string | undefined;
  badgeTone?: 'primary' | 'neutral';
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  mobile?: boolean;
  /** Radio group name. */
  name: string;
}) {
  return (
    <label
      className={cn(
        'relative flex cursor-pointer flex-col gap-2.5 rounded-md bg-surface p-4 shadow-sm',
        selected && 'shadow-plan-selected',
        disabled && 'cursor-not-allowed opacity-70',
        'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-fg-1',
      )}
    >
      <input
        type="radio"
        name={name}
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
        className="sr-only"
        aria-label={title}
      />
      <span className="flex items-center gap-2">
        <span className="flex -space-x-1.5">
          {logos.map((l) => (
            <span
              key={l.name}
              className="grid size-8 place-items-center rounded-sm bg-white shadow-ring-border"
            >
              <LogoImg logo={l} size="sm" decorative />
            </span>
          ))}
        </span>
        {badge && (
          <span
            className={cn(
              'ml-auto inline-flex h-5.5 items-center rounded-full px-2.5 text-meta font-semibold text-fg-1',
              badgeTone === 'primary' ? 'bg-primary' : 'bg-bg-base',
            )}
          >
            {badge}
          </span>
        )}
      </span>
      <strong className={mobile ? 'text-su-input' : 'text-card'}>{title}</strong>
      {body && <span className="text-table text-fg-2">{body}</span>}
      {routes.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {routes.map((r) => (
            <li
              key={r}
              className="inline-flex h-6 items-center rounded-full bg-bg-base px-2.5 text-meta font-medium"
            >
              {r}
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}

/* ---- TestRunTable (OB4) and TestRunList (MO4) ---------------------------------------------------- */

export interface TestRunRowView {
  id: string;
  order: string;
  customer: string;
  amount: string;
  account: string | null;
  state: 'ready' | 'needsAccount' | 'failed';
  /** "EU-salg: vælg konto", "EU-salg". */
  note?: string | undefined;
  /** The "Vælg konto" control for this row. */
  action?: ReactNode;
}

export function TestRunCounters({
  items,
  mobile = false,
}: {
  items: { label: string; value: number; detail: string; tone: 'ok' | 'warn' | 'error' }[];
  mobile?: boolean;
}) {
  return (
    <ul className={cn('m-0 grid list-none grid-cols-3 p-0', mobile ? 'gap-2' : 'gap-3')}>
      {items.map((it) => (
        <li
          key={it.label}
          className={cn(
            'flex flex-col gap-0.5 rounded-md bg-surface shadow-sm',
            mobile ? 'px-3 py-2.5' : 'px-4 py-3.5',
          )}
        >
          <span className="text-meta font-medium text-fg-2">{it.label}</span>
          <strong
            className={cn(
              mobile ? 'text-m-kpi' : 'text-stat-compact',
              it.value > 0 && it.tone === 'warn'
                ? 'text-warn-fg'
                : it.value > 0 && it.tone === 'error'
                  ? 'text-error-fg'
                  : 'text-fg-1',
            )}
          >
            {it.value}
          </strong>
          {!mobile && <span className="text-meta font-medium text-fg-2">{it.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

const STATE_ICON = { ready: Check, needsAccount: Info, failed: CircleAlert } as const;

export function TestRunTable({
  head,
  rows,
  more,
  stateLabel,
  caption,
}: {
  head: { order: string; customer: string; amount: string; account: string; result: string };
  rows: TestRunRowView[];
  /** "+ 6 ordrer klar". */
  more?: string | undefined;
  stateLabel: Record<TestRunRowView['state'], string>;
  caption: string;
}) {
  return (
    <div className="overflow-hidden rounded-md bg-surface shadow-sm">
      <table className="w-full border-collapse text-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="shadow-hairline-b">
            {[head.order, head.customer, head.amount, head.account, head.result].map((h, i) => (
              <th
                key={h}
                scope="col"
                className={cn(
                  'px-4 py-2.5 text-left text-meta font-semibold text-fg-1',
                  i === 2 && 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className={cn('shadow-hairline-b', r.state === 'needsAccount' && 'bg-warn-bg')}
            >
              <td className="px-4 py-3 font-mono tabular">{r.order}</td>
              <td className="px-4 py-3">{r.customer}</td>
              <td className="px-4 py-3 text-right tabular">{r.amount}</td>
              <td className="px-4 py-3">
                {r.account ?? <span className="font-semibold text-fg-1">{r.note}</span>}
              </td>
              <td className="px-4 py-3">
                {r.action ? (
                  <span className="block w-36 whitespace-nowrap">{r.action}</span>
                ) : (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 font-semibold',
                      r.state === 'ready' ? 'text-ok-fg' : 'text-error-fg',
                    )}
                  >
                    <Icon icon={STATE_ICON[r.state]} size={14} />
                    {stateLabel[r.state]}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {more && <p className="m-0 px-4 py-3 text-meta font-medium text-fg-2">{more}</p>}
    </div>
  );
}

export function TestRunList({
  rows,
  more,
  stateLabel,
  label,
}: {
  rows: TestRunRowView[];
  more?: string | undefined;
  stateLabel: Record<TestRunRowView['state'], string>;
  label: string;
}) {
  return (
    <div className="overflow-hidden rounded-md bg-surface shadow-sm">
      <ul aria-label={label} className="m-0 list-none p-0">
        {rows.map((r) => (
          <li
            key={r.id}
            className={cn(
              'flex min-h-14 items-center gap-3 px-4 py-2.5 shadow-row-divider',
              r.state === 'needsAccount' && 'bg-warn-bg',
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col leading-snug">
              <strong className="truncate text-table">
                <span className="font-mono">{r.order}</span> {r.customer}
              </strong>
              <span className="text-meta font-medium text-fg-2">
                {r.amount} · {r.account ?? r.note}
              </span>
            </span>
            {r.action ? (
              // The select keeps a fixed width so the order and customer stay readable.
              <span className="w-36 flex-none whitespace-nowrap">{r.action}</span>
            ) : (
              <span
                className={cn(
                  'inline-flex flex-none items-center gap-1.5 text-meta font-semibold',
                  r.state === 'ready' ? 'text-ok-fg' : 'text-error-fg',
                )}
              >
                <Icon icon={STATE_ICON[r.state]} size={14} />
                {stateLabel[r.state]}
              </span>
            )}
          </li>
        ))}
      </ul>
      {more && <p className="m-0 px-4 py-3 text-meta font-medium text-fg-2">{more}</p>}
    </div>
  );
}

export function Spinner() {
  return <Icon icon={LoaderCircle} size={16} className="animate-spin" />;
}
