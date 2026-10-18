import type { ReactNode } from 'react';

export const metadata = { title: 'Agentor' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="da">
      <body>{children}</body>
    </html>
  );
}
