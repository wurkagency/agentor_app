'use client';

import { cn, Icon } from '@agentor/ui';
import { MobileCard, MobileField, MobileInput, Segmented } from '@agentor/ui/mobile';
import { Check, X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useNow } from '@/components/now';

export type Role = 'owner' | 'admin' | 'developer' | 'reader';

export interface AccessState {
  flowScope: 'all' | 'selected';
  flowIds: string[];
  accessExpiresAt: string;
  isExternal: boolean;
}

/**
 * Bottom sheet (MA30): the dimmed page with a sheet from the bottom, radius 20 at the top, a grab
 * handle, title + intro and a 40 px close button. Radix Dialog traps focus; Esc and a tap on the
 * backdrop close it.
 */
export function MobileSheet({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  closeLabel: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 flex items-end bg-scrim-strong pt-16">
          <DialogPrimitive.Content
            className="flex max-h-full w-full flex-col gap-3 overflow-y-auto rounded-t-lg bg-canvas px-4 pb-6 pt-2 shadow-modal outline-none"
            {...(description ? {} : { 'aria-describedby': undefined })}
          >
            <span
              aria-hidden
              className="h-1 w-10 flex-none self-center rounded-full bg-border-strong"
            />
            <div className="flex items-start justify-between gap-3">
              <span className="flex flex-col gap-0.5 leading-snug">
                <DialogPrimitive.Title className="m-0 text-m-hero">{title}</DialogPrimitive.Title>
                {description && (
                  <DialogPrimitive.Description className="m-0 text-meta font-medium text-fg-2">
                    {description}
                  </DialogPrimitive.Description>
                )}
              </span>
              <DialogPrimitive.Close
                className="touch-target grid size-10 flex-none cursor-pointer place-items-center rounded-full border-0 bg-surface text-fg-1"
                aria-label={closeLabel}
              >
                <Icon icon={X} size={18} />
              </DialogPrimitive.Close>
            </div>
            {children}
            <div aria-hidden className="pb-bar-safe" />
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Role as radio cards (MA30): native radios, so arrow keys and screen readers work as usual. */
export function RoleCards<R extends Role>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: R;
  options: { value: R; title: string; description?: string }[];
  onChange: (v: R) => void;
}) {
  const t = useTranslations('team');
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-table font-semibold">{t('role')}</legend>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <label
            key={o.value}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-md bg-surface px-3.5 py-3 shadow-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-fg-1',
              on && 'shadow-ring-dark-2',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={on}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            <span
              aria-hidden
              className={cn(
                'grid size-5.5 flex-none place-items-center rounded-full',
                on ? 'bg-fg-1' : 'shadow-ring-strong-2',
              )}
            >
              {on && <span className="size-2 rounded-full bg-white" />}
            </span>
            <span className="flex flex-col gap-0.5 leading-snug">
              <strong className="text-body">{o.title}</strong>
              {o.description && (
                <span className="text-meta font-medium text-fg-2">{o.description}</span>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** A checkbox row: the whole row is the label of one native checkbox. */
function CheckRow({
  checked,
  onChange,
  children,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 px-4 py-1.5 text-body shadow-row-divider last:shadow-none has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-fg-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'grid size-5.5 flex-none place-items-center rounded-xs',
          checked ? 'bg-fg-1 text-primary' : 'bg-white shadow-ring-off',
        )}
      >
        {checked && <Icon icon={Check} size={14} />}
      </span>
      <span className="flex flex-col leading-snug">
        {children}
        {hint && <span className="text-meta font-medium text-fg-2">{hint}</span>}
      </span>
    </label>
  );
}

/** Adgang: all or selected flows, the flows and the expiry (MA30), and "Ekstern bruger". */
export function MobileAccessFields({
  role,
  value,
  onChange,
  flows,
}: {
  role: Role;
  value: AccessState;
  onChange: (v: AccessState) => void;
  flows: { id: string; name: string }[];
}) {
  const t = useTranslations('team');
  const ti = useTranslations('mobile.invite');
  const now = useNow();
  const scoped = role === 'developer' || role === 'reader';
  return (
    <>
      {scoped && (
        <>
          <strong className="text-table">{t('access')}</strong>
          <Segmented
            label={t('access')}
            value={value.flowScope}
            onChange={(k) => onChange({ ...value, flowScope: k as 'all' | 'selected' })}
            items={[
              { key: 'all', label: t('scopeAll') },
              { key: 'selected', label: t('scopeSelected') },
            ]}
          />
          {value.flowScope === 'selected' && (
            <>
              <MobileCard label={ti('flows')}>
                {flows.length === 0 ? (
                  <p className="m-0 px-4 py-3 text-table text-fg-2">{ti('noFlows')}</p>
                ) : (
                  <div className="py-1">
                    {flows.map((f) => (
                      <CheckRow
                        key={f.id}
                        checked={value.flowIds.includes(f.id)}
                        onChange={(c) =>
                          onChange({
                            ...value,
                            flowIds: c
                              ? [...value.flowIds, f.id]
                              : value.flowIds.filter((id) => id !== f.id),
                          })
                        }
                      >
                        {f.name}
                      </CheckRow>
                    ))}
                  </div>
                )}
              </MobileCard>
              <MobileField label={t('accessExpires')} hint={t('accessExpiresHelp')}>
                <MobileInput
                  type="date"
                  value={value.accessExpiresAt}
                  min={now.toISOString().slice(0, 10)}
                  onChange={(e) => onChange({ ...value, accessExpiresAt: e.target.value })}
                />
              </MobileField>
            </>
          )}
        </>
      )}
      <MobileCard>
        <CheckRow
          checked={value.isExternal}
          onChange={(c) => onChange({ ...value, isExternal: c })}
          hint={t('isExternalHelp')}
        >
          {t('isExternal')}
        </CheckRow>
      </MobileCard>
    </>
  );
}
