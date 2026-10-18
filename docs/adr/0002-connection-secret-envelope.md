# ADR 0002 · How the web process stores a secret it can't read

Status: proposed, to be decided in M5 · 19. okt. 2026

## Problem

produktspecifikation §9.2 says: secrets are encrypted with a per-tenant DEK wrapped by the KEK; only the worker holds the KEK; the web role can insert secrets but never read them. But the customer types their API key into the web app. If only the worker can unwrap the DEK, the web process has no key to encrypt with.

## Options

1. **Seal to the KEK's public half (recommended).** The KEK becomes a key pair. The web process encrypts the secret with a fresh AES-256-GCM key and wraps that key with the KEK public key (X25519 sealed box via Node's built-in `crypto`, no new dependency). It stores the result with `format = 'kek-sealed-v1'` through `app.insert_connection_secret()`. The worker opens it with the private key and, on first use, re-encrypts it under the tenant DEK (`format = 'dek-aes256gcm-v1'`). The web process can write but never decrypt, which is exactly the property the spec asks for.
2. **Hand the plaintext to the worker** through the queue. Rejected: secrets would sit in Redis, which §9.3 forbids.
3. **Give the web process the DEK.** Rejected: breaks "web can't read secrets".

## Current state (M0)

`connection_secrets` already has `format`, `key_id`, `key_version`, `nonce` and `ciphertext`, so either envelope fits without a migration. Only the insert-only function and the privileges are in place; no crypto code exists yet.
