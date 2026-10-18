# app.agentor.dk

Agentor keeps data in sync between webshops and ERP, CRM and marketing systems. This monorepo holds the web app, webhook ingest, sync worker and scheduler. Production URL: https://app.agentor.dk

- Plan and milestones: [docs/PLAN.md](docs/PLAN.md)
- Specs: [docs/specs/](docs/specs/) · approved design: [docs/design/runde-1/](docs/design/runde-1/) · brand: [docs/brand/](docs/brand/)
- Architecture decisions: [docs/adr/](docs/adr/) · ops runbooks: [infra/ops/](infra/ops/README.md)

## Layout

```
apps/web         Next.js UI, server actions, internal API      (agentor-app)
apps/ingest      Fastify webhook receiver                      (agentor-ingest)
apps/worker      BullMQ workers, the only process with the KEK (agentor-worker)
apps/scheduler   polling, retention, billing; single leader    (agentor-scheduler)
packages/db      Drizzle schema, migrations, RLS, isolation suite
packages/core    domain logic (status roll-up, …)
packages/config  shared TypeScript config
infra/           docker compose, DB roles, PM2, ops runbooks
```

## Local development

Requires Node 22+, corepack and Docker.

```bash
corepack enable
pnpm install
cp .env.example .env.local   # then fill in the local values (see below)
pnpm db:up                   # Postgres 16 :55432, Redis 7 :56379, Mailpit :58025
pnpm db:migrate
pnpm dev                     # coming with M2
```

Local `.env.local` values for the compose services use the dev passwords from `infra/db/init-dev.sh`, e.g. `DATABASE_URL_WEB=postgres://agentor_web:agentor_web_dev@127.0.0.1:55432/agentor`.

## Checks

| Command                                              | What                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm typecheck` · `pnpm lint` · `pnpm format:check` | Static checks                                                             |
| `pnpm test`                                          | Unit tests                                                                |
| `pnpm db:check-rls`                                  | Every tenant table has forced RLS and policies; roles are least-privilege |
| `pnpm test:isolation`                                | Tenant A can't read or write tenant B through any table, as any role      |
| `pnpm test:isolation:canary`                         | Proves the suite fails when RLS is disabled on a table                    |
| `pnpm build`                                         | Builds every app and package                                              |

CI runs all of the above on every pull request. Branch protection on `main` should require the `CI` checks to pass before merging.
