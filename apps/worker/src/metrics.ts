import { createServer, type Server } from 'node:http';

/**
 * Prometheus metrics for the worker (produktspecifikation §10.3), in the text exposition format
 * without a client library. Labels are low-cardinality only: never a tenant, flow or record.
 */
export class Metrics {
  private counters = new Map<string, number>();
  private sums = new Map<string, { sum: number; count: number }>();
  private help = new Map<string, string>();

  describe(name: string, help: string) {
    this.help.set(name, help);
  }

  inc(name: string, labels: Record<string, string> = {}, by = 1) {
    const key = series(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  observe(name: string, labels: Record<string, string>, value: number) {
    const key = series(name, labels);
    const s = this.sums.get(key) ?? { sum: 0, count: 0 };
    s.sum += value;
    s.count += 1;
    this.sums.set(key, s);
  }

  render(): string {
    const out: string[] = [];
    const typed = new Set<string>();
    const head = (name: string, type: string) => {
      if (typed.has(name)) return;
      typed.add(name);
      const h = this.help.get(name);
      if (h) out.push(`# HELP ${name} ${h}`);
      out.push(`# TYPE ${name} ${type}`);
    };
    for (const [key, v] of [...this.counters].sort()) {
      head(key.split('{')[0]!, 'counter');
      out.push(`${key} ${v}`);
    }
    for (const [key, s] of [...this.sums].sort()) {
      const [name, rest] = [key.split('{')[0]!, key.slice(key.split('{')[0]!.length)];
      head(name, 'summary');
      out.push(`${name}_sum${rest} ${s.sum}`, `${name}_count${rest} ${s.count}`);
    }
    return `${out.join('\n')}\n`;
  }
}

function series(name: string, labels: Record<string, string>): string {
  const l = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v.replace(/["\\\n]/g, '_')}"`)
    .join(',');
  return l ? `${name}{${l}}` : name;
}

/** Serves /metrics on localhost only; Prometheus scrapes it on the server. */
export function serveMetrics(metrics: Metrics, port: number, host = '127.0.0.1'): Server {
  const server = createServer((req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }).end(metrics.render());
  });
  server.listen(port, host);
  return server;
}

export const metrics = new Metrics();
metrics.describe('agentor_jobs_total', 'Jobs processed by queue, name and result.');
metrics.describe('agentor_job_seconds', 'Job duration in seconds by queue and name.');
metrics.describe('agentor_records_total', 'Records processed by outcome and failure.');
metrics.describe('agentor_rate_limit_waits_total', 'Writes that waited for a rate limit.');
metrics.describe('agentor_echoes_total', 'Source changes dropped as our own writes.');
metrics.describe('agentor_duplicates_total', 'Source versions dropped by the idempotency key.');
