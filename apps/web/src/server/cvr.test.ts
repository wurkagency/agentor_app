import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({ env: () => ({ CVR_PROVIDER: 'fixture' }) }));

const { fromVirkdata, VirkdataCvrProvider } = await import('./cvr');

/** Fictional company in Virkdata's response shape (never real data). */
const NORDLYS = {
  vat: 12345678,
  status: 'Normal',
  name: 'Nordlys Cykler ApS',
  address: 'Cykelvej 12B',
  zipcode: 8000,
  city: 'Aarhus C',
  startdate: '2014-03-01',
  enddate: null,
  industrydesc: 'Detailhandel med cykler',
};

describe('CVR via Virkdata', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps name, address, start year, status and industry', () => {
    expect(fromVirkdata('12345678', NORDLYS)).toEqual({
      cvr: '12345678',
      name: 'Nordlys Cykler ApS',
      addressLine: 'Cykelvej 12B',
      postalCode: '8000',
      city: 'Aarhus C',
      since: 2014,
      active: true,
      industry: 'Detailhandel med cykler',
    });
  });

  it('marks a closed company, and refuses another company than asked for', () => {
    expect(
      fromVirkdata('11112222', {
        vat: '11112222',
        name: 'Lukket Butik ApS',
        status: 'Opløst efter fusion',
        enddate: '2020-06-30',
      }),
    ).toMatchObject({ active: false, addressLine: null, industry: null, since: null });
    expect(fromVirkdata('12345678', { ...NORDLYS, vat: 87654321 })).toBeNull();
  });

  it('sends the key in Authorization and asks by CVR number in Denmark', async () => {
    const fetchMock = vi.fn(async () => Response.json(NORDLYS));
    vi.stubGlobal('fetch', fetchMock);
    const p = new VirkdataCvrProvider('demo-key', 'https://cvr.example.test/api/');
    expect((await p.lookup('12345678'))?.name).toBe('Nordlys Cykler ApS');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get('search')).toBe('12345678');
    expect(url.searchParams.get('country')).toBe('dk');
    expect((init.headers as Record<string, string>).Authorization).toBe('demo-key');
    expect(await p.lookup('abc')).toBeNull();
  });

  it('treats no_results as not found and other error codes as an outage', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error_code: 3002, response: 'no_results' }));
    const p = new VirkdataCvrProvider('demo-key');
    expect(await p.lookup('12345678')).toBeNull();
    vi.stubGlobal('fetch', async () =>
      Response.json({ error_code: 7002, response: 'daily_quota_exceeded' }),
    );
    await expect(p.lookup('12345678')).rejects.toThrow('7002');
  });
});
