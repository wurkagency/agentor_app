'use client';

import { Icon } from '@agentor/ui';
import { CalendarDays } from 'lucide-react';
import type { FormEvent } from 'react';

/**
 * Fra/til as a plain GET form (S7, A3, A4, F7): the chosen dates land in ?from=&to=, so the
 * period can be shared and survives a reload, and it works without JavaScript. Other parameters
 * that should survive go in `keep`.
 */
export function DateRangeForm({
  action,
  from,
  to,
  labels,
  keep = {},
  max,
  mobile = false,
}: {
  action: string;
  from: string;
  to: string;
  labels: { legend: string; from: string; to: string; apply: string };
  keep?: Record<string, string>;
  /** Latest selectable day, YYYY-MM-DD. */
  max?: string;
  /** MP23, MP27, MP28: Fra and Til side by side, labels over 48 px fields. */
  mobile?: boolean;
}) {
  const input = mobile
    ? 'h-12 w-full min-w-0 rounded-field border border-border-strong bg-white px-3 font-sans text-m-input text-fg-1 tabular-nums box-border'
    : 'h-10 rounded-sm border border-border bg-surface px-3 font-sans text-body text-fg-1 tabular-nums';
  const submitOnChange = (e: FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    if (form.checkValidity()) form.requestSubmit();
  };
  if (mobile)
    return (
      <form action={action} method="get" onChange={submitOnChange}>
        <fieldset className="m-0 grid grid-cols-2 gap-2.5 border-0 p-0">
          <legend className="sr-only">{labels.legend}</legend>
          {Object.entries(keep).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {(['from', 'to'] as const).map((k) => (
            <label key={k} className="flex min-w-0 flex-col gap-1.5 text-table font-semibold">
              {/* A label of its own over the field: "Fra", "Til" (the inline desktop form says "til"). */}
              {labels[k].charAt(0).toUpperCase() + labels[k].slice(1)}
              <input
                type="date"
                name={k}
                defaultValue={k === 'from' ? from : to}
                required
                {...(max ? { max } : {})}
                className={input}
              />
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          className="sr-only mt-2 h-10 cursor-pointer rounded-full border-0 bg-white px-4 font-sans text-table font-semibold text-fg-1 shadow-ring-strong focus:not-sr-only"
        >
          {labels.apply}
        </button>
      </form>
    );
  return (
    <form
      action={action}
      method="get"
      className="flex flex-wrap items-center gap-2"
      // A chosen date applies at once, as on the boards; the button is there for keyboards and
      // for browsers without JavaScript.
      onChange={submitOnChange}
    >
      <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
        <legend className="sr-only">{labels.legend}</legend>
        {Object.entries(keep).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <Icon icon={CalendarDays} size={16} className="text-fg-2" />
        <label className="flex items-center gap-2 text-meta font-medium text-fg-2">
          {labels.from}
          <input
            type="date"
            name="from"
            defaultValue={from}
            required
            {...(max ? { max } : {})}
            className={input}
          />
        </label>
        <label className="flex items-center gap-2 text-meta font-medium text-fg-2">
          {labels.to}
          <input
            type="date"
            name="to"
            defaultValue={to}
            required
            {...(max ? { max } : {})}
            className={input}
          />
        </label>
      </fieldset>
      <button
        type="submit"
        className="sr-only inline-flex h-9 cursor-pointer items-center rounded-full border-0 bg-surface px-4 font-sans text-table font-semibold text-fg-1 shadow-ring-chip focus:not-sr-only"
      >
        {labels.apply}
      </button>
    </form>
  );
}
