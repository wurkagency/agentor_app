# Claude Code prompt: signup and onboarding for app.agentor.dk

Paste everything below the line into Claude Code in the `agentor_app` repo. It assumes the main build prompt (`docs/CLAUDE-CODE-BUILD-PROMPT.md`) is the standing brief and the mobile prompt (`docs/CLAUDE-CODE-MOBILE-PROMPT.md`) has been run. The stack, order of authority, security rules, tokens, Danish copy rules and working style still apply. This prompt adds self-service signup with a paid subscription, followed by guided onboarding, on desktop and mobile.

---

You are building **self-service signup and onboarding** for app.agentor.dk. A new customer creates an account, tells us about the company, picks a plan and pays. Only then is the tenant active. After that, onboarding connects the webshop and the accounting system, sets up the first flow from a template, test-runs it and puts it live as a draft. Read this whole prompt and the sources before you plan.

## 1. Sources (read in this order)

1. `docs/design/runde-1/README.md`: decision **21 "Signup og onboarding"** and decision **22 "Signup og onboarding på mobil"** (both binding). Also decision 18 (Finans: QuickPay, yearly price, VAT, failed payments), decision 20 (mobile/PWA) and the "Pladsholdere" section.
2. The boards in `docs/design/runde-1/boards/`. On the live canvas (https://claude.ai/artifact/PM26ZBLDG84UP6EMwvRw1a), the desktop boards are on the page "Desktop" and the mobile boards on the page "Mobile".
   - Desktop signup: `SU1-Opret-konto`, `SU2-Bekraeft-mail`, `SU3-Virksomhed`, `SU4-Abonnement`, `SU5-Betaling`, `SU6-Velkommen`
   - Desktop onboarding: `OB1-Webshop`, `OB2-Regnskab`, `OB3-Skabelon`, `OB4-Testkoersel`, `OB5-Klar`
   - Mobile signup: `MS1-Opret-konto` to `MS6-Velkommen` (390 × 844)
   - Mobile onboarding: `MO1-Webshop` to `MO5-Klar` (390 × 844)
3. `docs/design/runde-1/logos/` for connector logos plus `google.svg` and `microsoft.svg` for the sign-in buttons.
4. `docs/specs/produktspecifikation.md` sections on tenants, roles, billing, entitlements, connections, flows, test run and audit log. `docs/specs/designspecifikation.md` for tokens and states.
5. The existing code: Better Auth setup, `plan_entitlements` and the M10 plan/billing work, the connector SDK, the template and test-run code, and the old onboarding built from the removed `D14-Onboarding-1..3` boards. **The new boards replace that old onboarding.** Remove its routes and components once the new flow covers them, and say what you removed.

The boards decide layout, copy and states. The spec and the README decisions decide data and rules. If they disagree, ask me. Don't guess.

## 2. Routes

One route tree with responsive layouts, as in the mobile work. Below 768 px the `MS`/`MO` board is the reference. From 768 px up, the `SU`/`OB` board is.

| Step | Route | Desktop | Mobile |
| --- | --- | --- | --- |
| Account | `/signup` | `SU1` | `MS1` |
| Verify e-mail | `/signup/verify` | `SU2` | `MS2` |
| Company | `/signup/company` | `SU3` | `MS3` |
| Plan | `/signup/plan` | `SU4` | `MS4` |
| Payment | `/signup/payment` | `SU5` | `MS5` |
| Welcome | `/signup/welcome` | `SU6` | `MS6` |
| Webshop | `/onboarding/webshop` | `OB1` | `MO1` |
| Accounting | `/onboarding/accounting` | `OB2` | `MO2` |
| Template | `/onboarding/template` | `OB3` | `MO3` |
| Test run | `/onboarding/test` | `OB4` | `MO4` |
| Live | `/onboarding/done` | `OB5` | `MO5` |

The routes are guarded by state. A user who opens a later step too early is sent to their current step. A user who returns after leaving resumes where they stopped. An active tenant who opens `/signup/*` is sent to `/`.

## 3. Business rules (non-negotiable)

**Account and identity**
- Sign up with Google or Microsoft (Better Auth social providers) or with name, e-mail and password.
- E-mail sign-up must be verified with a 6-digit code before anything else. Codes expire and are rate-limited. Resend is possible after a countdown, as on `SU2`.
- Don't reveal whether an e-mail already has an account. Say "Har du allerede en konto? Log ind" as on the boards.
- SSO sign-ups skip `/signup/verify` because the provider has verified the e-mail.

**Tenant state**
- Model signup as an explicit state on the tenant, for example `pending_company → pending_plan → pending_payment → active`, plus `abandoned`.
- **The tenant becomes `active` only when QuickPay confirms the payment through a verified callback.** The browser redirect after payment is never enough.
- Before activation, the user can't reach any app route, create connections or run flows.
- Abandoned signups are cleaned up after a retention period. Ask me how long.

**Company step**
- The CVR number looks up name and address (the "Fundet" state on `SU3`).
- Use the CVR service the spec names. If it names none, ask me before adding one.
- Lookup failure falls back to manual entry. It never blocks signup.
- The system choices (webshop, accounting, CRM, marketing) and order volume are stored on the tenant. They pre-select the connections in onboarding and drive the recommended plan and template.
- The recommendation logic is data, not hard-coded `if`s.

**Plans**
- Plans, prices and entitlements come from `plan_entitlements`. No prices in code.
- Monthly or yearly toggle. Yearly = 10 × monthly, shown as "2 måneder gratis".
- Prices shown excl. VAT on the plan step.
- The recommended plan is badged "Anbefalet til jer". On mobile it is expanded and the other plans are rows.
- `[ANTAL]` stays a placeholder until `plan_entitlements` provides the value.

**Payment**
- QuickPay subscriptions, **card only** (MobilePay is removed).
- Card details are entered in QuickPay's hosted payment window or embedded fields. **Card data never touches our servers or logs.** The board's card fields show the look, not where the data goes.
- The order summary shows plan, period, VAT 25 % and total today. Amounts are stored in øre as integers.
- The payment step is the only place terms are accepted, under the heading "Accept af betingelser". There are two required checkboxes: "Jeg accepterer Abonnementsbetingelser" and "Jeg har læst Privatlivspolitik". The pay button is disabled until both are ticked.
- Store terms version, timestamp and user per acceptance, and write it to the audit log.
- Payment failure keeps the user on `/signup/payment` with a clear error and a retry. Failed renewals follow decision 18 (retry after 2, 5 and 9 days).
- Callbacks are signature-verified and idempotent.

**Onboarding**
- Each connection uses OAuth (or an API key where the board says so) with the minimum scopes listed on the board. On mobile, OAuth opens in the system browser and returns to the app.
- The navy diagram turns green per connected system.
- The template step creates the first flow **as a draft**.
- The test run uses the 10 latest orders and **writes nothing** to the destination. It shows what would be sent.
- "Gå live" activates the flow so it creates **drafts** in the accounting system, as the boards say ("Live som kladde").
- "Spring over" is available on every onboarding step. It lands on Overblik with a reminder card until onboarding is done.

**Trust content**
- Logos are only for connectors that exist.
- No invented numbers, customers or quotes. The three trust points are "Data i EU", "Krypterede nøgler" and "Test før noget skrives".
- `[Handelsbetingelser]`, `[Databehandleraftale]` and other bracketed values stay placeholders.

## 4. Layout details from the latest review

These came out of the last design round and are easy to miss:

- **Mobile signup and onboarding:** the step indicator ("Trin 1 af 4 · Konto", "Opsætning 1 af 4 · Webshop") sits **at the bottom of the screen**, under the main button. It uses thin 3 px bars and small grey text.
- **Mobile:** the first heading on every signup and onboarding screen has **40 px top padding**. Where something sits above the heading (the green "forbundet" banner on `MO2`, the live card on `MO5`), the 40 px goes on that element.
- **Mobile `MS1`:** Google and Microsoft are side by side in two columns, labelled "Google" and "Microsoft". Keep `aria-label="Fortsæt med Google"` / "Fortsæt med Microsoft". There is extra space above the sign-in buttons, and 20 px above "Opret konto".
- **Mobile `MS5`:** expiry fills the row and CVC is a narrow 3-digit field (`inputmode="numeric"`). No field may overflow its card.
- **Desktop `SU`/`OB`:** the progress bar is inside the form column above the heading ("Trin 2 af 4", "Næste: …", four equal bars). The navy trust panel is on the right.
- The Agentor logo is top left on every signup and onboarding screen, `SU6` included.

## 5. Components

Reuse `packages/ui` and the mobile namespace. Add only what is missing:

- `SignupShell` (logo, top-right link, form column, optional trust panel), `StepProgress` (desktop top variant, mobile bottom variant), `TrustPanel` and `TrustRow`.
- `SsoButton` (provider logo + label), `CodeInput` (6 cells, paste support, auto-advance), `CvrField` (lookup states: idle, searching, found, not found).
- `SystemPicker` (logo tiles, multi-select), `PlanCard` (expanded/collapsed), `BillingPeriodToggle`, `OrderSummary`, `TermsAcceptance`.
- `ConnectionDiagram` (source → Agentor → destination, turns green), `TemplateCard`, `TestRunList`/`TestRunTable`.

Every component has content, loading, empty and error states.

## 6. How to work

1. **Plan first.** Write `docs/PLAN-SIGNUP.md`. Include the state machine, data model changes (tenant signup state, system choices, terms acceptances), the QuickPay flow with callback handling, the routes, the components, acceptance criteria per board, what you will remove from the old onboarding, and open questions. Show it to me and wait for approval.
2. **S1 – Signup backend:** state machine, verification codes, CVR lookup, plan recommendation, QuickPay subscription + callback, terms acceptance, guards.
3. **S2 – Signup UI:** `SU1`–`SU6` and `MS1`–`MS6`.
4. **S3 – Onboarding:** `OB1`–`OB5` and `MO1`–`MO5` on top of the existing connector, template and test-run code. Also the skip path and the Overblik reminder.
5. **S4 – Cleanup:** remove the old onboarding, update the route map in `CLAUDE-CODE-BUILD-PROMPT.md` if anything changed, and seed a demo signup.

For every milestone:
- Playwright at 1440 × 900 and 390 × 844 for every board, with screenshots next to the board in the PR.
- e2e paths:
  - E-mail signup → code → CVR → plan → QuickPay **test mode** → callback → active → onboarding → test run → live as draft.
  - The same path with Google SSO (mocked provider).
  - Redirect without callback, which must leave the tenant **not** active.
  - Abandon at payment, then resume.
  - Skip onboarding, which must show the Overblik reminder.
- Tests:
  - Callback signature check.
  - Idempotency (the same callback twice).
  - Rate limits on code sending and verification.
  - No e-mail enumeration.
  - Tenant isolation for every new endpoint.
  - Card data absent from logs and database.
- Accessibility: labels, focus order, visible focus, errors announced, 44 px targets on mobile, contrast 4.5:1.
- Never fake a passing state. Ask before adding a dependency the spec doesn't name.

## 7. First reply I expect

1. Confirmation that you have read README decisions 18, 20, 21 and 22 and found all 22 boards (`SU1`–`SU6`, `OB1`–`OB5`, `MS1`–`MS6`, `MO1`–`MO5`). List any that are missing.
2. What exists today (auth, plans, QuickPay, old onboarding) and what you will reuse, change or remove.
3. Your proposal for the QuickPay integration (hosted window or embedded fields) and why, with the PCI scope it implies.
4. `docs/PLAN-SIGNUP.md` with milestones, acceptance criteria and open questions.

Then stop and wait for my go-ahead.
