# app.agentor.dk: build plan

Status: **draft, waiting for product-owner approval** · 18. okt. 2026

This plan turns the approved specs and the round-1 design into a codebase. It maps to the phases in `docs/specs/produktspecifikation.md` §14.1. Every milestone is one feature branch and one PR into `main`.

Sources and order of authority are fixed by the build brief: (1) the decisions list in `docs/design/runde-1/README.md`, (2) the boards, (3) `designspecifikation.md`, (4) `docs/brand/`, (5) `produktspecifikation.md`, (6) connector specs.

---

## 1. Architecture in one page

**Four processes, one database, one queue** (produktspecifikation §10.1):

| Process | App | Runs as | Does | Never does |
| --- | --- | --- | --- | --- |
| `agentor-app` | `apps/web` (Next.js 16) | OS user `agentor-web`, DB role `agentor_web` | UI, server actions, internal API, writes config and enqueues work | Read secrets, call customer systems |
| `agentor-ingest` | `apps/ingest` (Fastify) | `agentor-web` / `agentor_web` | Verify webhook signature, write idempotent event row, enqueue, reply 200 | Process events synchronously |
| `agentor-worker` | `apps/worker` (BullMQ) | `agentor-worker` / `agentor_worker` | Fetch, normalise, fan-out, filter/map (JSONata, sandboxed), write, record outcome | Anything without a re-validated tenant context |
| `agentor-scheduler` | `apps/scheduler` | `agentor-worker` / `agentor_worker` | Polling, token refresh, retention, quota reset, QuickPay billing; single leader via Redis lock | Run twice |

**Tenancy is enforced three times.** (1) App layer: every DB access goes through `withTenant(ctx, fn)` in `packages/db`, which opens a transaction and runs `SET LOCAL app.tenant_id` and `app.user_id`. A lint rule forbids raw SQL and direct Drizzle client use outside `packages/db`. (2) Database: `ENABLE` + `FORCE ROW LEVEL SECURITY` on every tenant table with `tenant_id = current_setting('app.tenant_id', true)::uuid` for `USING` and `WITH CHECK`, so missing context returns zero rows. Composite FKs `(tenant_id, id)` stop cross-tenant links. Flow-level ACL is a second policy on `flows` and derived tables (`flow_grants`). (3) Ops: separate OS users, KEK readable only by `agentor-worker`, egress filtering (documented in `infra/`, applied on the VM).

**Tenant context comes only from the session or the job**, never from the URL or body. Routes carry no tenant id. Object ids are UUID v7.

**Secrets:** AES-256-GCM envelope encryption. Per-tenant DEK in `tenant_keys`, wrapped by a KEK loaded from a file outside the repo through a small `KeyProvider` interface (file now, Vault/KMS later). `agentor_web` can only call a `SECURITY DEFINER` insert function and has no `SELECT` on `connection_secrets` or `tenant_keys`. Only `agentor_worker` can read them.

**Flows:** a flow's graph (nodes, routes, settings, mapping) is a JSONB snapshot in `flow_versions`, validated by one shared Zod schema in `packages/core`. The draft is the newest unpublished version, locked to one editor. Publishing materialises `routes` for fast fan-out and status roll-up. Status is computed per route and rolled up worst-wins: Afbrudt > Fejl > Advarsel > Aktiv > Test > Pauset > Kladde.

**Connectors are manifests plus adapters.** `packages/connector-sdk` defines the manifest (auth, entities and ports, triggers, supported modes, `settingsSchema` as JSON Schema, `mappingTargets` with live lookups, dependencies, rate limit, changelog) and a contract-test kit. The UI renders forms, ports and mapping from the manifest, never per connector. Phase 1 ships a `mock` connector (source + destination) that drives the whole editor and test run. Phase 2 adds `woocommerce` and `dinero`.

**Sync pipeline (Phase 2):** ingest/poll → idempotency key `(connection_id, entity, source_id, source_version)` → normalise to the common model → fan-out one job per matching published route → filter, map, resolve dependencies → write in Test / Kladde / Live respecting a per-connection token bucket → record outcome, `entity_links`, metrics. Job payloads carry references, never personal data. Retries use exponential backoff with jitter (1 min → 6 h, max 8); 4xx validation errors go straight to "Kræver handling". Exhausted jobs become failed records with "Gentag", never silent Redis loss.

**Web app:** App Router, server components for reads, server actions for mutations (CSRF-safe), TanStack Query only where the client needs live data (editor, notifications, run lists). All copy in next-intl catalogs (`da` default, `en`). All visuals from tokens via a Tailwind v4 theme in `packages/ui`.

**Repo layout** (as proposed in the brief, kept):

```
apps/      web · ingest · worker · scheduler
packages/  db · core · connector-sdk · connectors/{mock,woocommerce,dinero} · ui · i18n · config
infra/     docker-compose.yml (Postgres 16, Redis 7 noeviction+AOF, Mailpit) · pm2/ · db/roles.sql · ops/ (VM runbooks)
docs/      specs · design · brand · PLAN.md · adr/
```

One addition: `docs/adr/` for short architecture decision records (e.g. auth tables vs RLS, UUID v7 generation), so decisions taken during the build are traceable.

---

## 2. Milestones

Phase 0 = M0. Phase 1 = M1–M7 (gate after M7). Phase 2 = M8–M11 (starts only after you approve the Phase 1 gate). Boards are in `docs/design/runde-1/boards/`.

Common acceptance criteria for **every** milestone (not repeated below):
- CI green: install → typecheck → lint → unit → isolation → build (+ e2e from M2).
- Every new tenant table has RLS + FORCE + policy, composite FKs, and is covered by the isolation suite. The RLS migration check fails the build otherwise.
- No hex, px outside the scale, ad-hoc radii or shadows in components (lint rule from M1).
- All copy via next-intl, Danish, domain words from produktspecifikation §3.
- Every list/card ships content, skeleton, empty and error states.
- Screenshots at 1440×900 next to the matching board in the PR. Works at 1280.
- No secrets or real customer data in repo, logs or tests.

### M0 · Fundament (Phase 0, repo part)

**Scope**
- pnpm workspaces + Turborepo, Node 22 (`.nvmrc`, `engines`), TypeScript strict, ESLint (flat config) + Prettier, shared configs in `packages/config`.
- `infra/docker-compose.yml`: Postgres 16, dedicated Redis 7 (`maxmemory-policy noeviction`, `appendonly yes`), Mailpit.
- `packages/db`: Drizzle setup, migrations run as `agentor_owner`, roles script for `agentor_owner`, `agentor_web`, `agentor_worker`, `agentor_support`, `agentor_readonly_ops` exactly per §10.3 (no `BYPASSRLS`, runtime roles own nothing).
- RLS helpers: SQL helper to enable+force+create the standard policy; `withTenant()` / `withSystem()` (system only for global tables); UUID v7 generator.
- First tenant tables: `tenants` (own policy `id = app.tenant_id`), `users` (global identity), `memberships`, `flows` (minimal), `flow_grants`, `audit_log` (insert+select only), `connection_secrets` + `tenant_keys` with the insert-only function, plus `plans` / `plan_entitlements` (global, read-only to runtime roles).
- **Isolation suite** (`packages/db/test/isolation`, Vitest against real Postgres): for every tenant table, generated from the schema, two tenants; A cannot select, insert, update or delete B's rows; queries without `app.tenant_id` return 0 rows; `agentor_web` cannot read `connection_secrets`; `agentor_support` can touch no table. A meta-test fails if a tenant table is missing from the suite.
- CI-check that every table in the tenant schema has RLS enabled+forced and a policy (queries `pg_class`/`pg_policies` after migrating).
- GitHub Actions: install → typecheck → lint → unit → isolation (Postgres service container) → build; plus gitleaks, Semgrep, `pnpm audit`, frozen lockfile.
- `infra/pm2/ecosystem.config.cjs` for the four processes and two OS users; `.env.example` with names only; `infra/ops/` runbooks stubs (VM hardening, KEK handling, backups) as documentation, not executed.
- Empty but booting `apps/web`, `apps/ingest` (health route), `apps/worker`, `apps/scheduler` (leader lock).

**Gate:** isolation suite green in CI, and a recorded run (in the PR) where a migration that disables RLS on a test table makes the suite and the RLS check fail.

**Not in scope (ops, on the VM):** hardening, OS users, backups and the restore test from the Phase 0 gate in §14.1. I'll write the runbooks; executing them on the server is yours or DevOps'.

### M1 · Tokens and component library

**Boards:** `Main`, `Komponenter-Handlinger`, `Komponenter-Data`, `Komponenter-Feedback` (Gå Live dialog from `D5-GaaLive`, not this sheet), `Komponenter-Tilstande`.

**Scope**
- `packages/ui/tokens`: brand tokens copied from `docs/brand/tokens/` (colors, radii, shadows, spacing, typography, theming with `--tenant-*` fallbacks), plus app tokens from designspecifikation §2 (`--status-*-fg/-bg`, `--app-surface`, `--app-canvas-dots`) and `--app-canvas: #F7F5F1`. App-shell sizes come from decision 1 (top bar 88, editor header 64, content max 1200), not `docs/brand/tokens/app-shell.css`, which is outdated. Any value found on a board but missing from tokens becomes a named token, listed in the PR. Known additions from the board inventory: `--radius-12` (nodes, palette rows, radio cards), `--app-subrow` (#FCFBF9), `--app-scrim` (rgba(26,26,24,.40)), row hover/selected fill, lime tints for drop target / test-run diff / port halo, ring tokens (focus, selected row lime+dark edge, selected port, error ring, lime+dark outline) and inset hairlines. Off-scale one-offs on the boards (radii 2/3/4/6/10, spacing 6/10/14/20/36/56, type 10/11/15/22/28) map to the nearest token unless they are structural (e.g. primary nav 15/500, health counters 28/700), in which case they become named app tokens. The full mapping goes in the M1 PR for review.
- Tailwind v4 theme generated from the tokens (`@theme`), so utilities only expose token values. Lint rule against arbitrary values (`[#…]`, `[13px]`) in `className`.
- Fonts self-hosted via `next/font` (Plus Jakarta Sans, JetBrains Mono): no Google Fonts call at runtime (EU data).
- Components (shadcn/ui restyled, Radix underneath): Button (primary L/M/S, secondary, ghost, dark, destructive, icon-only), StatusPill (+ compact dot), ModeBadge, ConnectorLogo/ConnectorPair (BC initials fallback), StatCard + sparkline (Recharts), FilterChip, Tabs (page, inspector, segmented), Switch/Checkbox/Radio, Input/Select/Combobox (mono account numbers), Accordion "Avanceret" (remembered state), Tooltip/Popover, Dialog (standard, destructive with name typing, publish), Toast (with "Fortryd"), Banner, EmptyState, Skeleton, ErrorCard (business + developer), KeyValueList, UsageMeter, Avatar/UserChip (Support marker), DataTable (expandable tree, selectable, sticky header, dark 12/600 headers per decision 7).
- Lucide icons pinned to the 0.460 look, stroke 1.75, sizes 16/18/24 via one `Icon` wrapper.
- Formatting helpers in `packages/i18n`: `1.234,50 kr.`, `18. okt. 2026`, `for 4 min. siden` (Intl, no date library).
- A `/_dev/components` page (dev-only, not routed in prod) rendering every component in every state, matched to the sheets.

**Acceptance:** each state on the four sheets (default, hover, focus, active, disabled, loading) exists and is screenshot-tested with Playwright; focus ring 2 px `#1A1A18` with 2 px offset (white on navy); axe-core clean; status always icon + text; `prefers-reduced-motion` turns off pulse and motion.

### M2 · App shell, i18n and authentication

**Boards:** `App-skal-B`, `App-skal-B-Indstillinger`, `D14-Login`, `D14-MFA`, `D1-Soeg` (shell only), `D2-Notifikationer` (shell only).

**Scope**
- App shell per decision 1–4: 88 px top bar, logo per decision 5, primary text nav with 2 px underline, ⌘K, bell with badge (red on error/broken, else dark), account chip; secondary pill nav; profile menu (Skift virksomhed, Min profil, Indstillinger, Abonnement og forbrug, Sprog, Log ud); content max 1200 px. Focus flows as centred cards without shell (decision 13).
- next-intl with `da` default and `en`; language switch in the profile menu; every string in catalogs; a CI check for missing keys.
- Better Auth: e-mail + password (Argon2id), TOTP, passkeys, organizations mapped to `tenants`/`memberships`; server-side sessions in HttpOnly/Secure/SameSite=Lax cookie, 12 h idle / 30 d absolute, rotation on login and role change; MFA mandatory for Ejer and Admin; login/MFA rate limiting and lockout; new-device notification e-mail (Mailpit locally, Brevo later).
- Security headers: strict CSP with nonce, HSTS, `frame-ancestors 'none'`; CSRF on mutations (server actions + origin check on API routes).
- Request → `TenantContext` from the session only; `/forgot-password` and `/invite/[token]` stubs completed in M3.

**Acceptance:** log in with password + TOTP or passkey; Ejer/Admin cannot reach the app without MFA; isolation tests extended to sessions and auth factors; Playwright login test; shell matches `App-skal-B` at 1440 and 1280.

### M3 · Tenants, team, access and settings

**Boards:** `D11-Team`, `D11-Inviter`, `App-skal-B-Indstillinger` (Virksomhed), `D12-Notifikationer`, `D12-Sikkerhed`, `D12-Auditlog`.

**Scope**
- Roles Ejer, Admin, Udvikler, Læser per §6 and per-flow access (`flow_grants` with optional expiry, enforced in RLS and in the app). Restricted users see only granted flows, their runs and the connections those flows use (name and status only). Expired grants stop working without a job running (policy checks `expires_at`).
- Invitations (role + flows + expiry), pending invitations, change role, remove, "at least one Ejer" rule.
- Settings: Virksomhed (name, CVR, address, language, time zone, currency), Notifikationer matrix (events × in-app/e-mail/push/SMS, thresholds, quiet hours; push/SMS delivery arrives in Phase 2), Sikkerhed (MFA, passkeys, sessions with "log ud overalt", require MFA for everyone, support-access approval setting D8), Audit-log (append-only, filters, CSV export, support access visible).
- Audit writes for every configuration change via one `audit()` helper inside the same transaction.
- `support_access_grants` table and the `agentor_support` break-glass functions (DB side only; the manage.agentor.dk UI is out of scope).
- Seed: Nordlys Cykler ApS with Mette Holm (Ejer), Jonas Krag (Admin), Sara Lind (Udvikler, 1 flow, expires 12. nov. 2026), Bo Dahl (Læser).

**Acceptance:** isolation tests for memberships, grants, invitations, audit log (no update/delete possible for any runtime role); role matrix tests (every server action checked against all four roles + restricted Udvikler); Sara sees exactly one flow everywhere.

### M4 · Plans, billing, entitlements and onboarding

**Boards:** `D13-Abonnement`, `D2-Graense`, `D14-Onboarding-1`, `-2`, `-3`, `D1-Ny-kunde`.

**Scope**
- `plans` and `plan_entitlements` as data (integration sets, destinations per flow, transactions, polling interval, retention, rate limit). No plan logic in code: one `entitlements` view and one `assertEntitled()` guard in `packages/core`.
- `subscriptions`, `addons`, `usage_counters`; transaction = successful Live write per destination (D2); at 100 % operation continues 7 days with notice (D2), never silent pause.
- QuickPay subscriptions in test mode: card authorisation in onboarding step 2, payment method on D13, invoice list; monthly charge job in the scheduler (idempotent per period). Downgrade blocked with explanation when over the new plan's limits.
- Onboarding: (1) company via CVR lookup, language, time zone, (2) plan and payment, (3) template → editor with guide. "Ny kunde" checklist on Overblik until the first test run is done (activation metric).
- `[ANTAL]` placeholders render from `plan_entitlements`.

**Acceptance:** entitlement unit tests (limits, Enterprise unlimited destinations, quota states 80/100 %); "Nyt flow" disabled with tooltip and upgrade link at the limit (`D2-Graense`); QuickPay flow works against their test environment with test cards only.

### M5 · Connector SDK, mock connector, connections and the key box

**Boards:** `D9-Forbindelser`, `D9-Katalog`, `D9-Dinero-Afbrudt`.

**Scope**
- `packages/connector-sdk`: manifest types and JSON Schema for the manifest itself, port and entity model (Agentor Common Model: Customer, Product, Order, CreditNote, StockLevel), capability flags (modes, triggers), `settingsSchema` → form renderer, `mappingTargets` with lookup providers, dependencies, rate limit, changelog (additive/breaking), contract-test kit.
- `packages/connectors/mock`: a source ("Mock-webshop") and a destination ("Mock-regnskab") with realistic ports, a chart of accounts lookup (1000, 1010, 1015, 1020, 1030, 1100, 6900) and deterministic sample records (#10421–#10460, #10447 failing on account 1010).
- `connectors` / `connector_versions` catalog (23 systems in 5 groups with Forbundet / Tilgængelig / På vej, decision 14; only mock is installable in Phase 1).
- Connections: create from manifest auth form, secrets written only through the insert function; worker-side `KeyProvider` + DEK cache; "Gentest forbindelse", "Genautentificér", "Afbryd" (warns when used by active flows); keys never shown, only "Konfigureret 12. okt. af Mette".
- Outbound HTTP client (worker only): HTTPS required, DNS resolved once, blocks private/loopback/link-local/metadata ranges also after redirects, timeouts, max body size. Unit-tested with a rebinding fixture.
- `apps/ingest`: per-connection unguessable webhook URL, HMAC verification hook per connector, timestamp/nonce window 5 min, idempotent event insert, enqueue, 200.

**Acceptance:** isolation + role tests show `agentor_web` cannot read a secret it wrote; SSRF test matrix green; mock connector passes the SDK contract tests; D9 screens match.

### M6 · Flow model, Overblik, Integrationer, detail, Aktivitet

**Boards:** `D1-Overblik`, `D1-Overblik-Problemer`, `D1-Soeg`, `D2-Integrationer`, `D2-Integrationer-Samlet`, `D2-Valg`, `D2-Tom`, `D2-Notifikationer`, `D7-Flow-Oversigt`, `D7-Flow-Fejl`, `D8-Koersler-Forretning`, `D8-Koersler-Udvikler`, `D10-Aktivitet-Log`.

**Scope**
- Tables: `flow_versions` (JSONB graph + Zod schema), `routes` (materialised), `route_cursors`, `entity_links`, `runs` and `run_records` (monthly partitions, custom SQL migration), `run_payloads` (encrypted), `metrics_daily`, `notifications`.
- `packages/core`: status roll-up, status triggers from §7.1 (5 %, 3 in a row, 80 %, per-tenant thresholds), plain-language flow explanation generated from the graph ("Når en ordre i WooCommerce bliver Gennemført, oprettes …").
- Seed the six Nordlys flows, connections (incl. e-conomic "Nordlys Outlet" afbrudt), runs and records, and the #10447 error so both "Alt kører" and "Problemer" states are reproducible (`pnpm seed --state=problems|ok|new`).
- Overblik: health band, 4 stat cards (synkroniseret omsætning with tooltip), Kræver handling, usage, recent activity; period switch I dag / 7 dage / 30 dage.
- Integrationer: expandable table (flow rows + route sub-rows, sparkline 7 d), filter chips in the URL, "Fold alle ud", bulk Pause/Genoptag (`D2-Valg`), empty state with templates, Basic/Developer toggle remembered per user (decision 2).
- ⌘K palette (flows, connections, order numbers, pages, "Nyt flow"); notifications popover with Kræver handling / Alle.
- Flow detail with the board's tabs **Oversigt · Kørsler · Ruter · Indstillinger** (the spec's Versioner tab becomes version history in the editor menu; "Efterindlæs" lives on the route's Kørsel tab). Oversigt and Kørsler as drawn (business and developer views, masked request/response); Ruter and Indstillinger have no board, so they reuse the D7 route cards and the settings form pattern.
- Aktivitet log with filters, "Indlæs flere", CSV export respecting the filter.
- Actions Pause / Genoptag / Kør nu / Gentag as toasts with "Fortryd" (6 s); they enqueue mock jobs.

**Acceptance:** status roll-up unit tests (every pair of statuses, Pauset not counted as error); Overblik answers "kører alt?" without scrolling at 1440×900; restricted users see filtered Overblik and Aktivitet; isolation tests for all new tables including partitions.

### M7 · Flow editor, test run and publish (Phase 1 gate)

**Boards:** `D3-Editor-Start`, `D3-Editor`, `D3-Editor-Traek`, `D3-Editor-Validering`, `D3-Editor-Skjult`, `D3-Editor-Laest`, `D4-Skabelonvaelger`, `D4-Guide`, `D5-Testkoersel`, `D5-GaaLive`, `D6-Listevisning`, `M5-Editor` (mobile "kræver en computer").

**Scope**
- `@xyflow/react` canvas with ELK.js auto-layout; source left, destinations right; nodes, ports (connected / free / valid target / incompatible), routes (Live solid, Test dashed, Pauset 40 %), status badges only on Advarsel/Fejl/Afbrudt, dependency chip, moving dot during runs (off with reduced motion); zoom + minimap.
- Palette with connections by category and the destination limit ("2 af 3 destinationer brugt · Flere kræver Enterprise"), drop rejected above the limit without Enterprise.
- Inspector (440 / 400 px, hideable with `]`, 48 px edge when hidden): nothing selected = flow settings + explanation; node = connection; route = Generelt, Mapping (one-column fields, collapsible sections, Kategori → konto without VAT column, product exceptions, fallback account), Filtre (rule builder, AND/OR, plain-language summary), Kørsel, Historik. Developer mode adds field-to-field JSONata mapping with live preview, raw filter expression, request/response.
- Draft lock (one editor, read-only banner for others), undo/redo, explicit Gem/Annullér with unsaved-change guard, validation (live markers + bottom panel; clicking a finding focuses the field), versions and restore-as-draft.
- List view (`D6`), fully keyboard operable; every canvas action reachable from list view + inspector.
- Template picker and in-editor guide (4 steps with progress).
- Test run: worker runs the draft against the latest 10 mock source records without writing; bottom panel shows per route created/updated/skipped and before/after for a selected record.
- Publish: diff dialog; "Sådan oprettes fakturaer" choice **Som kladde, uden bogføring** (default) or **Bogfør med det samme (Live)**, checkbox and button text follow the choice (decision 11); creates an immutable version, materialises routes; in-flight runs finish on the old version.
- **Playwright prototype path** (brief §7): Overblik (problems) → Integrationer → expand "Webshop → regnskab og CRM" → Åbn editor → route "Ordrer → Dinero Fakturaer" → EU B2B validation error → choose 1015 → Testkør (10 records, 9 created, 1 skipped) → Publicér as kladde → Overblik "Alt kører".

**Phase 1 gate:** the editor builds and publishes a flow against the mock connector, and the Playwright prototype path passes in CI on seeded data. I stop here for your approval.

Note on the seed: the prototype path uses Dinero/WooCommerce names and logos on seeded connections backed by the mock adapter (`connector_id = mock`, display metadata from the catalog). That keeps the gate honest (no real API) while matching the boards.

### Phase 2 · First live integration (after approval)

Outline only; detailed plan written at the Phase 1 gate.

- **M8 Sync engine:** BullMQ queues per stage, idempotency, fan-out from published routes, dependency resolution, per-connection and per-tenant token buckets (`moveToDelayed`), retries/backoff, dead-letter → failed records, polling cursors with 2 min overlap, echo suppression, graceful shutdown, retention jobs (payloads 30 d, records 13 mo, audit 24 mo), Prometheus metrics, Pino with `tenant_id`, GlitchTip/Sentry EU without payloads.
- **M9 WooCommerce connector:** consumer key/secret auth, connection test, programmatic webhook registration + HMAC, hourly polling fallback, orders, refunds (partial, line-level), customers (guest checkout, email match), products/variations/categories (primary category), order status trigger, line-item account mapping with category → product → fallback, three-level VAT override and conflict flags. Contract tests against WooCommerce in Docker.
- **M10 Dinero connector:** OAuth via Visma Connect, chart of accounts and VAT code lookups, contacts by email, sales and credit-note posting in Test / Kladde / Live, order reference + attachment, rate limit. Contract tests against a Dinero sandbox.
- **M11 Notifications, PWA, mobile:** e-mail/SMS via Brevo, Web Push (VAPID, own server), service worker caching the shell only, IndexedDB status snapshot keyed by user+tenant and wiped on logout/401 (covered by the isolation suite), mobile screens `M1`–`M7`, `D10-Afstemning` if it's in Phase 2 (see questions).

---

## 3. Board coverage

| Board | Milestone |
| --- | --- |
| Main, Komponenter-Handlinger, -Data, -Feedback, -Tilstande | M1 |
| App-skal-B, D14-Login, D14-MFA | M2 |
| App-skal-B-Indstillinger, D11-Team, D11-Inviter, D12-Notifikationer, D12-Sikkerhed, D12-Auditlog | M3 (shell part in M2) |
| D13-Abonnement, D2-Graense, D14-Onboarding-1..3, D1-Ny-kunde | M4 |
| D9-Forbindelser, D9-Katalog, D9-Dinero-Afbrudt | M5 |
| D1-Overblik, D1-Overblik-Problemer, D1-Soeg, D2-Integrationer, D2-Integrationer-Samlet, D2-Valg, D2-Tom, D2-Notifikationer, D7-Flow-Oversigt, D7-Flow-Fejl, D8-Koersler-Forretning, D8-Koersler-Udvikler, D10-Aktivitet-Log | M6 |
| D3-Editor-Start, D3-Editor, D3-Editor-Traek, D3-Editor-Validering, D3-Editor-Skjult, D3-Editor-Laest, D4-Skabelonvaelger, D4-Guide, D5-Testkoersel, D5-GaaLive, D6-Listevisning, M5-Editor | M7 |
| D10-Afstemning, M1-Overblik, M2-Integrationer, M3-Fejl, M4-Notifikationer, M6-Installer, M7-Push | M11 (Phase 2) |
| App-skal (rejected) | not built |

All 56 boards are accounted for.

---

## 4. Dependencies not named in the spec (need your OK)

The spec names the stack. These are the supporting packages I expect to add; I'll ask again if anything else comes up.

| Package | Why |
| --- | --- |
| `pg` (node-postgres) | Driver for Drizzle; supports `SET LOCAL` per transaction |
| Radix primitives, `cmdk`, `sonner`, `class-variance-authority`, `tailwind-merge` | What shadcn/ui is built on (dialogs, ⌘K, toasts, variants) |
| `lucide-react@0.460.0` (pinned) | Lucide icons at the specified version |
| `@node-rs/argon2` | Argon2id password hashing (§9.5); Better Auth defaults to scrypt |
| `uuid` (v7) | UUID v7 ids on Postgres 16 (native `uuidv7()` only arrives in PG 18) |
| `ioredis` | Redis client used by BullMQ, leader lock and token buckets |
| `@axe-core/playwright` | Accessibility checks in e2e |
| `gitleaks`, `semgrep` (CI actions only) | Secret scanning and SAST per §9.8 |


---

## 5. Where boards and specs disagree

The order of authority settles most of these: boards win on layout, copy and states, so I build as drawn and note it in the PR. Where a board's copy implies a **business rule** that contradicts the product spec, I don't treat the copy as a decision. Those are in §6.

| Topic | Spec says | Board shows | I'll do |
| --- | --- | --- | --- |
| App shell sizes | Sidebar 240, top bar 56; `app-shell.css` 260/64/1320 | Top bar 88, editor 64 + 56 toolbar, max 1200, padding 40 | Boards (decision 1); `app-shell.css` not used |
| Settings layout | 200 px left submenu, form max 720 | Secondary pill nav | Boards |
| Secondary nav row | – | Transaction meter right-aligned on every page | Boards |
| Flow detail tabs | Oversigt · Editor · Kørsler · Versioner · Indstillinger | Oversigt · Kørsler · Ruter · Indstillinger | Boards (see M6) |
| "Kørsler" / "Skabeloner" pills under Integrationer | No such routes | Shown | `/integrations/runs` (cross-flow runs) and `/integrations/templates` (picker as a page); see Q19 |
| Dialog widths | 480 (invite, focus cards) | Invite 560, onboarding 600/880 | Boards |
| Bottom panel | 240 | 240 (validation), 300 (test run) | Boards |
| Avatar / ModeBadge in editor | 28 / 22 | 32 / 20 | Boards |
| Mobile screens | M1–M4 | M1–M7 | Boards |
| Bulk bar | Pause · Genoptag | + Kør nu | Boards |
| Hidden inspector | 48 px edge | + floating "Valgt: … · Vis indstillinger" pill | Boards |
| Support avatar | – | Lime triangle | No triangle (decision 5): initials + "Support" tag |
| fg-3 as text | Metadata, placeholder | 2,79:1 on white, so icons only | fg-3 never used for text; placeholders and metadata use fg-2 |
| Input border #E4E1DB | Input outline | 1,31:1, fails WCAG 1.4.11 | `--color-border-strong` on input outlines (Q22) |
| Template copy | Draft by default | D4: "bogføres automatisk" | Rewrite to match draft-first (Q25) |

Screens with **no board**, built from the nearest pattern and flagged in the PR: Virksomhed settings, forgot password, accept invite, version history/diff, flow Ruter and Indstillinger tabs, Developer views of D2, desktop full-page notifications, `/developer/*` (webhooks, logs), no-access states.

---

## 6. Open questions

Each has the default I'll use if you don't answer. **Q1–Q10 block M3/M4**; the rest can wait for the milestone that needs them.

**Plans, billing and limits**
1. **The full `plan_entitlements` table.** The boards contradict each other: D13 lists Business at 1.000 transactions/md., while every meter shows 1.420 / 2.000 (Enterprise is also 2.000); Startup is 100; Startup integration sets are `[ANTAL]`; "2 / alle · ingen grænse" is unclear. Please give per plan: integration sets, destinations per flow (and the Enterprise cap, since one sheet shows 6), transactions/month, users (Business shows 10), polling interval (15/5/1, D7), retention and the overage add-on. *Default:* seed only what's unambiguous; the rest renders "–".
2. **Plan features on D13 that the spec doesn't have:** annual billing ("Skift til årlig"), SSO and white-label on Enterprise, "Eksterne brugere" from Business, "Supportadgang og audit-log" on Startup. *Default:* feature text comes from `plan_entitlements`; none of the extra features are built.
3. **Retention.** Spec: payloads 30 d, run metadata 13 mo, audit 24 mo. Boards: "Gemmes i 90 dage på Business", "Opbevaring 90/90 dage". *Default:* spec values, with a per-plan entitlement for run history.
4. **Quota behaviour.** D2 decision: 7 days of grace after 100 %. A component sheet says runs queue until the 1st; another warns at 89 % vs the 80 % rule. *Default:* D2 (7 days, then add-on), warning at 80 %.
5. **QuickPay test merchant** (key in `.env.local` only), invoice number format (AG-2026-1043 shown), prices shown with moms, "Du betaler først, når du forlader opsætningen". *Default:* mocked QuickPay client until I have a test account; copy as drawn.
6. **CVR lookup provider** (Virk needs an agreement; cvrapi.dk is third-party) and the "Ordrer pr. måned" bands behind the plan recommendation. *Default:* interface + stub, no external call.

**Roles, support and security**
7. **Udvikler permissions.** Spec: flows and connections. D11: "Kan ikke oprette forbindelser"; Admin listed without settings. *Default:* spec §6.
8. **Break-glass support.** Spec: approval optional (D8), max 60 min, support can act as Admin. D11/D12: approval mandatory, "i 2 timer", read-only wording. *Default:* spec, and the copy adjusted to match.
9. **MFA details:** "Husk denne enhed i 30 dage", 8 backup codes, whether "Kræv totrin for hele teamet" also covers Udvikler and Læser. *Default:* as drawn; the team toggle covers all roles.
10. **Invite link lifetime** (7 days shown) and default access expiry (~30 days). *Default:* as drawn.

**Notifications and status**
11. **"Systematisk fejl".** Spec: ≥ 5 % error rate or 3 in a row. D12: 3 errors on the same route within 15 min. Thresholds per tenant (spec) or per user ("Gælder kun dig")? *Default:* spec rule, thresholds per tenant, channel choices per user.
12. **Event list.** The board adds "Enkelt record fejlet" and a weekly summary, and drops connector update and "nyt tilgængeligt". *Default:* union of both.
13. **Quota push.** M7 shows an 80 % push; M6/M7 copy says only events that need action. *Default:* no quota push.
14. **Broken-connection action label:** Genautentificér / Genetablér / Forbind. *Default:* "Genautentificér", except first-time connect ("Forbind").
15. **Queue on a broken connection:** "Nye ordrer venter i kø i op til 7 dage". *Default:* 7 days, then the records fail with "Gentag".

**Editor and flows**
16. **Kladde vs Live.** Is the publish choice "Som kladde / Bogfør med det samme" per route or per flow, and how does it relate to the route's Tilstand? (D6 shows the route in Live; D5 publishes it as Kladde.) *Default:* the dialog sets Tilstand on every route whose destination supports draft posting; Tilstand on the route stays the single source of truth.
17. **Two checklists:** onboarding has 5 steps (D1), the editor guide 4 (D4). *Default:* both; D1 counts the guide as one of its steps.
18. **Seed inconsistencies:** error counts (2 vs 3 Kreditnotaer records, "3 flows kræver handling" vs the items shown), "Outlet → regnskab · 3 ruter", seed plan (Startup in D2-Graense, Business elsewhere). *Default:* Business everywhere plus a separate seed state for D2-Graense; numbers made consistent and every change listed in the M6 PR.
19. **"Kørsler" and "Skabeloner" pills** under Integrationer. *Default:* as in §5.
20. **"Synkroniseret omsætning"** with or without moms (spec: by choice; D5 shows "uden moms"). *Default:* without moms, with a tenant setting.
21. **Promises in copy I can't verify:** "Book 20 minutter med en rådgiver", "Opsætning tager typisk 10 minutter", the "Giv besked" waitlist, custom connectors in Developer view, several accounts per connector ("Tilføj konto"), "Prøver igen om 5 min.", "ca. 1.240 kontakter". *Default:* build several accounts per connector (the model allows it) and the waitlist as stored interest; hide the advisor booking and custom-connector text until you confirm.

**Accessibility**
22. **Input border contrast** (§5). *Default:* `--color-border-strong`.
23. **Small text:** bottom-nav labels 11/600, badges 10/700. *Default:* as drawn, checked for 4,5:1.

**Phase 2 (decide before Phase 2 starts)**
24. **Dinero posting model.** The Dinero spec recommends manual vouchers (no duplicate invoice); the design names the port "Fakturaer" and the dialog says "der oprettes fakturaer i Dinero". *Default:* manual voucher as the mechanism, "Fakturaer" as the word the customer sees, invoice mode later.
25. **Draft-first** for new Dinero routes (Dinero spec Q2). *Default:* yes.
26. **WooCommerce trigger statuses** (WooCommerce spec Q3). *Default:* processing + completed, configurable.
27. **`dinero.md`** is referenced by the Dinero spec but wasn't in the copy list (and `Dinero.md` shows as deleted in the `agentor` working tree). Should I use it?
28. **Reconciliation (`D10-Afstemning`)** is Phase 3 in §14.1 but in the route map. *Default:* M11, once real Dinero data exists; Phase 1 shows the tab with an empty state.
29. **Mobile layouts.** *Default:* Phase 1 screens work from 1024 px and don't break below; `M1`–`M7` ship with the PWA in M11.

**Technical and process**
30. **Editor URL.** Brief: `/integrations/[id]/edit`; spec: `/integrations/[id]/editor`. *Default:* `/editor`, with `/edit` redirecting.
31. **"Basic | Developer"** is English in a Danish UI. Decision 2 wins, so I keep it unless you want "Basis | Udvikler".
32. **Auth tables vs RLS.** Sessions exist before a tenant is chosen, so `auth_sessions`/`auth_factors` can't be tenant-scoped as §11 lists. *Default:* own-row policy on `app.user_id`; `memberships`/`invitations` stay tenant-scoped; ADR.
33. **"Skift virksomhed"** is in the profile menu (decision 3), but tenant-switch UI is Phase 3 (D9). *Default:* shown only with more than one membership.
34. **Legal text** (privacy, DPA, subprocessors, terms). *Default:* `TODO(legal)` placeholders; nothing invented.
35. **Node version.** This machine has Node 24; the spec says 22 LTS. *Default:* pin 22 in `.nvmrc`, `engines` and CI.
36. **GitHub CLI** isn't installed, so I can push branches but not open PRs. Install and authenticate `gh`, or will you open the PRs?
37. **Phase 0 ops** (VM hardening, OS users, backups, restore test, staging) are outside the repo. *Default:* runbooks in `infra/ops/`; the restore test stays an open gate item for you/DevOps.
