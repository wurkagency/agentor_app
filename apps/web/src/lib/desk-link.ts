import { safeNext } from './safe-next';

/**
 * Pages that "Send link til min computer" may point to (README decision 20). Only app paths: the
 * link is e-mailed to the signed-in user themself, and the page checks access when it is opened.
 */
const PREFIXES = [
  '/integrations',
  '/connections',
  '/activity',
  '/settings',
  '/billing',
  '/support',
  '/notifications',
  '/onboarding',
  '/platform',
];

export function deskLinkPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  const path = safeNext(value);
  if (path !== value) return null;
  if (path === '/') return path;
  const bare = path.split(/[?#]/, 1)[0]!;
  return PREFIXES.some((p) => bare === p || bare.startsWith(`${p}/`)) ? path : null;
}
