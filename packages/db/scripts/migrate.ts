import { runMigrations } from '../src/migrate.js';
import { loadLocalEnv, requireEnv } from './env.js';

loadLocalEnv();
await runMigrations(requireEnv('DATABASE_URL_OWNER'));
console.log('Migrations applied.');
