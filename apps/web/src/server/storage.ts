import { diskStorage, type Storage } from '@agentor/storage';
import { resolve } from 'node:path';
import { env, isProduction } from './env';

let cached: Storage | undefined;

/**
 * The storage area for uploaded files (PLAN-2026-10-21 Q1). Production sets STORAGE_DIR (created
 * by server-setup.sh, owned by agentor-web); development uses .data/storage in the repo.
 */
export function storage(): Storage {
  if (cached) return cached;
  const dir = env().STORAGE_DIR;
  if (!dir && isProduction()) throw new Error('STORAGE_DIR is not set: uploads have nowhere to go');
  cached = diskStorage(dir ?? resolve(process.cwd(), '../../.data/storage'));
  return cached;
}
