/**
 * Agentor's common data model (produktspecifikation §4): every connector translates to and
 * from these shapes, so N connectors are N adapters, not N² integrations. Amounts are in øre
 * (minor units) to avoid floating-point money. v2 fields (PLAN-INTEGRATIONS-WOO-DINERO §3.4)
 * are optional, so records from v1 adapters stay valid.
 */

export const ENTITIES = ['order', 'creditNote', 'customer', 'product', 'stock'] as const;
export type Entity = (typeof ENTITIES)[number];

export interface Address {
  line1: string | null;
  line2?: string | null;
  postalCode: string | null;
  city: string | null;
  state?: string | null;
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
  companyName?: string | null;
  /** Danish CVR number. */
  cvr?: string | null;
  /** EAN/GLN for e-invoices to the public sector. */
  ean?: string | null;
  /** Bought without an account in the shop; matched by e-mail. */
  isGuest?: boolean;
  shippingAddress?: Address | null;
  /** Last change at the source (cursor and idempotency version). */
  updatedAt?: string;
}

/** A named party on an order: who it is billed to or shipped to. */
export interface Party {
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
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
  /** Product lines unless the source says otherwise. */
  kind?: 'product' | 'fee';
  variantId?: string | null;
  ean?: string | null;
  taxClass?: string | null;
  /** Discount on the whole line excl. VAT, øre. */
  discount?: number;
  /** Goods or services: decides the EU and export accounts (F8). Goods when unknown. */
  supplyType?: 'goods' | 'services';
  /** Source id of the bundle line this line belongs to. */
  bundleParent?: string | null;
}

/** A VAT rate the shop charged on the order, e.g. WooCommerce `tax_lines`. */
export interface VatLine {
  rateId: string | null;
  code: string | null;
  label: string | null;
  rate: number;
  /** VAT amount, øre. */
  amount: number;
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
  updatedAt?: string;
  paidAt?: string | null;
  completedAt?: string | null;
  /** The shop's own status before normalising, e.g. WooCommerce "on-hold" or a plugin status. */
  sourceStatus?: string;
  pricesIncludeVat?: boolean;
  paymentMethod?: { id: string; title: string } | null;
  transactionId?: string | null;
  shippingMethod?: string | null;
  couponCodes?: string[];
  billing?: Party | null;
  shippingTo?: Party | null;
  note?: string | null;
  vatLines?: VatLine[];
  /** The connection's configured meta keys by alias, e.g. `{ ean: '5790000…' }`. */
  meta?: Record<string, string>;
  /** The untouched source payload: for expressions and the developer view, never logged. */
  raw?: unknown;
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
  reason?: string | null;
  /** Whether the shop refunded the payment (WooCommerce `refunded_payment`). */
  refundsPayment?: boolean;
  meta?: Record<string, string>;
  raw?: unknown;
}

export interface Product {
  sourceId: string;
  sku: string | null;
  name: string;
  category: string | null;
  price: number;
  vatRate: number;
  ean?: string | null;
  categories?: string[];
  variantOf?: string | null;
  taxClass?: string | null;
  updatedAt?: string;
  raw?: unknown;
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

export const DANISH_VAT_RATE = 0.25;

export type SaleKind = 'domestic' | 'euB2b' | 'euB2c' | 'export';

const rateEq = (a: number, b: number) => Math.abs(a - b) < 0.0005;

/** The VAT rates the shop charged: its VAT lines, else the rates on its order lines. */
export function chargedRates(o: Partial<Pick<Order, 'lines' | 'vatLines'>>): number[] {
  const fromVat = (o.vatLines ?? []).filter((v) => v.amount !== 0).map((v) => v.rate);
  if (fromVat.length) return fromVat;
  return (o.lines ?? []).map((l) => l.vatRate);
}

/**
 * Sales VAT category of an order, which decides the account it is booked on (D3). The VAT the
 * shop actually charged decides first (PLAN D3 "book what the shop charged"); the country and
 * VAT number only settle it when the order carries no VAT or no lines:
 * - Danish customer: domestic.
 * - Danish VAT charged abroad: EU private customer → euB2c (booked like domestic by default),
 *   everyone else → domestic.
 * - Another rate charged: EU → euB2c (destination VAT, OSS), outside the EU → export.
 * - No VAT: EU with a VAT number → euB2b, EU without → euB2c, outside the EU → export.
 */
export function saleKind(
  o: Pick<Order, 'customer'> & Partial<Pick<Order, 'lines' | 'vatLines'>>,
): SaleKind {
  const country = o.customer.address.country.toUpperCase();
  if (country === 'DK') return 'domestic';
  const eu = EU.has(country);
  const charged = chargedRates(o).filter((r) => r > 0);
  if (charged.length) {
    if (charged.every((r) => rateEq(r, DANISH_VAT_RATE)))
      return eu && !o.customer.vatNumber ? 'euB2c' : 'domestic';
    return eu ? 'euB2c' : 'export';
  }
  if (eu) return o.customer.vatNumber ? 'euB2b' : 'euB2c';
  return 'export';
}

/**
 * Whether the VAT on an order line contradicts its sale kind, so the integration warns instead of
 * booking silently (PLAN F7, D3). Returns a short code or null.
 */
export function vatMismatch(
  kind: SaleKind,
  vatRate: number,
): 'FOREIGN_VAT' | 'VAT_ON_REVERSE_CHARGE' | 'VAT_ON_EXPORT' | null {
  if (vatRate <= 0 || rateEq(vatRate, DANISH_VAT_RATE)) return null;
  if (kind === 'euB2c') return 'FOREIGN_VAT';
  if (kind === 'euB2b') return 'VAT_ON_REVERSE_CHARGE';
  if (kind === 'export') return 'VAT_ON_EXPORT';
  return null;
}
