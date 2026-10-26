import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '../../src/client.js';
import { restoreVersion } from '../../src/repo/editor.js';
import { roleUrl } from './env.js';
import { ID } from './fixtures.js';
import { admin } from './helpers.js';

/**
 * Gendan som kladde through the repository as the web role runs it. The seeded draft is put back
 * afterwards, so the other suites see the seeded data.
 */

let web: DatabaseHandle;
let original: Record<string, unknown>;
const OWNER = { tenantId: ID.tenantA, userId: ID.userAOwner, name: 'Owner A' };

beforeAll(async () => {
  web = createDatabase(roleUrl('web', inject('isolationDb')), { max: 2 });
  original = (
    await admin(
      `select definition, locked_by, locked_by_name, locked_at, updated_at, author_name from flow_versions where id = $1`,
      [ID.draftA1],
    )
  ).rows[0];
});

afterAll(async () => {
  await admin(
    `update flow_versions set definition = $2, locked_by = $3, locked_by_name = $4, locked_at = $5, updated_at = $6, author_name = $7 where id = $1`,
    [
      ID.draftA1,
      original.definition,
      original.locked_by,
      original.locked_by_name,
      original.locked_at,
      original.updated_at,
      original.author_name,
    ],
  );
  await admin(`delete from audit_log where action = 'flow.version_restored'`);
  await web.close();
});

describe('restoring a version as the draft', () => {
  it('copies the version into the draft and locks it to the editor', async () => {
    await admin(`update flow_versions set locked_by = null, locked_at = null where id = $1`, [
      ID.draftA1,
    ]);
    const draftId = await restoreVersion(web.db, OWNER, ID.flowA1, ID.versionA1);
    expect(draftId).toBe(ID.draftA1);
    const [v] = (await admin(`select definition from flow_versions where id = $1`, [ID.versionA1]))
      .rows;
    const [d] = (
      await admin(`select definition, locked_by from flow_versions where id = $1`, [ID.draftA1])
    ).rows;
    expect(d.definition).toEqual(v.definition);
    expect(d.locked_by).toBe(ID.userAOwner);
    const audit = await admin(
      `select 1 from audit_log where action = 'flow.version_restored' and tenant_id = $1`,
      [ID.tenantA],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('refuses while someone else holds a fresh lock', async () => {
    await admin(`update flow_versions set locked_by = $2, locked_at = now() where id = $1`, [
      ID.draftA1,
      ID.userADevRestricted,
    ]);
    await expect(restoreVersion(web.db, OWNER, ID.flowA1, ID.versionA1)).rejects.toThrow('LOCKED');
  });

  it('readers and other tenants cannot restore', async () => {
    await admin(`update flow_versions set locked_by = null, locked_at = null where id = $1`, [
      ID.draftA1,
    ]);
    await expect(
      restoreVersion(
        web.db,
        { tenantId: ID.tenantA, userId: ID.userAReader, name: 'Reader' },
        ID.flowA1,
        ID.versionA1,
      ),
    ).rejects.toThrow('FORBIDDEN');
    await expect(
      restoreVersion(
        web.db,
        { tenantId: ID.tenantB, userId: ID.userBOwner, name: 'B' },
        ID.flowA1,
        ID.versionA1,
      ),
    ).rejects.toThrow('NOT_FOUND');
  });
});
