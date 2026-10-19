import {
  saleKind,
  WriteError,
  type ConnectorAdapter,
  type EntityRecord,
  type LookupOption,
  type Order,
  type WriteMode,
} from '@agentor/connectors';
import type { FilterRule, FlowDefinition, Route } from './definition.js';

/**
 * The engine's per-record decisions (produktspecifikation §4.1 steps 4–6): filter, map, write.
 * Pure apart from the adapter call, so test runs and live runs share exactly the same logic.
 */

export type Outcome =
  'created' | 'updated' | 'skipped' | 'failed' | 'would_create' | 'would_update';

export interface PlannedLine {
  description: string;
  amount: number;
  account: string | null;
  accountLabel: string | null;
  kind: 'line' | 'shipping';
}

export interface RecordResult {
  routeId: string;
  sourceId: string;
  /** "#10447" for orders, name for customers. */
  label: string;
  amount: number | null;
  outcome: Outcome;
  destinationId: string | null;
  errorCode: string | null;
  /** Error parameters for the customer message ("Kontoen 1010 findes ikke…"). */
  errorParams: Record<string, string> | null;
  skipReason: string | null;
  /** Preview for the test run and the developer view (no credentials, no full PII). */
  preview: {
    customer: string;
    country: string;
    vatNumber: string | null;
    saleKind: string | null;
    lines: PlannedLine[];
    total: number | null;
    vatFree: boolean;
  } | null;
  durationMs: number;
  /**
   * Why a failed record failed, which decides what happens next: `invalid` and `mapping` need
   * the customer (never retried automatically), `transient` and `rate_limited` are retried with
   * backoff, `unauthorized` waits for the connection.
   */
  failure?: 'invalid' | 'transient' | 'rate_limited' | 'unauthorized' | 'mapping' | 'dependency';
  retryAfterMs?: number;
}

function fieldValue(
  rule: FilterRule,
  rec: EntityRecord[keyof EntityRecord],
): string | number | null {
  const o = rec as Partial<Order>;
  switch (rule.field) {
    case 'total':
      return typeof o.total === 'number' ? o.total / 100 : null;
    case 'status':
      return o.status ?? null;
    case 'country':
      return o.customer?.address.country ?? null;
    case 'customerKind':
      return o.customer?.kind ?? null;
  }
}

/** Returns the first rule the record fails, or null when it passes. */
export function failedFilter(
  route: Route,
  rec: EntityRecord[keyof EntityRecord],
): FilterRule | null {
  for (const rule of route.filters) {
    const v = fieldValue(rule, rec);
    if (v === null) return rule;
    const a = typeof rule.value === 'number' ? Number(v) : String(v);
    const b = rule.value;
    const ok =
      rule.op === 'gt'
        ? a > b
        : rule.op === 'gte'
          ? a >= b
          : rule.op === 'lt'
            ? a < b
            : rule.op === 'eq'
              ? a === b
              : a !== b;
    if (!ok) return rule;
  }
  return null;
}

const accountKey = (o: Order, vatRate: number) => {
  const kind = saleKind(o);
  if (kind === 'euB2b') return 'accounts.euB2b';
  if (kind === 'export') return 'accounts.export';
  return vatRate === 0 ? 'accounts.vatFree' : 'accounts.domestic';
};

/**
 * Chooses the account for each order line (D3): product exception → category row → the
 * sale-type account (EU B2B, export, VAT-free, domestic). Shipping has its own accounts.
 */
export function planInvoice(
  route: Route,
  o: Order,
  accounts: LookupOption[] | undefined,
): { lines: PlannedLine[]; missing: { key: string; value: string | null } | null } {
  const label = (v: string | null) =>
    v ? (accounts?.find((a) => a.value === v)?.label ?? null) : null;
  const kind = saleKind(o);
  const lines: PlannedLine[] = [];
  let missing: { key: string; value: string | null } | null = null;
  const check = (key: string, value: string | null) => {
    if (missing) return;
    if (!value) missing = { key, value: null };
    else if (accounts && !accounts.some((a) => a.value === value)) missing = { key, value };
  };
  for (const l of o.lines) {
    const exception = route.categoryAccounts.find((r) => r.product && r.product === l.name);
    const byCategory =
      kind === 'domestic'
        ? route.categoryAccounts.find((r) => !r.product && r.category === l.category)
        : undefined;
    const key = accountKey(o, l.vatRate);
    const account =
      kind === 'domestic'
        ? (exception?.account ?? byCategory?.account ?? route.mapping[key] ?? null)
        : (route.mapping[key] ?? null);
    check(exception || byCategory ? 'mapping.categoryAccounts' : key, account);
    lines.push({
      description: l.name,
      amount: l.unitPrice * l.quantity,
      account,
      accountLabel: label(account),
      kind: 'line',
    });
  }
  if (o.shipping > 0) {
    const key = o.shippingVatRate === 0 ? 'accounts.shippingVatFree' : 'accounts.shipping';
    const account = route.mapping[key] ?? null;
    check(key, account);
    lines.push({
      description: 'Fragt',
      amount: o.shipping,
      account,
      accountLabel: label(account),
      kind: 'shipping',
    });
  }
  return { lines, missing };
}

function labelOf(entity: string, rec: EntityRecord[keyof EntityRecord]): string {
  const r = rec as { number?: string; name?: string; sourceId: string };
  if (entity === 'order') return `#${r.number}`;
  if (entity === 'creditNote') return `KN-${r.number}`;
  return r.name ?? r.sourceId;
}

export interface RouteRunInput {
  def: FlowDefinition;
  route: Route;
  records: EntityRecord[keyof EntityRecord][];
  destination: ConnectorAdapter;
  /** Destination's live lookups (chart of accounts). */
  accounts?: LookupOption[] | undefined;
  /** Test runs force a dry run whatever the route's mode (§5.4). */
  dryRun: boolean;
  /** Cross-reference: the record's id in the destination, if it was written before. */
  existingId: (sourceId: string) => string | null;
  /**
   * Resolves the record's dependencies in the destination before it is written (manifest
   * `dependencies`, e.g. Dinero needs the customer before the invoice). Returns their
   * destination ids, or the dependency that could not be created.
   */
  resolveDependencies?: (
    record: EntityRecord[keyof EntityRecord],
  ) => Promise<{ refs: Record<string, string> } | { missing: string; reason: string }>;
  /** Waits for the destination's rate limit before each write. */
  beforeWrite?: () => Promise<void>;
  now?: () => number;
}

const MODE: Record<Route['mode'], WriteMode> = { test: 'dry_run', draft: 'draft', live: 'live' };

export async function runRoute(input: RouteRunInput): Promise<RecordResult[]> {
  const { route, destination } = input;
  const now = input.now ?? (() => Date.now());
  const out: RecordResult[] = [];
  const dry = input.dryRun || route.mode === 'test';
  for (const rec of input.records) {
    const started = now();
    const base = {
      routeId: route.id,
      sourceId: (rec as { sourceId: string }).sourceId,
      label: labelOf(route.entity, rec),
      amount: typeof (rec as Order).total === 'number' ? (rec as Order).total : null,
      destinationId: null,
      errorCode: null,
      errorParams: null,
      skipReason: null,
      preview: null,
    };
    // "Send når ordren er Gennemført" (D6 Generelt): orders in other states wait.
    const trigger = route.settings['trigger.orderStatus'];
    if (
      route.entity === 'order' &&
      typeof trigger === 'string' &&
      trigger &&
      (rec as Order).status !== trigger
    ) {
      out.push({ ...base, outcome: 'skipped', skipReason: `trigger:${trigger}`, durationMs: 0 });
      continue;
    }
    const rule = failedFilter(route, rec);
    if (rule) {
      out.push({
        ...base,
        outcome: 'skipped',
        skipReason: `filter:${rule.field}:${rule.op}:${rule.value}`,
        durationMs: 0,
      });
      continue;
    }
    let preview: RecordResult['preview'] = null;
    if (route.entity === 'order' && route.targetEntity === 'order') {
      const o = rec as Order;
      const plan = planInvoice(route, o, input.accounts);
      preview = {
        customer: o.customer.name,
        country: o.customer.address.country,
        vatNumber: o.customer.vatNumber,
        saleKind: saleKind(o),
        lines: plan.lines,
        total: o.total,
        vatFree: saleKind(o) === 'euB2b' || saleKind(o) === 'export',
      };
      if (plan.missing) {
        out.push({
          ...base,
          preview,
          outcome: 'failed',
          errorCode: plan.missing.value ? 'ACCOUNT_NOT_FOUND' : 'ACCOUNT_MISSING',
          errorParams: { field: plan.missing.key, value: plan.missing.value ?? '' },
          durationMs: now() - started,
          failure: 'mapping',
        });
        continue;
      }
    }
    const existing = input.existingId(base.sourceId);
    if (existing && !route.updateExisting) {
      out.push({ ...base, preview, outcome: 'skipped', skipReason: 'exists', durationMs: 0 });
      continue;
    }
    try {
      let refs: Record<string, string> | undefined;
      if (!dry && input.resolveDependencies) {
        const deps = await input.resolveDependencies(rec);
        if ('missing' in deps) {
          out.push({
            ...base,
            preview,
            outcome: 'failed',
            errorCode: 'DEPENDENCY_MISSING',
            errorParams: { entity: deps.missing, message: deps.reason.slice(0, 200) },
            durationMs: now() - started,
            failure: 'dependency',
          });
          continue;
        }
        refs = deps.refs;
      }
      if (!dry) await input.beforeWrite?.();
      const res = await destination.write(route.targetEntity, rec as never, {
        mode: dry ? 'dry_run' : MODE[route.mode],
        existingId: existing,
        ...(refs ? { refs } : {}),
      });
      out.push({
        ...base,
        preview,
        outcome: dry
          ? res.action === 'update'
            ? 'would_update'
            : 'would_create'
          : res.action === 'update'
            ? 'updated'
            : res.action === 'skip'
              ? 'skipped'
              : 'created',
        destinationId: res.destinationId,
        durationMs: now() - started,
      });
    } catch (e) {
      const kind = e instanceof WriteError ? e.kind : 'transient';
      out.push({
        ...base,
        preview,
        outcome: 'failed',
        errorCode:
          kind === 'invalid'
            ? 'DESTINATION_REJECTED'
            : kind === 'unauthorized'
              ? 'CONNECTION_BROKEN'
              : 'DESTINATION_ERROR',
        errorParams: { message: e instanceof Error ? e.message.slice(0, 200) : 'unknown' },
        durationMs: now() - started,
        failure: kind,
        ...(e instanceof WriteError && e.retryAfterMs ? { retryAfterMs: e.retryAfterMs } : {}),
      });
    }
  }
  return out;
}

export function summarise(results: RecordResult[]) {
  const count = (o: Outcome[]) => results.filter((r) => o.includes(r.outcome)).length;
  return {
    total: results.length,
    ok: count(['created', 'updated', 'would_create', 'would_update']),
    created: count(['created', 'would_create']),
    updated: count(['updated', 'would_update']),
    skipped: count(['skipped']),
    failed: count(['failed']),
  };
}
