import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  duePushes: vi.fn(),
  pushContext: vi.fn(),
  pushDone: vi.fn(),
  pushDefer: vi.fn(),
  dropPushSubscription: vi.fn(),
  latestPendingGrant: vi.fn(),
}));
const send = vi.hoisted(() => vi.fn());
vi.mock('@agentor/db', () => db);
vi.mock('web-push', () => ({ default: { sendNotification: send } }));

const { drainPushQueue } = await import('./push.js');

const TENANT = '0190b000-0000-7000-8000-000000000001';
const USER = '0190b000-0000-7000-8000-000000000101';
const FLOW = '0190b000-0000-7000-8000-000000000201';
const RUN = '0190b000-0000-7000-8000-000000000501';
const GRANT = '0190b000-0000-7000-8000-000000000601';

const device = (events: Partial<Record<string, boolean>> = {}) => ({
  id: 'dev-1',
  endpoint: 'https://push.example.test/1',
  p256dh: 'k',
  auth: 'a',
  events: { errors: true, connection: true, support: true, quota: true, weekly: false, ...events },
});
const deps = () => ({
  db: {} as never,
  redis: { set: vi.fn().mockResolvedValue('OK'), del: vi.fn() } as never,
  log: { warn: vi.fn() } as never,
  vapid: { publicKey: 'p', privateKey: 'q', subject: 'mailto:x@example.test' },
});
// 12:00 in Copenhagen: outside quiet hours.
const NOON = new Date('2026-10-20T10:00:00Z');

function due(
  messageKey: string,
  params: Record<string, unknown>,
  href: string,
  opts: { createdAt?: Date; kind?: 'new' | 'resolved' } = {},
) {
  db.duePushes.mockResolvedValue([
    { id: 1, tenantId: TENANT, notificationId: 'n-1', userId: USER, kind: opts.kind ?? 'new' },
  ]);
  db.pushContext.mockResolvedValue({
    notification: { id: 'n-1', messageKey, params, href, createdAt: opts.createdAt ?? NOON },
    devices: [device()],
    quiet: { enabled: true, start: '22:00', end: '07:00' },
  });
}

const payload = () => JSON.parse(send.mock.calls[0]![1] as string);

describe('drainPushQueue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a failed run says what happened and opens the failure screen (MA06), without customer data', async () => {
    due(
      'recordsFailed',
      { count: 3, flow: 'Webshop → regnskab og CRM' },
      `/integrations/${FLOW}?tab=runs&run=${RUN}`,
    );
    expect(await drainPushQueue(deps(), NOON)).toBe(1);
    expect(payload()).toEqual({
      title: '3 records fejlede',
      body: 'Webshop → regnskab og CRM. Tryk for at se, hvad der skete.',
      url: `/integrations/${FLOW}/runs/${RUN}`,
      tag: 'n-1:new',
    });
    expect(db.pushDone).toHaveBeenCalledWith(expect.anything(), 1);
  });

  it('a support request opens MA12 for the waiting request and is never held at night (B7)', async () => {
    const night = new Date('2026-10-20T21:30:00Z');
    due('supportRequested', { name: 'Anne Sørensen', hours: 24 }, '/settings/security#support', {
      createdAt: night,
    });
    db.latestPendingGrant.mockResolvedValue(GRANT);
    await drainPushQueue(deps(), night);
    expect(payload()).toMatchObject({
      title: 'Agentor support beder om adgang',
      body: 'Anne vil hjælpe i 24 timer. Godkend eller afvis.',
      url: `/support-access/${GRANT}`,
    });
    expect(db.pushDefer).not.toHaveBeenCalled();
  });

  it('holds errors in quiet hours until 07:00', async () => {
    const night = new Date('2026-10-20T21:30:00Z');
    due('recordsFailed', { count: 1, flow: 'X' }, '/integrations', { createdAt: night });
    await drainPushQueue(deps(), night);
    expect(send).not.toHaveBeenCalled();
    expect(db.pushDefer).toHaveBeenCalledWith(
      expect.anything(),
      1,
      new Date('2026-10-21T05:00:00Z'),
    );
  });

  it('skips devices that switched the category off and drops gone subscriptions', async () => {
    due('connectionBroken', { connector: 'e-conomic', name: 'Nordlys Outlet' }, '/connections/x');
    db.pushContext.mockResolvedValueOnce({
      notification: {
        id: 'n-1',
        messageKey: 'connectionBroken',
        params: {},
        href: null,
        createdAt: NOON,
      },
      devices: [device({ connection: false })],
      quiet: { enabled: false, start: '22:00', end: '07:00' },
    });
    await drainPushQueue(deps(), NOON);
    expect(send).not.toHaveBeenCalled();
    expect(db.pushDone).toHaveBeenCalled();

    vi.clearAllMocks();
    due('connectionBroken', { connector: 'e-conomic', name: 'Nordlys Outlet' }, '/connections/x');
    send.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    await drainPushQueue(deps(), NOON);
    expect(db.dropPushSubscription).toHaveBeenCalledWith(expect.anything(), TENANT, 'dev-1');
  });

  it('pushes "Fejlen er løst" when a problem is resolved', async () => {
    due(
      'recordsFailed',
      { count: 3, flow: 'Webshop' },
      `/integrations/${FLOW}?tab=runs&run=${RUN}`,
      { kind: 'resolved' },
    );
    await drainPushQueue(deps(), NOON);
    expect(payload()).toMatchObject({
      title: 'Fejlen er løst',
      body: 'Webshop kører igen uden fejl.',
    });
  });

  it('sends nothing without VAPID keys or when another worker holds the lock', async () => {
    due('recordsFailed', { count: 1, flow: 'X' }, '/integrations');
    expect(await drainPushQueue({ ...deps(), vapid: null }, NOON)).toBe(0);
    const locked = {
      ...deps(),
      redis: { set: vi.fn().mockResolvedValue(null), del: vi.fn() } as never,
    };
    expect(await drainPushQueue(locked, NOON)).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
