# ADR 0002 · How the web process stores a secret it can't read

Status: **accepted** (option 1) · M5, 19. okt. 2026

## Problem

produktspecifikation §9.2 says: secrets are encrypted with a per-tenant DEK wrapped by the KEK; only the worker holds the KEK; the web role can insert secrets but never read them. But the customer types their API key into the web app. If only the worker can unwrap the DEK, the web process has no key to encrypt with.

## Options

1. **Seal to the KEK's public half (recommended).** The KEK becomes a key pair. The web process encrypts the secret with a fresh AES-256-GCM key and wraps that key with the KEK public key (X25519 sealed box via Node's built-in `crypto`, no new dependency). It stores the result with `format = 'kek-sealed-v1'` through `app.insert_connection_secret()`. The worker opens it with the private key and, on first use, re-encrypts it under the tenant DEK (`format = 'dek-aes256gcm-v1'`). The web process can write but never decrypt, which is exactly the property the spec asks for.
2. **Hand the plaintext to the worker** through the queue. Rejected: secrets would sit in Redis, which §9.3 forbids.
3. **Give the web process the DEK.** Rejected: breaks "web can't read secrets".

## Current state (M0)

`connection_secrets` already has `format`, `key_id`, `key_version`, `nonce` and `ciphertext`, so either envelope fits without a migration. Only the insert-only function and the privileges are in place; no crypto code exists yet.

## Decision (M5)

Option 1, implemented in `packages/keybox`:

- KEK = X25519 key pair. `KEK_FILE` holds the private key for the worker only (0400; the loader refuses group/other-readable files on POSIX). The web process gets only `KEK_PUBLIC_KEY`.
- `kek-sealed-v1`: an ephemeral X25519 key, then HKDF-SHA256, then AES-256-GCM. The stored ciphertext is the ephemeral public key, the ciphertext and the tag.
- `dek-aes256gcm-v1`: AES-256-GCM under the tenant DEK. DEKs are sealed to the KEK in `tenant_keys.wrapped_dek`.
- Associated data binds every ciphertext to its row (`connection-secret`, tenant, connection), so a ciphertext moved to another row does not open.
- The worker re-encrypts a sealed secret under the DEK on first use (`apps/worker/src/connections.ts`).
- Verified by `packages/keybox/test` and `packages/db/test/isolation/keybox-flow.test.ts`, which checks the real roles: web can store a secret but cannot select it.
