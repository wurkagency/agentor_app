'use server';

import { manifestFor } from '@agentor/connectors';
import {
  ConnectionError,
  createConnection,
  deleteConnection,
  getConnection,
  isUuid,
  updateConnectionSettings,
  reauthorizeConnection,
  requestConnectionTest,
  rotateWebhookToken,
} from '@agentor/db';
import { validatePublicUrl } from '@agentor/http';
import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { actorFor, type ActionResult } from '@/server/actor';
import { requireRole } from '@/server/auth/session';
import {
  enqueueConnectionTest,
  enqueueWebhookAddress,
  hasWebhook,
  sealCredentials,
  webhookUrl,
} from '@/server/connections';
import { env } from '@/server/env';
import { db } from '@/server/infra';

/**
 * Owners, admins and developers manage connections (produktspecifikation §6, PLAN Q), and Agentor
 * support under a help grant, logged as support in the customer's audit log.
 */
const MANAGERS = ['owner', 'admin', 'developer'] as const;

const credentialsSchema = z.record(z.string().max(64), z.string().trim().max(2048));

/**
 * Checks the fields the manifest asks for. A self-hosted URL must be HTTPS and resolve only to
 * public addresses (SSRF, §9.4); the mock mode accepts any well-formed HTTPS URL.
 */
async function checkCredentials(
  connectorId: string,
  raw: unknown,
): Promise<{ ok: true; creds: Record<string, string> } | { ok: false; error: string }> {
  const m = manifestFor(connectorId);
  if (!m || m.auth.type === 'oauth2') return { ok: false, error: 'unknownConnector' };
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const creds: Record<string, string> = {};
  for (const f of m.auth.fields) {
    const v = parsed.data[f.key]?.trim() ?? '';
    if (!v) return { ok: false, error: `missing:${f.key}` };
    if (f.type === 'url') {
      try {
        const url = env().CONNECTOR_MODE === 'mock' ? new URL(v) : await validatePublicUrl(v);
        if (url.protocol !== 'https:') return { ok: false, error: 'httpsRequired' };
        creds[f.key] = url.origin;
      } catch {
        return { ok: false, error: 'badUrl' };
      }
    } else creds[f.key] = v;
  }
  return { ok: true, creds };
}

function initialName(connectorId: string, creds: Record<string, string>) {
  const m = manifestFor(connectorId)!;
  return creds.baseUrl ? new URL(creds.baseUrl).host : m.name;
}

/** API-key connectors: the auth form generated from the manifest (D9-Katalog → Forbind). */
export async function connectWithKey(
  connectorId: string,
  raw: unknown,
): Promise<ActionResult<{ id: string; webhookUrl: string | null }>> {
  const ctx = await requireRole(MANAGERS, { support: true });
  const checked = await checkCredentials(connectorId, raw);
  if (!checked.ok) return checked;
  const m = manifestFor(connectorId)!;
  const actor = await actorFor(ctx);
  const created = await createConnection(db(), actor, {
    connectorId,
    name: initialName(connectorId, checked.creds),
    version: m.version,
    webhook: hasWebhook(connectorId),
    secretFor: (id, token) => sealCredentials(actor.tenantId, id, checked.creds, token),
  });
  await enqueueConnectionTest(actor.tenantId, created.id);
  revalidatePath('/connections');
  return {
    ok: true,
    data: {
      id: created.id,
      webhookUrl: created.webhookToken ? webhookUrl(created.webhookToken) : null,
    },
  };
}

/**
 * OAuth connectors. Live mode sends the customer to the provider; the mock provider (Fase 1,
 * CONNECTOR_MODE=mock) is the app's own consent page, which calls this on "Godkend".
 */
export async function completeMockOAuth(
  connectorId: string,
  reconnectId: string | null,
): Promise<ActionResult<{ id: string }>> {
  if (env().CONNECTOR_MODE !== 'mock') return { ok: false, error: 'notAvailable' };
  const ctx = await requireRole(MANAGERS, { support: true });
  const m = manifestFor(connectorId);
  if (!m || m.auth.type !== 'oauth2') return { ok: false, error: 'unknownConnector' };
  const actor = await actorFor(ctx);
  const creds = {
    accessToken: `mock-${randomBytes(12).toString('hex')}`,
    refreshToken: `mock-${randomBytes(12).toString('hex')}`,
  };
  if (reconnectId) {
    if (!isUuid(reconnectId)) return { ok: false, error: 'invalid' };
    await reauthorizeConnection(
      db(),
      actor,
      reconnectId,
      (id, token) => sealCredentials(actor.tenantId, id, creds, token),
      { webhook: hasWebhook(connectorId) },
    );
    await enqueueConnectionTest(actor.tenantId, reconnectId);
    revalidatePath('/connections');
    return { ok: true, data: { id: reconnectId } };
  }
  const created = await createConnection(db(), actor, {
    connectorId,
    name: m.name,
    version: m.version,
    webhook: hasWebhook(connectorId),
    secretFor: (id, token) => sealCredentials(actor.tenantId, id, creds, token),
  });
  await enqueueConnectionTest(actor.tenantId, created.id);
  revalidatePath('/connections');
  return { ok: true, data: { id: created.id } };
}

/** New API key for a broken API-key connection (Genautentificér). */
export async function reconnectWithKey(
  connectionId: string,
  connectorId: string,
  raw: unknown,
): Promise<ActionResult> {
  const ctx = await requireRole(MANAGERS, { support: true });
  if (!isUuid(connectionId)) return { ok: false, error: 'invalid' };
  const checked = await checkCredentials(connectorId, raw);
  if (!checked.ok) return checked;
  const actor = await actorFor(ctx);
  try {
    await reauthorizeConnection(
      db(),
      actor,
      connectionId,
      (id, token) => sealCredentials(actor.tenantId, id, checked.creds, token),
      { webhook: hasWebhook(connectorId) },
    );
  } catch (e) {
    if (e instanceof ConnectionError) return { ok: false, error: e.code };
    throw e;
  }
  await enqueueConnectionTest(actor.tenantId, connectionId);
  revalidatePath('/connections');
  return { ok: true };
}

export async function testConnection(connectionId: string): Promise<ActionResult> {
  const ctx = await requireRole(MANAGERS, { support: true });
  if (!isUuid(connectionId)) return { ok: false, error: 'invalid' };
  const actor = await actorFor(ctx);
  try {
    await requestConnectionTest(db(), actor, connectionId);
  } catch (e) {
    if (e instanceof ConnectionError) return { ok: false, error: e.code };
    throw e;
  }
  await enqueueConnectionTest(actor.tenantId, connectionId);
  revalidatePath(`/connections/${connectionId}`);
  return { ok: true };
}

export async function newWebhookAddress(
  connectionId: string,
): Promise<ActionResult<{ webhookUrl: string }>> {
  const ctx = await requireRole(MANAGERS, { support: true });
  if (!isUuid(connectionId)) return { ok: false, error: 'invalid' };
  const actor = await actorFor(ctx);
  const token = await rotateWebhookToken(db(), actor, connectionId);
  // Live clients register the address themselves; the old one stops working at once.
  if (env().CONNECTOR_MODE === 'live')
    await enqueueWebhookAddress(actor.tenantId, connectionId, token);
  return { ok: true, data: { webhookUrl: webhookUrl(token) } };
}

const settingValueSchema = z.union([
  z.string().max(200),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(80)).max(50),
]);

/**
 * Saves the connection's own settings (manifest `connectionSettings`): only the manifest's keys,
 * values of the declared type and, for fixed options, one of them. A new test follows, because a
 * setting such as the Dinero company changes what the connection reaches.
 */
export async function saveConnectionSettings(
  connectionId: string,
  raw: unknown,
): Promise<ActionResult> {
  const ctx = await requireRole(MANAGERS, { support: true });
  if (!isUuid(connectionId)) return { ok: false, error: 'invalid' };
  const parsed = z.record(z.string().max(64), settingValueSchema).safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const conn = await getConnection(
    db(),
    { tenantId: ctx.tenant.tenantId, userId: ctx.user.id },
    connectionId,
  );
  const m = conn ? manifestFor(conn.connectorId) : null;
  if (!conn || !m) return { ok: false, error: 'NOT_FOUND' };
  const fields = m.connectionSettings ?? [];
  const clean: Record<string, unknown> = {};
  for (const f of fields) {
    if (!Object.hasOwn(parsed.data, f.key)) continue;
    const v = parsed.data[f.key];
    const ok =
      f.type === 'boolean'
        ? typeof v === 'boolean'
        : f.type === 'number'
          ? typeof v === 'number'
          : f.type === 'multiselect'
            ? Array.isArray(v)
            : typeof v === 'string' &&
              (f.type !== 'select' ||
                f.lookup ||
                v === '' ||
                (f.options ?? []).some((o) => o.value === v));
    if (!ok) return { ok: false, error: `invalid:${f.key}` };
    clean[f.key] = v;
  }
  const actor = await actorFor(ctx);
  await updateConnectionSettings(
    db(),
    actor,
    connectionId,
    clean,
    fields.map((f) => f.key),
  );
  await requestConnectionTest(db(), actor, connectionId);
  await enqueueConnectionTest(actor.tenantId, connectionId);
  revalidatePath(`/connections/${connectionId}`);
  return { ok: true };
}

export async function disconnect(connectionId: string): Promise<ActionResult> {
  const ctx = await requireRole(MANAGERS, { support: true });
  if (!isUuid(connectionId)) return { ok: false, error: 'invalid' };
  try {
    await deleteConnection(db(), await actorFor(ctx), connectionId);
  } catch (e) {
    if (e instanceof ConnectionError) return { ok: false, error: e.code };
    throw e;
  }
  revalidatePath('/connections');
  return { ok: true };
}
