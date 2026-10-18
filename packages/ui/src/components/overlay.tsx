'use client';

import {
  DropdownMenu as Menu,
  Popover as PopoverPrimitive,
  Tooltip as TooltipPrimitive,
} from 'radix-ui';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** Wrap the app once so tooltips share a delay. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={300} skipDelayDuration={150}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

/** Navy tooltip, white 12 px text, radius 8 (§4). The trigger must be focusable. */
export function Tooltip({
  content,
  children,
  side = 'top',
  open,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  open?: boolean;
}) {
  return (
    <TooltipPrimitive.Root {...(open !== undefined ? { open } : {})}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-w-72 rounded-sm bg-navy px-2 py-1 text-meta text-on-navy shadow-sm"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

/** White popover, shadow-card, radius 16 (§4). */
export function PopoverContent({
  className,
  align = 'end',
  sideOffset = 8,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={16}
        className={cn('z-50 rounded-md bg-surface shadow-card outline-none', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

export function DropdownMenuContent({
  className,
  align = 'end',
  sideOffset = 8,
  ...props
}: ComponentPropsWithoutRef<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={16}
        className={cn(
          'z-50 min-w-56 rounded-md bg-surface p-2 shadow-card outline-none',
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  );
}

/** 40 px menu row (App-skal-B profile menu): icon 16 fg-2, label 14/500, optional hint right. */
export function DropdownMenuItem({
  className,
  icon,
  hint,
  children,
  destructive,
  ...props
}: ComponentPropsWithoutRef<typeof Menu.Item> & {
  icon?: ReactNode;
  hint?: ReactNode;
  destructive?: boolean;
}) {
  return (
    <Menu.Item
      className={cn(
        'flex h-10 cursor-pointer select-none items-center gap-3 rounded-sm px-3 text-body font-medium text-fg-1 focus-visible:-outline-offset-2',
        'data-highlighted:bg-bg-base data-disabled:cursor-not-allowed data-disabled:text-fg-2',
        destructive && 'text-error-fg',
        className,
      )}
      {...props}
    >
      {icon && <span className="text-fg-2">{icon}</span>}
      <span className="flex-1">{children}</span>
      {hint && <span className="ml-auto text-meta font-medium text-fg-2">{hint}</span>}
    </Menu.Item>
  );
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="my-1 h-px bg-border" />;
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return <Menu.Label className="px-3 pb-2 pt-1">{children}</Menu.Label>;
}
