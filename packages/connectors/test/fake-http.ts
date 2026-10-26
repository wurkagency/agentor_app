import type { HttpRequest, HttpResponse, Transport } from '../src/live/http.js';

/**
 * A recorded system for the live clients' tests: routes are matched on method and path, and
 * every request is kept so a test can check what was sent.
 */
export interface FakeRoute {
  method: HttpRequest['method'];
  path: RegExp;
  reply: (
    m: RegExpExecArray,
    url: URL,
    req: HttpRequest,
  ) => Partial<HttpResponse> & { json?: unknown };
}

export interface Sent {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

export function fakeTransport(routes: FakeRoute[]): { transport: Transport; sent: Sent[] } {
  const sent: Sent[] = [];
  const transport: Transport = async (raw, req) => {
    const url = new URL(raw);
    const body =
      typeof req.body === 'string' && req.body.startsWith('{') ? JSON.parse(req.body) : req.body;
    sent.push({ method: req.method, url, headers: req.headers ?? {}, body });
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.path.exec(url.pathname);
      if (!m) continue;
      const out = r.reply(m, url, req);
      return {
        status: out.status ?? 200,
        headers: out.headers ?? {},
        body: out.json !== undefined ? JSON.stringify(out.json) : (out.body ?? ''),
      };
    }
    return { status: 404, headers: {}, body: JSON.stringify({ code: 'rest_no_route' }) };
  };
  return { transport, sent };
}
