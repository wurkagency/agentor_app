import { createPrivateKey } from 'node:crypto';
import {
  DEK_FORMAT,
  dekDecrypt,
  dekEncrypt,
  generateKek,
  newWrappedDek,
  open,
  publicKeyFromBase64,
  seal,
  SEALED_FORMAT,
  secretBinding,
  unwrapDek,
} from '@agentor/keybox';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '../../src/client.js';
import {
  createConnection,
  ingestWebhook,
  loadConnectionForWorker,
  recordConnectionTest,
  storeDekSecret,
  tenantDek,
} from '../../src/repo/connections.js';
import { roleUrl } from './env.js';
import { ID } from './fixtures.js';
import { admin } from './helpers.js';

/**
 * The key box end to end with the real roles (produktspecifikation §9.2, ADR 0002): the web role
 * stores a credential it can never read back; the worker opens it with the KEK and moves it
 * under the tenant's DEK.
 */

let web: DatabaseHandle;
let worker: DatabaseHandle;
const kek = generateKek();
const kekPrivate = createPrivateKey(kek.privatePem);
const kekPublic = publicKeyFromBase64(kek.publicB64);
const actor = { tenantId: ID.tenantB, userId: ID.userBOwner, name: 'Ejer B' };
let connectionId = '';
let webhookToken = '';

beforeAll(() => {
  const db = inject('isolationDb');
  web = createDatabase(roleUrl('web', db), { max: 2 });
  worker = createDatabase(roleUrl('worker', db), { max: 2 });
});

afterAll(async () => {
  if (connectionId) await admin('delete from connections where id = $1', [connectionId]);
  await admin(`delete from tenant_keys where tenant_id = $1 and kek_id = 'keybox-test'`, [
    ID.tenantB,
  ]);
  await web?.close();
  await worker?.close();
});

describe('key box', () => {
  it('web seals a credential to the KEK and cannot read it back', async () => {
    const created = await createConnection(web.db, actor, {
      connectorId: 'woocommerce',
      name: 'butik.example',
      version: '1.0.0',
      webhook: true,
      secretFor: (id) =>
        seal(
          JSON.stringify({ consumerKey: 'ck_test', consumerSecret: 'cs_test' }),
          kekPublic,
          secretBinding(ID.tenantB, id),
        ),
    });
    connectionId = created.id;
    webhookToken = created.webhookToken!;
    expect(webhookToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(
      web.db.execute(sql`select ciphertext from connection_secrets`),
    ).rejects.toMatchObject({
      cause: { code: '42501' },
    });
    const stored = await admin(
      'select format, ciphertext from connection_secrets where connection_id = $1',
      [connectionId],
    );
    expect(stored.rows[0].format).toBe(SEALED_FORMAT);
    expect(Buffer.from(stored.rows[0].ciphertext).toString()).not.toContain('cs_test');
  });

  it('the worker opens it and re-encrypts it under the tenant DEK', async () => {
    const conn = await loadConnectionForWorker(worker.db, ID.tenantB, connectionId);
    const bind = secretBinding(ID.tenantB, connectionId);
    const plain = open(conn!.secret!, kekPrivate, bind);
    expect(JSON.parse(plain.toString()).consumerSecret).toBe('cs_test');

    await admin(
      `update tenant_keys set retired_at = now() where tenant_id = $1 and retired_at is null`,
      [ID.tenantB],
    );
    const key = await tenantDek(worker.db, ID.tenantB, () => ({
      wrapped: newWrappedDek(kekPublic, ID.tenantB).wrapped,
      kekId: 'keybox-test',
    }));
    expect(key.created).toBe(true);
    const dek = unwrapDek(key.wrapped, kekPrivate, ID.tenantB);
    await storeDekSecret(worker.db, ID.tenantB, connectionId, key.id, dekEncrypt(plain, dek, bind));

    const again = await loadConnectionForWorker(worker.db, ID.tenantB, connectionId);
    expect(again!.secret!.format).toBe(DEK_FORMAT);
    expect(JSON.parse(dekDecrypt(again!.secret!, dek, bind).toString()).consumerKey).toBe(
      'ck_test',
    );
    // The same DEK is reused on the next job.
    const reuse = await tenantDek(worker.db, ID.tenantB, () => {
      throw new Error('should not create');
    });
    expect(reuse.id).toBe(key.id);
  });

  it('a secret cannot be read from another tenant even by the worker', async () => {
    const other = await loadConnectionForWorker(worker.db, ID.tenantA, connectionId);
    expect(other).toBeNull();
  });

  it('records test results and accepts webhooks for the connection’s token only', async () => {
    await recordConnectionTest(worker.db, ID.tenantB, connectionId, {
      ok: true,
      accountId: 'butik.example',
      accountName: 'butik.example',
    });
    const status = await admin('select status from connections where id = $1', [connectionId]);
    expect(status.rows[0].status).toBe('ok');
    const ev = await ingestWebhook(
      web.db,
      webhookToken,
      { 'x-wc-webhook-topic': 'order.created' },
      Buffer.from('{}'),
    );
    expect(ev?.tenantId).toBe(ID.tenantB);
    expect(await ingestWebhook(web.db, 'x'.repeat(43), {}, Buffer.from('{}'))).toBeNull();
    expect(await ingestWebhook(web.db, 'not a token', {}, Buffer.from('{}'))).toBeNull();
  });
});
