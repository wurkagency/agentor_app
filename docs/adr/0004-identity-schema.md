# ADR 0004 · Identity lives in its own schema, outside tenant RLS

Status: accepted (M2) · 19. okt. 2026

## Context

produktspecifikation §11 lists `users` as global identity and `auth_sessions`/`auth_factors` as RLS tables. Better Auth (D6) must find a user by e-mail and a session by token before anyone knows which tenant, or even which user, the request belongs to. A tenant policy can't apply at that point, and an own-row policy keyed on `app.user_id` can't either, because the user isn't known yet when Better Auth looks them up.

## Decision

1. Better Auth's tables live in schema **`auth`**: `users`, `sessions`, `accounts`, `verifications`, `two_factors`, `passkeys`. Ids are UUID v7 generated in the app.
2. **Only `agentor_web`** has access to `auth.*` (Better Auth runs in agentor-app). Worker, support and ops roles have no USAGE on the schema. `check-rls` and the isolation suite enforce this.
3. Tenant data stays in `public` under RLS. `memberships.user_id` references `auth.users`.
4. Before a tenant is chosen, a user may list **their own** memberships and tenants: `own_memberships_without_tenant` and `own_tenants_without_tenant`, which apply only while `app.tenant_id` is unset. Once a tenant is set, only `tenant_isolation` applies, so an agency user never sees a second tenant in the first tenant's context. Both cases are covered by isolation tests.
5. The tenant context comes from `auth.sessions.active_tenant_id` and is re-validated against `memberships` on every request (`requireAppContext()`); switching company checks membership before storing the choice.
6. Sensitive values are protected inside the schema:
   - Passwords are Argon2id.
   - TOTP secrets and backup codes are encrypted with `BETTER_AUTH_SECRET`; backup codes are switched from Better Auth's plain-JSON default to `storeBackupCodes: 'encrypted'`.
   - Session tokens are HttpOnly cookies.

## Consequences

- A bug in web code could read another user's identity row. The tenant data that matters (flows, connections, secrets, runs) remains behind RLS, and the key box stays worker-only.
- Repository functions that touch `auth.*` live in `packages/db/src/repo/identity.ts`, the only place outside Better Auth that does.
