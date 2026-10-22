import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  dueEmails: vi.fn(),
  emailRecipient: vi.fn(),
  emailSent: vi.fn(),
  emailSkip: vi.fn(),
  emailDefer: vi.fn(),
  emailFailed: vi.fn(),
  connectionEmailFacts: vi.fn(),
  quotaFacts: vi.fn(),
  weeklyStats: vi.fn(),
  unsubscribeToken: vi.fn(),
}));
vi.mock('@agentor/db', () => db);

const { drainEmailQueue } = await import('./email.js');

const TENANT = '0190b000-0000-7000-8000-000000000001';
const USER = '0190b000-0000-7000-8000-000000000101';
const CONN = '0190b000-0000-7000-8000-000000000301';
// 12:00 and 23:30 in Copenhagen.
const NOON = new Date('2026-10-20T10:00:00Z');
const NIGHT = new Date('2026-10-20T21:30:00Z');

const send = vi.fn();
const deps = () => ({
  db: {} as never,
  redis: { set: vi.fn().mockResolvedValue('OK'), del: vi.fn() } as never,
  log: { warn: vi.fn() } as never,
  send: send as never,
  appUrl: 'https://app.agentor.dk',
});

let nextId = 1;
const row = (event: string, key: string, extra: Record<string, unknown> = {}) => ({
  id: nextId++,
  tenantId: TENANT,
  userId: USER,
  event,
  dedupeKey: key,
  notificationId: '0190b000-0000-7000-8000-000000000901',
  attempts: 0,
  createdAt: NOON,
  ...extra,
});
const who = (notification: Record<string, unknown> | null, emailOn = true) => ({
  email: 'mette@nordlys-cykler.test',
  name: 'Mette Holm',
  locale: 'da',
  tenantName: 'Nordlys Cykler ApS',
  emailOn,
  quiet: { enabled: true, start: '22:00', end: '07:00' },
  notification,
});
const brokenNotification = {
  params: {},
  href: `/connections/${CONN}`,
  flowId: null,
  connectionId: CONN,
  createdAt: NOON,
  resolvedAt: null,
};
const systematicNotification = (flow: string) => ({
  params: {
    count: 3,
    flow,
    entity: 'order',
    code: 'ACCOUNT_NOT_FOUND',
    label: '#10432',
    system: 'Dinero',
    p_value: '1010',
    p_field: 'EU B2B-salg',
    at: NOON.toISOString(),
  },
  href: '/integrations/x?tab=runs&run=y',
  flowId: null,
  connectionId: null,
  createdAt: NOON,
  resolvedAt: null,
});

beforeEach(() => {
  for (const f of Object.values(db)) f.mockReset();
  send.mockReset();
  send.mockResolvedValue({ messageId: '<m@test>' });
  db.connectionEmailFacts.mockResolvedValue({
    connectorId: 'economic',
    name: 'Nordlys Outlet',
    status: 'broken',
    statusReason: 'Adgangen blev afvist. Log ind igen for at give Agentor adgang.',
    brokenSince: new Date('2026-10-19T07:14:00Z'),
    tokenExpiresAt: null,
    flows: [{ id: 'f', name: 'Outlet → regnskab', routes: 3 }],
    waiting: 7,
  });
});

describe('notification e-mail queue (E19–E22)', () => {
  it('sends E19 at once, also in quiet hours, with the affected flow and the queue', async () => {
    const r = row('connection_broken', 'n1');
    db.dueEmails.mockResolvedValue([r]);
    db.emailRecipient.mockResolvedValue(who(brokenNotification));
    expect(await drainEmailQueue(deps(), NIGHT)).toBe(1);
    expect(send).toHaveBeenCalledWith(
      'notify-connection-broken',
      expect.objectContaining({
        system: 'e-conomic',
        account: 'Nordlys Outlet',
        cause: 'expired',
        flows: [{ name: 'Outlet → regnskab', routes: 3 }],
        queued: 7,
        url: `https://app.agentor.dk/connections/${CONN}/reconnect`,
      }),
      expect.objectContaining({
        to: 'mette@nordlys-cykler.test',
        entityRef: 'connection_broken-n1',
      }),
    );
    expect(db.emailSent).toHaveBeenCalledWith({}, r.id, '<m@test>');
    expect(db.emailDefer).not.toHaveBeenCalled();
  });

  it('skips when the person turned e-mail off, or the connection works again', async () => {
    const off = row('connection_broken', 'n2');
    const fixed = row('connection_broken', 'n3');
    db.dueEmails.mockResolvedValue([off, fixed]);
    db.emailRecipient
      .mockResolvedValueOnce(who(brokenNotification, false))
      .mockResolvedValueOnce(who({ ...brokenNotification, resolvedAt: NOON }));
    expect(await drainEmailQueue(deps(), NOON)).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(db.emailSkip).toHaveBeenCalledWith({}, off.id);
    expect(db.emailSkip).toHaveBeenCalledWith({}, fixed.id);
  });

  it('holds E20 until the end of quiet hours', async () => {
    const r = row('systematic_error', 'n4');
    db.dueEmails.mockResolvedValue([r]);
    db.emailRecipient.mockResolvedValue(who(systematicNotification('Webshop → regnskab')));
    expect(await drainEmailQueue(deps(), NIGHT)).toBe(0);
    expect(db.emailDefer).toHaveBeenCalledWith({}, r.id, new Date('2026-10-21T05:00:00Z'));
    expect(send).not.toHaveBeenCalled();
  });

  it('merges E20s that waited into one e-mail, with the app texts', async () => {
    const a = row('systematic_error', 'n5');
    const b = row('systematic_error', 'n6');
    db.dueEmails.mockResolvedValue([a, b]);
    db.emailRecipient
      .mockResolvedValueOnce(who(systematicNotification('Webshop → regnskab')))
      .mockResolvedValueOnce(who(systematicNotification('Outlet → regnskab')))
      .mockResolvedValueOnce(who(systematicNotification('Outlet → regnskab')));
    expect(await drainEmailQueue(deps(), NOON)).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const props = send.mock.calls[0]![1] as {
      incidents: { flow: string; why: string; entity: string }[];
    };
    expect(props.incidents.map((i) => i.flow)).toEqual(['Webshop → regnskab', 'Outlet → regnskab']);
    expect(props.incidents[0]!.entity).toBe('ordrer');
    expect(props.incidents[0]!.why).toBe(
      'Kontoen 1010 findes ikke længere i Dinero. Ruten sender EU B2B-salg til den konto.',
    );
    expect(db.emailSent).toHaveBeenCalledWith({}, a.id, '<m@test>');
    expect(db.emailSkip).toHaveBeenCalledWith({}, b.id);
  });

  it('sends E21 with the month and when the counter resets', async () => {
    db.dueEmails.mockResolvedValue([row('quota', 'quota:2026-10', { notificationId: null })]);
    db.emailRecipient.mockResolvedValue(who(null));
    db.quotaFacts.mockResolvedValue({ used: 1620, limit: 2000, plan: 'Business' });
    expect(await drainEmailQueue(deps(), NOON)).toBe(1);
    expect(send).toHaveBeenCalledWith(
      'notify-quota-80',
      expect.objectContaining({
        used: 1620,
        limit: 2000,
        plan: 'Business',
        resetsAt: new Date('2026-10-31T23:00:00Z'),
      }),
      expect.anything(),
    );
  });

  it('sends E22 with an unsubscribe link and a one-click header', async () => {
    db.dueEmails.mockResolvedValue([
      row('weekly_summary', 'week:2026-W42', { notificationId: null }),
    ]);
    db.emailRecipient.mockResolvedValue(who(null));
    db.unsubscribeToken.mockResolvedValue('t'.repeat(32));
    db.weeklyStats.mockResolvedValue({
      records: 7639,
      orders: 412,
      errors: 3,
      runs: 1000,
      okRuns: 996,
      flows: [],
    });
    // Monday 08:00 Copenhagen.
    expect(await drainEmailQueue(deps(), new Date('2026-10-19T06:00:00Z'))).toBe(1);
    const [, props, opts] = send.mock.calls[0]!;
    expect(props).toMatchObject({
      week: 42,
      from: new Date('2026-10-11T22:00:00Z'),
      okRatio: 0.996,
      unsubscribeUrl: `https://app.agentor.dk/unsubscribe/${'t'.repeat(32)}`,
    });
    expect(opts).toMatchObject({
      unsubscribeUrl: `https://app.agentor.dk/api/unsubscribe/${'t'.repeat(32)}`,
    });
  });

  it('marks a failed send for a later try and logs no address', async () => {
    const r = row('connection_broken', 'n7');
    db.dueEmails.mockResolvedValue([r]);
    db.emailRecipient.mockResolvedValue(who(brokenNotification));
    send.mockRejectedValue(new Error('smtp down'));
    const d = deps();
    expect(await drainEmailQueue(d, NOON)).toBe(0);
    expect(db.emailFailed).toHaveBeenCalledWith({}, r.id);
    const logged = JSON.stringify(
      (d.log as unknown as { warn: ReturnType<typeof vi.fn> }).warn.mock.calls,
    );
    expect(logged).not.toContain('mette@');
  });
});
