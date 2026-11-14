/** Writes the sample PDFs to a folder: tsx scripts/samples.ts <out-dir> */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  creditNotePdf,
  invoicePdf,
  longInvoice,
  SAMPLE_CREDIT_NOTE,
  SAMPLE_EAN_INVOICE,
  SAMPLE_SUBSCRIPTION_INVOICE,
  SAMPLE_SUPPORT_INVOICE,
} from '../src/index.js';

const out = process.argv[2] ?? '.';
mkdirSync(out, { recursive: true });
const files: [string, Buffer][] = [
  ['I01-faktura-support.pdf', invoicePdf(SAMPLE_SUPPORT_INVOICE)],
  ['I01-faktura-abonnement.pdf', invoicePdf(SAMPLE_SUBSCRIPTION_INVOICE)],
  ['I01-faktura-ean.pdf', invoicePdf(SAMPLE_EAN_INVOICE)],
  ['I01-faktura-lang.pdf', invoicePdf(longInvoice())],
  ['I02-kreditnota.pdf', creditNotePdf(SAMPLE_CREDIT_NOTE)],
];
for (const [name, pdf] of files) writeFileSync(join(out, name), pdf);
console.log(files.map(([n, b]) => `${n} ${b.length} B`).join('\n'));
