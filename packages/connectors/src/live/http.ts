import { safeFetch, SafeHttpError } from '@agentor/http';
import { WriteError } from '../adapter.js';

/**
 * The live clients' one door to the network: the SSRF-safe client in production, a fake in
 * tests. Bodies are text, so recorded fixtures can stand in for a real system.
 */
export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string | Buffer;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type Transport = (url: string, req: HttpRequest) => Promise<HttpResponse>;

export const safeTransport: Transport = async (url, req) => {
  const res = await safeFetch(url, {
    method: req.method,
    ...(req.headers ? { headers: req.headers } : {}),
    ...(req.body !== undefined ? { body: req.body } : {}),
    timeoutMs: 30_000,
    maxBytes: 10 * 1024 * 1024,
  });
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers))
    if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  return { status: res.status, headers, body: res.text() };
};

/** A system answered with an error status; `body` is kept short and never holds credentials. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = 'HttpError';
  }
}

export function retryAfter(headers: Record<string, string>, fallbackMs: number): number {
  const v = headers['retry-after'];
  if (v && /^\d+$/.test(v)) return Number(v) * 1000;
  const at = v ? Date.parse(v) : NaN;
  return Number.isFinite(at) ? Math.max(at - Date.now(), 1000) : fallbackMs;
}

/**
 * Maps a failure to the engine's classes (produktspecifikation §4.1): rejected data is never
 * retried, timeouts and 5xx are, 429 waits, and a refused login waits for the connection.
 */
export function toWriteError(e: unknown, rateLimitMs = 60_000): WriteError {
  if (e instanceof WriteError) return e;
  if (e instanceof HttpError) {
    if (e.status === 429)
      return new WriteError(e.message, 'rate_limited', e.retryAfterMs ?? rateLimitMs);
    if (e.status === 401 || e.status === 403) return new WriteError(e.message, 'unauthorized');
    if (e.status >= 400 && e.status < 500) return new WriteError(e.message, 'invalid');
    return new WriteError(e.message, 'transient');
  }
  if (e instanceof SafeHttpError) {
    // An address that resolves to a blocked network is not a passing fault.
    if (e.code === 'BLOCKED_ADDRESS' || e.code === 'INSECURE_URL')
      return new WriteError(e.message, 'unauthorized');
    return new WriteError(e.message, 'transient');
  }
  return new WriteError(e instanceof Error ? e.message : 'unknown error', 'transient');
}

/** Money as the systems send it ("123.45", 123.45) in øre. */
export function ore(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** ISO 8601 in UTC from a GMT timestamp without zone ("2026-10-18T12:00:00"). */
export function gmt(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
