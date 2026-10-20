# Operations runbooks (VM, Phase 0)

These steps run on the Ubuntu/Plesk VM, not in CI. They are the ops half of the Phase 0 gate in produktspecifikation §14.1. Each item lists the spec section it implements. Status: **not executed**. Owner: DevOps.

## 1. OS users (§9.9, §10.1)

- Create `agentor-web` and `agentor-worker` as system users without a login shell. Neither is in the Plesk subscription's group, and the Plesk user is not in either of theirs.
- PM2 runs once per user: `infra/pm2/ecosystem.web.config.cjs` and `infra/pm2/ecosystem.worker.config.cjs`.
- No PHP or Passenger on Agentor's domains. Plesk's Node.js hosting stays off; PM2 is the only process manager.

## 2. Key encryption key (§9.2)

- Generate the KEK offline. Store it at a path outside the webroot, owned by `agentor-worker`, directory mode 0700, file mode 0400.
- Never in the repo, `.env` files or backups. Two people keep an offline copy (paper or hardware token).
- Rotation re-wraps tenant DEKs only. Keep the 60-minute token-revocation runbook (Shopify, Dinero, HubSpot) next to the key procedure.

## 3. PostgreSQL 16 (§10.3, §10.6)

- Unix sockets only. Create the roles with `infra/db/roles.sql`, using strong passwords from the password manager.
- Rotate the production database password that was shared during the agentor.dk handover (§10.5).
- `pg_stat_statements` on. Backups with pgBackRest to encrypted EU object storage: weekly full, daily differential, continuous WAL. RPO 15 min, RTO 4 h.
- **Restore test every quarter, documented.** The Phase 0 gate requires one passing restore test.

## 4. Redis 7, dedicated (§10.2)

- A separate instance, not the shared Redis: `maxmemory-policy noeviction`, `appendonly yes`, Unix socket, back up the AOF daily.

## 5. Network (§9.4)

- `iptables` owner match: `agentor-worker` may not reach private, loopback, link-local or metadata ranges except PostgreSQL and Redis over Unix sockets.
- Nginx (Plesk) terminates TLS for `app.agentor.dk` and proxies to `127.0.0.1:3000` (web) and `127.0.0.1:3100` (ingest, `/hooks/`).

## 6. Hardening (§9.9)

- Automatic security updates, fail2ban, SSH with keys only, AppArmor profiles for the Node processes.
- Exit criterion for a dedicated VM: the first paying customer above Business, 50 tenants, or the first ISO 27001/SOC 2 request, whichever comes first.

## 7. Deploy (§10.5)

GitHub Actions builds and tests. A restricted deploy user runs: `git pull` → `pnpm install --frozen-lockfile` → `pnpm db:migrate` (as `agentor_owner`) → `pnpm build` → `pm2 reload` for each user. Releases live in versioned folders with a `current` symlink, so rollback is one symlink switch.

## 8. Signup in production with QuickPay test mode (PLAN-SIGNUP Q19)

There is no staging. Until launch, production runs signup end to end with QuickPay in test mode.

- `QUICKPAY_MODE=test` in `web.env.production` and `worker.env.production`, with the test account's `QUICKPAY_API_KEY` (both) and `QUICKPAY_PRIVATE_KEY` (web). QuickPay posts its callbacks to `https://app.agentor.dk/billing/quickpay` (agentor-ingest), which must be reachable from the internet.
- Pay with QuickPay's published test cards (QuickPay manager → Help → Test cards). Callbacks carry `test_mode: true`. In `live` mode these are refused (`parseCallback`), so a test card can never activate a company after launch.
- Terms: while agentor.dk has no documents, `LEGAL_DEV_VERSION` lets SU5 store the version as `test:<value>`. Only in test mode: with `QUICKPAY_MODE=live` acceptance is refused until `LEGAL_SUBSCRIPTION_TERMS_URL` and `LEGAL_PRIVACY_URL` point at agentor.dk pages with `<meta name="agentor-document-version">`.
- CVR: `CVR_PROVIDER=virkdata` with `VIRKDATA_API_KEY`. Check the key with `pnpm --filter @agentor/web cvr:check` (does not count against the quota).
- Manual check each release: sign up with a real inbox → code → CVR → plan → test card → SU6 shows "Betalt" → receipt mail arrives once → MFA → onboarding. Abandon one signup at payment and confirm it is deleted after 24 hours.

**Before launch (switch to live):** set `QUICKPAY_MODE=live` and the live keys; set the two `LEGAL_*_URL`s and remove `LEGAL_DEV_VERSION`; delete the companies created in test mode (`select id, name from tenants where signup_state_at is not null`, after checking the list); `pm2 reload` both users.
