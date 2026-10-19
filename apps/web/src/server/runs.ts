import { enqueueFlowRun, flowsQueue, redisConnection } from '@agentor/jobs';
import { QueueEvents, type Queue } from 'bullmq';
import { env } from './env';

const g = globalThis as unknown as {
  __agentorFlowQueue?: Queue;
  __agentorFlowEvents?: QueueEvents;
};

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

/**
 * Developer expression preview (D6): the worker evaluates it in its sandbox and answers within
 * a few seconds. The web never runs customer expressions itself.
 */
export async function previewExpression(
  entity: 'order' | 'creditNote' | 'customer' | 'product' | 'stock',
  source: string,
): Promise<{ ok: boolean; value?: string; error?: string }> {
  g.__agentorFlowEvents ??= new QueueEvents(queue().name, {
    connection: redisConnection(env().REDIS_URL),
  });
  const job = await queue().add(
    'expression.preview',
    { entity, source },
    { attempts: 1, removeOnComplete: true, removeOnFail: true },
  );
  return job.waitUntilFinished(g.__agentorFlowEvents, 5_000);
}
