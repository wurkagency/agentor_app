import { caseStats, errorGroups, listCustomers, listPlans, type CustomerRow } from '@agentor/db';
import { formatMinutes, type Locale } from '@agentor/i18n';
import { cache } from 'react';
import { db } from './infra';

/** Customer list for the staff member, cached per request (P1, cases, time). */
export const customersFor = cache(async (userId: string): Promise<CustomerRow[]> =>
  listCustomers(db(), userId),
);

/** tenantId → name, for cases and time rows. */
export const tenantNames = cache(
  async (userId: string) => new Map((await customersFor(userId)).map((c) => [c.tenantId, c.name])),
);

export const planNames = cache(async () => {
  const plans = await listPlans(db());
  return new Map(plans.map((p) => [p.id, p.name]));
});

export const statsFor = cache(async (userId: string) => caseStats(db(), userId));

export const errorsFor = cache(async (userId: string, days: number) =>
  errorGroups(db(), userId, days),
);

/** The short status lines in the gear menu (P1-Kunder-Menu). */
export async function gearCounts(userId: string, locale: Locale) {
  const [stats, errors] = await Promise.all([statsFor(userId), errorsFor(userId, 1)]);
  return {
    openCases: stats.open,
    mineCases: stats.mine,
    errorTypes: errors.filter((e) => e.customers > 1).length,
    minutesToday: formatMinutes(stats.minutesToday, locale),
  };
}

/** Two-letter initials for customer badges (P1): "Nordlys Cykler ApS" → "NC". */
export function initials(name: string): string {
  const words = name
    .replace(/\s+(ApS|A\/S|I\/S|IVS|K\/S|P\/S)$/i, '')
    .split(/[\s&]+/)
    .filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? words[0]?.[1] ?? '')).toUpperCase();
}
