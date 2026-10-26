'use client';

import type { Route } from '@agentor/flows';
import { Button, Icon, Input, Textarea } from '@agentor/ui';
import { Play, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { previewExpressionAction } from '@/app/(app)/integrations/[id]/editor/actions';

/**
 * Developer mapping (D6 Developer-visning): a JSONata expression per target field, with a live
 * preview against a fictional sample record. The engine evaluates them in a sandbox thread.
 */
export function ExpressionEditor({
  route,
  readOnly,
  update,
}: {
  route: Route;
  readOnly: boolean;
  update: (fn: (r: Route) => void) => void;
}) {
  const t = useTranslations('editor.expr');
  const entries = Object.entries(route.expressions ?? {});
  return (
    <section className="flex flex-col gap-3" aria-labelledby="expr-title">
      <div>
        <h3 id="expr-title" className="m-0 text-body font-semibold">
          {t('title')}
        </h3>
        <p className="m-0 text-meta text-fg-2">{t('help')}</p>
      </div>
      {entries.map(([field, source], i) => (
        <ExpressionRow
          key={i}
          entity={route.entity}
          field={field}
          source={source}
          readOnly={readOnly}
          onField={(f) =>
            update((r) => {
              const next: Record<string, string> = {};
              for (const [k, v] of Object.entries(r.expressions ?? {}))
                next[k === field ? f : k] = v;
              r.expressions = next;
            })
          }
          onSource={(s) => update((r) => void (r.expressions = { ...r.expressions, [field]: s }))}
          onRemove={() =>
            update((r) => {
              const next = { ...r.expressions };
              delete next[field];
              r.expressions = next;
            })
          }
        />
      ))}
      {!readOnly && (
        <div>
          <Button
            variant="secondary"
            size="s"
            onClick={() =>
              update((r) => {
                let n = 1;
                while (`field${n}` in (r.expressions ?? {})) n++;
                r.expressions = { ...r.expressions, [`field${n}`]: '' };
              })
            }
          >
            <Icon icon={Plus} size={14} />
            {t('add')}
          </Button>
        </div>
      )}
    </section>
  );
}

function ExpressionRow(p: {
  entity: string;
  field: string;
  source: string;
  readOnly: boolean;
  onField: (f: string) => void;
  onSource: (s: string) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('editor.expr');
  const [field, setField] = useState(p.field);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2 rounded-sm p-3 shadow-ring-chip">
      <div className="flex items-center gap-2">
        <Input
          aria-label={t('field')}
          mono
          density="compact"
          className="flex-1"
          disabled={p.readOnly}
          value={field}
          onChange={(e) => setField(e.target.value.replace(/[^\w.]/g, '').slice(0, 80))}
          onBlur={() => field && field !== p.field && p.onField(field)}
        />
        {!p.readOnly && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('remove', { field: p.field })}
            onClick={p.onRemove}
          >
            <Icon icon={X} size={14} />
          </Button>
        )}
      </div>
      <Textarea
        aria-label={t('expression', { field: p.field })}
        rows={2}
        className="font-mono text-mono"
        disabled={p.readOnly}
        value={p.source}
        maxLength={2000}
        onChange={(e) => p.onSource(e.target.value)}
      />
      <div className="flex items-start gap-2">
        <Button
          variant="ghost"
          size="s"
          loading={pending}
          disabled={!p.source.trim()}
          onClick={() =>
            start(async () => {
              const res = await previewExpressionAction(p.entity, p.source);
              setResult(
                res.ok
                  ? { ok: true, text: res.data!.value }
                  : { ok: false, text: res.error ?? t('error') },
              );
            })
          }
        >
          {!pending && <Icon icon={Play} size={14} />}
          {t('preview')}
        </Button>
        {result && (
          <pre
            className={
              result.ok
                ? 'm-0 flex-1 overflow-x-auto rounded-xs bg-bg-base px-2 py-1 font-mono text-mono'
                : 'm-0 flex-1 overflow-x-auto rounded-xs bg-error-bg px-2 py-1 font-mono text-mono text-error-fg'
            }
            aria-live="polite"
          >
            {result.text}
          </pre>
        )}
      </div>
    </div>
  );
}
