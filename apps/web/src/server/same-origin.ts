import { env } from './env';

/**
 * Path and query of a URL if it points at this app, otherwise "/". Keeps return URLs from
 * query strings from becoming open redirects or javascript: links.
 */
export function sameOriginPath(url: string): string {
  const base = new URL(env().APP_URL);
  let target: URL;
  try {
    target = new URL(url, base);
  } catch {
    return '/';
  }
  if (target.origin !== base.origin) return '/';
  return `${target.pathname}${target.search}`;
}
