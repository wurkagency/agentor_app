import { createPrivateKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  dekDecrypt,
  dekEncrypt,
  generateKek,
  newWrappedDek,
  open,
  publicKeyFromBase64,
  publicOf,
  seal,
  secretBinding,
  unwrapDek,
} from '../src/index.js';

const kek = generateKek();
const priv = createPrivateKey(kek.privatePem);
const pub = publicKeyFromBase64(kek.publicB64);
const T = '0190a000-0000-7000-8000-00000000000a';
const C = '0190a000-0000-7000-8000-0000000a4001';

describe('sealing to the KEK', () => {
  it('round-trips with the private key', () => {
    const env = seal('dinero-api-key-123', pub, secretBinding(T, C));
    expect(env.format).toBe('kek-sealed-v1');
    expect(env.ciphertext.toString()).not.toContain('dinero-api-key-123');
    expect(open(env, priv, secretBinding(T, C)).toString()).toBe('dinero-api-key-123');
  });

  it('cannot be opened for another row or with another KEK', () => {
    const env = seal('x', pub, secretBinding(T, C));
    expect(() => open(env, priv, secretBinding(T, T))).toThrow(/does not open/);
    const other = createPrivateKey(generateKek().privatePem);
    expect(() => open(env, other, secretBinding(T, C))).toThrow(/does not open/);
  });

  it('refuses a truncated authentication tag', () => {
    const env = seal('x', pub, secretBinding(T, C));
    env.ciphertext = env.ciphertext.subarray(0, env.ciphertext.length - 4);
    expect(() => open(env, priv, secretBinding(T, C))).toThrow();
  });

  it('detects tampering', () => {
    const env = seal('x', pub, secretBinding(T, C));
    env.ciphertext[env.ciphertext.length - 1]! ^= 1;
    expect(() => open(env, priv, secretBinding(T, C))).toThrow();
  });

  it('derives the configured public key from the private file', () => {
    expect(publicOf(priv)).toBe(kek.publicB64);
    expect(() => publicKeyFromBase64('c2hvcnQ=')).toThrow(/32 bytes/);
  });
});

describe('tenant DEKs', () => {
  it('wraps a DEK per tenant and encrypts secrets under it', () => {
    const { dek, wrapped } = newWrappedDek(pub, T);
    expect(unwrapDek(wrapped, priv, T).equals(dek)).toBe(true);
    expect(() => unwrapDek(wrapped, priv, C)).toThrow();
    const env = dekEncrypt('secret', dek, secretBinding(T, C));
    expect(dekDecrypt(env, dek, secretBinding(T, C)).toString()).toBe('secret');
    expect(() => dekDecrypt(env, dek, secretBinding(C, T))).toThrow();
  });
});
