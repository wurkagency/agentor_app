import { adapterFor, MOCK_ORDERS, WriteError, type ConnectorAdapter } from '@agentor/connectors';
import { describe, expect, it } from 'vitest';
import { runRoute } from '../src/engine.js';
import { applyExpressions } from '../src/expressions.js';
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

describe('OR groups and developer mapping', () => {
  const order = MOCK_ORDERS[0]!; // #10447, Hamburg, company, total 4.395 kr.
  const base = def.routes[0]!;

  it('passes when any group passes and every rule of that group passes', async () => {
    const { failedFilter } = await import('../src/engine.js');
    const route = {
      ...base,
      entity: 'order' as const,
      filters: [
        { field: 'country' as const, op: 'eq' as const, value: 'DK', group: 0 },
        { field: 'customerKind' as const, op: 'eq' as const, value: 'company', group: 1 },
        { field: 'total' as const, op: 'gt' as const, value: 1000, group: 1 },
      ],
    };
    expect(failedFilter(route, order)).toBeNull();
    const strict = { ...route, filters: route.filters.map((f) => ({ ...f, group: 0 })) };
    expect(failedFilter(strict, order)?.field).toBe('country');
  });

  it('shapes the record with JSONata before writing', async () => {
    const seen: unknown[] = [];
    const base2 = adapterFor({ connectorId: 'dinero', credentials: {}, mode: 'mock' });
    const destination = {
      ...base2,
      connectorId: base2.connectorId,
      write: async (_e: string, r: unknown) => {
        seen.push(r);
        return { action: 'create' as const, destinationId: 'x' };
      },
    } as unknown as ConnectorAdapter;
    await runRoute({
      def,
      route: { ...base, expressions: { name: '$uppercase(name) & " (web)"' } },
      applyExpressions,
      records: [customer],
      destination,
      dryRun: false,
      existingId: () => null,
    });
    expect((seen[0] as { name: string }).name).toBe(`${customer.name.toUpperCase()} (web)`);
  });

  it('a runaway expression fails the record instead of holding the worker', async () => {
    const [r] = await runRoute({
      def,
      route: { ...base, expressions: { name: '($f := function($n) { $f($n + 1) }; $f(0))' } },
      applyExpressions,
      records: [customer],
      destination: adapterFor({ connectorId: 'dinero', credentials: {}, mode: 'mock' }),
      dryRun: false,
      existingId: () => null,
    });
    expect(r).toMatchObject({
      outcome: 'failed',
      errorCode: 'EXPRESSION_ERROR',
      failure: 'mapping',
    });
  });
});
