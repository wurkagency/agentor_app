/**
 * PNGs of every page of the sample invoice and credit note PDFs (PLAN-EMAILS-PDF §8), for the
 * pull request and for checking the layout against the I01/I02 boards. Renders each PDF with
 * Chromium's own PDF viewer (full Chromium, not the headless shell).
 *   pnpm --filter @agentor/web exec tsx scripts/pdf-screenshots.ts [out-dir]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  creditNotePdf,
  invoicePdf,
  longInvoice,
  SAMPLE_CREDIT_NOTE,
  SAMPLE_EAN_INVOICE,
  SAMPLE_SUBSCRIPTION_INVOICE,
  SAMPLE_SUPPORT_INVOICE,
} from '@agentor/pdf';
import { chromium } from '@playwright/test';

const out =
  process.argv[2] ??
  join(import.meta.dirname, '..', '..', '..', 'docs', 'screenshots', 'emails-pdf');

const DOCS: [string, Buffer][] = [
  ['I01-faktura-support', invoicePdf(SAMPLE_SUPPORT_INVOICE)],
  ['I01-faktura-abonnement', invoicePdf(SAMPLE_SUBSCRIPTION_INVOICE)],
  ['I01-faktura-ean', invoicePdf(SAMPLE_EAN_INVOICE)],
  ['I01-faktura-lang', invoicePdf(longInvoice())],
  ['I02-kreditnota', creditNotePdf(SAMPLE_CREDIT_NOTE)],
];

async function main() {
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PDF_BROWSER ?? 'msedge' });
  try {
    for (const [name, pdf] of DOCS) {
      const file = join(tmpdir(), `${name}.pdf`);
      await writeFile(file, pdf);
      const pages = Number(/\/Count (\d+)/.exec(pdf.toString('latin1'))![1]);
      for (let p = 1; p <= pages; p++) {
        // A fresh tab per page: the viewer ignores a changed #page on the same document.
        const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
        await page.goto(`${pathToFileURL(file).toString()}#page=${p}&toolbar=0&view=Fit`);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: join(out, `${name}-side-${p}.png`) });
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`PDF pages in ${out}`);
}

void main();
