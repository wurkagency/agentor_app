import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * The storage area for files people upload (PLAN-2026-10-21 §5.4, Q1): profile photos today.
 * One small interface with a disk driver under a root directory (STORAGE_DIR); an S3-compatible
 * driver can replace it later without touching the callers. Files are never served straight from
 * the disk: the app reads them after its own access check.
 */
export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  /** The file, or null when there is none. */
  get(key: string): Promise<Buffer | null>;
  /** Removes the file; a missing file is not an error. */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export class StorageKeyError extends Error {
  constructor(key: string) {
    super(`Invalid storage key: ${JSON.stringify(key)}`);
    this.name = 'StorageKeyError';
  }
}

/** Keys are lower-case paths like "avatars/<uuid>/<sha256>.webp": no "..", no absolute paths. */
const KEY = /^[a-z0-9][a-z0-9_.-]*(\/[a-z0-9][a-z0-9_.-]*)*$/;

export function checkKey(key: string): string {
  if (!KEY.test(key) || key.split('/').some((p) => p === '.' || p === '..') || key.length > 300)
    throw new StorageKeyError(key);
  return key;
}

/** Files under `root`. Writes go to a temporary file first and are renamed into place. */
export function diskStorage(root: string): Storage {
  const base = resolve(root);
  const pathOf = (key: string) => {
    const p = resolve(base, checkKey(key));
    // Belt and braces on top of the key check: never outside the root.
    if (!p.startsWith(base + sep)) throw new StorageKeyError(key);
    return p;
  };
  return {
    async put(key, data) {
      const p = pathOf(key);
      await mkdir(dirname(p), { recursive: true, mode: 0o750 });
      const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
      await writeFile(tmp, data, { mode: 0o640 });
      await rename(tmp, p);
    },
    async get(key) {
      try {
        return await readFile(pathOf(key));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
    async exists(key) {
      try {
        return (await stat(pathOf(key))).isFile();
      } catch {
        return false;
      }
    },
  };
}
