import { env } from './env';

/**
 * CVR lookup for signup (SU3). Behind a small interface so development and
 * e2e never call the register, and the provider can change without touching the page.
 */
export interface CvrCompany {
  cvr: string;
  name: string;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  /** Year the company was founded, for "aktiv siden 2014". */
  since: number | null;
  active: boolean;
  /** Industry text, "Detailhandel med cykler" on SU3's "Fundet" state. */
  industry: string | null;
}

export interface CvrProvider {
  lookup(cvr: string): Promise<CvrCompany | null>;
}

export const CVR_RE = /^\d{8}$/;

/** Fictional companies only (never real customer data in seed or tests). */
const FIXTURES: CvrCompany[] = [
  {
    cvr: '12345678',
    name: 'Nordlys Cykler ApS',
    addressLine: 'Cykelvej 12',
    postalCode: '8000',
    city: 'Aarhus C',
    since: 2014,
    active: true,
    industry: 'Detailhandel med cykler',
  },
  {
    cvr: '87654321',
    name: 'Nordlys Outlet ApS',
    addressLine: 'Havnegade 3',
    postalCode: '5000',
    city: 'Odense C',
    since: 2019,
    active: true,
    industry: 'Detailhandel med cykler',
  },
  {
    cvr: '11112222',
    name: 'Lukket Butik ApS',
    addressLine: 'Gammel Torv 1',
    postalCode: '1000',
    city: 'København K',
    since: 2009,
    active: false,
    industry: null,
  },
];

export class FixtureCvrProvider implements CvrProvider {
  async lookup(cvr: string) {
    return FIXTURES.find((c) => c.cvr === cvr) ?? null;
  }
}

/**
 * Virkdata's CVR API (https://virkdata.dk/dokumentation, v1.4.10): one GET endpoint, the key in
 * the Authorization header, flat JSON. Chosen for signup instead of Datafordeler (PLAN-SIGNUP B2).
 */
interface VirkdataCompany {
  vat?: number | string | null;
  status?: string | null;
  name?: string | null;
  address?: string | null;
  zipcode?: number | string | null;
  city?: string | null;
  startdate?: string | null;
  enddate?: string | null;
  industrydesc?: string | null;
}

interface VirkdataError {
  error_code?: number;
  response?: string;
}

/** Maps Virkdata's answer to the lookup result; null when it is another company. */
export function fromVirkdata(cvr: string, c: VirkdataCompany): CvrCompany | null {
  const name = c.name?.trim();
  if (!name || String(c.vat ?? '') !== cvr) return null;
  const ended = !!c.enddate || /oph(ø|oe)r|opløst|konkurs/i.test(c.status ?? '');
  return {
    cvr,
    name,
    addressLine: c.address?.trim() || null,
    postalCode: c.zipcode != null ? String(c.zipcode) : null,
    city: c.city?.trim() || null,
    since: c.startdate ? Number(c.startdate.slice(0, 4)) || null : null,
    active: !ended,
    industry: c.industrydesc?.trim() || null,
  };
}

export class VirkdataCvrProvider implements CvrProvider {
  constructor(
    private readonly apiKey: string,
    private readonly endpoint = 'https://virkdata.dk/api/',
  ) {
    if (!apiKey) throw new Error('VIRKDATA_API_KEY is required');
  }

  async lookup(cvr: string) {
    if (!CVR_RE.test(cvr)) return null;
    const url = new URL(this.endpoint);
    url.searchParams.set('search', cvr);
    url.searchParams.set('country', 'dk');
    url.searchParams.set('format', 'json');
    const res = await fetch(url, {
      headers: { Authorization: this.apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    const json = (await res.json().catch(() => null)) as
      (VirkdataCompany & VirkdataError) | (VirkdataCompany & VirkdataError)[] | null;
    const body = Array.isArray(json) ? json.find((c) => String(c.vat) === cvr) : json;
    // 3002 no_results: not found. Any other error code (key, quota, rate limit) is an outage.
    if (body?.error_code === 3002) return null;
    if (!res.ok || !body || body.error_code)
      throw new Error(`CVR lookup failed (${body?.error_code ?? res.status})`);
    return fromVirkdata(cvr, body);
  }
}

let provider: CvrProvider | undefined;

export function cvrProvider(): CvrProvider {
  if (!provider) {
    const e = env();
    provider =
      e.CVR_PROVIDER === 'virkdata'
        ? new VirkdataCvrProvider(e.VIRKDATA_API_KEY ?? '')
        : new FixtureCvrProvider();
  }
  return provider;
}
