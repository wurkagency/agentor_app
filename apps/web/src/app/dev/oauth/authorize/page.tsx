import { notFound } from 'next/navigation';
import { mockSsoEnabled, SSO_PROVIDERS } from '@/server/mock-sso';
import { approveMockSso } from './actions';

/**
 * Mock identity provider's consent page (SSO_MODE=mock, e2e and development only). Stands in for
 * Google's or Microsoft's account chooser. Fictional identities only.
 */
export default async function MockAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (!mockSsoEnabled()) notFound();
  const p = await searchParams;
  const provider = SSO_PROVIDERS.find((x) => x === p.provider);
  if (!provider || !p.redirect_uri || !p.state) notFound();
  const label = provider === 'google' ? 'Google' : 'Microsoft';
  return (
    <main className="mx-auto flex max-w-focus flex-col gap-4 p-8">
      <h1 className="m-0 text-section">Test-login · {label}</h1>
      <p className="m-0 text-fg-2">Lokal testudbyder. Bruges kun i udvikling og test.</p>
      <form action={approveMockSso} className="flex flex-col gap-3">
        <input type="hidden" name="provider" value={provider} />
        <input type="hidden" name="redirect_uri" value={p.redirect_uri} />
        <input type="hidden" name="state" value={p.state} />
        <label className="flex flex-col gap-1">
          <span>Navn</span>
          <input
            name="name"
            defaultValue="Mette Holm"
            className="rounded-sm border border-border-strong p-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>E-mail</span>
          <input
            name="email"
            type="email"
            defaultValue="mette@nordlys-cykler.dk"
            className="rounded-sm border border-border-strong p-2"
          />
        </label>
        <button type="submit" className="rounded-full bg-primary p-3 font-semibold text-fg-1">
          Fortsæt som testbruger
        </button>
      </form>
    </main>
  );
}
