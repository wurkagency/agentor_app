import { describe, expect, it } from 'vitest';
import { activeAppTab, activePlatformTab, platformHidesTabBar } from './tabs';

describe('activeAppTab', () => {
  it('follows the boards', () => {
    expect(activeAppTab('/')).toBe('overview');
    expect(activeAppTab('/notifications')).toBe('overview');
    expect(activeAppTab('/connections/abc/reconnect')).toBe('overview');
    expect(activeAppTab('/integrations/abc/runs/def')).toBe('overview');
    expect(activeAppTab('/integrations')).toBe('integrations');
    expect(activeAppTab('/integrations/abc')).toBe('integrations');
    expect(activeAppTab('/activity')).toBe('activity');
    expect(activeAppTab('/settings/notifications')).toBe('more');
    expect(activeAppTab('/support-access/abc')).toBe('more');
    expect(activeAppTab('/billing')).toBe('more');
    expect(activeAppTab('/more')).toBe('more');
    expect(activeAppTab('/integrationsx')).toBeNull();
  });
});

describe('platform tabs', () => {
  it('maps areas and hides the bar on a case', () => {
    expect(activePlatformTab('/platform/customers')).toBe('customers');
    expect(activePlatformTab('/platform/cases/123')).toBe('cases');
    expect(activePlatformTab('/platform/finance/invoices')).toBe('finance');
    expect(activePlatformTab('/platform/time')).toBeNull();
    expect(platformHidesTabBar('/platform/cases/123')).toBe(true);
    expect(platformHidesTabBar('/platform/cases')).toBe(false);
    expect(platformHidesTabBar('/platform/cases/archive')).toBe(false);
    expect(platformHidesTabBar('/platform/cases/list')).toBe(false);
  });
});
