/** "Ordrer pr. måned, cirka" (D14-Onboarding-1); matches plan_entitlements.recommended_for_orders. */
export const ORDERS_PER_MONTH = ['0-200', '200-1000', '1000+'] as const;
export type OrdersPerMonth = (typeof ORDERS_PER_MONTH)[number];

/** First-flow templates (D14-Onboarding-3). Source → destination connector logos. */
export const TEMPLATES = [
  'webshop-dinero',
  'webshop-economic',
  'shopify-dinero',
  'shopify-economic',
  'customers-hubspot',
  'customers-brevo',
] as const;
export type TemplateId = (typeof TEMPLATES)[number];

export const TEMPLATE_LOGOS: Record<TemplateId, [string, string]> = {
  'webshop-dinero': ['woocommerce', 'dinero'],
  'webshop-economic': ['woocommerce', 'economic'],
  'shopify-dinero': ['shopify', 'dinero'],
  'shopify-economic': ['shopify', 'economic'],
  'customers-hubspot': ['woocommerce', 'hubspot'],
  'customers-brevo': ['woocommerce', 'brevo'],
};
