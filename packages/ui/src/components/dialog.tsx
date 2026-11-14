'use client';

import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';
import { Field, Input } from './form';
import { Icon } from './icon';

const WIDTH = {
  480: 'w-120',
  560: 'w-140',
  640: 'w-160',
  720: 'w-180',
  880: 'w-220',
} as const;

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** 480 standard, 560 invite, 720 publish/diff, 880 template picker (§4, boards). */
  width?: keyof typeof WIDTH;
  children?: ReactNode;
  /** Right-aligned actions in the footer; the primary action goes last. */
  footer?: ReactNode;
  closeLabel: string;
  className?: string;
}

/**
 * Dialog (Komponenter-Feedback): scrim at 40 %, white card radius 16 with shadow-card, title
 * 16/600, footer with a hairline and right-aligned actions. Focus is trapped and restored.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  width = 480,
  children,
  footer,
  closeLabel,
  className,
}: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <DialogPrimitive.Content
          className={cn(
            'dialog-frame fixed left-1/2 z-50 flex -translate-x-1/2 flex-col rounded-md bg-surface shadow-card outline-none',
            WIDTH[width],
            className,
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-6">
            <div className="flex flex-col gap-1">
              <DialogPrimitive.Title className="m-0 text-card">{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="m-0 text-body text-fg-2">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label={closeLabel} className="-mr-2 -mt-1">
                <Icon icon={X} size={18} />
              </Button>
            </DialogPrimitive.Close>
          </div>
          {children && (
            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 pb-6 pt-3">
              {children}
            </div>
          )}
          {footer && (
            <div className="flex justify-end gap-2 px-6 py-4 shadow-hairline-t">{footer}</div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface DestructiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** What happens, listed (§5.5). */
  consequences: ReactNode[];
  /** The exact name the user must type to confirm. */
  confirmName: string;
  confirmLabel: ReactNode;
  typeLabel: ReactNode;
  cancelLabel: string;
  closeLabel: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  busyLabel?: ReactNode;
}

/** Destructive confirmation: lists consequences and requires typing the name (§4, §5.5). */
export function DestructiveDialog({
  open,
  onOpenChange,
  title,
  consequences,
  confirmName,
  confirmLabel,
  typeLabel,
  cancelLabel,
  closeLabel,
  onConfirm,
  busy,
  busyLabel,
}: DestructiveDialogProps) {
  const [typed, setTyped] = useState('');
  const matches = typed.trim() === confirmName;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped('');
        onOpenChange(o);
      }}
      title={title}
      closeLabel={closeLabel}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant="destructive"
            disabled={!matches}
            loading={busy ?? false}
            onClick={() => void onConfirm()}
            className={cn(matches && 'bg-error-fg text-white hover:bg-error-fg')}
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </>
      }
    >
      <ul className="m-0 list-disc space-y-1 pl-5 text-body">
        {consequences.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
      <Field label={typeLabel}>
        {({ id }) => (
          <Input
            id={id}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </Field>
    </Dialog>
  );
}
