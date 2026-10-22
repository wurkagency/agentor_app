/**
 * Renders the hosted e-mail images (README decision 26: logo as PNG at 2x, no SVG in mail) into
 * public/email/. Run after changing the logo or an icon: pnpm --filter @agentor/web exec tsx
 * scripts/email-assets.ts
 */
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const out = join(import.meta.dirname, '..', 'public', 'email');
const logo = readFileSync(
  join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'packages',
    'email',
    'assets',
    'agentor-logotype.svg',
  ),
  'utf8',
);

/** Lucide icons as on the boards (24 × 24 viewBox). */
const ICONS: Record<string, { size: number; stroke: string; width: string; body: string }> = {
  clock: {
    size: 14,
    stroke: '#6B6B67',
    width: '2',
    body: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  },
  file: {
    size: 20,
    stroke: '#1A1A18',
    width: '1.75',
    body: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  },
};
const SHIELD =
  '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>';
for (const [kind, stroke] of [
  ['info', '#2B5C8A'],
  ['warning', '#8A520D'],
  ['error', '#B42318'],
] as const)
  ICONS[`shield-${kind}`] = { size: 18, stroke, width: '2', body: SHIELD };

async function main() {
  await mkdir(out, { recursive: true });
  for (const [variant, fill] of [
    ['dark', '#1A1A18'],
    ['light', '#F2F0EB'],
  ] as const) {
    const svg = logo.replace(/fill:\s*#[0-9a-fA-F]{3,6}/g, `fill: ${fill}`);
    // 112 × 27 in the mail, rendered at 2x.
    await sharp(Buffer.from(svg), { density: 600 })
      .resize(224, 54, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(join(out, `agentor-logo-${variant}@2x.png`));
  }
  for (const [name, i] of Object.entries(ICONS)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${i.size * 2}" height="${i.size * 2}" viewBox="0 0 24 24" fill="none" stroke="${i.stroke}" stroke-width="${i.width}" stroke-linecap="round" stroke-linejoin="round">${i.body}</svg>`;
    await sharp(Buffer.from(svg), { density: 300 })
      .resize(i.size * 2, i.size * 2)
      .png({ compressionLevel: 9 })
      .toFile(join(out, `${name}.png`));
  }
  console.log('e-mail images written to', out);
}

void main();
