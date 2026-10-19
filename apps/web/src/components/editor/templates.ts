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
  routes: { entity: Entity; targetEntity: Entity; to: string }[];
  tags: Entity[];
  popular?: boolean;
}

export const TEMPLATES: Template[] = [
  {
    id: 'webshop-dinero',
    category: 'erp',
    source: ['woocommerce'],
    destinations: ['dinero'],
    routes: [
      { entity: 'order', targetEntity: 'order', to: 'dinero' },
      { entity: 'creditNote', targetEntity: 'creditNote', to: 'dinero' },
      { entity: 'customer', targetEntity: 'customer', to: 'dinero' },
    ],
    tags: ['order', 'creditNote', 'customer'],
    popular: true,
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
