# Claude Code prompt: the whole app on mobile (phase 2)

Paste everything below the line into Claude Code in the `agentor_app` repo. It builds on two earlier prompts:
- `docs/CLAUDE-CODE-BUILD-PROMPT.md`, which stays the standing brief: stack, order of authority, security rules, tokens, Danish copy and working style.
- `docs/CLAUDE-CODE-MOBILE-PROMPT.md`, which covers phase 1: the shell, components, PWA, push, MA01–MA15 and MP01–MP07.

This prompt widens mobile from "follow along" to the whole app, except the flow editor.

---

You are extending the mobile experience of app.agentor.dk so that **every desktop page has a mobile version**. Read this whole prompt and the sources before you plan.

## 1. What changed

README decision **23 "Hele appen på mobil"** replaces the limits in decision 20.

**Read-only on mobile.** These stay on desktop for editing:
- The node editor (canvas)
- Mapping
- Filters and rules
- The template guide and template picker
- Creating new flows

Mobile shows these as collapsible tables with all the information visible (`MA19`, `MA20`), plus the line "ændres i editoren på computer".

**Full editing on mobile.** Everything else:
- Team, invitations and roles
- Security, passkeys and sessions
- Audit log
- Connections and the connector catalog
- Reconciliation
- Runs, including the developer view
- Plan change and payment method
- Notifications per channel
- Test run and publish
- Bulk pause, resume and run

**Platform on mobile.** Platform gains:
- The support view of a customer's app (with switch customer and end session)
- Request access
- The customer page
- The case archive
- My time
- Resolve a case and send the history
- Platform users (Superadmin only)
- All Finans subpages

The phase 1 boards were updated, so read them again:
- `MA04` and `MA05` link to the tables.
- `MA10` has new menu rows.
- `MA11` links to channels.
- `MA15` links to plan change.
- `MP01` opens the customer action sheet.
- `MP02` links to the archive and my time.
- `MP06` lists the Finans subpages.

The old "Send link til min computer" and grey computer notes remain only where the work really is editor-only, for example the mapping fix in `MA06`.

## 2. Sources (read in this order)

1. `docs/design/runde-1/README.md`:
   - Decision 23 (binding), decision 20 (now partly replaced) and decisions 16, 18, 19, 21 and 22.
   - The board table "Mobile: alle sider fra Desktop".
2. The new boards in `docs/design/runde-1/boards/`. On the live canvas (https://claude.ai/artifact/PM26ZBLDG84UP6EMwvRw1a) they are on page **"Mobile"**, in the two lowest rows.
   - All boards are 390 px wide. Long scrolling screens are drawn at full height, up to 1194 px.
   - Customer app: `MA16`–`MA35`.
   - Platform, cases and Finans: `MP08`–`MP23`.
3. The matching desktop board for each one (named in the README table) is the source of data, states, validation and copy. The mobile board decides layout and what is shown first.
4. `docs/specs/produktspecifikation.md` and `docs/specs/designspecifikation.md` for roles, permissions, audit and states.

Where the mobile and desktop boards disagree on data or rules, the spec and README win. Where they disagree on layout below 768 px, the mobile board wins.

## 3. Board → route map

**Customer app** (tabs Overblik, Integrationer, Aktivitet, Mere):

| Board | Route (mobile layout of the existing route) | Notes |
| --- | --- | --- |
| `MA16-Kom-i-gang` | `/` while setup is unfinished | Checklist 2 of 5. Replaces Overblik until the first flow is Live. |
| `MA17-Soeg` | search overlay (⌘K on desktop) | Full-screen search: orders, flows, connections, quick actions. |
| `MA18-Integrationer-Tom` | `/integrations` (empty) | Template cards link to the desktop guide (desk note). |
| `MA19-Flows-Tabel` | `/integrations` (table mode) | **Collapsible table.** Every row expands to connections, status, mode, routes, records 7 d, last run and row actions. Multi-select with a floating bulk bar: Pause, Genoptag, Kør nu. Same server actions as the desktop D2-Valg. |
| `MA20-Flow-Ruter` | `/integrations/[id]/routes` | Routes grouped by destination as collapsible rows: mode, status, filter, schedule. **Read-only.** Bottom bar: Testkør, Publicér. |
| `MA21-Graense` | `/integrations` with plan limit | Upgrade banner, links to `MA33`. |
| `MA22-Testkoersel` | `/integrations/[id]/test` | Test run summary, per route and per order, expandable order detail. Writes nothing. |
| `MA23-Publicer` | publish sheet on `/integrations/[id]` | Change list, draft or post mode, required confirmation. Same publish action as D5-GaaLive. |
| `MA24-Koersler` | `/integrations/[id]/runs` | Runs as collapsible rows with records and "Gentag fejlede". |
| `MA25-Koersel-Udvikler` | `/integrations/[id]/runs/[runId]?view=developer` | Request and response. Secrets are always masked server-side. Only for roles that may see the developer view. |
| `MA26-Forbindelser` | `/connections` | Collapsible rows: access, token expiry, used in, last check, re-authenticate. |
| `MA27-Tilfoej-forbindelse` | `/connections/new` | Catalog with filter chips. OAuth opens the system browser and returns. |
| `MA28-Afstemning` | `/activity/reconciliation` | Per day as collapsible rows. Retry from a day with deviations. |
| `MA29-Team` | `/settings/team` | Users as collapsible rows: change role, remove. The invite button floats. |
| `MA30-Inviter` | invite sheet | Role, all or selected flows, expiry. Same validation as desktop. |
| `MA31-Sikkerhed` | `/settings/security` | TOTP, require 2FA for the team, passkeys, sessions, support approval switch. |
| `MA32-Auditlog` | `/settings/audit` | Collapsible events, "Kun supportadgang" filter, export. |
| `MA33-Skift-plan` | `/billing/plan` | Compare and change plan, monthly or yearly. Owner only. Prices from `plan_entitlements`. |
| `MA34-MFA` | `/login/mfa` | TOTP step with remember device. |
| `MA35-Notifikationskanaler` | `/settings/notifications` (channels) | App, e-mail, push and SMS per event, plus threshold. Quiet hours stay on `MA11`. |

**Platform** (navy header, tabs Kunder, Sager, Fejl, Finans):

| Board | Route | Notes |
| --- | --- | --- |
| `MP08-Kunde` | `/platform/customers/[id]` | Active grant banner, needs action, contact (collapsible), access log. |
| `MP09-Anmod-adgang` | request sheet | Case, reason, duration 1/8/24 h, scope. Same server action as P3. |
| `MP10-Supportvisning` | customer routes under an active grant | The **lime support bar** sits above the customer top bar on every screen, can't be dismissed and has "Afslut". The customer tabs are used. Everything is audit-logged with the staff member's name. |
| `MP11-Skift-kunde` | switch sheet | Active grants first, then recent customers. Without a grant, open the customer page. |
| `MP12-Platformbrugere` | `/platform/staff` | Superadmin only. Staff as collapsible rows, rights per role, support access rules. |
| `MP13-Sager-Arkiv` | `/platform/cases/archive` | Search title, solution and notes. Collapsible rows. |
| `MP14-Afslut-session` | end session sheet | Auto-logged time, action list, link to case, internal note, end the grant. |
| `MP15-Min-tid` | `/platform/time` | Running session, today, week, entries needing a case, entries per case. |
| `MP16-Loes-sag` | `/platform/cases/[id]/resolve` | Recipients, what to include (internal notes are always excluded and locked), closing message, status after. |
| `MP17-Kunde-handlinger` | action sheet from `MP01` | Open as support, customer page, new case, finance, extend or end access. |
| `MP18`–`MP23` | `/platform/finance/*` | Subscriptions, support settlement, customer finance, support invoice draft (approve), invoices and payments, reports. Superadmin only. KPI cards use the compact mobile variants from phase 1. |

## 4. Patterns to build once (extend `packages/ui` mobile namespace)

- **`CollapsibleRow`**: a semantic `<details>`/`<summary>`, or a button with `aria-expanded` and a region. It has a leading element (checkbox, logo, avatar, time), title, subtitle, trailing status pill and chevron. The body is a key/value list (`KeyValueRow`) and an optional action row. This one component carries every desktop table on mobile. Rows that reveal actions must stay ≥ 44 px tall. The expanded state survives back navigation.
- **`SelectableList` + `BulkBar`**: checkbox in the row's leading slot and a floating dark bar above the tab bar with the count and actions. Esc and "Fjern valg" clear the selection.
- **`BottomSheet`**: dialogs become sheets with a handle, title, subtitle and close button. Focus trap, Esc, backdrop close and scrollable content. The existing centred `Modal` stays for time registration.
- **`SupportBar`**: lime, sticky, shows customer, scope, case and time left, with an "Afslut" action. Rendered by the layout whenever a grant session is active, never by individual pages.
- **`StickyActionBar`**: the bottom bar with primary and secondary actions for test, publish, approve and resolve.
- **`Fab`**: the floating primary action (Invitér, Registrér tid) above the tab bar.
- **`SegmentedControl`**, **`ChipFilter`** (horizontal, no wrapping), **`StatCard`** (compact number card) and **`Banner`** (info, warning, success).
- Every new screen has content, skeleton, empty and error states.

## 5. Rules (non-negotiable)

- **Same routes, same API, same server actions** as desktop. No mobile-only endpoints. Permission checks are server-side and identical. The UI only decides what to show.
- **Editor work stays read-only on mobile:** mapping, filters, rules, new routes, new flows and templates. Show the data, never an editable control. "Åbn editor" links are replaced by the desk note.
- **Roles:**
  - Developer view only for allowed roles.
  - Plan and payment are owner only.
  - Team changes are owner and admin.
  - Platform users and Finans are Superadmin only.
  - Supporters see no tenant data without an active grant, and an expired grant stops working immediately.
- **Support view:**
  - Every request made during a grant session carries the grant ID and is audit-logged in the customer's log.
  - Ending the session stops the timer and offers to end the grant.
  - Switching customer requires a grant for the target customer.
- **Money:**
  - Integers in øre.
  - Finans screens show excl. VAT where the desktop board does (reports) and incl. VAT where it does (invoices, settlement).
  - No MobilePay on new screens (pending decision on Finans).
- **Copy** is Danish, exactly as on the boards, using "du". **Touch targets** ≥ 44 px. Status is always shown as icon + text + colour. **Contrast** 4.5:1. Respect `prefers-reduced-motion`.

## 6. How to work

1. **Plan first.** Write `docs/PLAN-MOBILE-2.md`:
   - Milestones, routes, components and acceptance criteria per board.
   - Which desktop server actions each mobile action reuses.
   - Open questions.

   Show it to me and wait for approval.
2. **M5 – Patterns:** the components in §4 in Storybook or on `/dev/mobile`, in every state.
3. **M6 – Customer app:** `MA16`–`MA35` and the updated links in `MA04`, `MA05`, `MA10`, `MA11` and `MA15`.
4. **M7 – Platform:** `MP08`–`MP17`, including the support view session (bar, switch, end session with time) and the updated `MP01`/`MP02`.
5. **M8 – Finans:** `MP18`–`MP23` and the updated `MP06`.

For every milestone:
- Playwright at 390 × 844 and 360 × 780 for every board, scrolling through full-height boards. Put screenshots next to the board in the PR.
- e2e paths:
  - `MA19`: select 3 flows → Pause → the audit log shows 3 entries.
  - `MA20` → Testkør → `MA23` publish as draft.
  - `MA30` invite with selected flows → the invitee sees only those flows.
  - `MP09` request → customer approves on `MA12` → `MP10` support view → `MP14` save 42 min. → the time appears on `MP15` and in `MP19`.
  - A supporter with an expired grant gets 404 on every tenant route.
  - `MP21` approve the invoice draft.
- The tenant-isolation and role suites cover every new route and action.
- Lighthouse accessibility passes. Report the score.
- Never fake a passing state. Ask before adding a dependency the spec doesn't name.

## 7. First reply I expect

1. Confirmation that you have read README decision 23 and found all 36 new boards (`MA16`–`MA35`, `MP08`–`MP23`) plus the 8 updated phase 1 boards. List any that are missing.
2. A list of each desktop server action you will reuse, and any that don't exist yet.
3. Your approach for `CollapsibleRow` (native `<details>` or a custom disclosure) and for keeping the support session state in the layout.
4. `docs/PLAN-MOBILE-2.md`.

Then stop and wait for my go-ahead.
