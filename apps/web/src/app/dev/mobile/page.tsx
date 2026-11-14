import { notFound } from 'next/navigation';
import { MobileShowcase } from './showcase';

export const metadata = { title: 'Mobilkomponenter' };

/**
 * Every mobile component in every state (PLAN-MOBILE M1), matched against the MA/MP boards at
 * 360, 390 and 430 px. Never available in production unless AGENTOR_DEV_PAGES=1 is set.
 */
export default function MobileComponentsPage() {
  if (process.env.NODE_ENV === 'production' && process.env.AGENTOR_DEV_PAGES !== '1') notFound();
  return <MobileShowcase />;
}
