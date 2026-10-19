import type { Entity } from './model.js';

/**
 * Connector manifest (produktspecifikation §4.3). The UI is generated from it: ports, the auth
 * form, settings and mapping fields. Nothing in the app is written for one specific connector.
 */

export type Category = 'webshop' | 'erp' | 'crm' | 'marketing' | 'communication';
export type WriteMode = 'dry_run' | 'draft' | 'live';

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

export interface Port {
  entity: Entity;
  /** The system's own name for the entity, e.g. Dinero "Fakturaer", HubSpot "Kontakter". */
  label: string;
  trigger?: { kind: 'webhook' } | { kind: 'poll'; minMinutes: number };
  modes?: WriteMode[];
}

export interface MappingField {
  /** Stable key stored in the flow version (§4.5), e.g. "accounts.euB2b". */
  key: string;
  label: string;
  help?: string;
  required: boolean;
  /** Live lookup list from the destination (chart of accounts, VAT codes). */
  lookup?: 'accounts' | 'vatCodes' | 'templates';
}

export interface MappingGroup {
  key: string;
  title: string;
  description?: string;
  fields: MappingField[];
}

export interface SettingField {
  key: string;
  label: string;
  type: 'boolean' | 'select' | 'text';
  default: boolean | string;
  options?: { value: string; label: string }[];
  help?: string;
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
  /** Webhook signature scheme for sources that push. */
  webhook?: { signatureHeader: string; scheme: 'hmac-sha256-base64' };
  changelog: { version: string; kind: 'additive' | 'breaking'; note: string }[];
}
