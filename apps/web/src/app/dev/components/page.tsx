import { notFound } from 'next/navigation';
import { Showcase } from './showcase';

export const metadata = { title: 'Komponenter' };

/**
 * Component sheet rendered from the real components, matched against
 * docs/design/runde-1/boards/Komponenter-*.dc.html. Never available in production unless
 * AGENTOR_DEV_PAGES=1 is set explicitly (used by the screenshot tests).
 */
export default function ComponentsPage() {
  if (process.env.NODE_ENV === 'production' && process.env.AGENTOR_DEV_PAGES !== '1') notFound();
  return <Showcase />;
}
