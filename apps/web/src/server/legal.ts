import type { AcceptedDocument } from '@agentor/db';
import { env, isProduction } from './env';

/**
 * Terms accepted on the payment step (PLAN-SIGNUP B6, B12): Abonnementsbetingelser and
 * Privatlivspolitik live on agentor.dk and are shown in a modal. The version stored with the
 * acceptance is the one the page itself shows, read when the owner accepts:
 *
 *   <meta name="agentor-document-version" content="2026-11-01">
 *
 * FOLLOW-UP (T3): the real URLs, the agreed meta tag, and whether the DPA is accepted here too.
 * Until then development and tests use LEGAL_DEV_VERSION, and production refuses to accept.
 */

export class LegalUnavailableError extends Error {
  constructor() {
    super('LEGAL_UNAVAILABLE');
    this.name = 'LegalUnavailableError';
  }
}

const VERSION_META =
  /<meta\s+[^>]*name=["']agentor-document-version["'][^>]*content=["']([^"']{1,80})["'][^>]*>/i;
const VERSION_META_REVERSED =
  /<meta\s+[^>]*content=["']([^"']{1,80})["'][^>]*name=["']agentor-document-version["'][^>]*>/i;

/** Only agentor.dk serves the documents; no redirects elsewhere. */
function allowed(url: string): boolean {
  const u = new URL(url);
  return (
    u.protocol === 'https:' && (u.hostname === 'agentor.dk' || u.hostname === 'www.agentor.dk')
  );
}

export function parseDocumentVersion(html: string): string | null {
  const m = VERSION_META.exec(html) ?? VERSION_META_REVERSED.exec(html);
  const v = m?.[1]?.trim();
  return v && /^[\w.\-: ]{1,80}$/.test(v) ? v : null;
}

async function versionOf(url: string): Promise<string> {
  if (!allowed(url)) throw new LegalUnavailableError();
  const res = await fetch(url, {
    headers: { Accept: 'text/html' },
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  }).catch(() => null);
  if (!res?.ok) throw new LegalUnavailableError();
  const version = parseDocumentVersion((await res.text()).slice(0, 200_000));
  if (!version) throw new LegalUnavailableError();
  return version;
}

export interface LegalLinks {
  subscriptionTerms: string | null;
  privacy: string | null;
}

/** Links for the modal; null shows the placeholder ("[Abonnementsbetingelser]"). */
export function legalLinks(): LegalLinks {
  const e = env();
  return {
    subscriptionTerms: e.LEGAL_SUBSCRIPTION_TERMS_URL ?? null,
    privacy: e.LEGAL_PRIVACY_URL ?? null,
  };
}

/** The two documents with the versions agentor.dk shows right now. */
export async function currentTermsForAcceptance(): Promise<AcceptedDocument[]> {
  const e = env();
  const docs: { document: AcceptedDocument['document']; url: string | undefined }[] = [
    { document: 'subscription_terms', url: e.LEGAL_SUBSCRIPTION_TERMS_URL },
    { document: 'privacy_policy', url: e.LEGAL_PRIVACY_URL },
  ];
  return Promise.all(
    docs.map(async (d) => {
      if (!d.url) {
        // No document yet: only outside production, and marked as such in the stored version.
        if (isProduction() || !e.LEGAL_DEV_VERSION) throw new LegalUnavailableError();
        return { document: d.document, url: 'about:blank', version: `dev:${e.LEGAL_DEV_VERSION}` };
      }
      return { document: d.document, url: d.url, version: await versionOf(d.url) };
    }),
  );
}
