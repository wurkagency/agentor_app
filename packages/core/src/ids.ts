/**
 * UUID v7 (RFC 9562): 48-bit Unix ms timestamp, version 7, variant 10, 74 random bits.
 * Matches app.uuid_v7() in the database; used where ids are generated in the application
 * (e.g. Better Auth records).
 */
export function uuidv7(now: number = Date.now()): string {
  // Web Crypto works in Node and the browser alike.
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
