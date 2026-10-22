'use client';

import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from '../icon';

/**
 * Modal (MP04): centred over the dimmed page, radius 20, padding 20, title 18/700 with a 44 px
 * close button. Focus is trapped and restored; Esc and a tap on the backdrop close it.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Meta line under the title, e.g. "#2291 · Nordlys Cykler ApS". */
  description?: ReactNode;
  closeLabel: string;
  children: ReactNode;
  /** Actions, usually two BigButtons side by side. */
  footer?: ReactNode;
  className?: string;
}) {
  // Opened from state, not a Dialog.Trigger: Radix would return focus to a trigger that doesn't
  // exist, so remember what had focus (before Radix moves it in) and return there on close.
  const returnTo = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement)
      returnTo.current = document.activeElement;
  }, [open]);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-scrim-strong p-4">
          <DialogPrimitive.Content
            className={cn(
              'flex max-h-full w-full flex-col gap-4 overflow-y-auto rounded-lg bg-surface p-5 shadow-modal outline-none',
              className,
            )}
            {...(description ? {} : { 'aria-describedby': undefined })}
            onCloseAutoFocus={(e) => {
              const el = returnTo.current;
              if (el?.isConnected) {
                e.preventDefault();
                el.focus();
              }
            }}
          >
            <div className="flex items-center justify-between">
              <span className="flex flex-col leading-snug">
                <DialogPrimitive.Title className="m-0 text-m-hero">{title}</DialogPrimitive.Title>
                {description && (
                  <DialogPrimitive.Description className="m-0 text-meta font-medium text-fg-2">
                    {description}
                  </DialogPrimitive.Description>
                )}
              </span>
              <DialogPrimitive.Close
                className="-mr-2.5 grid size-11 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent text-fg-1"
                aria-label={closeLabel}
              >
                <Icon icon={X} size={18} className="size-5" />
              </DialogPrimitive.Close>
            </div>
            {children}
            {footer && <div className="flex gap-2">{footer}</div>}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
