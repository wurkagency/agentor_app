import {
  dynamicRouteTargets,
  manifestFor,
  saleKeys,
  saleKind,
  settingValue,
  vatMismatch,
  WriteError,
  type ConnectorAdapter,
  type EntityRecord,
  type LookupOption,
  type Order,
  type OrderLine,
  type TargetField,
  type WriteMode,
  type WriteOptions,
} from '@agentor/connectors';
import type { FilterRule, FlowDefinition, Route } from './definition.js';
import { renderTemplate, resolvePath, TemplateError } from './templates.js';

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

/** Something worth a look that does not stop the record, e.g. foreign VAT on an EU sale. */
export interface RecordWarning {
  code:
    | 'VAT_FOREIGN'
    | 'VAT_ON_REVERSE_CHARGE'
    | 'VAT_ON_EXPORT'
    // From the destination (WriteResult.warnings), e.g. Odoo's tax differs from the shop's.
    | 'VAT_RATE_MISMATCH'
    | 'TOTAL_ROUNDED'
    | 'PAYMENT_NOT_REGISTERED'
    | 'CHANGED_AFTER_BOOKING';
  params: Record<string, string>;
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
    /** Destination fields rendered from templates (PLAN §5.5). */
    fields?: Record<string, string>;
  } | null;
  warnings?: RecordWarning[];
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

function failedIn(rules: FilterRule[], rec: EntityRecord[keyof EntityRecord]): FilterRule | null {
  for (const rule of rules) {
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

/**
 * Returns the rule that stopped the record, or null when it passes. Rules in a group must all
 * pass (AND); the record passes when any group does (OR). Without OR groups this is plain AND.
 */
export function failedFilter(
  route: Route,
  rec: EntityRecord[keyof EntityRecord],
): FilterRule | null {
  if (route.filters.length === 0) return null;
  const groups = [...new Set(route.filters.map((r) => r.group ?? 0))].sort();
  let first: FilterRule | null = null;
  for (const g of groups) {
    const failed = failedIn(
      route.filters.filter((r) => (r.group ?? 0) === g),
      rec,
    );
    if (!failed) return null;
    first ??= failed;
  }
  return first;
}

/**
 * Chooses the account for each order line (D3): product exception → category row → the
 * sale-type account (EU B2B, export, VAT-free, domestic). Shipping has its own accounts.
 * Category rows apply to sales booked like domestic sales; abroad the sale type decides.
 */
export function planInvoice(
  route: Route,
  o: Order,
  accounts: LookupOption[] | undefined,
): {
  lines: PlannedLine[];
  missing: { key: string; value: string | null } | null;
  warnings: RecordWarning[];
} {
  const label = (v: string | null) =>
    v ? (accounts?.find((a) => a.value === v)?.label ?? null) : null;
  const kind = saleKind(o);
  const oss = route.settings['oss.mode'] === 'destinationVat';
  const lines: PlannedLine[] = [];
  const warnings: RecordWarning[] = [];
  let missing: { key: string; value: string | null } | null = null;
  const check = (key: string, value: string | null) => {
    if (missing) return;
    if (!value) missing = { key, value: null };
    else if (accounts && !accounts.some((a) => a.value === value)) missing = { key, value };
  };
  for (const l of o.lines) {
    const exception = route.categoryAccounts.find((r) => r.product && r.product === l.name);
    const categoryRow = route.categoryAccounts.find((r) => !r.product && r.category === l.category);
    const services =
      (l.supplyType ?? exception?.supplyType ?? categoryRow?.supplyType) === 'services';
    const keys = saleKeys(kind, l.vatRate, services, oss);
    const key = keys.find((k) => route.mapping[k]) ?? keys[keys.length - 1]!;
    const likeDomestic = key === 'accounts.domestic' || key === 'accounts.vatFree';
    const byCategory = likeDomestic ? (exception ?? categoryRow) : undefined;
    const account = byCategory?.account ?? route.mapping[key] ?? null;
    check(byCategory ? 'mapping.categoryAccounts' : key, account);
    const mismatch = vatMismatch(kind, l.vatRate);
    if (mismatch)
      warnings.push({
        code: mismatch === 'FOREIGN_VAT' ? 'VAT_FOREIGN' : mismatch,
        params: { line: l.name, rate: String(Math.round(l.vatRate * 1000) / 10), kind },
      });
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
  return { lines, missing, warnings };
}

/**
 * What the destination needs from the route to build its document (WriteOptions.route): settings
 * with the manifest defaults filled in, so the adapter and the UI agree on every value.
 */
export function routeWriteContext(
  route: Pick<Route, 'settings' | 'mapping' | 'tables' | 'targetEntity'>,
  destinationConnectorId: string,
  accounts?: (string | null)[],
): NonNullable<WriteOptions['route']> {
  const fields = manifestFor(destinationConnectorId)?.routeSettings?.[route.targetEntity] ?? [];
  const settings: Record<string, unknown> = {};
  for (const f of fields) settings[f.key] = f.default;
  Object.assign(settings, route.settings);
  return {
    settings,
    mapping: route.mapping,
    tables: route.tables,
    ...(accounts ? { accounts } : {}),
  };
}

/**
 * Renders the destination's target fields (manifest `targets`) from the route's templates or
 * the manifest defaults. Templates read the record under its entity name (`order.number`) and
 * the source connection (`connection.id`). An expression for the same key wins.
 */
export function renderTargets(
  targets: TargetField[],
  route: Pick<Route, 'entity' | 'templates' | 'expressions'>,
  rec: EntityRecord[keyof EntityRecord],
  connectionId: string,
  shaped: unknown = rec,
): { fields: Record<string, string>; lineFields: Record<string, string>[] } {
  const ctx = {
    [route.entity]: rec,
    connection: { id: connectionId, short: connectionId.slice(0, 8) },
  };
  const lines = (rec as { lines?: OrderLine[] }).lines ?? [];
  const fields: Record<string, string> = {};
  const lineFields: Record<string, string>[] = lines.map(() => ({}));
  for (const t of targets) {
    if (Object.hasOwn(route.expressions, t.key)) {
      const v = resolvePath(shaped, t.key);
      if (typeof v === 'string' || typeof v === 'number') fields[t.key] = String(v);
      continue;
    }
    const src = t.editable === 'template' ? (route.templates[t.key] ?? t.default) : t.default;
    if (src === undefined) continue;
    const opts = { maxLength: t.maxLength };
    try {
      if (t.scope === 'record') fields[t.key] = renderTemplate(src, ctx, opts);
      else
        lines.forEach((line, i) => {
          lineFields[i]![t.key] = renderTemplate(src, { ...ctx, line }, opts);
        });
    } catch (e) {
      throw e instanceof TemplateError ? Object.assign(e, { field: t.key }) : e;
    }
  }
  return { fields, lineFields };
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
  /**
   * Evaluates the route's developer expressions (JSONata) in a sandbox. Server-only, so it is
   * passed in by the worker (`@agentor/flows/sandbox`) and never bundled into the browser.
   */
  applyExpressions?: <T>(record: T, expressions: Record<string, string>) => Promise<T>;
  now?: () => number;
}

const MODE: Record<Route['mode'], WriteMode> = { test: 'dry_run', draft: 'draft', live: 'live' };

export async function runRoute(input: RouteRunInput): Promise<RecordResult[]> {
  const { route, destination } = input;
  const now = input.now ?? (() => Date.now());
  const out: RecordResult[] = [];
  const dry = input.dryRun || route.mode === 'test';
  const sourceConnection = input.def.nodes.find((n) => n.id === route.from)?.connectionId ?? '';
  const inPort = manifestFor(destination.connectorId)?.inputs.find(
    (p) => p.entity === route.targetEntity,
  );
  const targets = [...(inPort?.targets ?? []), ...dynamicRouteTargets(inPort, route)];
  const statuses = route.sourceOptions['trigger.statuses'];
  // Destinations that book on accounts (Dinero, e-conomic journals) need them mapped. Odoo and
  // e-conomic invoices take the income account from the product, so there an empty account
  // mapping is not an error: accounts count only when required under the route's settings.
  const destManifest = manifestFor(destination.connectorId);
  const needsAccounts = (destManifest?.mapping?.[route.targetEntity] ?? []).some((g) =>
    g.fields.some(
      (f) =>
        f.key.startsWith('accounts.') &&
        (f.required ||
          (f.requiredIf !== undefined &&
            settingValue(
              destManifest?.routeSettings?.[route.targetEntity],
              route.settings,
              f.requiredIf.setting,
            ) === f.requiredIf.equals)),
    ),
  );
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
    // Source options (PLAN §4.3): which order statuses to send; empty means all.
    if (route.entity === 'order' && Array.isArray(statuses) && statuses.length) {
      const o = rec as Order;
      if (!statuses.includes(o.status) && !(o.sourceStatus && statuses.includes(o.sourceStatus))) {
        out.push({
          ...base,
          outcome: 'skipped',
          skipReason: `status:${o.sourceStatus ?? o.status}`,
          durationMs: 0,
        });
        continue;
      }
    }
    if (
      route.entity === 'order' &&
      route.sourceOptions.skipZeroTotal === true &&
      (rec as Order).total === 0
    ) {
      out.push({ ...base, outcome: 'skipped', skipReason: 'zeroTotal', durationMs: 0 });
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
    let warnings: RecordWarning[] = [];
    let accounts: (string | null)[] | undefined;
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
      warnings = plan.warnings;
      accounts = needsAccounts ? plan.lines.map((l) => l.account) : undefined;
      if (plan.missing && needsAccounts) {
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
    // Developer mapping: JSONata expressions shape the record before it is written.
    let shaped = rec;
    if (Object.keys(route.expressions ?? {}).length) {
      try {
        if (!input.applyExpressions) throw new Error('expressions are not available here');
        shaped = await input.applyExpressions(rec, route.expressions);
      } catch (e) {
        out.push({
          ...base,
          preview,
          outcome: 'failed',
          errorCode: 'EXPRESSION_ERROR',
          errorParams: {
            field: (e as { field?: string }).field ?? '',
            message: e instanceof Error ? e.message : 'invalid expression',
          },
          durationMs: now() - started,
          failure: 'mapping',
        });
        continue;
      }
    }
    // Destination fields from templates (PLAN §5.5), after expressions so they can override.
    let rendered: ReturnType<typeof renderTargets> | null = null;
    if (targets.length) {
      try {
        rendered = renderTargets(targets, route, rec, sourceConnection, shaped);
        if (preview) preview.fields = rendered.fields;
      } catch (e) {
        out.push({
          ...base,
          preview,
          outcome: 'failed',
          errorCode: 'TEMPLATE_ERROR',
          errorParams: {
            field: (e as { field?: string }).field ?? '',
            message: e instanceof Error ? e.message.slice(0, 200) : 'invalid template',
          },
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
      const res = await destination.write(route.targetEntity, shaped as never, {
        mode: dry ? 'dry_run' : MODE[route.mode],
        existingId: existing,
        ...(refs ? { refs } : {}),
        ...(rendered ? { fields: rendered.fields, lineFields: rendered.lineFields } : {}),
        route: routeWriteContext(route, destination.connectorId, accounts),
      });
      const all = [...warnings, ...((res.warnings ?? []) as RecordWarning[])];
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
        ...(all.length ? { warnings: all } : {}),
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
