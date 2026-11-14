import type { Category } from './manifest.js';
import { MANIFESTS } from './manifests/index.js';

/**
 * The connector catalogue (D9-Katalog, README decision 14, plus Odoo): 24 systems in 5 groups.
 * Systems with a manifest can be connected; the rest are "På vej" and collect interest.
 */
export interface CatalogueEntry {
  id: string;
  name: string;
  /** Short line under the name ("Open Source 2.4", "Tidligere ConvertKit"). */
  subtitle: string;
  category: Category;
  logo: string | null;
  available: boolean;
}

const SOON: Omit<CatalogueEntry, 'available'>[] = [
  {
    id: 'magento',
    name: 'Magento',
    subtitle: 'Open Source 2.4',
    category: 'webshop',
    logo: '/logos/magento.svg',
  },
  {
    id: 'adobe-commerce',
    name: 'Adobe Commerce',
    subtitle: 'Tidligere Magento Commerce',
    category: 'webshop',
    logo: '/logos/adobe.svg',
  },
  {
    id: 'prestashop',
    name: 'PrestaShop',
    subtitle: '1.7 og 8',
    category: 'webshop',
    logo: '/logos/prestashop.svg',
  },
  {
    id: 'dandomain',
    name: 'DanDomain',
    subtitle: 'Webshop',
    category: 'webshop',
    logo: '/logos/dandomain.svg',
  },
  {
    id: 'dandomain-classic',
    name: 'DanDomain Classic',
    subtitle: 'Webshop',
    category: 'webshop',
    logo: '/logos/dandomain-classic.svg',
  },
  { id: 'billy', name: 'Billy', subtitle: 'Regnskab', category: 'erp', logo: '/logos/billy.svg' },
  {
    id: 'fortnox',
    name: 'Fortnox',
    subtitle: 'Regnskab · Sverige',
    category: 'erp',
    logo: '/logos/fortnox.svg',
  },
  {
    id: 'business-central',
    name: 'Business Central',
    subtitle: 'Microsoft Dynamics 365',
    category: 'erp',
    logo: null,
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    subtitle: 'Sales Cloud',
    category: 'crm',
    logo: '/logos/salesforce.svg',
  },
  {
    id: 'pipedrive',
    name: 'Pipedrive',
    subtitle: 'CRM',
    category: 'crm',
    logo: '/logos/pipedrive.svg',
  },
  {
    id: 'klaviyo',
    name: 'Klaviyo',
    subtitle: 'E-mail og SMS',
    category: 'marketing',
    logo: '/logos/klaviyo.svg',
  },
  {
    id: 'activecampaign',
    name: 'ActiveCampaign',
    subtitle: 'Marketing automation',
    category: 'marketing',
    logo: '/logos/activecampaign.svg',
  },
  {
    id: 'campaignmonitor',
    name: 'Campaign Monitor',
    subtitle: 'E-mail',
    category: 'marketing',
    logo: '/logos/campaignmonitor.svg',
  },
  {
    id: 'kit',
    name: 'Kit',
    subtitle: 'Tidligere ConvertKit',
    category: 'marketing',
    logo: '/logos/kit.svg',
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    subtitle: 'Transaktionsmails',
    category: 'communication',
    logo: '/logos/sendgrid.svg',
  },
  {
    id: 'twilio',
    name: 'Twilio',
    subtitle: 'SMS',
    category: 'communication',
    logo: '/logos/twilio.svg',
  },
];

const SUBTITLE: Record<string, string> = {
  woocommerce: 'Webshop',
  shopify: 'Webshop',
  dinero: 'Regnskab',
  economic: 'Regnskab',
  odoo: 'ERP og lager',
  hubspot: 'CRM',
  brevo: 'Nyhedsbrev og kontakter',
  mailchimp: 'Lister og tags',
};

export const CATEGORY_ORDER: Category[] = ['webshop', 'erp', 'crm', 'marketing', 'communication'];

export const CATALOGUE: CatalogueEntry[] = [
  ...Object.values(MANIFESTS).map((m) => ({
    id: m.id,
    name: m.name,
    subtitle: SUBTITLE[m.id] ?? '',
    category: m.category,
    logo: m.logo,
    available: true,
  })),
  ...SOON.map((e) => ({ ...e, available: false })),
].sort(
  (a, b) =>
    CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
    Number(b.available) - Number(a.available),
);
