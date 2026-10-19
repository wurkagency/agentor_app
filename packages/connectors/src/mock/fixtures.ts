import type { Customer, Order, OrderLine, Product } from '../model.js';

/**
 * Fictional Nordlys Cykler data for the mock connectors (designspecifikation §10.1). The ten
 * newest orders match D5-Testkørsel: #10447 is an EU B2B sale to Hans Weber GmbH and #10444
 * has a total of 0 kr. Never real customers.
 */

const kr = (v: number) => Math.round(v * 100);

const dk = (line1: string, postalCode: string, city: string) => ({
  line1,
  postalCode,
  city,
  country: 'DK',
});

const person = (
  id: string,
  name: string,
  email: string,
  addr = dk('Cykelvej 1', '8000', 'Aarhus C'),
): Customer => ({
  sourceId: id,
  kind: 'person',
  name,
  email,
  phone: null,
  vatNumber: null,
  address: addr,
});

export const CUSTOMERS: Customer[] = [
  {
    sourceId: 'c-901',
    kind: 'company',
    name: 'Hans Weber GmbH',
    email: 'einkauf@weber-rad.example',
    phone: null,
    vatNumber: 'DE811000001',
    address: { line1: 'Radweg 4', postalCode: '20095', city: 'Hamburg', country: 'DE' },
  },
  person('c-902', 'Line Kjær', 'line.kjaer@example.dk', dk('Søndergade 12', '8000', 'Aarhus C')),
  person('c-903', 'Mads Holt', 'mads.holt@example.dk', dk('Vestergade 3', '5000', 'Odense C')),
  person('c-904', 'Ane Bruun', 'ane.bruun@example.dk', dk('Nørregade 40', '1165', 'København K')),
  person('c-905', 'Søren Lund', 'soren.lund@example.dk', dk('Åboulevarden 9', '8000', 'Aarhus C')),
  person('c-906', 'Ida Friis', 'ida.friis@example.dk', dk('Strandvejen 101', '2900', 'Hellerup')),
];

export const PRODUCTS: Product[] = [
  {
    sourceId: 'p-1',
    sku: 'AERO-56',
    name: 'Racercykel Aero',
    category: 'Cykler',
    price: kr(4316),
    vatRate: 0.25,
  },
  {
    sourceId: 'p-2',
    sku: 'E7-M',
    name: 'Elcykel Nordlys E7',
    category: 'Cykler',
    price: kr(15196),
    vatRate: 0.25,
  },
  {
    sourceId: 'p-3',
    sku: 'HELM-PRO',
    name: 'Cykelhjelm Pro',
    category: 'Tøj',
    price: kr(999.2),
    vatRate: 0.25,
  },
  {
    sourceId: 'p-4',
    sku: 'LOCK-K',
    name: 'Cykellås Kraft',
    category: 'Reservedele',
    price: kr(519.2),
    vatRate: 0.25,
  },
  {
    sourceId: 'p-5',
    sku: 'GIFT-500',
    name: 'Gavekort 500 kr.',
    category: 'Gavekort',
    price: kr(500),
    vatRate: 0,
  },
  {
    sourceId: 'p-6',
    sku: 'TUBE-28',
    name: 'Slange 28"',
    category: 'Reservedele',
    price: kr(79.2),
    vatRate: 0.25,
  },
  {
    sourceId: 'p-7',
    sku: 'SERV-1',
    name: 'Forårsservice',
    category: 'Service',
    price: kr(479.2),
    vatRate: 0.25,
  },
];

function line(productId: string, quantity = 1, vatRate?: number): OrderLine {
  const p = PRODUCTS.find((x) => x.sourceId === productId)!;
  return {
    sku: p.sku,
    productId: p.sourceId,
    name: p.name,
    quantity,
    unitPrice: p.price,
    vatRate: vatRate ?? p.vatRate,
    category: p.category,
  };
}

function order(
  n: number,
  customerId: string,
  lines: OrderLine[],
  opts: { shipping?: number; shippingVatRate?: number; minutesAgo: number; total?: number },
): Order {
  const shipping = opts.shipping ?? 0;
  const shippingVatRate = opts.shippingVatRate ?? 0.25;
  const net = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const vat = lines.reduce((s, l) => s + Math.round(l.unitPrice * l.quantity * l.vatRate), 0);
  return {
    sourceId: `o-${n}`,
    number: String(n),
    createdAt: new Date(Date.UTC(2026, 9, 18, 12, 0) - opts.minutesAgo * 60_000).toISOString(),
    status: 'completed',
    currency: 'DKK',
    customer: CUSTOMERS.find((c) => c.sourceId === customerId)!,
    lines,
    shipping,
    shippingVatRate,
    total: opts.total ?? net + vat + shipping + Math.round(shipping * shippingVatRate),
  };
}

/** Newest first, like the shop's API. */
export const ORDERS: Order[] = [
  // EU B2B: reverse charge, no Danish VAT; freight VAT-free (D5: 4.316 + 79 = 4.395 kr.).
  order(10447, 'c-901', [line('p-1', 1, 0)], {
    shipping: kr(79),
    shippingVatRate: 0,
    minutesAgo: 4,
  }),
  order(10446, 'c-902', [line('p-2')], { minutesAgo: 22 }),
  order(10445, 'c-903', [line('p-3')], { minutesAgo: 41 }),
  // Paid fully with a gift card: total 0 kr., skipped by "Kun ordrer med total > 0".
  order(10444, 'c-904', [line('p-6')], { minutesAgo: 63, total: 0 }),
  order(10443, 'c-905', [line('p-4')], { minutesAgo: 80 }),
  order(10442, 'c-906', [line('p-6', 2)], { shipping: kr(39.2), minutesAgo: 95 }),
  order(10441, 'c-902', [line('p-7')], { minutesAgo: 130 }),
  order(10440, 'c-903', [line('p-4'), line('p-6')], { shipping: kr(39.2), minutesAgo: 170 }),
  order(10439, 'c-905', [line('p-5')], { minutesAgo: 205 }),
  order(10438, 'c-906', [line('p-3'), line('p-6')], { shipping: kr(39.2), minutesAgo: 240 }),
];

/** Dinero's chart of accounts as the mock returns it (D3). 1010 no longer exists. */
export const DINERO_ACCOUNTS = [
  { value: '1000', label: 'Salg' },
  { value: '1015', label: 'Salg EU' },
  { value: '1020', label: 'Salg tøj' },
  { value: '1030', label: 'Værkstedssalg' },
  { value: '1040', label: 'Salg udland' },
  { value: '1050', label: 'Momsfrit salg' },
  { value: '1100', label: 'Fragt' },
  { value: '1110', label: 'Fragt momsfri' },
  { value: '6900', label: 'Gavekort' },
];

export const MOCK_ACCOUNTS: Record<string, { id: string; name: string }> = {
  woocommerce: { id: 'nordlys-cykler.dk', name: 'nordlys-cykler.dk' },
  shopify: { id: 'nordlys-outlet', name: 'Nordlys Outlet' },
  dinero: { id: '412983', name: 'Nordlys Cykler' },
  economic: { id: '771204', name: 'Nordlys Outlet' },
  hubspot: { id: '24015566', name: 'Nordlys Cykler' },
  brevo: { id: 'nyhedsbrev', name: 'Nyhedsbrev' },
  mailchimp: { id: 'us21', name: 'Nordlys' },
};
