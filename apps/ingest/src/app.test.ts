import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const app = buildApp();
afterAll(() => app.close());

describe('ingest server', () => {
  it('answers health checks', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('answers unknown hook paths with an empty 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/hooks/does-not-exist',
      payload: { a: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('');
  });

  it('refuses bodies above 1 MiB', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/hooks/x',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ blob: 'x'.repeat(1024 * 1024 + 10) }),
    });
    expect(res.statusCode).toBe(413);
  });
});
