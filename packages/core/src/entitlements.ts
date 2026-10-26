/**
 * Entitlements: plan limits are data (plan_entitlements), this is only the arithmetic over them
 * (produktspecifikation §11, D2). `null` means unlimited.
 */

export type Limit = number | null;

export interface PlanFeatures {
  included: string[];
  excluded: string[];
}

export interface Entitlements {
  integrationSets: Limit;
  destinationsPerFlow: Limit;
  transactionsPerMonth: Limit;
  seats: Limit;
  pollingIntervalMinutes: number;
  payloadRetentionDays: number;
  runHistoryMonths: number;
  auditRetentionMonths: number;
  overagePriceOrePer1000: number;
  quotaGraceDays: number;
  features: PlanFeatures;
  recommendedForOrders: string[];
  /** Most systems (SU3) the plan is recommended for; null = no upper bound. */
  recommendedForSystems: Limit;
  /** Prøveperiode in days (A2); null = by agreement, absent = not set yet. */
  trialDays?: Limit;
}

const KEYS: Record<string, keyof Entitlements> = {
  integration_sets: 'integrationSets',
  destinations_per_flow: 'destinationsPerFlow',
  transactions_per_month: 'transactionsPerMonth',
  seats: 'seats',
  polling_interval_minutes: 'pollingIntervalMinutes',
  payload_retention_days: 'payloadRetentionDays',
  run_history_months: 'runHistoryMonths',
  audit_retention_months: 'auditRetentionMonths',
  overage_price_ore_per_1000: 'overagePriceOrePer1000',
  quota_grace_days: 'quotaGraceDays',
  features: 'features',
  recommended_for_orders: 'recommendedForOrders',
  recommended_for_systems: 'recommendedForSystems',
  trial_days: 'trialDays',
};

const LIMIT_KEYS = new Set<keyof Entitlements>([
  'integrationSets',
  'destinationsPerFlow',
  'transactionsPerMonth',
  'seats',
  'recommendedForSystems',
]);

function isLimit(v: unknown): v is Limit {
  return v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0);
}

/**
 * Builds a plan's entitlements from its rows. A missing or malformed row fails loudly: a guard
 * that silently fell back to "unlimited" would give away the product.
 */
export function parseEntitlements(rows: readonly { key: string; value: unknown }[]): Entitlements {
  const out: Partial<Record<keyof Entitlements, unknown>> = {};
  for (const { key, value } of rows) {
    const k = KEYS[key];
    if (k) out[k] = value;
  }
  for (const k of Object.values(KEYS)) {
    const v = out[k];
    if (k === 'trialDays') {
      // Optional: shown on A2 when set, never assumed.
      if (k in out && !isLimit(v)) throw new Error(`entitlement ${k} malformed`);
    } else if (k === 'features') {
      const f = v as PlanFeatures | undefined;
      if (!f || !Array.isArray(f.included) || !Array.isArray(f.excluded))
        throw new Error(`entitlement ${k} missing`);
    } else if (k === 'recommendedForOrders') {
      if (!Array.isArray(v)) throw new Error(`entitlement ${k} missing`);
    } else if (LIMIT_KEYS.has(k)) {
      if (!(k in out) || !isLimit(v)) throw new Error(`entitlement ${k} missing`);
    } else if (typeof v !== 'number') {
      throw new Error(`entitlement ${k} missing`);
    }
  }
  return out as unknown as Entitlements;
}

/** Fraction used, 0..∞; 0 for unlimited. */
export function usageRatio(used: number, limit: Limit): number {
  if (limit === null) return 0;
  if (limit === 0) return used > 0 ? Infinity : 0;
  return used / limit;
}

export function withinLimit(used: number, limit: Limit): boolean {
  return limit === null || used <= limit;
}

/** Whether one more of something fits (seats, integration sets, destinations). */
export function canAdd(used: number, limit: Limit, adding = 1): boolean {
  return limit === null || used + adding <= limit;
}

export type QuotaLevel = 'ok' | 'warn' | 'over' | 'needsAddon';

export interface QuotaState {
  used: number;
  /** Plan quota plus add-ons bought for the period; null = unlimited. */
  limit: Limit;
  ratio: number;
  level: QuotaLevel;
  /** When the 7-day grace ends (level 'over'), or ended ('needsAddon'). */
  graceEndsAt: Date | null;
}

export const QUOTA_WARN_RATIO = 0.8;

/**
 * Transaction quota (D2): at 80 % the customer is warned; at 100 % operation continues for the
 * grace period with notice, and after that further Live writes need an add-on. Operation is never
 * paused silently: callers surface 'over' and 'needsAddon' as banners and notifications.
 */
export function quotaState(input: {
  used: number;
  planLimit: Limit;
  addonTransactions: number;
  exceededAt: Date | null;
  graceDays: number;
  now: Date;
}): QuotaState {
  const limit = input.planLimit === null ? null : input.planLimit + input.addonTransactions;
  const ratio = usageRatio(input.used, limit);
  if (limit === null || ratio < QUOTA_WARN_RATIO)
    return { used: input.used, limit, ratio, level: 'ok', graceEndsAt: null };
  if (ratio < 1) return { used: input.used, limit, ratio, level: 'warn', graceEndsAt: null };
  const since = input.exceededAt ?? input.now;
  const graceEndsAt = new Date(since.getTime() + input.graceDays * 86_400_000);
  return {
    used: input.used,
    limit,
    ratio,
    level: input.now >= graceEndsAt ? 'needsAddon' : 'over',
    graceEndsAt,
  };
}

export interface CurrentUsage {
  integrationSets: number;
  /** Largest number of destinations in any one flow. */
  maxDestinationsInFlow: number;
  /** Members using a seat; external users don't (D11). */
  seats: number;
  transactionsThisMonth: number;
}

export type DowngradeBlocker = keyof Pick<
  Entitlements,
  'integrationSets' | 'destinationsPerFlow' | 'seats' | 'transactionsPerMonth'
>;

/**
 * Plan change check (§7.8): a downgrade is blocked with guidance while the tenant is above the new
 * plan's limits. Nothing is ever deactivated to make a downgrade fit.
 */
export function planChangeBlockers(target: Entitlements, usage: CurrentUsage): DowngradeBlocker[] {
  const out: DowngradeBlocker[] = [];
  if (!withinLimit(usage.integrationSets, target.integrationSets)) out.push('integrationSets');
  if (!withinLimit(usage.maxDestinationsInFlow, target.destinationsPerFlow))
    out.push('destinationsPerFlow');
  if (!withinLimit(usage.seats, target.seats)) out.push('seats');
  if (!withinLimit(usage.transactionsThisMonth, target.transactionsPerMonth))
    out.push('transactionsPerMonth');
  return out;
}

/** Danish VAT, 25 %. Amounts in øre. */
export const VAT_RATE = 0.25;

export function withVat(netOre: number): { net: number; vat: number; gross: number } {
  const vat = Math.round(netOre * VAT_RATE);
  return { net: netOre, vat, gross: netOre + vat };
}

/** Price of add-on transactions, rounded up to whole blocks of 1.000 (D2). */
export function overagePrice(extraTransactions: number, orePer1000: number): number {
  if (extraTransactions <= 0) return 0;
  return Math.ceil(extraTransactions / 1000) * orePer1000;
}

/** "YYYY-MM" for a date in a time zone (billing months follow the tenant's zone). */
export function billingPeriod(date: Date, timeZone = 'Europe/Copenhagen'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  return `${y}-${m}`;
}

/** The same day next month, clamped to the month's last day (31 Jan → 28/29 Feb). */
export function addMonth(date: Date): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/**
 * The plan recommended from SU3's answers ("Anbefalet til jer"), from data only: the first plan
 * (in catalogue order) whose recommended_for_orders has the order interval; if more systems were
 * chosen than it suits (recommended_for_systems), the next plan that suits them.
 */
export function recommendPlan(
  plans: readonly {
    id: string;
    entitlements: Pick<Entitlements, 'recommendedForOrders' | 'recommendedForSystems'>;
  }[],
  answers: { ordersPerMonth: string | null | undefined; systemCount?: number },
): string | null {
  const { ordersPerMonth, systemCount = 0 } = answers;
  if (!ordersPerMonth) return null;
  const start = plans.findIndex((p) =>
    p.entitlements.recommendedForOrders.includes(ordersPerMonth),
  );
  if (start < 0) return null;
  const fits = plans
    .slice(start)
    .find((p) => withinLimit(systemCount, p.entitlements.recommendedForSystems));
  return (fits ?? plans[start]!).id;
}

/** UTC instant of local midnight on the 1st of a month in a time zone (handles DST). */
export function monthStart(year: number, month1: number, timeZone = 'Europe/Copenhagen'): Date {
  const guess = Date.UTC(year, month1 - 1, 1);
  const offsetAt = (t: number) => {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(t))
      .find((p) => p.type === 'timeZoneName')?.value;
    const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name ?? '');
    if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) * 60_000;
  };
  // Two passes settle the offset across a DST change.
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}
