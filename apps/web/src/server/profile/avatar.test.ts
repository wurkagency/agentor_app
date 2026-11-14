import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { AVATAR_MAX_BYTES, AvatarRejected, avatarKey, processAvatar, sniff } from './avatar';

const image = (width: number, height: number, format: 'png' | 'jpeg' | 'gif' = 'png') =>
  sharp({ create: { width, height, channels: 3, background: '#1e3a5f' } })
    .toFormat(format)
    .toBuffer();

const rejected = async (p: Promise<unknown>) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AvatarRejected);
  return (err as AvatarRejected).code;
};

describe('processAvatar', () => {
  it('turns a PNG or JPEG into a 512 × 512 WebP', async () => {
    for (const format of ['png', 'jpeg'] as const) {
      const out = await processAvatar(await image(800, 600, format));
      const meta = await sharp(out.webp).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', 512, 512]);
      expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('drops EXIF, GPS included, and turns the photo upright', async () => {
    // 600 wide × 300 high, stored with orientation 6 (rotate 90°): shown 300 × 600.
    const jpeg = await sharp(await image(600, 300, 'jpeg'))
      .withMetadata({
        orientation: 6,
        exif: { IFD0: { Make: 'Kamera' }, IFD3: { GPSLatitudeRef: 'N' } },
      })
      .jpeg()
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const meta = await sharp((await processAvatar(jpeg)).webp).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it('refuses small, large, unknown and disguised files', async () => {
    expect(await rejected(processAvatar(await image(255, 400)))).toBe('TOO_SMALL');
    expect(await rejected(processAvatar(Buffer.alloc(AVATAR_MAX_BYTES + 1)))).toBe('TOO_LARGE');
    expect(await rejected(processAvatar(await image(300, 300, 'gif')))).toBe('TYPE');
    expect(
      await rejected(processAvatar(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))),
    ).toBe('TYPE');
    // A PNG signature on a broken file.
    const broken = Buffer.concat([(await image(300, 300)).subarray(0, 8), Buffer.alloc(200)]);
    expect(await rejected(processAvatar(broken))).toBe('UNREADABLE');
  });
});

describe('sniff and avatarKey', () => {
  it('reads the type from the bytes', async () => {
    expect(sniff(await image(10, 10, 'png'))).toBe('png');
    expect(sniff(await image(10, 10, 'jpeg'))).toBe('jpeg');
    expect(sniff(Buffer.from('GIF89a'))).toBeNull();
  });

  it('names the file by user and content hash', () => {
    const user = '0190b000-0000-7000-8000-000000000103';
    expect(avatarKey(user, 'f'.repeat(64))).toBe(`avatars/${user}/${'f'.repeat(64)}.webp`);
  });
});
