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
  | 'categories';

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
  /** Webhook signature scheme for sources that push. */
  webhook?: { signatureHeader: string; scheme: 'hmac-sha256-base64' };
  changelog: { version: string; kind: 'additive' | 'breaking'; note: string }[];
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
