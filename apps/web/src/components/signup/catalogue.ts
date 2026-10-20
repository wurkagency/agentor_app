import { CATALOGUE, type CatalogueEntry } from '@agentor/connectors';

/**
 * Which systems the signup boards show, in the boards' order (layout, not data: names, logos and
 * availability come from the connector catalogue). "På vej" systems are shown as on the boards and
 * run on dummy data until each connector ships (PLAN-SIGNUP B4/B5, TODO T1/T2).
 */
export const SU1_LOGO_WALL = [
  'woocommerce',
  'shopify',
  'magento',
  'prestashop',
  'dinero',
  'economic',
  'billy',
  'fortnox',
  'hubspot',
  'brevo',
  'mailchimp',
  'klaviyo',
];
export const MS1_LOGO_ROW = [
  'woocommerce',
  'shopify',
  'dinero',
  'economic',
  'hubspot',
  'mailchimp',
];
export const SU3_FEATURED = [
  'woocommerce',
  'shopify',
  'dandomain',
  'dinero',
  'economic',
  'billy',
  'hubspot',
  'mailchimp',
  'klaviyo',
];
/** SU4's logo row under "Alle planer indeholder". */
export const SU4_LOGOS = [
  'woocommerce',
  'shopify',
  'dinero',
  'economic',
  'hubspot',
  'brevo',
  'mailchimp',
  'fortnox',
];

const BY_ID = new Map(CATALOGUE.map((c) => [c.id, c]));

export function catalogueEntry(id: string): CatalogueEntry | undefined {
  return BY_ID.get(id);
}

export function logos(ids: readonly string[]) {
  return ids
    .map((id) => BY_ID.get(id))
    .filter((c): c is CatalogueEntry => !!c)
    .map((c) => ({
      id: c.id,
      name: c.name,
      logoUrl: c.logo ?? undefined,
      soon: !c.available,
      category: c.category as string,
    }));
}

/** Every system for "Se alle N systemer". */
export function allSystems() {
  return logos(CATALOGUE.map((c) => c.id));
}

export const CATALOGUE_SIZE = CATALOGUE.length;
