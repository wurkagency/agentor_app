import { describe, expect, it } from 'vitest';
import { activeAppTab, activePlatformTab, platformHidesTabBar } from './tabs';

describe('activeAppTab', () => {
  it('follows the boards', () => {
    expect(activeAppTab('/')).toBe('overview');
    expect(activeAppTab('/notifications')).toBe('overview');
    expect(activeAppTab('/connections/abc/reconnect')).toBe('overview');
    expect(activeAppTab('/connections')).toBe('more');
    expect(activeAppTab('/connections/new')).toBe('more');
    expect(activeAppTab('/integrations/abc/runs/def')).toBe('overview');
    expect(activeAppTab('/integrations')).toBe('integrations');
    expect(activeAppTab('/integrations/abc')).toBe('integrations');
    expect(activeAppTab('/activity')).toBe('activity');
    expect(activeAppTab('/settings/notifications')).toBe('more');
    expect(activeAppTab('/support-access/abc')).toBe('more');
    expect(activeAppTab('/billing')).toBe('more');
    expect(activeAppTab('/more')).toBe('more');
    expect(activeAppTab('/profile')).toBe('profile');
    expect(activeAppTab('/integrationsx')).toBeNull();
  });
});

describe('platform tabs', () => {
  it('maps the sitemap v2 areas and hides the bar on a case', () => {
    expect(activePlatformTab('/platform')).toBe('customers');
    expect(activePlatformTab('/platform/customers/abc')).toBe('customers');
    expect(activePlatformTab('/platform/support/cases/123')).toBe('support');
    expect(activePlatformTab('/platform/support/access')).toBe('support');
    expect(activePlatformTab('/platform/support/time')).toBe('support');
    expect(activePlatformTab('/platform/finance/invoices')).toBe('finance');
    expect(activePlatformTab('/platform/admin/users')).toBe('admin');
    expect(activePlatformTab('/platform/admin/product')).toBe('admin');
    expect(activePlatformTab('/platform/profile')).toBe('profile');
    expect(activePlatformTab('/platform/supportx')).toBeNull();
    expect(platformHidesTabBar('/platform/support/cases/123')).toBe(true);
    expect(platformHidesTabBar('/platform/support/cases/123/resolve')).toBe(true);
    expect(platformHidesTabBar('/platform/support/cases')).toBe(false);
    expect(platformHidesTabBar('/platform/support/cases/export')).toBe(false);
  });
});
