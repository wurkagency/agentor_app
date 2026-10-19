import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

/**
 * Key box (produktspecifikation §9.2, ADR 0002).
 *
 * - The KEK is an X25519 key pair. The private half lives only in the worker's KEK file
 *   (0400, outside the webroot); the public half is configuration for the web process.
 * - The web process *seals* a secret to the KEK public key (format `kek-sealed-v1`): it can
 *   write credentials but never read them back.
 * - The worker opens sealed secrets and re-encrypts them under the tenant's DEK
 *   (`dek-aes256gcm-v1`). DEKs are themselves sealed to the KEK, so KEK rotation re-wraps DEKs
 *   only.
 * - Every ciphertext is bound to its row through AES-GCM associated data (tenant, connection),
 *   so a ciphertext copied to another tenant or connection fails to open.
 */

export const SEALED_FORMAT = 'kek-sealed-v1';
export const DEK_FORMAT = 'dek-aes256gcm-v1';

const INFO = Buffer.from('agentor-kek-sealed-v1');
const EPHEMERAL_LEN = 32;
const TAG_LEN = 16;

export interface Envelope {
  format: string;
  nonce: Buffer;
  ciphertext: Buffer;
}

export class KeyboxError extends Error {
  override readonly name = 'KeyboxError';
}

/* ---- Keys ------------------------------------------------------------------------------------ */

/** Raw 32-byte X25519 public key as base64 (KEK_PUBLIC_KEY). */
export function publicKeyFromBase64(b64: string): KeyObject {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32) throw new KeyboxError('KEK public key must be 32 bytes (base64)');
  // SPKI DER prefix for X25519 followed by the raw key.
  const der = Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), raw]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function rawPublic(key: KeyObject): Buffer {
  const der = key.export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32);
}

/**
 * Loads the KEK private key from its file and refuses a file other users can read
 * (on POSIX; Windows development machines have no mode bits to check).
 */
export function loadKekFile(path: string): KeyObject {
  if (process.platform !== 'win32') {
    const mode = statSync(path).mode & 0o077;
    if (mode !== 0) throw new KeyboxError('KEK file must not be readable by group or others');
  }
  return createPrivateKey(readFileSync(path));
}

/** New KEK pair (setup and tests): PEM private key and base64 raw public key. */
export function generateKek(): { privatePem: string; publicB64: string } {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  return {
    privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicB64: rawPublic(publicKey).toString('base64'),
  };
}

export function publicOf(privateKey: KeyObject): string {
  return rawPublic(createPublicKey(privateKey)).toString('base64');
}

/* ---- Sealing to the KEK (web) ---------------------------------------------------------------- */

function aad(parts: readonly string[]): Buffer {
  return Buffer.from(parts.join('\u0000'), 'utf8');
}

function deriveKey(shared: Buffer, ephemeral: Buffer, recipient: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', shared, Buffer.concat([ephemeral, recipient]), INFO, 32));
}

/** Encrypts to the KEK public key. Only the KEK private key can open the result. */
export function seal(
  plaintext: Buffer | string,
  kekPublic: KeyObject,
  bind: readonly string[],
): Envelope {
  const eph = generateKeyPairSync('x25519');
  const ephRaw = rawPublic(eph.publicKey);
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: kekPublic });
  const key = deriveKey(shared, ephRaw, rawPublic(kekPublic));
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(bind));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { format: SEALED_FORMAT, nonce, ciphertext: Buffer.concat([ephRaw, body]) };
}

/** Opens a sealed envelope with the KEK private key (worker only). */
export function open(env: Envelope, kekPrivate: KeyObject, bind: readonly string[]): Buffer {
  if (env.format !== SEALED_FORMAT) throw new KeyboxError(`not a ${SEALED_FORMAT} envelope`);
  if (env.ciphertext.length < EPHEMERAL_LEN + TAG_LEN) throw new KeyboxError('envelope too short');
  const ephRaw = env.ciphertext.subarray(0, EPHEMERAL_LEN);
  const body = env.ciphertext.subarray(EPHEMERAL_LEN);
  const ephPublic = publicKeyFromBase64(ephRaw.toString('base64'));
  const shared = diffieHellman({ privateKey: kekPrivate, publicKey: ephPublic });
  const key = deriveKey(shared, ephRaw, rawPublic(createPublicKey(kekPrivate)));
  return gcmOpen(key, env.nonce, body, bind);
}

function gcmOpen(key: Buffer, nonce: Buffer, body: Buffer, bind: readonly string[]): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(aad(bind));
  decipher.setAuthTag(body.subarray(body.length - TAG_LEN));
  try {
    return Buffer.concat([
      decipher.update(body.subarray(0, body.length - TAG_LEN)),
      decipher.final(),
    ]);
  } catch {
    throw new KeyboxError('envelope does not open (wrong key or row)');
  }
}

/* ---- Tenant DEKs (worker) -------------------------------------------------------------------- */

/** New DEK for a tenant, sealed to the KEK for storage in tenant_keys.wrapped_dek. */
export function newWrappedDek(kekPublic: KeyObject, tenantId: string) {
  const dek = randomBytes(32);
  const sealed = seal(dek, kekPublic, ['dek', tenantId]);
  return { dek, wrapped: Buffer.concat([sealed.nonce, sealed.ciphertext]) };
}

export function unwrapDek(wrapped: Buffer, kekPrivate: KeyObject, tenantId: string): Buffer {
  return open(
    { format: SEALED_FORMAT, nonce: wrapped.subarray(0, 12), ciphertext: wrapped.subarray(12) },
    kekPrivate,
    ['dek', tenantId],
  );
}

export function dekEncrypt(
  plaintext: Buffer | string,
  dek: Buffer,
  bind: readonly string[],
): Envelope {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dek, nonce);
  cipher.setAAD(aad(bind));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { format: DEK_FORMAT, nonce, ciphertext };
}

export function dekDecrypt(env: Envelope, dek: Buffer, bind: readonly string[]): Buffer {
  if (env.format !== DEK_FORMAT) throw new KeyboxError(`not a ${DEK_FORMAT} envelope`);
  return gcmOpen(dek, env.nonce, env.ciphertext, bind);
}

/** Associated data for a connection secret: the row it belongs to. */
export const secretBinding = (tenantId: string, connectionId: string) =>
  ['connection-secret', tenantId, connectionId] as const;
