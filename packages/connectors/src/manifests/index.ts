import type {
  ConnectorManifest,
  MappingGroup,
  MappingTable,
  SettingField,
  TargetField,
  VariableDef,
} from '../manifest.js';

const ORDER_MODES = ['dry_run', 'draft', 'live'] as const;

const v = (
  path: string,
  label: string,
  type: VariableDef['type'] = 'string',
  scope: VariableDef['scope'] = 'record',
): VariableDef => ({ path, label, type, scope });

/** Customer variables under a prefix: `order.customer.` on orders, `customer.` on customers. */
const customerVariables = (p: string): VariableDef[] => [
  v(`${p}name`, 'Kundens navn'),
  v(`${p}email`, 'Kundens e-mail'),
  v(`${p}phone`, 'Kundens telefon'),
  v(`${p}companyName`, 'Firmanavn'),
  v(`${p}vatNumber`, 'Momsnummer'),
  v(`${p}cvr`, 'CVR-nummer'),
  v(`${p}ean`, 'EAN-nummer'),
  v(`${p}address.line1`, 'Adresse'),
  v(`${p}address.postalCode`, 'Postnummer'),
  v(`${p}address.city`, 'By'),
  v(`${p}address.country`, 'Land'),
];

const lineVariables: VariableDef[] = [
  v('line.name', 'Varens navn', 'string', 'line'),
  v('line.sku', 'Varenummer (SKU)', 'string', 'line'),
  v('line.ean', 'EAN', 'string', 'line'),
  v('line.quantity', 'Antal', 'number', 'line'),
  v('line.unitPrice', 'Stykpris uden moms', 'money', 'line'),
  v('line.category', 'Kategori', 'string', 'line'),
];

/** What WooCommerce orders expose to templates (PLAN §4.4). `order.meta.*` comes from L1. */
const WOO_ORDER_VARIABLES: VariableDef[] = [
  v('order.sourceId', 'Ordre-id'),
  v('order.number', 'Ordrenummer'),
  v('order.createdAt', 'Ordredato', 'date'),
  v('order.paidAt', 'Betalt', 'date'),
  v('order.status', 'Status'),
  v('order.currency', 'Valuta'),
  v('order.total', 'Total inkl. moms', 'money'),
  v('order.paymentMethod.id', 'Betalingsmetode (id)'),
  v('order.paymentMethod.title', 'Betalingsmetode'),
  v('order.transactionId', 'Transaktions-id'),
  v('order.shippingMethod', 'Fragtmetode'),
  v('order.note', 'Kundens bemærkning'),
  v('order.billing.name', 'Faktureres til'),
  v('order.billing.company', 'Firma (fakturering)'),
  v('order.shippingTo.name', 'Leveres til'),
  v('order.shippingTo.address.line1', 'Leveringsadresse'),
  v('order.shippingTo.address.postalCode', 'Leveringspostnummer'),
  v('order.shippingTo.address.city', 'Leveringsby'),
  v('order.meta.*', 'Eget felt (meta)'),
  ...customerVariables('order.customer.'),
  ...lineVariables,
];

const WOO_CREDIT_NOTE_VARIABLES: VariableDef[] = [
  v('creditNote.sourceId', 'Refusions-id'),
  v('creditNote.number', 'Refusionsnummer'),
  v('creditNote.orderSourceId', 'Ordre-id'),
  v('creditNote.createdAt', 'Dato', 'date'),
  v('creditNote.reason', 'Årsag'),
  v('creditNote.total', 'Beløb inkl. moms', 'money'),
  v('creditNote.meta.*', 'Eget felt (meta)'),
  ...customerVariables('creditNote.customer.'),
  ...lineVariables,
];

const ORDER_STATUS_OPTIONS = [
  { value: 'pending', label: 'Afventer betaling' },
  { value: 'processing', label: 'Behandles' },
  { value: 'completed', label: 'Gennemført' },
  { value: 'cancelled', label: 'Annulleret' },
  { value: 'refunded', label: 'Refunderet' },
];

/** Source options on WooCommerce orders (PLAN §4.3). Defaults keep v1 behaviour: send all. */
const WOO_ORDER_OPTIONS: SettingField[] = [
  {
    key: 'trigger.statuses',
    label: 'Send ordrer med status',
    type: 'multiselect',
    default: [],
    options: ORDER_STATUS_OPTIONS,
    help: 'Tom: alle ordrer sendes.',
  },
  {
    key: 'skipZeroTotal',
    label: 'Spring ordrer på 0 kr. over',
    type: 'boolean',
    default: false,
  },
];

export const woocommerce: ConnectorManifest = {
  id: 'woocommerce',
  name: 'WooCommerce',
  version: '1.1.0',
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
  // PLAN §4.2: where the shop keeps fields that core WooCommerce lacks.
  connectionSettings: [
    {
      key: 'meta.vatNumber',
      label: 'Felt med momsnummer',
      type: 'text',
      default: '_billing_vat_number',
      help: 'Metafeltet på ordren, fx fra "EU VAT Number".',
    },
    { key: 'meta.cvr', label: 'Felt med CVR-nummer', type: 'text', default: '' },
    {
      key: 'meta.ean',
      label: 'Felt med EAN-nummer',
      type: 'text',
      default: '',
      help: 'Bruges til EAN-fakturaer til det offentlige.',
    },
    {
      key: 'orderNumber.source',
      label: 'Ordrenummer',
      type: 'select',
      default: 'number',
      level: 'advanced',
      options: [
        { value: 'number', label: 'Butikkens ordrenummer' },
        { value: 'id', label: 'Ordre-id' },
      ],
    },
    {
      key: 'webhooks.mode',
      label: 'Hent ændringer',
      type: 'select',
      default: 'webhook+poll',
      level: 'advanced',
      options: [
        { value: 'webhook+poll', label: 'Webhooks og kontrol hver time' },
        { value: 'poll', label: 'Kun kontrol' },
      ],
    },
  ],
  outputs: [
    {
      entity: 'order',
      label: 'Ordrer',
      trigger: { kind: 'webhook' },
      options: WOO_ORDER_OPTIONS,
      variables: WOO_ORDER_VARIABLES,
    },
    {
      entity: 'creditNote',
      label: 'Kreditnotaer',
      trigger: { kind: 'webhook' },
      variables: WOO_CREDIT_NOTE_VARIABLES,
    },
    {
      entity: 'customer',
      label: 'Kunder',
      trigger: { kind: 'webhook' },
      variables: [v('customer.sourceId', 'Kunde-id'), ...customerVariables('customer.')],
    },
    { entity: 'product', label: 'Produkter', trigger: { kind: 'poll', minMinutes: 5 } },
  ],
  inputs: [{ entity: 'stock', label: 'Lager', modes: ['dry_run', 'live'] }],
  counts: ['order', 'customer', 'product'],
  lookups: ['orderStatuses', 'paymentGateways', 'shippingMethods', 'categories'],
  rateLimit: { perMinute: 120 },
  webhook: { signatureHeader: 'x-wc-webhook-signature', scheme: 'hmac-sha256-base64' },
  changelog: [
    {
      version: '1.1.0',
      kind: 'additive',
      note: 'Statusfilter, egne felter og variabler til skabeloner.',
    },
    { version: '1.0.0', kind: 'additive', note: 'Første version.' },
  ],
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
  counts: ['order', 'customer', 'product'],
  rateLimit: { perMinute: 120 },
  webhook: { signatureHeader: 'x-shopify-hmac-sha256', scheme: 'hmac-sha256-base64' },
  changelog: [{ version: '1.0.0', kind: 'additive', note: 'Første version.' }],
};

const ACCOUNT_GROUP: MappingGroup = {
  key: 'accounts',
  title: 'Konti',
  description: 'Hvor salget bogføres i Dinero.',
  fields: [
    {
      key: 'accounts.domestic',
      label: 'Momspligtigt salg',
      required: true,
      lookup: 'accounts',
      expectVatCodes: ['U25'],
    },
    { key: 'accounts.vatFree', label: 'Momsfrit salg', required: true, lookup: 'accounts' },
    {
      key: 'accounts.euB2c',
      label: 'EU-salg til private',
      required: false,
      requiredIf: { setting: 'oss.mode', equals: 'destinationVat' },
      lookup: 'accounts',
      help: 'Tom: bogføres som momspligtigt salg med dansk moms.',
    },
    {
      key: 'accounts.euB2b',
      label: 'EU B2B-salg',
      required: true,
      lookup: 'accounts',
      expectVatCodes: ['UEUV', 'UEUY'],
    },
    {
      key: 'accounts.euB2bServices',
      label: 'EU B2B-salg af ydelser',
      required: false,
      lookup: 'accounts',
      expectVatCodes: ['UEUY'],
      help: 'Tom: samme konto som EU B2B-salg.',
    },
    {
      key: 'accounts.export',
      label: 'Salg uden for EU',
      required: true,
      lookup: 'accounts',
      expectVatCodes: ['UVV', 'UVY'],
    },
    {
      key: 'accounts.exportServices',
      label: 'Salg af ydelser uden for EU',
      required: false,
      lookup: 'accounts',
      expectVatCodes: ['UVY'],
      help: 'Tom: samme konto som salg uden for EU.',
    },
    { key: 'accounts.shipping', label: 'Fragt, momspligtig', required: true, lookup: 'accounts' },
    {
      key: 'accounts.shippingVatFree',
      label: 'Fragt, momsfri',
      required: true,
      lookup: 'accounts',
    },
    {
      key: 'accounts.rounding',
      label: 'Øreafrunding',
      required: false,
      lookup: 'accounts',
      help: 'Tom: små forskelle på totalen ignoreres.',
    },
  ],
};

/**
 * What Dinero writes that templates can fill (PLAN §5.5). External references are the
 * idempotency key in Dinero (F5), so only the developer view may change them.
 */
const DINERO_INVOICE_TARGETS: TargetField[] = [
  {
    key: 'invoice.externalReference',
    label: 'Ekstern reference',
    scope: 'record',
    required: true,
    maxLength: 128,
    default: 'agentor:{connection.id}:{order.sourceId}',
    editable: 'expression',
  },
  {
    key: 'invoice.description',
    label: 'Fakturaoverskrift',
    scope: 'record',
    required: false,
    default: 'Ordre {order.number}',
    editable: 'template',
  },
  {
    key: 'invoice.comment',
    label: 'Kommentar',
    scope: 'record',
    required: false,
    editable: 'template',
  },
  {
    key: 'line.description',
    label: 'Linjetekst',
    scope: 'line',
    required: true,
    default: '{line.name}',
    editable: 'template',
  },
];

const DINERO_CREDIT_NOTE_TARGETS: TargetField[] = [
  {
    key: 'creditNote.externalReference',
    label: 'Ekstern reference',
    scope: 'record',
    required: true,
    maxLength: 128,
    default: 'agentor:{connection.id}:{creditNote.sourceId}',
    editable: 'expression',
  },
  {
    // The order's invoice, found by the reference the invoice route gave it.
    key: 'creditNote.invoiceReference',
    label: 'Fakturaens reference',
    scope: 'record',
    required: true,
    maxLength: 128,
    default: 'agentor:{connection.id}:{creditNote.orderSourceId}',
    editable: 'expression',
  },
  {
    key: 'creditNote.description',
    label: 'Overskrift',
    scope: 'record',
    required: false,
    default: 'Kreditnota {creditNote.number}',
    editable: 'template',
  },
  {
    key: 'line.description',
    label: 'Linjetekst',
    scope: 'line',
    required: true,
    default: '{line.name}',
    editable: 'template',
  },
];

const DINERO_CONTACT_TARGETS: TargetField[] = [
  {
    key: 'contact.externalReference',
    label: 'Ekstern reference',
    scope: 'record',
    required: true,
    maxLength: 128,
    default: 'agentor:{connection.id}:{customer.sourceId}',
    editable: 'expression',
  },
];

/** Payment method → deposit account (PLAN §5.4 table 3). */
const PAYMENT_METHODS: MappingTable = {
  key: 'paymentMethods',
  title: 'Betalingsmetoder',
  description: 'Hvilken konto betalingen registreres på i Dinero.',
  from: { lookup: 'paymentGateways', label: 'Betalingsmetode' },
  to: [{ key: 'account', label: 'Indbetalingskonto', lookup: 'depositAccounts' }],
};

/** What the Dinero client honours on invoices (PLAN §5.3). */
const DINERO_INVOICE_SETTINGS: SettingField[] = [
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
      { value: 'byCountry', label: 'Engelsk uden for Danmark' },
    ],
  },
  {
    key: 'oss.mode',
    label: 'Moms ved EU-salg til private',
    type: 'select',
    default: 'danishVat',
    options: [
      { value: 'danishVat', label: 'Dansk moms (under 10.000 euro om året)' },
      { value: 'destinationVat', label: 'Købers lands moms (OSS)' },
    ],
    help: 'Dinero kan ikke bogføre udenlandsk moms. Ved OSS bogføres salget på egen konto.',
  },
  {
    key: 'invoice.updateDrafts',
    label: 'Opdatér fakturakladder',
    type: 'boolean',
    default: true,
    help: 'Ændringer i butikken opdaterer kladden. En bogført faktura ændres aldrig.',
  },
  {
    key: 'payment.register',
    label: 'Registrér betaling',
    type: 'boolean',
    default: true,
    help: 'Betalte ordrer får betalingen registreret, når fakturaen bogføres.',
  },
  {
    key: 'payment.account',
    label: 'Standardkonto for betalinger',
    type: 'select',
    default: '',
    lookup: 'depositAccounts',
    showIf: { key: 'payment.register', equals: true },
    help: 'Bruges, når betalingsmetoden ikke har sin egen konto.',
  },
  {
    key: 'invoice.date',
    label: 'Fakturadato',
    type: 'select',
    default: 'order',
    level: 'advanced',
    options: [
      { value: 'order', label: 'Ordrens dato' },
      { value: 'today', label: 'Dagens dato' },
    ],
  },
  {
    key: 'invoice.template',
    label: 'Fakturaskabelon',
    type: 'select',
    default: '',
    lookup: 'invoiceTemplates',
    level: 'advanced',
  },
  {
    key: 'rounding.maxDiff',
    label: 'Største afrunding (kr.)',
    type: 'number',
    default: 1,
    level: 'advanced',
    help: 'Er forskellen større, stopper fakturaen til gennemsyn.',
  },
  {
    key: 'send.email',
    label: 'Send faktura på e-mail',
    type: 'boolean',
    default: false,
    help: 'Kræver, at fakturaen bogføres.',
  },
  {
    key: 'send.eInvoice',
    label: 'Send EAN-faktura',
    type: 'boolean',
    default: false,
    help: 'Når ordren har et EAN-nummer. Sendes i stedet for e-mail.',
  },
];

/** How contacts are matched and kept up to date (PLAN §5.3). */
const DINERO_CONTACT_SETTINGS: SettingField[] = [
  {
    key: 'contact.match',
    label: 'Find kunden i Dinero på',
    type: 'select',
    default: 'email',
    options: [
      { value: 'email', label: 'E-mail' },
      { value: 'vatNumber', label: 'Momsnummer' },
      { value: 'externalReference', label: 'Kun egen reference' },
    ],
  },
  { key: 'contact.update', label: 'Opdatér kunder i Dinero', type: 'boolean', default: true },
  {
    key: 'contact.paymentDays',
    label: 'Betalingsfrist (dage)',
    type: 'number',
    default: 8,
    help: 'For ordrer, der ikke er betalt.',
  },
];

export const dinero: ConnectorManifest = {
  id: 'dinero',
  name: 'Dinero',
  version: '2.0.0',
  category: 'erp',
  logo: '/logos/dinero.svg',
  // Visma Connect (PLAN F3); offline_access gives the refresh token.
  auth: {
    type: 'oauth2',
    provider: 'Dinero',
    scopes: ['dineropublicapi:read', 'dineropublicapi:write', 'offline_access'],
  },
  accountHint: 'Virksomhed i Dinero',
  // One login reaches every company the user has; the connection books in one (PLAN §5.1).
  connectionSettings: [
    {
      key: 'organizationId',
      label: 'Virksomhed',
      type: 'select',
      default: '',
      lookup: 'organizations',
      help: 'Tom: den første virksomhed med Dinero Pro.',
    },
    {
      key: 'clearingAccount',
      label: 'Mellemregningskonto for betalinger',
      type: 'select',
      default: '',
      lookup: 'depositAccounts',
      help: 'Fx kortindløserens konto. Bruges, når en rute ikke har en anden.',
    },
  ],
  lookups: ['accounts', 'depositAccounts', 'vatCodes', 'invoiceTemplates', 'organizations'],
  // Dinero has no stock (PLAN F2): WooCommerce keeps stock itself.
  outputs: [{ entity: 'customer', label: 'Kontakter', trigger: { kind: 'poll', minMinutes: 15 } }],
  inputs: [
    {
      entity: 'order',
      label: 'Fakturaer',
      modes: [...ORDER_MODES],
      targets: DINERO_INVOICE_TARGETS,
      tables: [PAYMENT_METHODS],
    },
    {
      entity: 'creditNote',
      label: 'Kreditnotaer',
      modes: [...ORDER_MODES],
      targets: DINERO_CREDIT_NOTE_TARGETS,
    },
    {
      entity: 'customer',
      label: 'Kunder',
      modes: ['dry_run', 'live'],
      targets: DINERO_CONTACT_TARGETS,
    },
    { entity: 'product', label: 'Produkter', modes: ['dry_run', 'live'] },
  ],
  // Credit notes are created from the original invoice and reuse its accounts (INVOICE_MISSING).
  mapping: { order: [ACCOUNT_GROUP] },
  routeSettings: {
    order: [...DINERO_INVOICE_SETTINGS, ...DINERO_CONTACT_SETTINGS],
    creditNote: [DINERO_INVOICE_SETTINGS[1]!, ...DINERO_CONTACT_SETTINGS],
    customer: DINERO_CONTACT_SETTINGS,
  },
  // Invoice lines carry account and text; Dinero products are not needed (PLAN §5.3).
  dependencies: { order: ['customer'], creditNote: ['customer'] },
  rateLimit: { perMinute: 100 },
  changelog: [
    {
      version: '2.0.0',
      kind: 'breaking',
      note: 'Live forbindelse. Lagerantal er fjernet, fordi Dinero ikke har lager.',
    },
    {
      version: '1.4.0',
      kind: 'additive',
      note: 'Konti for EU-salg til private og ydelser, momskontrol og skabeloner til felter.',
    },
    { version: '1.3.0', kind: 'additive', note: 'Fragt kan bogføres på egen konto.' },
    { version: '1.0.0', kind: 'additive', note: 'Første version.' },
  ],
};

const ECONOMIC_ACCOUNT_GROUP: MappingGroup = {
  ...ACCOUNT_GROUP,
  description: 'Hvor salget bogføres i e-conomic.',
  fields: ACCOUNT_GROUP.fields.map(({ expectVatCodes: _codes, ...f }) => f),
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
  connectionSettings: [],
  lookups: ['accounts'],
  outputs: [
    { entity: 'customer', label: 'Kontakter', trigger: { kind: 'poll', minMinutes: 15 } },
    // Retur-flows (§4.2): stock counts from the ERP back to the shops.
    { entity: 'stock', label: 'Lagerantal', trigger: { kind: 'poll', minMinutes: 15 } },
  ],
  // Dinero's field limits and VAT codes are not e-conomic's: no targets, no VAT-code checks.
  inputs: dinero.inputs.map(({ targets: _targets, tables: _tables, ...p }) => p),
  routeSettings: {
    order: [DINERO_INVOICE_SETTINGS[0]!, DINERO_INVOICE_SETTINGS[1]!, DINERO_INVOICE_SETTINGS[2]!],
  },
  dependencies: { order: ['customer', 'product'], creditNote: ['customer'] },
  mapping: {
    order: [ECONOMIC_ACCOUNT_GROUP],
    creditNote: [ECONOMIC_ACCOUNT_GROUP],
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
