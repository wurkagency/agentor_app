import { createHash } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';

/**
 * Profile photo (PR1/D15 "Profilbillede"): PNG or JPEG, at least 256 × 256 px, at most 5 MB. The
 * type is checked from the file's own bytes, never the browser's word for it. The stored file is
 * a 512 × 512 WebP, turned upright from the EXIF orientation and with all metadata (EXIF, GPS,
 * camera) removed.
 */

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_MIN_SIDE = 256;
export const AVATAR_SIZE = 512;

export type AvatarError = 'TOO_LARGE' | 'TYPE' | 'TOO_SMALL' | 'UNREADABLE';

export class AvatarRejected extends Error {
  constructor(readonly code: AvatarError) {
    super(code);
    this.name = 'AvatarRejected';
  }
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

export function sniff(buf: Buffer): 'png' | 'jpeg' | null {
  const starts = (sig: number[]) => sig.every((b, i) => buf[i] === b);
  if (buf.length >= 8 && starts(PNG)) return 'png';
  if (buf.length >= 3 && starts(JPEG)) return 'jpeg';
  return null;
}

export async function processAvatar(
  input: Buffer,
): Promise<{ webp: Buffer; sha256: string; width: number; height: number }> {
  if (input.length > AVATAR_MAX_BYTES) throw new AvatarRejected('TOO_LARGE');
  const type = sniff(input);
  if (!type) throw new AvatarRejected('TYPE');
  let meta: Metadata;
  try {
    meta = await sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 }).metadata();
  } catch {
    throw new AvatarRejected('UNREADABLE');
  }
  if (meta.format !== type) throw new AvatarRejected('TYPE');
  // Width/height as shown, after EXIF rotation.
  const swap = (meta.orientation ?? 1) >= 5;
  const w = (swap ? meta.height : meta.width) ?? 0;
  const h = (swap ? meta.width : meta.height) ?? 0;
  if (w < AVATAR_MIN_SIDE || h < AVATAR_MIN_SIDE) throw new AvatarRejected('TOO_SMALL');
  let webp: Buffer;
  try {
    // sharp writes no metadata unless asked to (no withMetadata/keepExif), so EXIF is dropped.
    webp = await sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new AvatarRejected('UNREADABLE');
  }
  return {
    webp,
    sha256: createHash('sha256').update(webp).digest('hex'),
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  };
}

export const avatarKey = (userId: string, sha256: string) => `avatars/${userId}/${sha256}.webp`;
