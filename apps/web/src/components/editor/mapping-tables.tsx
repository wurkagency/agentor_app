'use client';

import type { MappingTable } from '@agentor/connectors';
import type { Route } from '@agentor/flows';
import { Select } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import type { LookupMap } from './setting-control';

const NONE = '__none__';

/**
 * Value tables on a route (PLAN §5.4), e.g. payment method → deposit account. Rows come from the
 * source's live list, columns from the destination's; an empty cell uses the route's default.
 */
export function MappingTables(p: {
  route: Route;
  tables: MappingTable[];
  sourceLookups: LookupMap;
  destLookups: LookupMap;
  sourceName: string;
  readOnly: boolean;
  update: (fn: (r: Route) => void) => void;
}) {
  const t = useTranslations('editor.tables');
  return (
    <>
      {p.tables.map((table) => {
        const rows = p.sourceLookups[table.from.lookup] ?? [];
        const saved = p.route.tables[table.key] ?? [];
        const set = (from: string, col: string, value: string) =>
          p.update((x) => {
            const list = (x.tables[table.key] ??= []);
            let row = list.find((r) => r.from === from);
            if (!row) list.push((row = { from }));
            if (value) row[col] = value;
            else delete row[col];
            x.tables[table.key] = list.filter((r) => Object.keys(r).length > 1);
          });
        return (
          <section
            key={table.key}
            className="flex flex-col gap-3"
            aria-labelledby={`tbl-${table.key}`}
          >
            <div>
              <h3 id={`tbl-${table.key}`} className="m-0 text-body font-semibold">
                {table.title}
              </h3>
              {table.description && <p className="m-0 text-meta text-fg-2">{table.description}</p>}
            </div>
            {rows.length === 0 ? (
              <p className="m-0 text-meta text-fg-2">
                {t('empty', { label: table.from.label.toLowerCase(), source: p.sourceName })}
              </p>
            ) : (
              <table className="w-full border-collapse text-table">
                <thead>
                  <tr className="text-left text-meta">
                    <th className="py-1.5 font-semibold">{table.from.label}</th>
                    {table.to.map((c) => (
                      <th key={c.key} className="py-1.5 font-semibold">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const values = saved.find((s) => s.from === row.value) ?? {};
                    return (
                      <tr key={row.value} className="border-t border-border">
                        <td className="py-1.5 pr-2">{row.label}</td>
                        {table.to.map((c) => (
                          <td key={c.key} className="py-1.5 pr-2">
                            <Select
                              aria-label={t('cell', { column: c.label, row: row.label })}
                              density="table"
                              disabled={p.readOnly}
                              value={values[c.key] ?? NONE}
                              onValueChange={(v) => set(row.value, c.key, v === NONE ? '' : v)}
                              options={[
                                { value: NONE, label: t('default') },
                                ...(p.destLookups[c.lookup] ?? []).map((o) => ({
                                  value: o.value,
                                  label: (
                                    <span>
                                      <span className="font-mono text-mono">{o.value}</span>{' '}
                                      {o.label}
                                    </span>
                                  ),
                                })),
                              ]}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </>
  );
}
