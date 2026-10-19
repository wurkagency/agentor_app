import { enqueueFlowRun, flowsQueue, redisConnection } from '@agentor/jobs';
import type { Queue } from 'bullmq';
import { env } from './env';

const g = globalThis as unknown as { __agentorFlowQueue?: Queue };

function queue(): Queue {
  g.__agentorFlowQueue ??= flowsQueue(redisConnection(env().REDIS_URL));
  return g.__agentorFlowQueue;
}

/** Hands a queued run to agentor-worker. */
export async function enqueueRun(
  tenantId: string,
  runId: string,
  retry?: { routeId?: string | undefined },
) {
  await enqueueFlowRun(queue(), { tenantId, runId, ...(retry ? { retry } : {}) });
}
