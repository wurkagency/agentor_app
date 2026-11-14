'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Desktop branch of a route that only exists as a mobile screen (PLAN-MOBILE §1): from 768 px it
 * replaces the URL with the desktop page for the same thing, so a link sent from a phone works on
 * the computer too. The link is the fallback without JavaScript.
 */
export function DesktopRedirect({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  useEffect(() => {
    if (window.matchMedia('(min-width: 768px)').matches) router.replace(href);
  }, [href, router]);
  return (
    <main id="main" className="flex flex-1 items-center justify-center p-8">
      <a href={href} className="text-body font-semibold text-fg-1">
        {label}
      </a>
    </main>
  );
}
