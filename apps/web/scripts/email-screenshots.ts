/**
 * Screenshots of every e-mail (E01–E22) in light and dark mode at 600 px, with the boards'
 * sample data (PLAN-EMAILS-PDF §8). Images are loaded from the running dev server (APP_URL,
 * default http://localhost:3000), so start it first.
 *   pnpm --filter @agentor/web exec tsx scripts/email-screenshots.ts [out-dir]
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BOARD, EMAIL_KEYS, renderEmail, SAMPLES, SAMPLE_NOW } from '@agentor/email';
import { chromium } from '@playwright/test';

const out =
  process.argv[2] ?? join(import.meta.dirname, '..', '..', '..', 'docs', 'screenshots', 'emails-pdf');
const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

async function main() {
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const scheme of ['light', 'dark'] as const) {
      const page = await browser.newPage({ viewport: { width: 680, height: 900 }, colorScheme: scheme });
      for (const key of EMAIL_KEYS) {
        const mail = renderEmail(key, SAMPLES[key] as never, { appUrl, now: SAMPLE_NOW });
        await page.setContent(mail.html, { waitUntil: 'networkidle' });
        await page.screenshot({ path: join(out, `${BOARD[key]}-${key}-${scheme}.png`), fullPage: true });
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`${EMAIL_KEYS.length * 2} screenshots in ${out}`);
}

void main();
