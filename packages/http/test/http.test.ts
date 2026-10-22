import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isBlockedAddress, safeFetch, SafeHttpError, validatePublicUrl } from '../src/index.js';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.1',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    'not-an-ip',
  ])('blocks %s', (a) => expect(isBlockedAddress(a)).toBe(true));

  it.each(['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (a) => expect(isBlockedAddress(a)).toBe(false),
  );
});

describe('URL and DNS checks', () => {
  it('refuses plain HTTP and credentials in the URL', async () => {
    await expect(safeFetch('http://example.com')).rejects.toMatchObject({ code: 'INSECURE_URL' });
    await expect(safeFetch('https://u:p@example.com')).rejects.toMatchObject({
      code: 'INSECURE_URL',
    });
  });

  it('refuses hosts that resolve to private addresses, even when mixed with public ones', async () => {
    const resolve = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ];
    await expect(validatePublicUrl('https://shop.example', { resolve })).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    await expect(safeFetch('https://169.254.169.254/latest/meta-data')).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    await expect(safeFetch('https://[::1]/')).rejects.toBeInstanceOf(SafeHttpError);
  });
});

/**
 * A local HTTPS server stands in for a customer's shop. Its certificate is generated with
 * openssl for this run and trusted only for these requests; the test policy allows loopback.
 */
const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasOpenssl)('requests', () => {
  let server: Server;
  let port = 0;
  let cert = '';
  const opts = () => ({ addressPolicy: (a: string) => a === '127.0.0.1', ca: cert });

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentor-http-'));
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-keyout',
        join(dir, 'key.pem'),
        '-out',
        join(dir, 'cert.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
    cert = readFileSync(join(dir, 'cert.pem'), 'utf8');
    const key = readFileSync(join(dir, 'key.pem'), 'utf8');
    rmSync(dir, { recursive: true, force: true });
    server = createServer({ key, cert }, (req, res) => {
      if (req.url === '/redirect-internal') {
        res.writeHead(302, { location: 'https://10.0.0.1/secret' });
        res.end();
      } else if (req.url === '/big') {
        res.end('x'.repeat(2048));
      } else {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, method: req.method }));
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => server?.close());

  it('fetches JSON over HTTPS', async () => {
    const res = await safeFetch(`https://127.0.0.1:${port}/ok`, opts());
    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ ok: true, method: 'GET' });
  });

  it('re-checks the target of a redirect', async () => {
    await expect(
      safeFetch(`https://127.0.0.1:${port}/redirect-internal`, opts()),
    ).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
  });

  it('enforces the maximum response size', async () => {
    await expect(
      safeFetch(`https://127.0.0.1:${port}/big`, { ...opts(), maxBytes: 1024 }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });
});
