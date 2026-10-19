import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';

/**
 * Developer mapping (D6 Developer-visning): a JSONata expression per target field, evaluated
 * against the source record. In the engine every expression runs in a separate thread that is
 * terminated when it exceeds its time limit, so a runaway expression (endless recursion, a huge
 * range) fails the record instead of holding or crashing the worker. JSONata itself has no I/O.
 */

export const EXPRESSION_MAX_LENGTH = 2000;
const TIME_LIMIT_MS = 250;

export class ExpressionError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'ExpressionError';
  }
}

const SANDBOX = `
const { parentPort, workerData } = require('node:worker_threads');
const jsonata = require(workerData.jsonata);
parentPort.on('message', async ({ id, source, input }) => {
  try {
    const value = await jsonata(source).evaluate(input);
    parentPort.postMessage({ id, ok: true, value: value === undefined ? null : value });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
});
`;

let sandbox: Worker | null = null;
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
>();

function thread(): Worker {
  if (sandbox) return sandbox;
  const jsonataPath = createRequire(import.meta.url).resolve('jsonata');
  const w = new Worker(SANDBOX, {
    eval: true,
    workerData: { jsonata: jsonataPath },
    resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 },
  });
  w.unref();
  w.on('message', (m: { id: number; ok: boolean; value?: unknown; error?: string }) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.value);
    else p.reject(new Error(m.error ?? 'invalid expression'));
  });
  const fail = (err: Error) => {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(err);
      pending.delete(id);
    }
    sandbox = null;
  };
  w.on('error', fail);
  w.on('exit', () => fail(new Error('expression stopped')));
  sandbox = w;
  return w;
}

/** Evaluates one expression in the sandbox thread; a timeout kills the thread. */
export function evaluateSandboxed(source: string, input: unknown): Promise<unknown> {
  if (source.length > EXPRESSION_MAX_LENGTH)
    return Promise.reject(new Error('expression is too long'));
  const w = thread();
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('expression took too long'));
      sandbox = null;
      void w.terminate();
    }, TIME_LIMIT_MS);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, source, input });
  });
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let o: Record<string, unknown> = target;
  for (const k of keys.slice(0, -1)) {
    if (typeof o[k] !== 'object' || o[k] === null) o[k] = {};
    o = o[k] as Record<string, unknown>;
  }
  o[keys.at(-1)!] = value;
}

/**
 * Applies a route's expressions to a copy of the record: each target field gets the value of
 * its expression evaluated against the original source record.
 */
export async function applyExpressions<T>(
  record: T,
  expressions: Record<string, string>,
): Promise<T> {
  const entries = Object.entries(expressions).filter(([, e]) => e.trim());
  if (entries.length === 0) return record;
  const out = structuredClone(record) as Record<string, unknown>;
  for (const [field, source] of entries) {
    try {
      setPath(out, field, await evaluateSandboxed(source, record));
    } catch (e) {
      throw new ExpressionError(e instanceof Error ? e.message : 'invalid expression', field);
    }
  }
  return out as T;
}
