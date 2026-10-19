import { describe, expect, it } from 'vitest';
import {
  ENTITIES,
  sourceVersion,
  WriteError,
  type ConnectorAdapter,
  type ConnectorManifest,
} from '../src/index.js';

/**
 * Contract-test kit (produktspecifikation §4.2): every connector adapter runs these against its
 * sandbox or recorded fixtures before it ships. They pin what the engine relies on: cursor
 * reads, reading one record, idempotent versions, dry runs that never write, typed write errors
 * and webhook parsing.
 */
export function adapterContract(
  name: string,
  manifest: ConnectorManifest,
  make: (credentials?: Record<string, string>) => ConnectorAdapter,
) {
  describe(`${name} adapter contract`, () => {
    const outputs = manifest.outputs.map((p) => p.entity);
    const inputs = manifest.inputs.map((p) => p.entity);

    it('passes its connection test with valid credentials', async () => {
      expect((await make().test()).ok).toBe(true);
    });

    it('reads records with a source id and a stable version', async () => {
      for (const entity of outputs) {
        const records = await make().fetch(entity, { limit: 5 });
        for (const r of records) {
          expect(typeof (r as { sourceId: unknown }).sourceId).toBe('string');
          expect(sourceVersion(r)).toBe(sourceVersion(structuredClone(r)));
        }
      }
    });

    it('honours limit and since', async () => {
      for (const entity of outputs) {
        expect((await make().fetch(entity, { limit: 1 })).length).toBeLessThanOrEqual(1);
        const future = new Date(Date.now() + 365 * 86_400_000).toISOString();
        const later = await make().fetch(entity, { limit: 50, since: future });
        const all = await make().fetch(entity, { limit: 50 });
        expect(later.length).toBeLessThanOrEqual(all.length);
      }
    });

    it('reads one record by id, and null for an unknown id', async () => {
      for (const entity of outputs) {
        const [first] = await make().fetch(entity, { limit: 1 });
        if (!first) continue;
        const id = (first as { sourceId: string }).sourceId;
        expect((await make().get(entity, id)) as unknown).toEqual(first);
        expect(await make().get(entity, `missing-${id}`)).toBeNull();
      }
    });

    it('never writes on a dry run', async () => {
      for (const entity of inputs) {
        const source = ENTITIES.includes(entity) ? await make().fetch(entity, { limit: 1 }) : [];
        const rec = source[0];
        if (!rec) continue;
        const res = await make().write(entity, rec, { mode: 'dry_run' });
        expect(res.destinationId).toBeNull();
      }
    });

    it('reports write failures as typed errors', async () => {
      for (const entity of inputs) {
        const [rec] = await make().fetch(entity, { limit: 1 });
        if (!rec) continue;
        const id = (rec as { sourceId: string }).sourceId;
        await expect(
          make({ mockFail: `invalid:${id}` }).write(entity, rec, { mode: 'live' }),
        ).rejects.toBeInstanceOf(WriteError);
      }
    });

    it('ignores webhooks it does not understand', () => {
      expect(make().parseWebhook('not json', {})).toBeNull();
    });
  });
}
