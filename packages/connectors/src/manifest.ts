import type { Entity } from './model.js';

/**
 * Connector manifest (produktspecifikation §4.3). The UI is generated from it: ports, the auth
 * form, settings and mapping fields. Nothing in the app is written for one specific connector.
 * v2 (PLAN-INTEGRATIONS-WOO-DINERO §3.1) adds options on both ends of a route, a variable
 * catalogue on source ports and a target-field catalogue on destination ports.
 */

export type Category = 'webshop' | 'erp' | 'crm' | 'marketing' | 'communication';
export type WriteMode = 'dry_run' | 'draft' | 'live';

/** Live lists an adapter can return: the ERP's chart of accounts, the shop's order statuses. */
export type LookupId =
  | 'accounts'
  | 'vatCodes'
  | 'templates'
  | 'depositAccounts'
  | 'invoiceTemplates'
  | 'organizations'
  | 'orderStatuses'
  | 'paymentGateways'
  | 'shippingMethods'
  | 'taxClasses'
  | 'taxRates'
  | 'categories'
  // Odoo (PLAN-INTEGRATIONS-WOO-ODOO16 §3.2).
  | 'companies'
  | 'warehouses'
  | 'locations'
  | 'pickingTypes'
  | 'journals'
  | 'taxes'
  | 'fiscalPositions'
  | 'paymentTerms'
  | 'pricelists'
  | 'productCategories'
  | 'carriers'
  | 'apps'
  // e-conomic (PLAN-INTEGRATIONS-ECONOMIC X1).
  | 'layouts'
  | 'vatZones'
  | 'customerGroups'
  | 'productGroups'
  | 'units'
  | 'products'
  /** Fixed rows (no system answers it): EU countries for OSS tables. */
  | 'countries'
  /** Any record list in the system by model, answered with a name search: `relation:res.partner`. */
  | `relation:${string}`
  /** The fields of a model, read from the system (Odoo `fields_get`): `fields:sale.order`. */
  | `fields:${string}`;

export interface AuthField {
  key: string;
  /** Danish label; manifests are product copy, shown as-is. */
  label: string;
  type: 'text' | 'secret' | 'url';
  help?: string;
  placeholder?: string;
}

export type ManifestAuth =
  | { type: 'api_key' | 'basic'; fields: AuthField[] }
  /** OAuth2: the customer signs in at the provider; scopes are kept to what entities need. */
  | { type: 'oauth2'; scopes: string[]; provider: string };

/** A value the source exposes to templates and expressions, e.g. `order.number`. */
export interface VariableDef {
  path: string;
  label: string;
  type: 'string' | 'number' | 'money' | 'date' | 'boolean';
  /** Line variables (`line.*`) only exist inside line templates. */
  scope: 'record' | 'line';
  example?: string;
}

/** A field the destination writes, which a template or an expression can fill. */
export interface TargetField {
  /** Stable key stored in the route's `templates`, e.g. "invoice.description". */
  key: string;
  label: string;
  scope: 'record' | 'line';
  required: boolean;
  maxLength?: number;
  /** Template used when the route has none, e.g. "Ordre {order.number}". */
  default?: string;
  /** `expression`: developer view only, because the value is a key the integration relies on. */
  editable: 'template' | 'expression';
}

/**
 * Variables or target fields read from the customer's own system rather than fixed in the
 * manifest (PLAN-INTEGRATIONS-WOO-ODOO16 §3.1): Odoo databases carry custom and Studio fields.
 * The worker caches the model's fields as the lookup list `fields:<model>` at each connection
 * test; `catalogueFromFields` turns that list into variables or targets.
 */
export interface DynamicCatalogue {
  /** The system's model, e.g. "stock.picking", "sale.order". */
  model: string;
  scope: 'record' | 'line';
  /** Path prefix, e.g. "shipment.fields" → `shipment.fields.x_studio_channel`. */
  prefix: string;
  /** `custom`: only the customer's own fields (Odoo `x_`); `all`: every field, developer view. */
  include?: 'custom' | 'all';
}

export interface Port {
  entity: Entity;
  /** The system's own name for the entity, e.g. Dinero "Fakturaer", HubSpot "Kontakter". */
  label: string;
  trigger?: { kind: 'webhook' } | { kind: 'poll'; minMinutes: number };
  modes?: WriteMode[];
  /** Source options for routes leaving this port (outputs), stored in `sourceOptions`. */
  options?: SettingField[];
  /** What this source exposes to templates and expressions (outputs). */
  variables?: VariableDef[];
  /** What this destination writes that templates can fill (inputs). */
  targets?: TargetField[];
  /** Value tables on routes into this port (inputs). */
  tables?: MappingTable[];
  /** More variables from the system's own fields (outputs). */
  dynamicVariables?: DynamicCatalogue[];
  /** More target fields from the system's own fields (inputs). */
  dynamicTargets?: DynamicCatalogue[];
}

export interface MappingField {
  /** Stable key stored in the flow version (§4.5), e.g. "accounts.euB2b". */
  key: string;
  label: string;
  help?: string;
  required: boolean;
  /** Required only when a route setting has this value, e.g. `oss.mode` = destinationVat. */
  requiredIf?: { setting: string; equals: string | boolean };
  /** Live lookup list from the destination (chart of accounts, VAT codes). */
  lookup?: LookupId;
  /**
   * VAT codes the chosen account should carry (Dinero books VAT by the account, F1). A different
   * code is a validation warning, never an error: the customer's chart is theirs.
   */
  expectVatCodes?: string[];
}

export interface MappingGroup {
  key: string;
  title: string;
  description?: string;
  fields: MappingField[];
}

export type SettingValue = boolean | string | number | string[];

export interface SettingField {
  key: string;
  label: string;
  type: 'boolean' | 'select' | 'multiselect' | 'text' | 'number';
  default: SettingValue;
  options?: { value: string; label: string }[];
  help?: string;
  /** `advanced` settings are shown in the developer view only. */
  level?: 'basic' | 'advanced';
  /** Shown only when another setting has this value. */
  showIf?: { key: string; equals: SettingValue };
  /** Options from a live list instead of `options` (a select over the deposit accounts). */
  lookup?: LookupId;
}

/**
 * A value table on a route (PLAN §5.4): rows from a source list mapped to destination values,
 * e.g. WooCommerce payment method → Dinero deposit account. Stored in the route's `tables`.
 */
export interface MappingTable {
  key: string;
  title: string;
  description?: string;
  /**
   * The row key: a source lookup (payment gateways, shipping methods), or fixed rows when the
   * rows don't come from the source (e-conomic's OSS zones per EU country).
   */
  from: { lookup: LookupId; label: string; options?: { value: string; label: string }[] };
  /** Columns per row, each a destination lookup. */
  to: { key: string; label: string; lookup: LookupId }[];
}

export interface ConnectorManifest {
  id: string;
  name: string;
  version: string;
  category: Category;
  logo: string;
  auth: ManifestAuth;
  /** What to call the account in lists, e.g. the shop domain or company name. */
  accountHint: string;
  /** Settings that belong to the connection and are shared by every flow using it. */
  connectionSettings?: SettingField[];
  /** Live lists the worker caches at each connection test, for dropdowns in the editor. */
  lookups?: LookupId[];
  /** Source ports (read). */
  outputs: Port[];
  /** Destination ports (write). */
  inputs: Port[];
  /** Per input entity: guided mapping groups (Mapping tab). */
  mapping?: Partial<Record<Entity, MappingGroup[]>>;
  /** Per input entity: route settings (e.g. how invoices are created). */
  routeSettings?: Partial<Record<Entity, SettingField[]>>;
  /** Implicit prerequisites, e.g. an invoice needs the customer and products in Dinero. */
  dependencies?: Partial<Record<Entity, Entity[]>>;
  rateLimit: { perMinute: number };
  /**
   * Entities the system can count cheaply (WooCommerce's X-WP-Total, Shopify's /count.json). The
   * connection test reports them, e.g. OB2 "Vi fandt 1.284 ordrer, 812 kunder og 146 produkter".
   */
  counts?: Entity[];
  /**
   * Webhook signature scheme for sources that push. `secret-header`: the system can't sign, so
   * it sends the connection's secret in a header we configured (e-conomic, PLAN X2).
   */
  webhook?: { signatureHeader: string; scheme: 'hmac-sha256-base64' | 'secret-header' };
  changelog: { version: string; kind: 'additive' | 'breaking'; note: string }[];
}

/** One cached field of a `fields:<model>` lookup list: name, label and what the system says. */
export interface FieldOption {
  value: string;
  label: string;
  meta?: Record<string, string | number | boolean>;
}

const VARIABLE_TYPES: Record<string, VariableDef['type']> = {
  char: 'string',
  text: 'string',
  html: 'string',
  selection: 'string',
  many2one: 'string',
  integer: 'number',
  float: 'number',
  monetary: 'money',
  date: 'date',
  datetime: 'date',
  boolean: 'boolean',
};

const TEXT_TYPES = new Set(['char', 'text', 'html']);

/** Bookkeeping fields every Odoo model carries; never useful in a template. */
const SYSTEM_FIELD = /^(__|message_|activity_|website_message_|has_message|access_)/;

/**
 * Variables and target fields from a system's own fields (PLAN-INTEGRATIONS-WOO-ODOO16 §3.1).
 * Adapters give a relation's display name as the value. Lists and files are left out, and so are
 * targets the system won't take a value for (read-only, computed and not stored).
 */
export function catalogueFromFields(
  fields: FieldOption[],
  cat: DynamicCatalogue,
): { variables: VariableDef[]; targets: TargetField[] } {
  const variables: VariableDef[] = [];
  const targets: TargetField[] = [];
  for (const f of fields) {
    if (SYSTEM_FIELD.test(f.value)) continue;
    if ((cat.include ?? 'custom') === 'custom' && !f.value.startsWith('x_')) continue;
    const type = String(f.meta?.type ?? '');
    const varType = VARIABLE_TYPES[type];
    if (!varType) continue;
    const path = `${cat.prefix}.${f.value}`;
    variables.push({
      path,
      label: f.label,
      type: varType,
      scope: cat.scope,
    });
    if (f.meta?.readonly === true || f.meta?.store === false) continue;
    const size = Number(f.meta?.size);
    targets.push({
      key: path,
      label: f.label,
      scope: cat.scope,
      required: f.meta?.required === true,
      ...(Number.isFinite(size) && size > 0 ? { maxLength: size } : {}),
      // Text takes a template; numbers, dates and relations (an id) need an expression.
      editable: TEXT_TYPES.has(type) ? 'template' : 'expression',
    });
  }
  return { variables, targets };
}

/**
 * A port with the variables and targets its dynamic catalogues found in the system's cached field
 * lists (`fields:<model>`), so the editor, validation and the engine see the customer's own fields.
 */
export function expandPort(
  port: Port | undefined,
  lookups: Partial<Record<string, FieldOption[]>> | undefined,
): Port | undefined {
  if (!port || (!port.dynamicVariables?.length && !port.dynamicTargets?.length)) return port;
  const fieldsOf = (c: DynamicCatalogue) =>
    catalogueFromFields(lookups?.[`fields:${c.model}`] ?? [], c);
  const variables = (port.dynamicVariables ?? []).flatMap((c) => fieldsOf(c).variables);
  const targets = (port.dynamicTargets ?? []).flatMap((c) => fieldsOf(c).targets);
  return {
    ...port,
    ...(port.variables || variables.length
      ? { variables: [...(port.variables ?? []), ...variables] }
      : {}),
    ...(port.targets || targets.length ? { targets: [...(port.targets ?? []), ...targets] } : {}),
  };
}

/**
 * Targets for the customer's own fields that a route fills (templates or expressions under a
 * dynamic prefix such as `order.fields.`). The engine renders them without the cached field list;
 * validation checked them against it when the route was published.
 */
export function dynamicRouteTargets(
  port: Port | undefined,
  route: { templates: Record<string, string>; expressions: Record<string, string> },
): TargetField[] {
  const known = new Set((port?.targets ?? []).map((t) => t.key));
  const out: TargetField[] = [];
  for (const key of new Set([...Object.keys(route.templates), ...Object.keys(route.expressions)])) {
    if (known.has(key)) continue;
    const cat = port?.dynamicTargets?.find((c) => key.startsWith(`${c.prefix}.`));
    if (!cat) continue;
    out.push({
      key,
      label: key,
      scope: cat.scope,
      required: false,
      editable: Object.hasOwn(route.templates, key) ? 'template' : 'expression',
    });
  }
  return out;
}

/** A route setting's value, falling back to the manifest default (the UI shows the same). */
export function settingValue(
  fields: SettingField[] | undefined,
  values: Record<string, unknown>,
  key: string,
): SettingValue | undefined {
  const v = values[key];
  if (v !== undefined) return v as SettingValue;
  return fields?.find((f) => f.key === key)?.default;
}
