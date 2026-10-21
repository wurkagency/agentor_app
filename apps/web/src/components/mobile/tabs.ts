/**
 * Which tab is active on which route, as on the boards: pages reached from Overblik (MA06 Fejl,
 * MA08 Genforbind, MA09 Notifikationer) keep Overblik lit, settings reached from Mere keep Mere.
 */
export type AppTab = 'overview' | 'integrations' | 'activity' | 'more' | 'profile';
export type PlatformTab = 'customers' | 'support' | 'finance' | 'admin' | 'profile';

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export function activeAppTab(path: string): AppTab | null {
  // MA26/MA27 Forbindelser are reached from Mere; MA08 Genforbind from the problems on Overblik.
  if (path === '/connections' || under(path, '/connections/new')) return 'more';
  if (path === '/' || under(path, '/notifications') || under(path, '/connections'))
    return 'overview';
  // A run's failure (MA06) is opened from the problems on Overblik.
  if (/^\/integrations\/[^/]+\/runs\//.test(path)) return 'overview';
  if (under(path, '/integrations')) return 'integrations';
  if (under(path, '/activity')) return 'activity';
  // MA36 Min profil (MX1: Profil last).
  if (under(path, '/profile')) return 'profile';
  if (
    ['/more', '/settings', '/billing', '/support', '/support-access', '/install'].some((p) =>
      under(path, p),
    )
  )
    return 'more';
  return null;
}

export function activePlatformTab(path: string): PlatformTab | null {
  // Sitemap v2 (README decision 24): Kunder · Support · Finans · Admin · Profil.
  if (under(path, '/platform/customers') || path === '/platform') return 'customers';
  if (under(path, '/platform/support')) return 'support';
  if (under(path, '/platform/finance')) return 'finance';
  if (under(path, '/platform/admin')) return 'admin';
  if (under(path, '/platform/profile')) return 'profile';
  return null;
}

/** A case (MP03) shows its timer bar instead of the tab bar. */
export function platformHidesTabBar(path: string): boolean {
  return /^\/platform\/support\/cases\/(?!export(\/|$))[^/?]+/.test(path);
}
