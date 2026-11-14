'use client';

import { useRef } from 'react';

/**
 * One rendered e-mail in a sandboxed iframe. The iframe's colour scheme decides
 * prefers-color-scheme inside it, so the same HTML shows its light and dark mode.
 */
export function PreviewFrame({
  html,
  scheme,
  title,
}: {
  html: string;
  scheme: 'light' | 'dark';
  title: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={html}
      sandbox="allow-same-origin"
      className="block h-screen w-full rounded-lg border border-border"
      style={{ colorScheme: scheme }}
      onLoad={() => {
        const f = ref.current;
        const doc = f?.contentDocument;
        if (f && doc) f.style.height = `${doc.documentElement.scrollHeight}px`;
      }}
    />
  );
}
