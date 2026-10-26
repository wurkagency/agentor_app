import {
  creditNotePdf,
  invoicePdf,
  longInvoice,
  SAMPLE_CREDIT_NOTE,
  SAMPLE_EAN_INVOICE,
  SAMPLE_SUBSCRIPTION_INVOICE,
  SAMPLE_SUPPORT_INVOICE,
} from '@agentor/pdf';

/**
 * The I01/I02 sample documents with the boards' data, for checking the layout in a browser.
 * Development only, like /dev/emails.
 */
const SAMPLES: Record<string, () => Buffer> = {
  'faktura-support': () => invoicePdf(SAMPLE_SUPPORT_INVOICE),
  'faktura-abonnement': () => invoicePdf(SAMPLE_SUBSCRIPTION_INVOICE),
  'faktura-ean': () => invoicePdf(SAMPLE_EAN_INVOICE),
  'faktura-lang': () => invoicePdf(longInvoice()),
  kreditnota: () => creditNotePdf(SAMPLE_CREDIT_NOTE),
};

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  if (process.env.NODE_ENV === 'production' && process.env.AGENTOR_DEV_PAGES !== '1')
    return new Response(null, { status: 404 });
  const { name } = await params;
  const make = SAMPLES[name];
  if (!make) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(make()), {
    headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' },
  });
}
