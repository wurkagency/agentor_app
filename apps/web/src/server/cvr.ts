import { env } from './env';

/**
 * CVR lookup for onboarding (D14-Onboarding-1). Behind a small interface so development and
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
 * Datafordeler GraphQL (CVR register, API key as `apiKey` query parameter). Chosen for signup
 * (PLAN-SIGNUP B2): the older CVR distribution closes next year.
 * FOLLOW-UP: the entity and field names below must be verified against the published schema at
 * https://graphql.datafordeler.dk/CVR/v1/schema before CVR_PROVIDER=datafordeler is enabled;
 * the fixture provider is the default until then (PLAN.md, CVR lookup).
 */
const QUERY = `query ($cvr: Int!) {
  CVR_Virksomhed(first: 1, where: { CVRNummer: { eq: $cvr } }) {
    nodes {
      CVRNummer
      virksomhedStartdato
      virksomhedOphoersdato
      CVR_Navn { vaerdi }
      CVR_Adressering { vejnavn husnummerFra postnummer postdistrikt }
    }
  }
}`;

interface DfNode {
  CVRNummer: number;
  virksomhedStartdato?: string | null;
  virksomhedOphoersdato?: string | null;
  CVR_Navn?: { vaerdi?: string | null }[] | { vaerdi?: string | null } | null;
  CVR_Adressering?:
    | {
        vejnavn?: string | null;
        husnummerFra?: string | number | null;
        postnummer?: string | number | null;
        postdistrikt?: string | null;
      }[]
    | null;
}

const first = <T>(v: T | T[] | null | undefined): T | undefined =>
  Array.isArray(v) ? v[0] : (v ?? undefined);

export class DatafordelerCvrProvider implements CvrProvider {
  constructor(
    private readonly apiKey: string,
    private readonly endpoint = 'https://graphql.datafordeler.dk/CVR/v1',
  ) {
    if (!apiKey) throw new Error('DATAFORDELER_API_KEY is required');
  }

  async lookup(cvr: string) {
    if (!CVR_RE.test(cvr)) return null;
    const url = new URL(this.endpoint);
    url.searchParams.set('apiKey', this.apiKey);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/graphql-response+json, application/json',
      },
      body: JSON.stringify({ query: QUERY, variables: { cvr: Number(cvr) } }),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`CVR lookup failed (${res.status})`);
    const json = (await res.json()) as { data?: { CVR_Virksomhed?: { nodes?: DfNode[] } } };
    const n = json.data?.CVR_Virksomhed?.nodes?.[0];
    if (!n) return null;
    const a = first(n.CVR_Adressering);
    const street = [a?.vejnavn, a?.husnummerFra].filter(Boolean).join(' ');
    return {
      cvr,
      name: first(n.CVR_Navn)?.vaerdi ?? '',
      addressLine: street || null,
      postalCode: a?.postnummer != null ? String(a.postnummer) : null,
      city: a?.postdistrikt ?? null,
      since: n.virksomhedStartdato ? Number(n.virksomhedStartdato.slice(0, 4)) : null,
      active: !n.virksomhedOphoersdato,
      // FOLLOW-UP (B2): the industry field is added once the schema is verified with a key.
      industry: null,
    };
  }
}

let provider: CvrProvider | undefined;

export function cvrProvider(): CvrProvider {
  if (!provider) {
    const e = env();
    provider =
      e.CVR_PROVIDER === 'datafordeler'
        ? new DatafordelerCvrProvider(e.DATAFORDELER_API_KEY ?? '')
        : new FixtureCvrProvider();
  }
  return provider;
}
