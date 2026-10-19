// Creates a development KEK pair outside the repository and prints the two settings to add to
// .env.local (or $GITHUB_ENV in CI). Production KEKs are created and stored per infra/ops.
//   node infra/scripts/dev-kek.mjs [path]
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const path = process.argv[2] ?? join(homedir(), '.agentor', 'dev-kek.pem');
if (!existsSync(path)) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const { privateKey } = generateKeyPairSync('x25519');
  writeFileSync(path, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  chmodSync(path, 0o600);
}
const der = createPublicKey(createPrivateKey(readFileSync(path))).export({
  format: 'der',
  type: 'spki',
});
console.log(`KEK_FILE=${path}`);
console.log(`KEK_PUBLIC_KEY=${der.subarray(der.length - 32).toString('base64')}`);
