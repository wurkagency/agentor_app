'use server';

import { manifestFor } from '@agentor/connectors';
import { createFlow } from '@agentor/db';
import type { FlowDefinition } from '@agentor/flows';
import { redirect } from 'next/navigation';
import { actorFor, type ActionResult } from '@/server/actor';
import { requireRole } from '@/server/auth/session';
import { templateById } from '@/components/editor/templates';
import { connectionMap } from '@/server/flows';
import { db } from '@/server/infra';

/**
 * Nyt flow (D4): places the template's nodes and routes on the tenant's own connections, every
 * route in Test, and opens the editor with the guide.
 */
export async function createFromTemplate(
  templateId: string | null,
  name: string,
): Promise<ActionResult> {
  const ctx = await requireRole(['owner', 'admin', 'developer'], { support: true });
  const conns = [...(await connectionMap(ctx.tenant.tenantId, ctx.user.id)).values()].filter(
    (c) => c.status !== 'broken',
  );
  const tpl = templateId ? templateById(templateId) : null;
  if (templateId && !tpl) return { ok: false, error: 'invalid' };
  const source = conns.find((c) =>
    tpl ? tpl.source.includes(c.connectorId) : manifestFor(c.connectorId)?.category === 'webshop',
  );
  if (!source) return { ok: false, error: 'missingSource' };
  const def: FlowDefinition = {
    defaultMode: 'test',
    pollMinutes: 5,
    nodes: [{ id: 'src', role: 'source', connectionId: source.id }],
    routes: [],
  };
  for (const connector of tpl?.destinations ?? []) {
    const dest = conns.find((c) => c.connectorId === connector);
    if (!dest) return { ok: false, error: `missing:${connector}` };
    def.nodes.push({ id: connector, role: 'destination', connectionId: dest.id });
  }
  for (const r of tpl?.routes ?? [])
    def.routes.push({
      id: `${r.entity.toLowerCase()}-${r.to}`,
      from: 'src',
      to: r.to,
      entity: r.entity,
      targetEntity: r.targetEntity,
      mode: 'test',
      paused: false,
      settings: {},
      mapping: {},
      categoryAccounts: [],
      filters: [],
      updateExisting: true,
      expressions: {},
      sourceOptions: { ...r.sourceOptions },
      tables: {},
      templates: {},
    });
  const id = await createFlow(db(), await actorFor(ctx), {
    name: name.trim().slice(0, 120) || 'Nyt flow',
    template: tpl?.id ?? null,
    definition: def,
  });
  const first = def.routes[0];
  redirect(
    `/integrations/${id}/editor?guide=1${first ? `&route=${first.id}&tab=${first.entity === 'order' ? 'mapping' : 'general'}` : ''}`,
  );
}
