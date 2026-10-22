import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/**
 * The one HTTP client for calls to customer systems (produktspecifikation §9.4):
 * - HTTPS only (plain HTTP only for explicitly allowed development hosts);
 * - DNS is resolved once per connection and the socket connects to that checked address, so a
 *   second resolution can't swap in an internal one (DNS rebinding);
 * - private, loopback, link-local, CGNAT, multicast and metadata addresses are refused, also
 *   after redirects, which are followed manually and re-checked;
 * - timeouts and a maximum response size.
 */

export class SafeHttpError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INSECURE_URL'
      | 'BLOCKED_ADDRESS'
      | 'DNS_FAILED'
      | 'TOO_MANY_REDIRECTS'
      | 'TOO_LARGE'
      | 'TIMEOUT'
      | 'NETWORK',
  ) {
    super(message);
    this.name = 'SafeHttpError';
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['64:ff9b::', 96],
  ['100::', 64],
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');

/** True for addresses an outbound call must never reach. */
export function isBlockedAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 0) return true;
  if (v === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return blocked.check(mapped[1]!, 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return blocked.check(address, 'ipv4');
}

export interface SafeFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** For tests only: replaces the address policy. */
  addressPolicy?: (address: string) => boolean;
  /** For tests only: replaces DNS resolution. */
  resolve?: (host: string) => Promise<LookupAddress[]>;
  /** For tests only: an extra trusted CA for this request (verification stays on). */
  ca?: string;
}

export interface SafeResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  url: string;
  text(): string;
  json<T = unknown>(): T;
}

const defaultResolve = (host: string) =>
  new Promise<LookupAddress[]>((resolve, reject) =>
    dnsLookup(host, { all: true, verbatim: true }, (err, addrs) =>
      err ? reject(err) : resolve(addrs),
    ),
  );

function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeHttpError('invalid URL', 'INSECURE_URL');
  }
  if (url.protocol !== 'https:') throw new SafeHttpError('only HTTPS is allowed', 'INSECURE_URL');
  if (url.username || url.password)
    throw new SafeHttpError('credentials in URL are not allowed', 'INSECURE_URL');
  return url;
}

/**
 * Validates a customer-entered base URL (e.g. a self-hosted WooCommerce) before it is saved:
 * HTTPS, no credentials, and the host must resolve only to public addresses.
 */
export async function validatePublicUrl(
  raw: string,
  opts: Pick<SafeFetchOptions, 'addressPolicy' | 'resolve'> = {},
): Promise<URL> {
  const url = checkUrl(raw);
  await resolveChecked(url.hostname, opts);
  return url;
}

async function resolveChecked(
  host: string,
  opts: Pick<SafeFetchOptions, 'addressPolicy' | 'resolve'>,
): Promise<LookupAddress> {
  const policy = opts.addressPolicy ?? ((a: string) => !isBlockedAddress(a));
  const literal = host.replace(/^\[|\]$/g, '');
  let addrs: LookupAddress[];
  if (isIP(literal)) addrs = [{ address: literal, family: isIP(literal) }];
  else {
    try {
      addrs = await (opts.resolve ?? defaultResolve)(host);
    } catch {
      throw new SafeHttpError(`could not resolve ${host}`, 'DNS_FAILED');
    }
  }
  if (addrs.length === 0) throw new SafeHttpError(`could not resolve ${host}`, 'DNS_FAILED');
  // Every address must be allowed: otherwise a host could mix public and private records.
  if (addrs.some((a) => !policy(a.address)))
    throw new SafeHttpError(`${host} resolves to a blocked address`, 'BLOCKED_ADDRESS');
  return addrs[0]!;
}

function once(
  url: URL,
  opts: SafeFetchOptions,
  pinned: LookupAddress,
): Promise<{ status: number; headers: SafeResponse['headers']; body: Buffer }> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  // The socket connects to the address we checked, whatever DNS says now.
  const lookup: LookupFunction = (_host, options, cb) => {
    if ((options as { all?: boolean }).all) cb(null, [pinned]);
    else cb(null, pinned.address, pinned.family);
  };
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: opts.method ?? 'GET',
        headers: { 'user-agent': 'Agentor/1.0 (+https://agentor.dk)', ...opts.headers },
        lookup,
        timeout: opts.timeoutMs ?? 15_000,
        ...(opts.ca ? { ca: opts.ca } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let tooLarge = false;
        res.on('data', (c: Buffer) => {
          if (tooLarge) return;
          size += c.length;
          if (size > maxBytes) {
            tooLarge = true;
            reject(new SafeHttpError('response too large', 'TOO_LARGE'));
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          if (!tooLarge)
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            });
        });
        res.on('error', (e) => {
          if (!tooLarge) reject(new SafeHttpError(e.message, 'NETWORK'));
        });
      },
    );
    req.on('timeout', () => req.destroy(new SafeHttpError('request timed out', 'TIMEOUT')));
    req.on('error', (e) =>
      reject(e instanceof SafeHttpError ? e : new SafeHttpError(e.message, 'NETWORK')),
    );
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  let url = checkUrl(raw);
  const maxRedirects = opts.maxRedirects ?? 3;
  let method = opts.method ?? 'GET';
  let body = opts.body;
  for (let hop = 0; ; hop++) {
    const pinned = await resolveChecked(url.hostname, opts);
    const res = await once(
      url,
      { ...opts, method, ...(body !== undefined ? { body } : {}) },
      pinned,
    );
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && typeof location === 'string') {
      if (hop >= maxRedirects) throw new SafeHttpError('too many redirects', 'TOO_MANY_REDIRECTS');
      url = checkUrl(new URL(location, url).toString());
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
      }
      continue;
    }
    const finalUrl = url.toString();
    return {
      ...res,
      url: finalUrl,
      text: () => res.body.toString('utf8'),
      json: <T>() => JSON.parse(res.body.toString('utf8')) as T,
    };
  }
}
