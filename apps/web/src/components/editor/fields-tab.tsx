'use client';

import { MOCK_ORDERS, type Port, type TargetField, type VariableDef } from '@agentor/connectors';
import { renderTemplate, type Finding, type Route } from '@agentor/flows';
import { Button, Field, Icon, Input, Select } from '@agentor/ui';
import { RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';

/** Meta aliases every WooCommerce connection has (connection settings L1). */
const META_ALIASES = ['vatNumber', 'cvr', 'ean'];

/** A fictional record per entity for the live preview (designspecifikation §10.1 test data). */
function sampleFor(entity: Route['entity']): Record<string, unknown> {
  const o = MOCK_ORDERS[1]!;
  const order = {
    ...o,
    meta: { ean: '5798000000001' },
    paymentMethod: { id: 'quickpay', title: 'Kort' },
  };
  if (entity === 'order') return order;
  if (entity === 'creditNote')
    return {
      sourceId: '901',
      number: '901',
      orderSourceId: o.sourceId,
      createdAt: o.createdAt,
      currency: o.currency,
      customer: o.customer,
      lines: o.lines,
      total: o.total,
      reason: 'Returneret',
      meta: { orderNumber: o.number },
    };
  if (entity === 'customer') return o.customer as unknown as Record<string, unknown>;
  if (entity === 'shipment')
    return {
      sourceId: '500',
      number: 'WH/OUT/00042',
      orderRef: o.number,
      state: 'done',
      doneAt: o.createdAt,
      carrier: 'GLS',
      trackingRef: '00340434161094042557',
      trackingUrl: null,
      lines: [],
      fields: {},
    };
  if (entity === 'invoiceStatus')
    return {
      sourceId: '900',
      kind: 'invoice',
      number: 'INV/2026/00123',
      orderRef: o.number,
      state: 'posted',
      paymentState: 'paid',
      currency: o.currency,
      total: o.total,
      residual: 0,
      date: o.createdAt.slice(0, 10),
      dueDate: o.createdAt.slice(0, 10),
      fields: {},
    };
  return {};
}

/** The variables a target can read: line variables only in line fields; meta wildcards expanded. */
export function variablesFor(port: Port | undefined, scope: TargetField['scope']): VariableDef[] {
  return (port?.variables ?? [])
    .filter((v) => v.scope === 'record' || scope === 'line')
    .flatMap((v) =>
      v.path.endsWith('.*')
        ? META_ALIASES.map((a) => ({
            ...v,
            // "meta.*" → "meta.<alias>": only the trailing wildcard.
            path: `${v.path.slice(0, -1)}${a}`,
            label: `${v.label}: ${a}`,
          }))
        : [v],
    );
}

export interface FieldsTabProps {
  route: Route;
  source: Port | undefined;
  sourceName: string;
  target: Port | undefined;
  systemName: string;
  sourceConnectionId: string;
  findings: Finding[];
  readOnly: boolean;
  developer: boolean;
  update: (fn: (r: Route) => void) => void;
}

function TemplateField(
  p: FieldsTabProps & { field: TargetField; sample: Record<string, unknown> },
) {
  const t = useTranslations('editor.fields');
  const ref = useRef<HTMLInputElement>(null);
  const f = p.field;
  const own = p.route.templates[f.key];
  const value = own ?? f.default ?? '';
  const editable = f.editable === 'template' && !p.readOnly;
  const err = p.findings.find((x) => x.routeId === p.route.id && x.path === `templates.${f.key}`);
  const ctx = {
    [p.route.entity]: p.sample,
    connection: { id: p.sourceConnectionId },
    line: (p.sample.lines as unknown[] | undefined)?.[0] ?? {},
  };
  let preview = '';
  try {
    preview = renderTemplate(value, ctx, { maxLength: f.maxLength });
  } catch {
    // Shown as a validation finding on the field.
  }
  const set = (next: string) =>
    p.update((x) => {
      if (next === (f.default ?? '')) delete x.templates[f.key];
      else x.templates[f.key] = next;
    });
  // Where the cursor was when the field lost focus to the variable list; the end until then.
  const caret = useRef<{ start: number; end: number } | null>(null);
  const remember = () => {
    const el = ref.current;
    if (el && el.selectionStart !== null)
      caret.current = { start: el.selectionStart, end: el.selectionEnd ?? el.selectionStart };
  };
  const insert = (path: string) => {
    const at = Math.min(caret.current?.start ?? value.length, value.length);
    const end = Math.min(caret.current?.end ?? at, value.length);
    const token = `{${path}}`;
    set(`${value.slice(0, at)}${token}${value.slice(end)}`);
    caret.current = { start: at + token.length, end: at + token.length };
    requestAnimationFrame(() => ref.current?.focus());
  };
  return (
    <Field
      label={f.label}
      inline
      error={
        err
          ? t(`error.${err.code}`, {
              variable: String(err.params?.variable ?? ''),
              message: String(err.params?.message ?? ''),
            })
          : undefined
      }
      help={
        f.editable === 'expression'
          ? t('expressionOnly')
          : f.maxLength
            ? t('maxLength', { count: f.maxLength })
            : undefined
      }
    >
      {({ describedBy }) => (
        <div className="flex flex-col gap-1.5">
          <Input
            ref={ref}
            id={`field-templates.${f.key}`}
            aria-label={f.label}
            aria-describedby={describedBy}
            aria-invalid={Boolean(err) || undefined}
            density="compact"
            mono
            readOnly={!editable}
            value={value}
            onChange={(e) => set(e.target.value)}
            onSelect={remember}
            onBlur={remember}
          />
          {editable && (
            <div className="flex items-center gap-2">
              <Select
                aria-label={t('insert')}
                density="compact"
                className="flex-1"
                placeholder={t('insert')}
                value=""
                onValueChange={insert}
                options={variablesFor(p.source, f.scope).map((v) => ({
                  value: v.path,
                  label: v.label,
                  hint: <span className="font-mono text-micro">{v.path}</span>,
                }))}
              />
              {own !== undefined && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('reset')}
                  onClick={() => set(f.default ?? '')}
                >
                  <Icon icon={RotateCcw} size={14} />
                </Button>
              )}
            </div>
          )}
          <p className="m-0 text-meta text-fg-2">
            <span className="eyebrow mr-1.5">{t('preview')}</span>
            <span className="font-mono text-mono text-fg-1">{preview || '–'}</span>
          </p>
        </div>
      )}
    </Field>
  );
}

/**
 * Felter (PLAN-INTEGRATIONS §6): what the destination writes and how, as templates over the
 * source's variables, with a preview on test data. Keys the integration relies on (external
 * references) are shown to developers only, read-only here; expressions can still set them.
 */
export function FieldsTab(p: FieldsTabProps) {
  const t = useTranslations('editor.fields');
  const sample = sampleFor(p.route.entity);
  const targets = (p.target?.targets ?? []).filter((f) => f.editable === 'template' || p.developer);
  if (targets.length === 0)
    return <p className="m-0 text-table text-fg-2">{t('none', { system: p.systemName })}</p>;
  return (
    <section className="flex flex-col gap-4">
      <p className="m-0 text-table text-fg-2">
        {t('intro', { system: p.systemName, source: p.sourceName })}
      </p>
      {targets.map((f) => (
        <TemplateField key={f.key} {...p} field={f} sample={sample} />
      ))}
      <p className="m-0 text-meta text-fg-2">{t('previewNote')}</p>
    </section>
  );
}
