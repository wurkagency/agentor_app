'use client';

import type { SettingField, SettingValue } from '@agentor/connectors';
import { Checkbox, Input, Select, Switch } from '@agentor/ui';

export type LookupList = { value: string; label: string; vatCode?: string }[];
export type LookupMap = Partial<Record<string, LookupList>>;

/** Radix Select can't hold an empty value; "none" stands for the empty default. */
const NONE = '__none__';

/** The settings to show: `showIf` met, split into the basic and the developer layer. */
export function visibleSettings(fields: SettingField[], values: Record<string, unknown>) {
  const shown = fields.filter((f) => {
    if (!f.showIf) return true;
    const other = fields.find((x) => x.key === f.showIf!.key);
    const v = values[f.showIf.key] ?? other?.default;
    return v === f.showIf.equals;
  });
  return {
    basic: shown.filter((f) => (f.level ?? 'basic') === 'basic'),
    advanced: shown.filter((f) => f.level === 'advanced'),
  };
}

/** Options for a select or multiselect: the manifest's own, or a live list from the system. */
function optionsOf(field: SettingField, lookups: LookupMap) {
  const live = field.lookup ? (lookups[field.lookup] ?? []) : [];
  const own = field.options ?? [];
  const seen = new Set(own.map((o) => o.value));
  return [...own, ...live.filter((o) => !seen.has(o.value))];
}

export interface SettingControlProps {
  field: SettingField;
  value: unknown;
  onChange: (v: SettingValue) => void;
  lookups: LookupMap;
  readOnly: boolean;
  id: string;
  describedBy: string | undefined;
  noneLabel: string;
}

/** One manifest setting as a control (produktspecifikation §4.3: the UI comes from the manifest). */
export function SettingControl(p: SettingControlProps) {
  const f = p.field;
  const v = p.value ?? f.default;
  if (f.type === 'boolean')
    return (
      <Switch
        id={p.id}
        aria-describedby={p.describedBy}
        disabled={p.readOnly}
        checked={Boolean(v)}
        onCheckedChange={(x) => p.onChange(x)}
      />
    );
  if (f.type === 'select') {
    const options = optionsOf(f, p.lookups);
    const empty = f.default === '' || options.length === 0;
    return (
      <Select
        id={p.id}
        aria-describedby={p.describedBy}
        disabled={p.readOnly}
        value={String(v) === '' ? (empty ? NONE : '') : String(v)}
        onValueChange={(x) => p.onChange(x === NONE ? '' : x)}
        options={[
          ...(empty ? [{ value: NONE, label: p.noneLabel }] : []),
          ...options.map((o) => ({ value: o.value, label: o.label })),
        ]}
      />
    );
  }
  if (f.type === 'multiselect') {
    const chosen = new Set(Array.isArray(v) ? (v as string[]) : []);
    return (
      <fieldset
        id={p.id}
        aria-describedby={p.describedBy}
        className="m-0 flex flex-col gap-1.5 border-0 p-0 pt-2"
      >
        <legend className="sr-only">{f.label}</legend>
        {optionsOf(f, p.lookups).map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-table">
            <Checkbox
              size={16}
              disabled={p.readOnly}
              checked={chosen.has(o.value)}
              onCheckedChange={(on) => {
                const next = new Set(chosen);
                if (on === true) next.add(o.value);
                else next.delete(o.value);
                p.onChange([...next]);
              }}
            />
            {o.label}
          </label>
        ))}
      </fieldset>
    );
  }
  if (f.type === 'number')
    return (
      <Input
        id={p.id}
        aria-describedby={p.describedBy}
        density="compact"
        type="number"
        inputMode="decimal"
        disabled={p.readOnly}
        value={String(v)}
        onChange={(e) => {
          const n = Number(e.target.value);
          p.onChange(e.target.value === '' || Number.isNaN(n) ? f.default : n);
        }}
      />
    );
  return (
    <Input
      id={p.id}
      aria-describedby={p.describedBy}
      density="compact"
      disabled={p.readOnly}
      value={String(v)}
      onChange={(e) => p.onChange(e.target.value)}
    />
  );
}
