import type { Entity } from '@agentor/connectors';

/**
 * Templates (D4-Skabelonvælger, produktspecifikation §5.5): nodes and routes placed for you, all
 * routes in Test, so the customer only fills in accounts and test runs.
 */
export interface Template {
  id: string;
  category: 'erp' | 'crm' | 'marketing';
  source: string[];
  destinations: string[];
  routes: {
    entity: Entity;
    targetEntity: Entity;
    to: string;
    /** Source options the template sets, e.g. which order statuses to send. */
    sourceOptions?: Record<string, string[] | string | boolean | number>;
  }[];
  tags: Entity[];
  popular?: boolean;
  /** Higher first when several templates fit the systems chosen on SU3 (OB3 "Anbefalet"). */
  priority?: number;
  /**
   * Accounts filled in for the customer on OB3, by the label of the destination's own account
   * (e.g. Dinero's "Salg"). Keys left out (EU B2B sales) are for the customer to choose on OB4.
   */
  accountHints?: Record<string, string>;
}

/** Common Danish account names: what most webshops book where. The customer can change all. */
const ERP_HINTS: Record<string, string> = {
  'accounts.domestic': 'Salg',
  'accounts.vatFree': 'Momsfrit salg',
  'accounts.export': 'Salg udland',
  'accounts.shipping': 'Fragt',
  'accounts.shippingVatFree': 'Fragt momsfri',
};

const PAID_ORDERS = { 'trigger.statuses': ['processing', 'completed'] };

export const TEMPLATES: Template[] = [
  {
    id: 'webshop-dinero',
    category: 'erp',
    source: ['woocommerce'],
    destinations: ['dinero'],
    routes: [
      // Paid orders only (PLAN-INTEGRATIONS §4.3): not pending or cancelled ones.
      { entity: 'order', targetEntity: 'order', to: 'dinero', sourceOptions: PAID_ORDERS },
      { entity: 'creditNote', targetEntity: 'creditNote', to: 'dinero' },
      { entity: 'customer', targetEntity: 'customer', to: 'dinero' },
    ],
    tags: ['order', 'creditNote', 'customer'],
    popular: true,
    priority: 10,
    accountHints: ERP_HINTS,
  },
  {
    id: 'webshop-economic',
    category: 'erp',
    source: ['woocommerce'],
    destinations: ['economic'],
    routes: [
      { entity: 'order', targetEntity: 'order', to: 'economic' },
      { entity: 'customer', targetEntity: 'customer', to: 'economic' },
    ],
    tags: ['order', 'customer'],
    priority: 8,
    accountHints: ERP_HINTS,
  },
  {
    id: 'webshop-odoo',
    category: 'erp',
    source: ['woocommerce'],
    destinations: ['odoo'],
    routes: [
      // Odoo takes the income account from the product; only taxes and products are chosen.
      { entity: 'order', targetEntity: 'order', to: 'odoo', sourceOptions: PAID_ORDERS },
      { entity: 'creditNote', targetEntity: 'creditNote', to: 'odoo' },
      { entity: 'customer', targetEntity: 'customer', to: 'odoo' },
    ],
    tags: ['order', 'creditNote', 'customer'],
    priority: 8,
  },
  {
    // The return flow (PLAN-INTEGRATIONS-WOO-ODOO16 §5): Odoo owns stock (OD3) and deliveries.
    id: 'odoo-webshop',
    category: 'erp',
    source: ['odoo'],
    destinations: ['woocommerce'],
    routes: [
      { entity: 'stock', targetEntity: 'stock', to: 'woocommerce' },
      { entity: 'shipment', targetEntity: 'shipment', to: 'woocommerce' },
      { entity: 'invoiceStatus', targetEntity: 'invoiceStatus', to: 'woocommerce' },
    ],
    tags: ['stock', 'shipment', 'invoiceStatus'],
    priority: 7,
  },
  {
    id: 'shopify-dinero',
    category: 'erp',
    source: ['shopify'],
    destinations: ['dinero'],
    routes: [
      { entity: 'order', targetEntity: 'order', to: 'dinero' },
      { entity: 'customer', targetEntity: 'customer', to: 'dinero' },
    ],
    tags: ['order', 'customer'],
    priority: 9,
    accountHints: ERP_HINTS,
  },
  {
    id: 'shopify-economic',
    category: 'erp',
    source: ['shopify'],
    destinations: ['economic'],
    routes: [
      { entity: 'order', targetEntity: 'order', to: 'economic' },
      { entity: 'creditNote', targetEntity: 'creditNote', to: 'economic' },
    ],
    tags: ['order', 'creditNote'],
    priority: 7,
    accountHints: ERP_HINTS,
  },
  {
    id: 'customers-hubspot',
    category: 'crm',
    source: ['woocommerce', 'shopify'],
    destinations: ['hubspot'],
    routes: [
      { entity: 'customer', targetEntity: 'customer', to: 'hubspot' },
      { entity: 'order', targetEntity: 'order', to: 'hubspot' },
    ],
    tags: ['customer', 'order'],
    priority: 5,
  },
  {
    id: 'customers-brevo',
    category: 'marketing',
    source: ['woocommerce', 'shopify'],
    destinations: ['brevo'],
    routes: [{ entity: 'customer', targetEntity: 'customer', to: 'brevo' }],
    tags: ['customer'],
  },
  {
    id: 'customers-mailchimp',
    category: 'marketing',
    source: ['woocommerce', 'shopify'],
    destinations: ['mailchimp'],
    routes: [{ entity: 'customer', targetEntity: 'customer', to: 'mailchimp' }],
    tags: ['customer'],
  },
];

export function templateById(id: string | null | undefined) {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

/**
 * Templates for the systems a company chose on SU3 and has connected (OB3), best first: every
 * system the template needs is chosen, more of them is better, then priority. Pure data matching.
 */
export function recommendTemplates(chosen: readonly string[]): Template[] {
  const has = new Set(chosen);
  return TEMPLATES.filter(
    (t) => t.source.some((s) => has.has(s)) && t.destinations.every((d) => has.has(d)),
  )
    .map((t) => ({ t, score: t.destinations.length * 100 + (t.priority ?? 0) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.t);
}
