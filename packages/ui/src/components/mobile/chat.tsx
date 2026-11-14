import { Lock, Timer } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from '../icon';

// Server-safe: no hooks. Support cases on mobile (MP03).

/** Customer message on white (left) or Agentor reply in dark (right). */
export function ChatBubble({
  from,
  author,
  time,
  children,
}: {
  from: 'customer' | 'agentor';
  author: ReactNode;
  time: ReactNode;
  children: ReactNode;
}) {
  const mine = from === 'agentor';
  return (
    <div
      className={cn(
        'flex max-w-bubble flex-col gap-0.5',
        mine ? 'items-end self-end' : 'items-start self-start',
      )}
    >
      <span className="text-micro font-medium text-fg-2">
        {author} · {time}
      </span>
      <span
        className={cn(
          'whitespace-pre-line rounded-bubble px-3 py-2.25 text-m-chat',
          mine ? 'bg-fg-1 text-white' : 'bg-white text-fg-1 shadow-sm',
        )}
      >
        {children}
      </span>
    </div>
  );
}

/** Yellow internal note, never shown to the customer (README decision 17). */
export function InternalNote({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-node bg-note-bg px-3 py-2.5">
      {/* warn-fg text on note-bg is 4.1:1; the words stay dark, the lock is coloured. */}
      <span className="flex items-center gap-1 text-m-caption font-semibold text-fg-1">
        <Icon icon={Lock} size={14} className="size-3 text-warn-fg" />
        {label}
      </span>
      <span className="whitespace-pre-line text-m-chat">{children}</span>
    </div>
  );
}

/** Centred event line in the timeline ("Supportsession gemt · 42 min. · 11:57"). */
export function TimelineEvent({ children }: { children: ReactNode }) {
  return <div className="text-center text-m-caption font-medium text-fg-2">{children}</div>;
}

/** "Stop og gem" in the TimerBar: lime S button drawn 28 px, touch target 44. */
export function TimerBarAction({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="touch-target inline-flex h-7 flex-none cursor-pointer items-center rounded-full border-0 bg-primary px-3 font-sans text-meta font-semibold text-fg-1"
    >
      {children}
    </button>
  );
}

/** Navy 52 px bar with the running case timer and "Stop og gem" (MP03), fixed to the bottom. */
export function TimerBar({
  time,
  label,
  action,
  fixed = true,
}: {
  /** "00:12:40", tabular. */
  time: ReactNode;
  /** "på sagen". */
  label: ReactNode;
  action: ReactNode;
  fixed?: boolean;
}) {
  return (
    <div
      className={cn(
        'on-navy z-30 flex-none bg-navy pb-bar-safe text-table text-on-navy',
        fixed && 'fixed inset-x-0 bottom-0',
      )}
      role="status"
      aria-live="off"
    >
      <div className="flex h-13 items-center gap-2.5 px-4">
        <Icon icon={Timer} size={18} />
        <span className="flex-1">
          <strong className="tabular">{time}</strong> {label}
        </span>
        {action}
      </div>
    </div>
  );
}
