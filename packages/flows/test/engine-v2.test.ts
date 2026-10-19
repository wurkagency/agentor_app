import { adapterFor, MOCK_ORDERS, WriteError, type ConnectorAdapter } from '@agentor/connectors';
import { describe, expect, it } from 'vitest';
import { runRoute } from '../src/engine.js';
import { parseDefinition } from '../src/definition.js';

/** The engine's failure classes and dependency hook (produktspecifikation §4.1). */
const def = parseDefinition({
  nodes: [
    { id: 'shop', role: 'source', connectionId: '0190a000-0000-7000-8000-000000000001' },
    { id: 'erp', role: 'destination', connectionId: '0190a000-0000-7000-8000-000000000002' },
  ],
  routes: [
    {
      id: 'r1',
      from: 'shop',
      to: 'erp',
      entity: 'customer',
      targetEntity: 'customer',
      mode: 'live',
    },
  ],
});
const route = def.routes[0]!;
const customer = MOCK_ORDERS[0]!.customer;

function failing(kind: WriteError['kind']): ConnectorAdapter {
  const base = adapterFor({ connectorId: 'dinero', credentials: {}, mode: 'mock' });
  return {
    ...base,
    connectorId: base.connectorId,
    write: async () => {
      throw new WriteError(kind, kind, kind === 'rate_limited' ? 5000 : undefined);
    },
  } as ConnectorAdapter;
}

describe('write failures', () => {
  it.each([
    ['invalid', 'DESTINATION_REJECTED'],
    ['transient', 'DESTINATION_ERROR'],
    ['rate_limited', 'DESTINATION_ERROR'],
    ['unauthorized', 'CONNECTION_BROKEN'],
  ] as const)('%s becomes %s with its class', async (kind, code) => {
    const [r] = await runRoute({
      def,
      route,
      records: [customer],
      destination: failing(kind),
      dryRun: false,
      existingId: () => null,
    });
    expect(r).toMatchObject({ outcome: 'failed', errorCode: code, failure: kind });
    if (kind === 'rate_limited') expect(r!.retryAfterMs).toBe(5000);
  });
});

describe('dependencies and rate limits', () => {
  it('resolves dependencies first and passes their ids to the write', async () => {
    const seen: unknown[] = [];
    const base = adapterFor({ connectorId: 'dinero', credentials: {}, mode: 'mock' });
    const destination = {
      ...base,
      connectorId: base.connectorId,
      write: async (_e: string, _r: unknown, opts: unknown) => {
        seen.push(opts);
        return { action: 'create' as const, destinationId: 'x-1' };
      },
    } as unknown as ConnectorAdapter;
    let waits = 0;
    const [r] = await runRoute({
      def,
      route,
      records: [customer],
      destination,
      dryRun: false,
      existingId: () => null,
      resolveDependencies: async () => ({ refs: { 'product:p-1': 'd-88' } }),
      beforeWrite: async () => {
        waits++;
      },
    });
    expect(r!.outcome).toBe('created');
    expect(seen[0]).toMatchObject({ refs: { 'product:p-1': 'd-88' } });
    expect(waits).toBe(1);
  });

  it('a dependency that cannot be created needs the customer', async () => {
    const [r] = await runRoute({
      def,
      route,
      records: [customer],
      destination: adapterFor({ connectorId: 'dinero', credentials: {}, mode: 'mock' }),
      dryRun: false,
      existingId: () => null,
      resolveDependencies: async () => ({ missing: 'product', reason: 'not found' }),
    });
    expect(r).toMatchObject({
      outcome: 'failed',
      errorCode: 'DEPENDENCY_MISSING',
      failure: 'dependency',
    });
  });

  it('a test run never resolves dependencies or waits', async () => {
    let called = false;
    await runRoute({
      def,
      route,
      records: [customer],
      destination: adapterFor({ connectorId: 'dinero', credentials: {}, mode: 'mock' }),
      dryRun: true,
      existingId: () => null,
      resolveDependencies: async () => {
        called = true;
        return { refs: {} };
      },
      beforeWrite: async () => {
        called = true;
      },
    });
    expect(called).toBe(false);
  });
});
