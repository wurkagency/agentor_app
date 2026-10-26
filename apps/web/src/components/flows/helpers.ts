import { manifestFor } from '@agentor/connectors';
import type { FlowDefinition } from '@agentor/flows';

/** The destination system's name and a mapping field's label for a route (from the manifest). */
export function routeTarget(
  def: FlowDefinition | null,
  conns: Map<string, { connectorId: string }>,
  routeId: string,
) {
  const r = def?.routes.find((x) => x.id === routeId);
  const node = r ? def?.nodes.find((n) => n.id === r.to) : undefined;
  const c = node ? conns.get(node.connectionId) : undefined;
  const m = c ? manifestFor(c.connectorId) : null;
  const fieldLabel = (key: string | undefined) =>
    key
      ? (Object.values(m?.mapping ?? {})
          .flat()
          .flatMap((g) => g?.fields ?? [])
          .find((f) => f.key === key)?.label ?? key)
      : null;
  return { system: m?.name ?? '', fieldLabel, route: r ?? null };
}
