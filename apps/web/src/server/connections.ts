import { manifestFor } from '@agentor/connectors';
import { connectionsQueue, enqueueConnectionJob, redisConnection } from '@agentor/jobs';
import { publicKeyFromBase64, seal, secretBinding } from '@agentor/keybox';
import type { Queue } from 'bullmq';
import { env } from './env';

/**
 * The web side of the key box: credentials are sealed to the KEK public key, so this process can
 * store them but never read them back (ADR 0002).
 */
export function sealCredentials(
  tenantId: string,
  connectionId: string,
  credentials: Record<string, string>,
) {
  const key = env().KEK_PUBLIC_KEY;
  if (!key) throw new Error('KEK_PUBLIC_KEY is not configured');
  return seal(
    JSON.stringify(credentials),
    publicKeyFromBase64(key),
    secretBinding(tenantId, connectionId),
  );
}

const g = globalThis as unknown as { __agentorConnQueue?: Queue };

function queue(): Queue {
  g.__agentorConnQueue ??= connectionsQueue(redisConnection(env().REDIS_URL));
  return g.__agentorConnQueue;
}

/** Asks the worker to open the credentials and test the connection. */
export async function enqueueConnectionTest(tenantId: string, connectionId: string) {
  await enqueueConnectionJob(queue(), 'connection.test', { tenantId, connectionId });
}

export function webhookUrl(token: string): string {
  return new URL(`/hooks/${token}`, env().INGEST_PUBLIC_URL).toString();
}

export function hasWebhook(connectorId: string): boolean {
  return Boolean(manifestFor(connectorId)?.webhook);
}
