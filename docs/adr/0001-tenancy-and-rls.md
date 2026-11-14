# ADR 0001 · Tenancy with PostgreSQL RLS

Status: accepted (M0) · 19. okt. 2026

## Context

produktspecifikation §9.1 requires a shared schema with `tenant_id` and forced RLS on every tenant table, separate DB roles (§10.3), `SET LOCAL` per transaction and fail-closed behaviour.

## Decisions

1. **Context is set with `set_config(name, value, true)`** as the first statement of every transaction (`withTenant()` in `packages/db`). That is `SET LOCAL`, but parameterised, so ids are never interpolated into SQL. Ids are validated as UUIDs before the call.
2. **`app.current_tenant_id()` / `app.current_user_id()`** return `NULL` for missing or empty context. Every policy compares against them, so no context means no rows. A malformed value raises an error instead of matching anything.
3. **Every table in `public` is RLS-protected** with `ENABLE` + `FORCE`, except the read-only global catalogue listed in `packages/db/src/tables.ts`. `scripts/check-rls.ts` enforces this in CI, together with role attributes (no superuser, no BYPASSRLS, own nothing) and key-box privileges.
4. **`tenants`** uses `id = app.current_tenant_id()`. **`users`** is global identity: visible to yourself and to members of the current tenant; you can only insert or update your own row.
5. **Per-flow access** is a `RESTRICTIVE` policy on `flows` and `flow_grants` that applies only to `agentor_web`. Workers act for the tenant, not a user, and are only bound by tenant isolation. Expired grants stop matching at query time (`expires_at > now()`), so no clean-up job is needed for correctness.
6. **Composite keys** `(tenant_id, id)` everywhere, and child tables reference `(tenant_id, parent_id)`, so a row can't point at another tenant's object even through a bug.
7. **UUID v7** is generated in the database (`app.uuid_v7()`) until PostgreSQL 18 ships `uuidv7()`.
8. **Isolation suite** (`packages/db/test/isolation`) is generated from the catalogue: every table with `tenant_id` is tested for read, update, delete, move and insert across tenants, as both web and worker. A meta-test fails when a table has no fixtures. A canary run disables RLS on a table and requires the suite to fail.

## Consequences

- Application code can't query the database except through `@agentor/db` (lint rule).
- Auth tables (M2) need the same treatment: sessions and factors are scoped by `app.user_id` because they exist before a tenant is chosen (PLAN.md Q32).
- Memberships writes are not yet restricted to admins in the database; the role check lives in the application layer (M3) because onboarding has to create the first owner.
