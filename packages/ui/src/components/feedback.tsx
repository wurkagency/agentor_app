'use client';

import { CircleCheck, CircleX, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast as sonner, Toaster as SonnerToaster } from 'sonner';
import { cn } from '../lib/cn';
import { Button } from './button';
import { Icon } from './icon';

/* ---- Banner: inside cards or global (Komponenter-Feedback) ----------------------------------- */

export type BannerTone = 'info' | 'warn' | 'error' | 'navy';

const BANNER: Record<BannerTone, { icon: LucideIcon; className: string; iconClass: string }> = {
  info: { icon: Info, className: 'bg-info-bg', iconClass: 'text-info-fg' },
  warn: { icon: TriangleAlert, className: 'bg-warn-bg', iconClass: 'text-warn-fg' },
  error: { icon: CircleX, className: 'bg-error-bg', iconClass: 'text-error-fg' },
  navy: { icon: Info, className: 'bg-navy text-on-navy on-navy', iconClass: 'text-on-navy' },
};

export interface BannerProps {
  tone: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  /** Only when it is safe to dismiss (§3.2). */
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
  /** Global banners span the page and sit flush (48 px). */
  global?: boolean;
}

export function Banner({
  tone,
  title,
  children,
  action,
  icon,
  onDismiss,
  dismissLabel,
  className,
  global,
}: BannerProps) {
  const b = BANNER[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 px-4 py-3 text-table',
        global ? 'min-h-12 items-center rounded-none' : 'rounded-node',
        b.className,
        className,
      )}
    >
      <Icon
        icon={icon ?? b.icon}
        size={16}
        className={cn('mt-0.5 flex-none', global && 'mt-0', b.iconClass)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title && <p className="m-0 font-semibold">{title}</p>}
        {children && <div className="m-0">{children}</div>}
      </div>
      {action && <div className="flex flex-none items-center gap-2">{action}</div>}
      {onDismiss && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="-my-1 -mr-2 size-7"
        >
          <Icon icon={X} size={16} />
        </Button>
      )}
    </div>
  );
}

/* ---- Toast: bottom right, 360 px, 6 s; errors stay until dismissed (§4, §5.5) ----------------- */

/** label: accessible name of the toast region, e.g. "Notifikationer". */
export function Toaster({ label }: { label: string }) {
  return (
    <SonnerToaster
      containerAriaLabel={label}
      position="bottom-right"
      gap={8}
      offset={24}
      // Phones: above the mobile tab bar (README decision 20); the shell sets the variable.
      mobileOffset={{
        bottom: 'calc(var(--m-tabbar-height) + 8px + env(safe-area-inset-bottom))',
        left: 16,
        right: 16,
      }}
      visibleToasts={4}
      toastOptions={{ unstyled: true, duration: 6000 }}
    />
  );
}

type ToastTone = 'ok' | 'error' | 'info';

const TOAST_ICON: Record<ToastTone, { icon: LucideIcon; className: string }> = {
  ok: { icon: CircleCheck, className: 'text-ok-fg' },
  error: { icon: CircleX, className: 'text-error-fg' },
  info: { icon: Info, className: 'text-info-fg' },
};

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  /** e.g. { label: 'Fortryd', onClick } for pause/resume/run (§5.5). */
  action?: { label: string; onClick: () => void };
  closeLabel: string;
}

function show(tone: ToastTone, { title, description, action, closeLabel }: ToastOptions) {
  const t = TOAST_ICON[tone];
  return sonner.custom(
    (id) => (
      <div
        className="box-border flex w-90 items-start gap-3 rounded-md bg-surface py-3.5 pl-4 pr-3 text-table shadow-card"
        role={tone === 'error' ? 'alert' : 'status'}
      >
        <Icon icon={t.icon} size={18} className={cn('mt-px', t.className)} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="m-0 font-semibold">{title}</p>
          {description && <p className="m-0 text-fg-2">{description}</p>}
        </div>
        {action && (
          <Button
            size="s"
            variant="secondary"
            onClick={() => {
              action.onClick();
              sonner.dismiss(id);
            }}
          >
            {action.label}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={closeLabel}
          className="size-7"
          onClick={() => sonner.dismiss(id)}
        >
          <Icon icon={X} size={16} />
        </Button>
      </div>
    ),
    { duration: tone === 'error' ? Infinity : 6000 },
  );
}

export const toast = {
  ok: (o: ToastOptions) => show('ok', o),
  error: (o: ToastOptions) => show('error', o),
  info: (o: ToastOptions) => show('info', o),
  dismiss: (id?: string | number) => sonner.dismiss(id),
};
