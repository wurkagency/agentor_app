import { BOARD, EMAIL_KEYS, renderEmail, SAMPLES, SAMPLE_NOW, type EmailKey } from '@agentor/email';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { env } from '@/server/env';
import { PreviewFrame } from './preview-frame';

export const metadata = { title: 'E-mails' };

/**
 * Every e-mail template (E01–E22) with the boards' sample data: subject, preheader, the HTML in
 * light and dark mode and the text version. Development only, like /dev/components.
 */
export default async function EmailsPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; lang?: string }>;
}) {
  if (process.env.NODE_ENV === 'production' && process.env.AGENTOR_DEV_PAGES !== '1') notFound();
  const sp = await searchParams;
  const key = (EMAIL_KEYS as string[]).includes(sp.key ?? '')
    ? (sp.key as EmailKey)
    : EMAIL_KEYS[0]!;
  const lang = sp.lang === 'en' ? 'en' : 'da';
  // Images are served by this app, so the preview links to its own origin.
  const mail = renderEmail(key, SAMPLES[key] as never, {
    appUrl: env().APP_URL,
    locale: lang,
    now: SAMPLE_NOW,
  });
  return (
    <div className="flex min-h-screen bg-canvas text-fg-1">
      <nav className="w-64 shrink-0 border-r border-border bg-surface p-4" aria-label="E-mails">
        <h1 className="mb-3 text-sm font-semibold">E-mails</h1>
        <ul className="space-y-1">
          {EMAIL_KEYS.map((k) => (
            <li key={k}>
              <Link
                href={`/dev/emails?key=${k}&lang=${lang}`}
                aria-current={k === key ? 'page' : undefined}
                className="block rounded-md px-2 py-1 text-sm hover:bg-bg-base aria-[current=page]:bg-bg-base aria-[current=page]:font-semibold"
              >
                <span className="font-mono text-xs text-fg-2">{BOARD[k]}</span> {k}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="min-w-0 flex-1 space-y-6 p-6">
        <header className="space-y-1">
          <p className="font-mono text-xs text-fg-2">
            {BOARD[key]} · {key} ·{' '}
            <Link
              className="underline"
              href={`/dev/emails?key=${key}&lang=${lang === 'da' ? 'en' : 'da'}`}
            >
              {lang === 'da' ? 'English' : 'Dansk'}
            </Link>
          </p>
          <p className="text-lg font-semibold" data-testid="email-subject">
            {mail.subject}
          </p>
          <p className="text-sm text-fg-2" data-testid="email-preheader">
            {mail.preheader}
          </p>
        </header>
        <div className="grid gap-6 xl:grid-cols-2">
          <section aria-label="Lys tilstand">
            <h2 className="mb-2 text-xs font-semibold uppercase text-fg-2">Lys</h2>
            <PreviewFrame html={mail.html} scheme="light" title={`${key} lys`} />
          </section>
          <section aria-label="Mørk tilstand">
            <h2 className="mb-2 text-xs font-semibold uppercase text-fg-2">Mørk</h2>
            <PreviewFrame html={mail.html} scheme="dark" title={`${key} mørk`} />
          </section>
        </div>
        <section aria-label="Tekstversion">
          <h2 className="mb-2 text-xs font-semibold uppercase text-fg-2">Tekst</h2>
          <pre
            className="whitespace-pre-wrap rounded-lg border border-border bg-surface p-4 font-mono text-xs"
            data-testid="email-text"
          >
            {mail.text}
          </pre>
        </section>
      </main>
    </div>
  );
}
