/**
 * Agentor's common data model (produktspecifikation §4): every connector translates to and
 * from these shapes, so N connectors are N adapters, not N² integrations. Amounts are in øre
 * (minor units) to avoid floating-point money.
 */

export const ENTITIES = ['order', 'creditNote', 'customer', 'product', 'stock'] as const;
export type Entity = (typeof ENTITIES)[number];

export interface Address {
  line1: string | null;
  postalCode: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string;
}

export interface Customer {
  sourceId: string;
  kind: 'person' | 'company';
  name: string;
  email: string | null;
  phone: string | null;
  /** EU VAT number for companies, e.g. "DE811…". */
  vatNumber: string | null;
  address: Address;
}

export interface OrderLine {
  sku: string | null;
  productId: string | null;
  name: string;
  quantity: number;
  /** Unit price excl. VAT, øre. */
  unitPrice: number;
  /** 0.25 for Danish VAT, 0 for VAT-free. */
  vatRate: number;
  category: string | null;
}

export interface Order {
  sourceId: string;
  /** The shop's own order number, e.g. "10447". */
  number: string;
  createdAt: string;
  /** Normalised status. */
  status: 'pending' | 'processing' | 'completed' | 'cancelled' | 'refunded';
  currency: string;
  customer: Customer;
  lines: OrderLine[];
  /** Shipping excl. VAT, øre. */
  shipping: number;
  shippingVatRate: number;
  /** Total incl. VAT, øre. */
  total: number;
}

export interface CreditNote {
  sourceId: string;
  number: string;
  orderSourceId: string;
  createdAt: string;
  currency: string;
  customer: Customer;
  lines: OrderLine[];
  total: number;
}

export interface Product {
  sourceId: string;
  sku: string | null;
  name: string;
  category: string | null;
  price: number;
  vatRate: number;
}

export interface Stock {
  sourceId: string;
  sku: string | null;
  quantity: number;
}

export interface EntityRecord {
  order: Order;
  creditNote: CreditNote;
  customer: Customer;
  product: Product;
  stock: Stock;
}

const EU = new Set([
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
]);

/** Sales VAT category of an order, which decides the account it is booked on (D3). */
export function saleKind(o: Pick<Order, 'customer'>): 'domestic' | 'euB2b' | 'euB2c' | 'export' {
  const country = o.customer.address.country.toUpperCase();
  if (country === 'DK') return 'domestic';
  if (EU.has(country)) return o.customer.vatNumber ? 'euB2b' : 'euB2c';
  return 'export';
}
