import { EU_COUNTRIES } from '../model.js';
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
  version: '1.2.0',
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
  inputs: [
    { entity: 'stock', label: 'Lager', modes: ['dry_run', 'live'] },
    {
      entity: 'shipment',
      label: 'Afsendelser',
      modes: ['dry_run', 'live'],
      targets: [
        {
          key: 'note.text',
          label: 'Ordrenote',
          scope: 'record',
          required: false,
          default:
            'Ordren er sendt med {shipment.carrier|default:"fragt"}. Trackingnummer: {shipment.trackingRef|default:"-"}',
          editable: 'template',
        },
      ],
    },
    {
      entity: 'invoiceStatus',
      label: 'Fakturastatus',
      modes: ['dry_run', 'live'],
      targets: [
        {
          key: 'note.paid',
          label: 'Note når fakturaen er betalt',
          scope: 'record',
          required: false,
          default: 'Faktura {invoiceStatus.number} er betalt.',
          editable: 'template',
        },
        {
          key: 'note.posted',
          label: 'Note når fakturaen er bogført',
          scope: 'record',
          required: false,
          default: 'Faktura {invoiceStatus.number} er bogført.',
          editable: 'template',
        },
        {
          key: 'note.cancelled',
          label: 'Note når fakturaen er annulleret',
          scope: 'record',
          required: false,
          default: 'Fakturaen er annulleret i regnskabet.',
          editable: 'template',
        },
        {
          key: 'note.creditNote',
          label: 'Note når der er lavet en kreditnota',
          scope: 'record',
          required: false,
          default: 'Kreditnota {invoiceStatus.number} er bogført.',
          editable: 'template',
        },
      ],
    },
  ],
  routeSettings: {
    shipment: [
      {
        key: 'shipment.status',
        label: 'Ordrestatus når ordren er afsendt',
        type: 'select',
        default: 'completed',
        options: [
          { value: 'completed', label: 'Gennemført' },
          { value: '', label: 'Uændret' },
        ],
        help: 'WooCommerce sender sin egen e-mail, når status skifter, hvis den er slået til.',
      },
      {
        key: 'shipment.customerNote',
        label: 'Vis noten for kunden',
        type: 'boolean',
        default: true,
        help: 'Kunden får noten på e-mail fra WooCommerce.',
      },
    ],
    invoiceStatus: [
      {
        key: 'invoice.events',
        label: 'Skriv en note, når fakturaen',
        type: 'multiselect',
        default: ['paid'],
        options: [
          { value: 'posted', label: 'er bogført' },
          { value: 'paid', label: 'er betalt' },
          { value: 'cancelled', label: 'er annulleret' },
          { value: 'creditNote', label: 'er krediteret' },
        ],
      },
      {
        key: 'invoice.statusOnPaid',
        label: 'Ordrestatus når fakturaen er betalt',
        type: 'select',
        default: '',
        options: [
          { value: '', label: 'Uændret' },
          { value: 'completed', label: 'Gennemført' },
          { value: 'processing', label: 'Behandles' },
        ],
      },
    ],
  },
  counts: ['order', 'customer', 'product'],
  lookups: ['orderStatuses', 'paymentGateways', 'shippingMethods', 'categories'],
  rateLimit: { perMinute: 120 },
  webhook: { signatureHeader: 'x-wc-webhook-signature', scheme: 'hmac-sha256-base64' },
  changelog: [
    {
      version: '1.2.0',
      kind: 'additive',
      note: 'Afsendelser og fakturastatus fra regnskabet som ordrenoter og status.',
    },
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

const ODOO_SHIPMENT_VARIABLES: VariableDef[] = [
  v('shipment.sourceId', 'Leverings-id'),
  v('shipment.number', 'Leveringsnummer'),
  v('shipment.orderRef', 'Butikkens ordrenummer'),
  v('shipment.doneAt', 'Afsendt', 'date'),
  v('shipment.carrier', 'Fragtfirma'),
  v('shipment.trackingRef', 'Trackingnummer'),
  v('shipment.trackingUrl', 'Trackinglink'),
];

const ODOO_INVOICE_STATUS_VARIABLES: VariableDef[] = [
  v('invoiceStatus.sourceId', 'Faktura-id'),
  v('invoiceStatus.number', 'Fakturanummer'),
  v('invoiceStatus.orderRef', 'Butikkens ordrenummer'),
  v('invoiceStatus.state', 'Status'),
  v('invoiceStatus.paymentState', 'Betalingsstatus'),
  v('invoiceStatus.total', 'Total inkl. moms', 'money'),
  v('invoiceStatus.residual', 'Mangler at blive betalt', 'money'),
  v('invoiceStatus.date', 'Fakturadato', 'date'),
  v('invoiceStatus.dueDate', 'Forfaldsdato', 'date'),
];

const opt = (value: string, label: string) => ({ value, label });

const t = (
  key: string,
  label: string,
  defaultTemplate: string | undefined,
  editable: TargetField['editable'] = 'template',
  extra: Partial<TargetField> = {},
): TargetField => ({
  key,
  label,
  scope: 'record',
  required: false,
  ...(defaultTemplate !== undefined ? { default: defaultTemplate } : {}),
  editable,
  ...extra,
});

/** How contacts are found and kept up to date in Odoo (PLAN-INTEGRATIONS-WOO-ODOO16 §4.3). */
const ODOO_CONTACT_SETTINGS: SettingField[] = [
  {
    key: 'contact.match',
    label: 'Find kunden i Odoo på',
    type: 'select',
    default: 'email',
    options: [
      opt('email', 'E-mail'),
      opt('vat', 'Momsnummer'),
      opt('ref', 'Kundens reference'),
      opt('none', 'Brug én fælles kunde'),
    ],
  },
  {
    key: 'contact.shared',
    label: 'Fælles kunde',
    type: 'select',
    default: '',
    lookup: 'relation:res.partner',
    showIf: { key: 'contact.match', equals: 'none' },
  },
  {
    key: 'contact.update',
    label: 'Opdater på kunder, der findes',
    type: 'multiselect',
    default: ['name', 'street', 'zip', 'city', 'country', 'phone', 'email'],
    options: [
      opt('name', 'Navn'),
      opt('street', 'Adresse'),
      opt('zip', 'Postnummer'),
      opt('city', 'By'),
      opt('country', 'Land'),
      opt('phone', 'Telefon'),
      opt('email', 'E-mail'),
      opt('vat', 'Momsnummer'),
    ],
    help: 'Odoo kontrollerer momsnumre, så de opdateres kun, hvis du vælger det.',
  },
  {
    key: 'contact.shippingAddress',
    label: 'Leveringsadresse',
    type: 'select',
    default: 'childDelivery',
    options: [
      opt('childDelivery', 'Som leveringsadresse under kunden'),
      opt('none', 'Brug kundens adresse'),
    ],
    level: 'advanced',
  },
];

const ODOO_TAX_SETTINGS: SettingField[] = [
  {
    key: 'tax.strategy',
    label: 'Moms på linjerne',
    type: 'select',
    default: 'shopTax',
    options: [
      opt('shopTax', 'Den moms, butikken opkrævede (anbefalet)'),
      opt('odoo', 'Lad Odoo vælge ud fra varer og skatteregler'),
    ],
  },
  {
    key: 'tax.verify',
    label: 'Når Odoos moms ikke passer med butikkens',
    type: 'select',
    default: 'warn',
    options: [opt('warn', 'Advar'), opt('fail', 'Stop posten'), opt('off', 'Ignorer')],
    level: 'advanced',
  },
  {
    key: 'oss.mode',
    label: 'EU-salg til private',
    type: 'select',
    default: 'danishVat',
    options: [
      opt('danishVat', 'Dansk moms (under grænsen)'),
      opt('destinationVat', 'Købers lands moms (OSS)'),
    ],
  },
];

const ODOO_PRODUCT_SETTINGS: SettingField[] = [
  {
    key: 'products.match',
    label: 'Find varen i Odoo på',
    type: 'select',
    default: 'sku',
    options: [
      opt('sku', 'Varenummer (intern reference)'),
      opt('barcode', 'Stregkode (EAN)'),
      opt('none', 'Brug altid standardvaren'),
    ],
  },
  {
    key: 'products.missing',
    label: 'Når varen ikke findes i Odoo',
    type: 'select',
    default: 'useGeneric',
    options: [
      opt('useGeneric', 'Brug standardvaren'),
      opt('create', 'Opret varen'),
      opt('fail', 'Stop posten'),
    ],
  },
  {
    key: 'products.genericId',
    label: 'Standardvare',
    type: 'select',
    default: '',
    lookup: 'relation:product.product',
  },
  {
    key: 'products.type',
    label: 'Varetype for nye varer',
    type: 'select',
    default: 'consu',
    options: [
      opt('consu', 'Forbrugsvare'),
      opt('product', 'Lagerført vare'),
      opt('service', 'Ydelse'),
    ],
    level: 'advanced',
  },
  {
    key: 'fees.productId',
    label: 'Vare til gebyrer',
    type: 'select',
    default: '',
    lookup: 'relation:product.product',
    level: 'advanced',
  },
];

const ODOO_PAYMENT_SETTINGS: SettingField[] = [
  {
    key: 'payment.register',
    label: 'Registrer betaling på betalte ordrer',
    type: 'boolean',
    default: true,
  },
  {
    key: 'payment.journalId',
    label: 'Journal til betalinger uden egen række',
    type: 'select',
    default: '',
    lookup: 'journals',
  },
  {
    key: 'payment.differenceHandling',
    label: 'Små differencer på betalingen',
    type: 'select',
    default: 'open',
    options: [opt('open', 'Lad stå åbent'), opt('reconcile', 'Afskriv')],
    level: 'advanced',
  },
];

/** What the Odoo writer honours on orders (§4.3). */
const ODOO_ORDER_SETTINGS: SettingField[] = [
  {
    key: 'posting.type',
    label: 'Opret i Odoo som',
    type: 'select',
    default: 'saleOrderAndInvoice',
    options: [
      opt('saleOrderAndInvoice', 'Salgsordre og faktura'),
      opt('saleOrder', 'Kun salgsordre'),
      opt('invoice', 'Kun faktura'),
    ],
  },
  {
    key: 'order.confirm',
    label: 'Bekræft salgsordren',
    type: 'boolean',
    default: true,
    help: 'Kun i Live. I Kladde bliver ordren et tilbud.',
  },
  {
    key: 'order.invoiceWhen',
    label: 'Opret fakturaen',
    type: 'select',
    default: 'onPaid',
    options: [
      opt('onPaid', 'Når ordren er betalt'),
      opt('onConfirm', 'Når ordren er bekræftet'),
      opt('onDelivered', 'Når varerne er leveret i Odoo'),
      opt('never', 'Aldrig (fakturer i Odoo)'),
    ],
    showIf: { key: 'posting.type', equals: 'saleOrderAndInvoice' },
  },
  { key: 'invoice.post', label: 'Bogfør fakturaen', type: 'boolean', default: false },
  {
    key: 'invoice.updateDrafts',
    label: 'Opdater kladder og tilbud, når ordren ændres',
    type: 'boolean',
    default: true,
  },
  {
    key: 'invoice.journalId',
    label: 'Salgsjournal',
    type: 'select',
    default: '',
    lookup: 'journals',
    showIf: { key: 'posting.type', equals: 'invoice' },
  },
  {
    key: 'invoice.date',
    label: 'Fakturadato',
    type: 'select',
    default: 'paid',
    options: [opt('paid', 'Betalingsdato'), opt('order', 'Ordredato'), opt('today', 'Dagens dato')],
    level: 'advanced',
  },
  {
    key: 'invoice.lockedPeriod',
    label: 'Dato i en låst periode',
    type: 'select',
    default: 'moveToToday',
    options: [opt('moveToToday', 'Brug dagens dato'), opt('fail', 'Stop posten')],
    level: 'advanced',
  },
  {
    key: 'currency',
    label: 'Valuta',
    type: 'select',
    default: 'order',
    options: [opt('order', 'Ordrens valuta'), opt('company', 'Firmaets valuta')],
    level: 'advanced',
  },
  ...ODOO_TAX_SETTINGS,
  {
    key: 'rounding.policy',
    label: 'Øreafrunding',
    type: 'select',
    default: 'line',
    options: [
      opt('line', 'Afrundingslinje'),
      opt('ignoreBelow', 'Accepter forskellen'),
      opt('fail', 'Stop posten'),
    ],
  },
  {
    key: 'rounding.productId',
    label: 'Vare til øreafrunding',
    type: 'select',
    default: '',
    lookup: 'relation:product.product',
    showIf: { key: 'rounding.policy', equals: 'line' },
  },
  {
    key: 'rounding.maxDiff',
    label: 'Største afrunding (kr.)',
    type: 'number',
    default: 1,
    level: 'advanced',
  },
  ...ODOO_PRODUCT_SETTINGS,
  {
    key: 'shipping.productId',
    label: 'Vare til fragt',
    type: 'select',
    default: '',
    lookup: 'relation:product.product',
  },
  {
    key: 'warehouseId',
    label: 'Lager der leverer',
    type: 'select',
    default: '',
    lookup: 'warehouses',
  },
  {
    key: 'pricelistId',
    label: 'Prisliste',
    type: 'select',
    default: '',
    lookup: 'pricelists',
    level: 'advanced',
  },
  ...ODOO_PAYMENT_SETTINGS,
  { key: 'send.email', label: 'Send fakturaen på e-mail', type: 'boolean', default: false },
  {
    key: 'cancel.quotation',
    label: 'Annulleret ordre med tilbud i Odoo',
    type: 'select',
    default: 'cancel',
    options: [opt('cancel', 'Annuller tilbuddet'), opt('keep', 'Behold det')],
    level: 'advanced',
  },
  {
    key: 'cancel.confirmed',
    label: 'Annulleret ordre, der er bekræftet men ikke faktureret',
    type: 'select',
    default: 'cancel',
    options: [opt('cancel', 'Annuller salgsordren'), opt('warn', 'Advar kun')],
    level: 'advanced',
  },
  ...ODOO_CONTACT_SETTINGS,
];

const ODOO_CREDIT_NOTE_SETTINGS: SettingField[] = [
  {
    key: 'creditNote.mode',
    label: 'Kreditnota',
    type: 'select',
    default: 'standalone',
    options: [
      opt('standalone', 'Med de refunderede linjer'),
      opt('reversal', 'Tilbagefør hele fakturaen ved fuld refusion'),
    ],
  },
  { key: 'creditNote.post', label: 'Bogfør kreditnotaen', type: 'boolean', default: false },
  {
    key: 'creditNote.registerRefund',
    label: 'Registrer udbetalingen, når butikken har refunderet',
    type: 'boolean',
    default: false,
  },
  ...ODOO_TAX_SETTINGS,
  ...ODOO_PRODUCT_SETTINGS,
  ODOO_PAYMENT_SETTINGS[1]!,
];

const ODOO_PRODUCT_WRITE_SETTINGS: SettingField[] = [
  { key: 'product.create', label: 'Opret nye varer', type: 'boolean', default: true },
  { key: 'product.update', label: 'Opdater varer, der findes', type: 'boolean', default: true },
  ODOO_PRODUCT_SETTINGS[3]!,
];

const taxField = (
  key: string,
  label: string,
  extra: Partial<MappingGroup['fields'][number]> = {},
): MappingGroup['fields'][number] => ({ key, label, required: false, lookup: 'taxes', ...extra });

/** The Odoo tax per sale type, when the route books the shop's VAT (tax.strategy shopTax, O8). */
const ODOO_TAX_GROUP: MappingGroup = {
  key: 'taxes',
  title: 'Moms',
  description: 'Hvilken moms i Odoo linjerne får. Kontoen kommer fra varen i Odoo.',
  fields: [
    taxField('tax.domestic', 'Salg med dansk moms', {
      requiredIf: { setting: 'tax.strategy', equals: 'shopTax' },
    }),
    taxField('tax.vatFree', 'Momsfrit salg'),
    taxField('tax.euB2b', 'EU B2B-salg af varer'),
    taxField('tax.euB2bServices', 'EU B2B-salg af ydelser'),
    taxField('tax.export', 'Salg af varer uden for EU'),
    taxField('tax.exportServices', 'Salg af ydelser uden for EU'),
    taxField('tax.euB2c', 'EU-salg til private (OSS)', {
      requiredIf: { setting: 'oss.mode', equals: 'destinationVat' },
    }),
  ],
};

const FISCAL_LABELS = {
  domestic: 'Danmark',
  euB2b: 'EU B2B',
  euB2c: 'EU-private',
  export: 'Uden for EU',
} as const;

/** Fiscal position per sale type, used when Odoo chooses the taxes (tax.strategy odoo). */
const ODOO_FISCAL_GROUP: MappingGroup = {
  key: 'fiscal',
  title: 'Skatteregler',
  description: 'Bruges, når Odoo vælger momsen. Tomt: Odoo finder selv reglen ud fra kunden.',
  fields: Object.entries(FISCAL_LABELS).map(([k, label]) => ({
    key: `fiscal.${k}`,
    label,
    required: false,
    lookup: 'fiscalPositions' as const,
  })),
};

/** Payment method → Odoo journal (§4.4 table 1). */
const ODOO_PAYMENT_METHODS: MappingTable = {
  key: 'paymentMethods',
  title: 'Betalingsmetoder',
  description: 'Hvilken journal betalingen registreres i i Odoo.',
  from: { lookup: 'paymentGateways', label: 'Betalingsmetode' },
  to: [{ key: 'journal', label: 'Journal', lookup: 'journals' }],
};

const ODOO_LINE_NAME: TargetField = {
  key: 'line.name',
  label: 'Linjetekst',
  scope: 'line',
  required: true,
  default: '{line.name}',
  editable: 'template',
};

/** What Odoo writes that templates fill (§4.5). External ids are the idempotency key (O7). */
const ODOO_ORDER_TARGETS: TargetField[] = [
  t('order.externalId', 'Ekstern id', 'woo_{connection.id}_order_{order.sourceId}', 'expression', {
    required: true,
  }),
  t('order.clientRef', 'Kundens reference', '{order.number}'),
  t('order.origin', 'Kildedokument', 'WooCommerce {order.number}'),
  t('order.note', 'Vilkår og bemærkning', '{order.note}'),
  t('invoice.ref', 'Fakturaens reference', '{order.number}'),
  t('invoice.paymentReference', 'Betalingsreference', '{order.number}'),
  t('invoice.narration', 'Fakturatekst', undefined),
  t('payment.memo', 'Betalingens tekst', '{order.paymentMethod.title} {order.transactionId}'),
  t(
    'partner.externalId',
    'Kundens eksterne id',
    'woo_{connection.id}_customer_{order.customer.sourceId}',
    'expression',
  ),
  t('partner.name', 'Kundens navn', undefined),
  ODOO_LINE_NAME,
];

const ODOO_CREDIT_NOTE_TARGETS: TargetField[] = [
  t(
    'creditNote.externalId',
    'Ekstern id',
    'woo_{connection.id}_refund_{creditNote.sourceId}',
    'expression',
    { required: true },
  ),
  t(
    'creditNote.orderExternalId',
    'Ordrens eksterne id',
    'woo_{connection.id}_order_{creditNote.orderSourceId}',
    'expression',
    { required: true },
  ),
  t(
    'creditNote.ref',
    'Reference',
    'Refusion {creditNote.number} for ordre {creditNote.meta.orderNumber}',
  ),
  ODOO_LINE_NAME,
];

const ODOO_CONTACT_TARGETS: TargetField[] = [
  t(
    'partner.externalId',
    'Ekstern id',
    'woo_{connection.id}_customer_{customer.sourceId}',
    'expression',
  ),
  t('partner.name', 'Navn', undefined),
  t('partner.ref', 'Reference', undefined),
  t('partner.comment', 'Note', undefined),
];

const ODOO_PRODUCT_TARGETS: TargetField[] = [
  t(
    'product.externalId',
    'Ekstern id',
    'woo_{connection.id}_product_{product.sourceId}',
    'expression',
  ),
];

/**
 * Odoo (PLAN-INTEGRATIONS-WOO-ODOO16): self-hosted, Odoo.sh or Odoo Online on the Custom plan.
 * Reads stock, deliveries and invoice status; writes contacts, products, sales orders with their
 * invoice, direct invoices, payments and credit notes.
 */
export const odoo: ConnectorManifest = {
  id: 'odoo',
  name: 'Odoo',
  version: '1.1.0',
  category: 'erp',
  logo: '/logos/odoo.svg',
  auth: {
    type: 'api_key',
    fields: [
      {
        key: 'baseUrl',
        label: 'Odoo-adresse',
        type: 'url',
        placeholder: 'https://odoo.firma.dk',
        help: 'Skal kunne nås fra internettet over HTTPS.',
      },
      {
        key: 'database',
        label: 'Database',
        type: 'text',
        help: 'Databasens navn. Det står i Odoo under Indstillinger, eller hos jeres driftspartner.',
      },
      {
        key: 'login',
        label: 'Brugerens login',
        type: 'text',
        help: 'Brug en bruger kun til integrationen.',
      },
      {
        key: 'apiKey',
        label: 'API-nøgle',
        type: 'secret',
        help: 'Oprettes under Præferencer → Kontosikkerhed → Ny API-nøgle.',
      },
    ],
  },
  accountHint: 'Firma i Odoo',
  connectionSettings: [
    { key: 'companyId', label: 'Firma', type: 'select', default: '', lookup: 'companies' },
    {
      key: 'stock.warehouseId',
      label: 'Lager',
      type: 'select',
      default: '',
      lookup: 'warehouses',
      help: 'Tomt: alle lagre i firmaet.',
    },
    {
      key: 'stock.quantity',
      label: 'Antal på lager til butikken',
      type: 'select',
      default: 'free_qty',
      options: [
        { value: 'free_qty', label: 'Ledigt (på lager minus reserveret)' },
        { value: 'qty_available', label: 'På lager' },
        { value: 'virtual_available', label: 'Forventet (med indkøb og salg)' },
      ],
    },
    {
      key: 'stock.match',
      label: 'Find varen i butikken på',
      type: 'select',
      default: 'sku',
      options: [
        { value: 'sku', label: 'Varenummer (intern reference)' },
        { value: 'barcode', label: 'Stregkode (EAN)' },
      ],
    },
    {
      key: 'stock.safetyBuffer',
      label: 'Sikkerhedslager',
      type: 'number',
      default: 0,
      help: 'Trækkes fra antallet, så butikken ikke sælger de sidste.',
    },
    {
      key: 'stock.onlyStorable',
      label: 'Kun lagerførte varer',
      type: 'boolean',
      default: true,
      level: 'advanced',
    },
    {
      key: 'lang',
      label: 'Sprog i Odoo',
      type: 'text',
      default: '',
      level: 'advanced',
      help: 'Fx da_DK. Tomt: brugerens sprog.',
    },
    { key: 'batchSize', label: 'Poster pr. kald', type: 'number', default: 200, level: 'advanced' },
  ],
  lookups: [
    'apps',
    'companies',
    'warehouses',
    'locations',
    'pickingTypes',
    'journals',
    'taxes',
    'fiscalPositions',
    'paymentTerms',
    'pricelists',
    'productCategories',
    'carriers',
    'accounts',
    'relation:product.product',
    'relation:res.partner',
  ],
  outputs: [
    { entity: 'stock', label: 'Lager', trigger: { kind: 'poll', minMinutes: 5 } },
    {
      entity: 'shipment',
      label: 'Leveringer',
      trigger: { kind: 'poll', minMinutes: 5 },
      variables: ODOO_SHIPMENT_VARIABLES,
      dynamicVariables: [{ model: 'stock.picking', scope: 'record', prefix: 'shipment.fields' }],
    },
    {
      entity: 'invoiceStatus',
      label: 'Fakturastatus',
      trigger: { kind: 'poll', minMinutes: 15 },
      variables: ODOO_INVOICE_STATUS_VARIABLES,
      dynamicVariables: [
        { model: 'account.move', scope: 'record', prefix: 'invoiceStatus.fields' },
      ],
    },
  ],
  inputs: [
    {
      entity: 'order',
      label: 'Salgsordrer og fakturaer',
      modes: [...ORDER_MODES],
      targets: ODOO_ORDER_TARGETS,
      tables: [ODOO_PAYMENT_METHODS],
      dynamicTargets: [
        { model: 'sale.order', scope: 'record', prefix: 'order.fields' },
        { model: 'account.move', scope: 'record', prefix: 'invoice.fields' },
      ],
    },
    {
      entity: 'creditNote',
      label: 'Kreditnotaer',
      modes: [...ORDER_MODES],
      targets: ODOO_CREDIT_NOTE_TARGETS,
      tables: [ODOO_PAYMENT_METHODS],
    },
    {
      entity: 'customer',
      label: 'Kontakter',
      modes: ['dry_run', 'live'],
      targets: ODOO_CONTACT_TARGETS,
      dynamicTargets: [{ model: 'res.partner', scope: 'record', prefix: 'partner.fields' }],
    },
    {
      entity: 'product',
      label: 'Produkter',
      modes: ['dry_run', 'live'],
      targets: ODOO_PRODUCT_TARGETS,
    },
  ],
  mapping: { order: [ODOO_TAX_GROUP, ODOO_FISCAL_GROUP], creditNote: [ODOO_TAX_GROUP] },
  routeSettings: {
    order: ODOO_ORDER_SETTINGS,
    creditNote: ODOO_CREDIT_NOTE_SETTINGS,
    customer: ODOO_CONTACT_SETTINGS,
    product: ODOO_PRODUCT_WRITE_SETTINGS,
  },
  dependencies: { order: ['customer'] },
  rateLimit: { perMinute: 120 },
  changelog: [
    {
      version: '1.1.0',
      kind: 'additive',
      note: 'Salgsordrer, fakturaer, betalinger, kreditnotaer, kontakter og varer.',
    },
    {
      version: '1.0.0',
      kind: 'additive',
      note: 'Første version: lager, leveringer og fakturastatus.',
    },
  ],
};

/* ---- e-conomic (PLAN-INTEGRATIONS-ECONOMIC) ---------------------------------------------------- */

const ECONOMIC_CUSTOMER_VARIABLES: VariableDef[] = [
  v('customer.sourceId', 'Kundenummer'),
  ...customerVariables('customer.'),
];

const ECONOMIC_PRODUCT_VARIABLES: VariableDef[] = [
  v('product.sku', 'Varenummer'),
  v('product.name', 'Varenavn'),
  v('product.price', 'Salgspris uden moms', 'money'),
  v('product.ean', 'Stregkode (EAN)'),
  v('product.category', 'Varegruppe'),
];

const ECONOMIC_STOCK_VARIABLES: VariableDef[] = [
  v('stock.sku', 'Varenummer'),
  v('stock.quantity', 'Antal på lager', 'number'),
];

const ECONOMIC_INVOICE_STATUS_VARIABLES: VariableDef[] = [
  v('invoiceStatus.number', 'Fakturanummer'),
  v('invoiceStatus.orderRef', 'Butikkens ordrenummer'),
  v('invoiceStatus.kind', 'Faktura eller kreditnota'),
  v('invoiceStatus.paymentState', 'Betalingsstatus'),
  v('invoiceStatus.total', 'Total inkl. moms', 'money'),
  v('invoiceStatus.residual', 'Mangler at blive betalt', 'money'),
  v('invoiceStatus.currency', 'Valuta'),
  v('invoiceStatus.date', 'Fakturadato', 'date'),
  v('invoiceStatus.dueDate', 'Forfaldsdato', 'date'),
];

/** How customers are found and kept up to date in e-conomic (§4.3 Kunder). */
const ECONOMIC_CONTACT_SETTINGS: SettingField[] = [
  {
    key: 'contact.match',
    label: 'Find kunden i e-conomic på',
    type: 'select',
    default: 'email',
    options: [
      opt('email', 'E-mail'),
      opt('cvr', 'CVR- eller momsnummer'),
      opt('number', 'Butikkens kundenummer'),
      opt('none', 'Brug én fælles kunde'),
    ],
  },
  {
    key: 'contact.shared',
    label: 'Kundenummer på den fælles kunde',
    type: 'number',
    default: 0,
    showIf: { key: 'contact.match', equals: 'none' },
  },
  {
    key: 'contact.numberOffset',
    label: 'Læg til butikkens kundenummer',
    type: 'number',
    default: 0,
    level: 'advanced',
    showIf: { key: 'contact.match', equals: 'number' },
    help: 'Fx 100000, så webshopkunder får deres egen nummerserie.',
  },
  {
    key: 'contact.update',
    label: 'Opdater på kunder, der findes',
    type: 'multiselect',
    default: ['name', 'address', 'zip', 'city', 'country', 'email', 'phone', 'ean'],
    options: [
      opt('name', 'Navn'),
      opt('address', 'Adresse'),
      opt('zip', 'Postnummer'),
      opt('city', 'By'),
      opt('country', 'Land'),
      opt('email', 'E-mail'),
      opt('phone', 'Telefon'),
      opt('cvr', 'CVR-nummer'),
      opt('ean', 'EAN-nummer'),
    ],
  },
  {
    key: 'contact.group',
    label: 'Kundegruppe for nye kunder',
    type: 'select',
    default: '',
    lookup: 'customerGroups',
    help: 'Tom: forbindelsens kundegruppe.',
  },
  {
    key: 'contact.groupForeign',
    label: 'Kundegruppe for udenlandske kunder',
    type: 'select',
    default: '',
    lookup: 'customerGroups',
    level: 'advanced',
    help: 'Tom: samme som andre nye kunder.',
  },
  {
    key: 'contact.attention',
    label: 'Køberen som att.-person hos firmakunder',
    type: 'boolean',
    default: true,
    level: 'advanced',
  },
];

const ECONOMIC_PRODUCT_SETTINGS: SettingField[] = [
  {
    key: 'products.match',
    label: 'Find varen i e-conomic på',
    type: 'select',
    default: 'sku',
    options: [
      opt('sku', 'Varenummer (SKU)'),
      opt('barcode', 'Stregkode (EAN)'),
      opt('none', 'Brug altid standardvaren'),
    ],
    help: 'e-conomic bogfører linjen på varens varegruppe, så hver linje skal have en vare.',
  },
  {
    key: 'products.missing',
    label: 'Når varen ikke findes i e-conomic',
    type: 'select',
    default: 'useGeneric',
    options: [
      opt('useGeneric', 'Brug standardvaren'),
      opt('create', 'Opret varen'),
      opt('fail', 'Stop posten'),
    ],
  },
  {
    key: 'products.group',
    label: 'Varegruppe for nye varer',
    type: 'select',
    default: '',
    lookup: 'productGroups',
    showIf: { key: 'products.missing', equals: 'create' },
    help: 'Bruges, når kategorien ikke har sin egen række.',
  },
  {
    key: 'lines.unit',
    label: 'Enhed på linjerne',
    type: 'select',
    default: '',
    lookup: 'units',
    level: 'advanced',
  },
];

const ECONOMIC_PAYMENT_SETTINGS: SettingField[] = [
  {
    key: 'payment.register',
    label: 'Registrer betaling på betalte ordrer',
    type: 'boolean',
    default: true,
    help: 'Betalingen lægges i kassekladden mod den bogførte faktura.',
  },
  {
    key: 'payment.journal',
    label: 'Kassekladde til betalinger',
    type: 'select',
    default: '',
    lookup: 'journals',
    showIf: { key: 'payment.register', equals: true },
  },
  {
    key: 'payment.account',
    label: 'Modkonto for betalinger',
    type: 'select',
    default: '',
    lookup: 'accounts',
    help: 'Fx bank eller kortindløserens mellemregning. Bruges, når betalingsmetoden ikke har sin egen.',
  },
  {
    key: 'payment.book',
    label: 'Bogfør betalingen',
    type: 'boolean',
    default: false,
    help: 'Slået fra: betalingen venter i kassekladden. Kun Agentors egne posteringer bogføres.',
  },
];

const ECONOMIC_ROUNDING_SETTINGS: SettingField[] = [
  {
    key: 'rounding.policy',
    label: 'Øreafrunding',
    type: 'select',
    default: 'line',
    options: [
      opt('line', 'Afrundingslinje'),
      opt('ignoreBelow', 'Accepter forskellen'),
      opt('fail', 'Stop posten'),
    ],
  },
  {
    key: 'rounding.maxDiff',
    label: 'Største afrunding (kr.)',
    type: 'number',
    default: 1,
    level: 'advanced',
  },
];

/** What the e-conomic client honours on invoices (§4.3 Fakturaer). */
const ECONOMIC_INVOICE_SETTINGS: SettingField[] = [
  {
    key: 'posting.type',
    label: 'Bogfør ordrer som',
    type: 'select',
    default: 'invoice',
    options: [opt('invoice', 'Faktura i e-conomic'), opt('journal', 'Bilag i kassekladden')],
    help: 'Bilag: butikkens egen faktura er bilaget, og linjerne bogføres på de valgte konti.',
  },
  {
    key: 'invoice.bookAutomatically',
    label: 'Bogfør fakturaer automatisk',
    type: 'boolean',
    default: false,
    showIf: { key: 'posting.type', equals: 'invoice' },
    help: 'Slået fra: fakturaerne venter som kladder i e-conomic. Kun i Live.',
  },
  {
    key: 'invoice.updateDrafts',
    label: 'Opdater kladder, når ordren ændres',
    type: 'boolean',
    default: true,
    help: 'En bogført faktura ændres aldrig.',
  },
  {
    key: 'invoice.layout',
    label: 'Layout',
    type: 'select',
    default: '',
    lookup: 'layouts',
    showIf: { key: 'posting.type', equals: 'invoice' },
    help: 'Tom: forbindelsens layout.',
  },
  {
    key: 'paymentTerms.paid',
    label: 'Betalingsbetingelse på betalte ordrer',
    type: 'select',
    default: '',
    lookup: 'paymentTerms',
    help: 'Fx "Betalt" eller "Kontant". Tom: som ubetalte ordrer.',
  },
  {
    key: 'paymentTerms.unpaid',
    label: 'Betalingsbetingelse på ubetalte ordrer',
    type: 'select',
    default: '',
    lookup: 'paymentTerms',
    help: 'Tom: kundens egen betingelse i e-conomic.',
  },
  {
    key: 'oss.mode',
    label: 'EU-salg til private',
    type: 'select',
    default: 'danishVat',
    options: [
      opt('danishVat', 'Dansk moms (under grænsen)'),
      opt('destinationVat', 'Købers lands moms (OSS)'),
    ],
    help: 'OSS: kunden får sit lands momszone i e-conomic.',
  },
  {
    key: 'invoice.delivery',
    label: 'Leveringsadresse på fakturaen',
    type: 'boolean',
    default: true,
    showIf: { key: 'posting.type', equals: 'invoice' },
  },
  {
    key: 'invoice.date',
    label: 'Fakturadato',
    type: 'select',
    default: 'paid',
    options: [opt('paid', 'Betalingsdato'), opt('order', 'Ordredato'), opt('today', 'Dagens dato')],
    level: 'advanced',
  },
  {
    key: 'invoice.bookWithShopNumber',
    label: 'Brug butikkens ordrenummer som fakturanummer',
    type: 'boolean',
    default: false,
    level: 'advanced',
    help: 'Kun når ordrenummeret er et tal. Ellers bruges e-conomics nummerserie.',
  },
  ...ECONOMIC_PRODUCT_SETTINGS,
  ...ECONOMIC_ROUNDING_SETTINGS,
  ...ECONOMIC_PAYMENT_SETTINGS,
  {
    key: 'send.eInvoice',
    label: 'Send EAN-faktura',
    type: 'boolean',
    default: false,
    help: 'Når kunden har et EAN-nummer. Sendes, når fakturaen bogføres.',
  },
  {
    key: 'send.email',
    label: 'Send fakturaen på e-mail fra e-conomic',
    type: 'boolean',
    default: false,
    level: 'advanced',
  },
  {
    key: 'journal.number',
    label: 'Kassekladde til bilag',
    type: 'select',
    default: '',
    lookup: 'journals',
    showIf: { key: 'posting.type', equals: 'journal' },
  },
  {
    key: 'journal.book',
    label: 'Bogfør bilagene',
    type: 'boolean',
    default: false,
    showIf: { key: 'posting.type', equals: 'journal' },
    help: 'Kun i Live, og kun Agentors egne posteringer.',
  },
  ...ECONOMIC_CONTACT_SETTINGS,
];

const ECONOMIC_CREDIT_NOTE_SETTINGS: SettingField[] = [
  {
    key: 'creditNote.bookAutomatically',
    label: 'Bogfør kreditnotaer automatisk',
    type: 'boolean',
    default: false,
    help: 'Kun i Live.',
  },
  {
    key: 'creditNote.missingInvoice',
    label: 'Når fakturaen ikke er bogført endnu',
    type: 'select',
    default: 'wait',
    options: [opt('wait', 'Vent og prøv igen'), opt('standalone', 'Lav kreditnotaen alligevel')],
  },
  {
    key: 'creditNote.registerRefund',
    label: 'Registrer udbetalingen, når butikken har refunderet',
    type: 'boolean',
    default: false,
  },
  ECONOMIC_INVOICE_SETTINGS[2]!,
  ECONOMIC_INVOICE_SETTINGS[3]!,
  ECONOMIC_INVOICE_SETTINGS[6]!,
  ...ECONOMIC_PRODUCT_SETTINGS,
  ...ECONOMIC_ROUNDING_SETTINGS,
  ...ECONOMIC_PAYMENT_SETTINGS.slice(1),
  ...ECONOMIC_CONTACT_SETTINGS,
];

const ECONOMIC_PRODUCT_WRITE_SETTINGS: SettingField[] = [
  { key: 'product.create', label: 'Opret nye varer', type: 'boolean', default: true },
  { key: 'product.update', label: 'Opdater varer, der findes', type: 'boolean', default: true },
  {
    key: 'product.fields',
    label: 'Felter der opdateres',
    type: 'multiselect',
    default: ['name', 'barcode'],
    options: [opt('name', 'Navn'), opt('price', 'Salgspris'), opt('barcode', 'Stregkode')],
    help: 'Priser ændres kun, hvis du vælger det.',
  },
  (({ showIf: _showIf, ...f }) => f)(ECONOMIC_PRODUCT_SETTINGS[2]!),
  ECONOMIC_PRODUCT_SETTINGS[3]!,
];

const zoneField = (key: string, label: string, help: string) => ({
  key,
  label,
  required: false,
  lookup: 'vatZones' as const,
  help,
});

/** The VAT zone per sale kind (E6). Empty: the standard zones of a Danish agreement. */
const ECONOMIC_ZONE_GROUP: MappingGroup = {
  key: 'zones',
  title: 'Momszoner',
  description: 'Zonen afgør momsen og kontoen sammen med varegruppen i e-conomic.',
  fields: [
    zoneField('zones.domestic', 'Danmark', 'Tom: zone 1 (Indland).'),
    zoneField('zones.euB2b', 'EU-firmaer med momsnummer', 'Tom: zone 2 (EU).'),
    zoneField('zones.euB2c', 'EU-private (dansk moms)', 'Tom: som Danmark. Ved OSS: købers land.'),
    zoneField('zones.export', 'Uden for EU', 'Tom: zone 3 (Udland).'),
  ],
};

/** The products lines book through when the shop's product isn't in e-conomic (E5). */
const ECONOMIC_PRODUCT_GROUP: MappingGroup = {
  key: 'products',
  title: 'Varer',
  description: 'Hver fakturalinje skal have en vare i e-conomic. Varegruppen afgør kontoen.',
  fields: [
    {
      key: 'products.generic',
      label: 'Standardvare',
      required: false,
      lookup: 'products',
      help: 'Bruges, når varen ikke findes i e-conomic.',
    },
    {
      key: 'products.genericServices',
      label: 'Standardvare for ydelser',
      required: false,
      lookup: 'products',
      help: 'Til EU- og eksportsalg af ydelser. Tom: standardvaren.',
    },
    { key: 'products.shipping', label: 'Fragt', required: false, lookup: 'products' },
    { key: 'products.fees', label: 'Gebyrer', required: false, lookup: 'products' },
    {
      key: 'products.rounding',
      label: 'Øreafrunding',
      required: false,
      lookup: 'products',
      help: 'Bør ligge i en momsfri varegruppe.',
    },
  ],
};

/** Accounts for the journal posting type only (X3); stable keys from v1. */
const ECONOMIC_ACCOUNT_GROUP: MappingGroup = {
  ...ACCOUNT_GROUP,
  description: 'Kun ved bilag i kassekladden: hvor salget bogføres.',
  fields: ACCOUNT_GROUP.fields.map(({ expectVatCodes: _codes, required, requiredIf, ...f }) => ({
    ...f,
    required: false,
    ...(required || requiredIf
      ? { requiredIf: { setting: 'posting.type', equals: 'journal' } }
      : {}),
  })),
};

const ECONOMIC_PAYMENT_METHODS: MappingTable = {
  key: 'paymentMethods',
  title: 'Betalingsmetoder',
  description: 'Hvor betalingen registreres i e-conomic.',
  from: { lookup: 'paymentGateways', label: 'Betalingsmetode' },
  to: [
    { key: 'account', label: 'Modkonto', lookup: 'accounts' },
    { key: 'journal', label: 'Kassekladde', lookup: 'journals' },
  ],
};

const ECONOMIC_PRODUCT_GROUPS: MappingTable = {
  key: 'productGroups',
  title: 'Varegrupper',
  description: 'Hvilken varegruppe nye varer oprettes i.',
  from: { lookup: 'categories', label: 'Kategori' },
  to: [{ key: 'group', label: 'Varegruppe', lookup: 'productGroups' }],
};

const ECONOMIC_OSS_ZONES: MappingTable = {
  key: 'ossZones',
  title: 'OSS-zoner',
  description: 'Momszone pr. land ved OSS. Tom: zonen med landets navn.',
  from: {
    lookup: 'countries',
    label: 'Land',
    options: [...EU_COUNTRIES]
      .filter((c) => c !== 'DK')
      .sort()
      .map((c) => ({ value: c, label: c })),
  },
  to: [{ key: 'zone', label: 'Momszone', lookup: 'vatZones' }],
};

/** What e-conomic writes that templates fill (§4.5). `externalId` is the idempotency key (E8). */
const ECONOMIC_INVOICE_TARGETS: TargetField[] = [
  t('invoice.externalId', 'Ekstern id', 'ag:{connection.short}:o:{order.sourceId}', 'expression', {
    required: true,
    maxLength: 50,
  }),
  t('invoice.otherReference', 'Anden reference', '{order.number}', 'template', {
    required: true,
    maxLength: 250,
  }),
  t('invoice.heading', 'Overskrift', 'Ordre {order.number}', 'template', { maxLength: 250 }),
  t('invoice.textLine1', 'Tekst 1', '{order.note}', 'template', { maxLength: 1000 }),
  t('invoice.textLine2', 'Tekst 2', undefined, 'template', { maxLength: 1000 }),
  t('invoice.publicEntryNumber', 'Rekvisitionsnummer (EAN)', undefined, 'template', {
    maxLength: 30,
  }),
  t(
    'payment.text',
    'Betalingens tekst',
    '{order.paymentMethod.title} {order.transactionId}',
    'template',
    {
      maxLength: 250,
    },
  ),
  t('voucher.text', 'Bilagstekst', 'Ordre {order.number}', 'template', { maxLength: 250 }),
  t('customer.name', 'Kundens navn', undefined, 'template', { maxLength: 255 }),
  { ...ODOO_LINE_NAME, key: 'line.description', maxLength: 2500 },
];

const ECONOMIC_CREDIT_NOTE_TARGETS: TargetField[] = [
  t(
    'creditNote.externalId',
    'Ekstern id',
    'ag:{connection.short}:r:{creditNote.sourceId}',
    'expression',
    { required: true, maxLength: 50 },
  ),
  t(
    'creditNote.invoiceReference',
    'Fakturaens reference',
    '{creditNote.meta.orderNumber}',
    'expression',
    {
      required: true,
      maxLength: 250,
    },
  ),
  t(
    'creditNote.otherReference',
    'Anden reference',
    '{creditNote.meta.orderNumber}-R{creditNote.number}',
    'template',
    { required: true, maxLength: 250 },
  ),
  t(
    'creditNote.heading',
    'Overskrift',
    'Kreditnota for ordre {creditNote.meta.orderNumber}',
    'template',
    {
      maxLength: 250,
    },
  ),
  t('creditNote.textLine1', 'Tekst 1', undefined, 'template', { maxLength: 1000 }),
  t('creditNote.textLine2', 'Tekst 2', '{creditNote.reason}', 'template', { maxLength: 1000 }),
  { ...ODOO_LINE_NAME, key: 'line.description', maxLength: 2500 },
];

const ECONOMIC_CUSTOMER_TARGETS: TargetField[] = [
  t('customer.name', 'Navn', undefined, 'template', { maxLength: 255 }),
];

const ECONOMIC_PRODUCT_TARGETS: TargetField[] = [
  t('product.name', 'Varenavn', undefined, 'template', { maxLength: 300 }),
];

/**
 * e-conomic (PLAN-INTEGRATIONS-ECONOMIC): invoices through products and VAT zones, credit notes
 * as negative invoices, payments and vouchers in the kassekladde; customers, products, stock and
 * invoice status as a source. Writes need the Plus plan or higher (E3).
 */
export const economic: ConnectorManifest = {
  id: 'economic',
  name: 'e-conomic',
  version: '2.0.0',
  category: 'erp',
  logo: '/logos/economic.svg',
  auth: {
    type: 'api_key',
    fields: [
      {
        key: 'grantToken',
        label: 'Agreement grant token',
        type: 'secret',
        help: 'Vises, når du tilføjer Agentor under Apps i e-conomic. Revisorer klikker først Administrér på kundens aftale.',
      },
    ],
  },
  accountHint: 'Aftale i e-conomic',
  connectionSettings: [
    {
      key: 'layout',
      label: 'Fakturalayout',
      type: 'select',
      default: '',
      lookup: 'layouts',
      help: 'Tom: det første layout i aftalen.',
    },
    {
      key: 'customerGroup',
      label: 'Kundegruppe for nye kunder',
      type: 'select',
      default: '',
      lookup: 'customerGroups',
    },
    {
      key: 'paymentTerms',
      label: 'Betalingsbetingelse for nye kunder',
      type: 'select',
      default: '',
      lookup: 'paymentTerms',
      help: 'Tom: aftalens standard.',
    },
    {
      key: 'stock.quantity',
      label: 'Antal på lager til butikken',
      type: 'select',
      default: 'available',
      options: [
        opt('available', 'Disponibelt (på lager minus bestilt af kunder)'),
        opt('inStock', 'På lager'),
      ],
      help: 'Kræver modulet Lager i e-conomic.',
    },
    {
      key: 'stock.safetyBuffer',
      label: 'Sikkerhedslager',
      type: 'number',
      default: 0,
      help: 'Trækkes fra antallet, så butikken ikke sælger de sidste.',
    },
    {
      key: 'stock.scan',
      label: 'Læs lager',
      type: 'select',
      default: 'all',
      level: 'advanced',
      options: [opt('all', 'Alle lagervarer hver gang'), opt('changed', 'Kun ændrede varer')],
    },
    {
      key: 'invoiceStatus.days',
      label: 'Fakturastatus for de seneste (dage)',
      type: 'number',
      default: 90,
      level: 'advanced',
    },
    {
      key: 'invoiceStatus.orderRefPattern',
      label: 'Ordrenummer i "Anden reference" (regex)',
      type: 'text',
      default: '',
      level: 'advanced',
      help: 'Første gruppe er ordrenummeret. Tom: hele referencen.',
    },
    {
      key: 'countryNames',
      label: 'Landenavne i e-conomic',
      type: 'select',
      default: 'da',
      level: 'advanced',
      options: [opt('da', 'Dansk'), opt('en', 'Engelsk')],
    },
    {
      key: 'webhooks.mode',
      label: 'Hent ændringer',
      type: 'select',
      default: 'webhook+poll',
      level: 'advanced',
      options: [
        opt('webhook+poll', 'Webhooks og kontrol hvert kvarter'),
        opt('poll', 'Kun kontrol'),
      ],
    },
  ],
  lookups: [
    'layouts',
    'vatZones',
    'paymentTerms',
    'customerGroups',
    'productGroups',
    'units',
    'journals',
    'accounts',
    'vatCodes',
    'products',
  ],
  outputs: [
    {
      entity: 'customer',
      label: 'Kunder',
      trigger: { kind: 'webhook' },
      variables: ECONOMIC_CUSTOMER_VARIABLES,
    },
    {
      entity: 'product',
      label: 'Varer',
      trigger: { kind: 'webhook' },
      variables: ECONOMIC_PRODUCT_VARIABLES,
    },
    // Retur-flows (§4.2): stock counts from the ERP back to the shops.
    {
      entity: 'stock',
      label: 'Lagerantal',
      trigger: { kind: 'poll', minMinutes: 15 },
      variables: ECONOMIC_STOCK_VARIABLES,
    },
    {
      entity: 'invoiceStatus',
      label: 'Fakturastatus',
      trigger: { kind: 'poll', minMinutes: 15 },
      variables: ECONOMIC_INVOICE_STATUS_VARIABLES,
    },
  ],
  inputs: [
    {
      entity: 'order',
      label: 'Fakturaer',
      modes: [...ORDER_MODES],
      targets: ECONOMIC_INVOICE_TARGETS,
      tables: [ECONOMIC_PAYMENT_METHODS, ECONOMIC_PRODUCT_GROUPS, ECONOMIC_OSS_ZONES],
    },
    {
      entity: 'creditNote',
      label: 'Kreditnotaer',
      modes: [...ORDER_MODES],
      targets: ECONOMIC_CREDIT_NOTE_TARGETS,
      tables: [ECONOMIC_PAYMENT_METHODS, ECONOMIC_PRODUCT_GROUPS, ECONOMIC_OSS_ZONES],
    },
    {
      entity: 'customer',
      label: 'Kunder',
      modes: ['dry_run', 'live'],
      targets: ECONOMIC_CUSTOMER_TARGETS,
    },
    {
      entity: 'product',
      label: 'Varer',
      modes: ['dry_run', 'live'],
      targets: ECONOMIC_PRODUCT_TARGETS,
      tables: [ECONOMIC_PRODUCT_GROUPS],
    },
  ],
  mapping: {
    order: [ECONOMIC_ZONE_GROUP, ECONOMIC_PRODUCT_GROUP, ECONOMIC_ACCOUNT_GROUP],
    creditNote: [ECONOMIC_ZONE_GROUP, ECONOMIC_PRODUCT_GROUP],
    customer: [ECONOMIC_ZONE_GROUP],
  },
  routeSettings: {
    order: ECONOMIC_INVOICE_SETTINGS,
    creditNote: ECONOMIC_CREDIT_NOTE_SETTINGS,
    customer: ECONOMIC_CONTACT_SETTINGS,
    product: ECONOMIC_PRODUCT_WRITE_SETTINGS,
  },
  // Lines find their products themselves (E5); customers come first.
  dependencies: { order: ['customer'], creditNote: ['customer'] },
  counts: ['customer', 'product'],
  // A cost-based token bucket per app + agreement (E15); requests go one at a time.
  rateLimit: { perMinute: 300 },
  webhook: { signatureHeader: 'x-agentor-secret', scheme: 'secret-header' },
  changelog: [
    {
      version: '2.0.0',
      kind: 'breaking',
      note: 'Live forbindelse. Fakturaer bogføres gennem varer og momszoner; konti bruges kun til bilag i kassekladden.',
    },
    { version: '1.0.0', kind: 'additive', note: 'Første version.' },
  ],
};

export const MANIFESTS: Record<string, ConnectorManifest> = Object.fromEntries(
  [woocommerce, shopify, dinero, economic, odoo, hubspot, brevo, mailchimp].map((m) => [m.id, m]),
);

export function manifestFor(id: string): ConnectorManifest | null {
  return MANIFESTS[id] ?? null;
}
