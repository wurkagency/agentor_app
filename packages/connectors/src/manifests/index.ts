import type { ConnectorManifest, MappingGroup } from '../manifest.js';

const ORDER_MODES = ['dry_run', 'draft', 'live'] as const;

export const woocommerce: ConnectorManifest = {
  id: 'woocommerce',
  name: 'WooCommerce',
  version: '1.0.0',
  category: 'webshop',
  logo: '/logos/woocommerce.svg',
  auth: {
    type: 'api_key',
    fields: [
      {
        key: 'baseUrl',
        label: 'Butikkens adresse',
        type: 'url',
        placeholder: 'https://din-butik.dk',
        help: 'Skal bruge HTTPS.',
      },
      { key: 'consumerKey', label: 'Consumer key', type: 'secret', help: 'Starter med ck_.' },
      { key: 'consumerSecret', label: 'Consumer secret', type: 'secret', help: 'Starter med cs_.' },
    ],
  },
  accountHint: 'Butikkens domæne',
  outputs: [
    { entity: 'order', label: 'Ordrer', trigger: { kind: 'webhook' } },
    { entity: 'creditNote', label: 'Kreditnotaer', trigger: { kind: 'webhook' } },
    { entity: 'customer', label: 'Kunder', trigger: { kind: 'webhook' } },
    { entity: 'product', label: 'Produkter', trigger: { kind: 'poll', minMinutes: 5 } },
  ],
  inputs: [{ entity: 'stock', label: 'Lager', modes: ['dry_run', 'live'] }],
  rateLimit: { perMinute: 120 },
  webhook: { signatureHeader: 'x-wc-webhook-signature', scheme: 'hmac-sha256-base64' },
  changelog: [{ version: '1.0.0', kind: 'additive', note: 'Første version.' }],
};

export const shopify: ConnectorManifest = {
  id: 'shopify',
  name: 'Shopify',
  version: '1.0.0',
  category: 'webshop',
  logo: '/logos/shopify.svg',
  auth: {
    type: 'oauth2',
    provider: 'Shopify',
    scopes: ['read_orders', 'read_customers', 'read_products'],
  },
  accountHint: 'Butikkens navn',
  outputs: [
    { entity: 'order', label: 'Ordrer', trigger: { kind: 'webhook' } },
    { entity: 'creditNote', label: 'Refunderinger', trigger: { kind: 'webhook' } },
    { entity: 'customer', label: 'Kunder', trigger: { kind: 'webhook' } },
    { entity: 'product', label: 'Produkter', trigger: { kind: 'webhook' } },
  ],
  inputs: [{ entity: 'stock', label: 'Lager', modes: ['dry_run', 'live'] }],
  rateLimit: { perMinute: 120 },
  webhook: { signatureHeader: 'x-shopify-hmac-sha256', scheme: 'hmac-sha256-base64' },
  changelog: [{ version: '1.0.0', kind: 'additive', note: 'Første version.' }],
};

const ACCOUNT_GROUP: MappingGroup = {
  key: 'accounts',
  title: 'Konti',
  description: 'Hvor salget bogføres i Dinero.',
  fields: [
    { key: 'accounts.domestic', label: 'Momspligtigt salg', required: true, lookup: 'accounts' },
    { key: 'accounts.vatFree', label: 'Momsfrit salg', required: true, lookup: 'accounts' },
    { key: 'accounts.euB2b', label: 'EU B2B-salg', required: true, lookup: 'accounts' },
    { key: 'accounts.export', label: 'Salg uden for EU', required: true, lookup: 'accounts' },
    { key: 'accounts.shipping', label: 'Fragt, momspligtig', required: true, lookup: 'accounts' },
    {
      key: 'accounts.shippingVatFree',
      label: 'Fragt, momsfri',
      required: true,
      lookup: 'accounts',
    },
  ],
};

export const dinero: ConnectorManifest = {
  id: 'dinero',
  name: 'Dinero',
  version: '1.3.0',
  category: 'erp',
  logo: '/logos/dinero.svg',
  auth: {
    type: 'oauth2',
    provider: 'Dinero',
    scopes: ['read', 'write', 'dineropublicapi:read', 'dineropublicapi:write'],
  },
  accountHint: 'Virksomhed i Dinero',
  outputs: [
    { entity: 'customer', label: 'Kontakter', trigger: { kind: 'poll', minMinutes: 15 } },
    // Retur-flows (§4.2): stock counts from the ERP back to the shops.
    { entity: 'stock', label: 'Lagerantal', trigger: { kind: 'poll', minMinutes: 15 } },
  ],
  inputs: [
    { entity: 'order', label: 'Fakturaer', modes: [...ORDER_MODES] },
    { entity: 'creditNote', label: 'Kreditnotaer', modes: [...ORDER_MODES] },
    { entity: 'customer', label: 'Kunder', modes: ['dry_run', 'live'] },
    { entity: 'product', label: 'Produkter', modes: ['dry_run', 'live'] },
  ],
  mapping: { order: [ACCOUNT_GROUP], creditNote: [ACCOUNT_GROUP] },
  routeSettings: {
    order: [
      {
        key: 'invoice.bookAutomatically',
        label: 'Bogfør fakturaer automatisk',
        type: 'boolean',
        default: false,
        help: 'Slået fra: fakturaerne lægges som kladder, som du bogfører i Dinero.',
      },
      {
        key: 'invoice.language',
        label: 'Fakturasprog',
        type: 'select',
        default: 'da',
        options: [
          { value: 'da', label: 'Dansk' },
          { value: 'en', label: 'Engelsk' },
        ],
      },
    ],
  },
  dependencies: { order: ['customer', 'product'], creditNote: ['customer'] },
  rateLimit: { perMinute: 100 },
  changelog: [
    { version: '1.3.0', kind: 'additive', note: 'Fragt kan bogføres på egen konto.' },
    { version: '1.0.0', kind: 'additive', note: 'Første version.' },
  ],
};

export const economic: ConnectorManifest = {
  ...dinero,
  id: 'economic',
  name: 'e-conomic',
  version: '1.0.0',
  logo: '/logos/economic.svg',
  auth: {
    type: 'api_key',
    fields: [
      {
        key: 'grantToken',
        label: 'Agreement grant token',
        type: 'secret',
        help: 'Findes i e-conomic under Apps.',
      },
    ],
  },
  accountHint: 'Aftale i e-conomic',
  mapping: {
    order: [{ ...ACCOUNT_GROUP, description: 'Hvor salget bogføres i e-conomic.' }],
    creditNote: [{ ...ACCOUNT_GROUP, description: 'Hvor salget bogføres i e-conomic.' }],
  },
  rateLimit: { perMinute: 120 },
  changelog: [{ version: '1.0.0', kind: 'additive', note: 'Første version.' }],
};

export const hubspot: ConnectorManifest = {
  id: 'hubspot',
  name: 'HubSpot',
  version: '1.0.0',
  category: 'crm',
  logo: '/logos/hubspot.svg',
  auth: {
    type: 'oauth2',
    provider: 'HubSpot',
    scopes: ['crm.objects.contacts.write', 'crm.objects.deals.write'],
  },
  accountHint: 'HubSpot-konto',
  outputs: [],
  inputs: [
    { entity: 'customer', label: 'Kontakter', modes: ['dry_run', 'live'] },
    { entity: 'order', label: 'Handler', modes: ['dry_run', 'live'] },
  ],
  rateLimit: { perMinute: 600 },
  changelog: [{ version: '1.0.0', kind: 'additive', note: 'Første version.' }],
};

export const brevo: ConnectorManifest = {
  id: 'brevo',
  name: 'Brevo',
  version: '1.0.0',
  category: 'marketing',
  logo: '/logos/brevo.svg',
  auth: {
    type: 'api_key',
    fields: [{ key: 'apiKey', label: 'API-nøgle', type: 'secret', help: 'Starter med xkeysib-.' }],
  },
  accountHint: 'Kontonavn i Brevo',
  outputs: [],
  inputs: [{ entity: 'customer', label: 'Kontakter', modes: ['dry_run', 'live'] }],
  rateLimit: { perMinute: 300 },
  changelog: [{ version: '1.0.0', kind: 'additive', note: 'Første version.' }],
};

export const mailchimp: ConnectorManifest = {
  ...brevo,
  id: 'mailchimp',
  name: 'Mailchimp',
  logo: '/logos/mailchimp.svg',
  auth: {
    type: 'api_key',
    fields: [
      {
        key: 'apiKey',
        label: 'API-nøgle',
        type: 'secret',
        help: 'Slutter med -us21 eller lignende.',
      },
    ],
  },
  accountHint: 'Mailchimp-konto',
};

export const MANIFESTS: Record<string, ConnectorManifest> = Object.fromEntries(
  [woocommerce, shopify, dinero, economic, hubspot, brevo, mailchimp].map((m) => [m.id, m]),
);

export function manifestFor(id: string): ConnectorManifest | null {
  return MANIFESTS[id] ?? null;
}
