import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Loads the repo-root .env.local for local development, if present. CI sets env directly. */
export function loadLocalEnv(): void {
  const file = fileURLToPath(new URL('../../../.env.local', import.meta.url));
  if (existsSync(file)) process.loadEnvFile(file);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}
