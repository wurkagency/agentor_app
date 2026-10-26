import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.js';

/** Location of the SQL migrations, both from src (tsx/vitest) and from dist. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Applies all pending migrations. Must connect as agentor_owner (produktspecifikation §10.3). */
export async function runMigrations(ownerUrl: string): Promise<void> {
  const handle = createDatabase(ownerUrl, { max: 1, applicationName: 'agentor-migrate' });
  try {
    const { rows } = await handle.pool.query<{ current_user: string }>('select current_user');
    if (rows[0]?.current_user !== 'agentor_owner') {
      throw new Error(`migrations must run as agentor_owner, not ${rows[0]?.current_user ?? '?'}`);
    }
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER, migrationsSchema: 'drizzle' });
  } finally {
    await handle.close();
  }
}
