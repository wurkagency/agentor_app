# Claude Code prompt: mobile and PWA for app.agentor.dk

> Phase 1. README decision 23 has since widened mobile to the whole app (except the flow editor). Phase 2 is in `docs/CLAUDE-CODE-MOBILE-FULL-PROMPT.md`.

Paste everything below the line into Claude Code in the `agentor_app` repo. It assumes the main build prompt (`docs/CLAUDE-CODE-BUILD-PROMPT.md`) is the standing brief: the stack, order of authority, security rules, tokens, Danish copy rules and working style all still apply. This prompt adds the mobile layer on top.

---

You are adding the **mobile and PWA experience** to app.agentor.dk. Mobile is for following along and acting fast, not for building. Read this whole prompt and the sources below before you plan.

## 1. Sources (read in this order)

1. `docs/design/runde-1/README.md`: decision **20 "Mobil og PWA"** (binding), decision 16 (Platform and support access, 24 h), decision 18 (Finans, Superadmin only), decision 19 (dashboard blocks).
2. The mobile boards in `docs/design/runde-1/boards/`. On the live canvas (https://claude.ai/artifact/PM26ZBLDG84UP6EMwvRw1a) they sit on the page **"Mobile"**. All boards are 390 × 844.
   - Customer app: `MA01-Log-ind` to `MA15-Abonnement`
   - Agentor Platform: `MP01-Kunder` to `MP07-Forfaldne`
3. The desktop boards for the same features, as the source of data, states and copy. The mobile board decides layout and what is shown.
4. `docs/specs/produktspecifikation.md` sections on notifications, push, PWA, roles, support access and audit log, plus `docs/specs/designspecifikation.md` for tokens and states.

Where the mobile boards and the desktop boards disagree on layout, the mobile board wins below 768 px. Where they disagree on data or rules, the spec and the README decisions win.

## 2. Principles (non-negotiable)

- **Same app, same routes, same API.** No separate mobile app or API. Below 768 px the route renders its mobile layout. Above it, the desktop layout. Server-side permission checks are identical, and the UI only decides what to show.
- **Essentials only.** No node editor, no KPI decks, no wide tables. Integrations are status cards with connector logos, and routes are a list. Compact blocks (sparkline, ring, 7-day bars) are allowed where the board shows them, and nowhere else.
- **Desktop-only work says so.** Mapping, rules, new flows, templates, onboarding, plan changes, team and invitations, security settings, audit log, reconciliation, developer view, the support view of a customer's app, and Finans reports, settlement and invoice drafts all stay on desktop. Where a user would look for them, show the grey "computer" line (`desk_note` on the boards) and, where the board has one, the button "Send link til min computer". That button emails the user a deep link to the same resource.
- **Touch and accessibility.** Targets ≥ 44 px, real `<button>`/`<a>`/`<input>` with labels, visible focus, status always icon + text + colour, `prefers-reduced-motion` respected, text contrast 4.5:1. Test at 360, 390 and 430 px wide.
- **Danish copy exactly as on the boards**, "du" form, via next-intl.

## 3. What can be done on mobile

Customer app (tabs: Overblik, Integrationer, Aktivitet, Mere, with the bell in the top bar):

| Board | Route | Allowed actions |
| --- | --- | --- |
| `MA01-Log-ind` | `/login` | Passkey sign-in (WebAuthn via Better Auth). The phone unlocks the passkey with Face ID, Touch ID or a fingerprint. A PWA cannot call Face ID directly, so never say "Face ID" in a button. E-mail + password + TOTP is the fallback. No sign-up on mobile. |
| `MA02-Overblik`, `MA03-Overblik-Problemer` | `/` | Read status. Tap through to problems. "Genforbind" on a broken connection. |
| `MA04-Integrationer` | `/integrations` | Filter (Alle, Problemer, Pauset). Read only. |
| `MA05-Flow` | `/integrations/[id]` | "Gentag N fejlede", pause and resume the flow. Route list is read only. |
| `MA06-Fejl` | `/integrations/[id]/runs/[runId]` | Retry the failed records. Send a link to the desktop. |
| `MA07-Aktivitet` | `/activity` | Filter. Read only. |
| `MA08-Genforbind` | `/connections/[id]/reconnect` | Start the OAuth reconnect in the system browser and return to the app. Show queued records. |
| `MA09-Notifikationer` | bell → `/notifications` | Mark as read. Each item deep-links to its screen. |
| `MA10-Mere` | `/more` | Navigation only. Log out. |
| `MA11-Notifikationsindstillinger` | `/settings/notifications` (mobile view) | Per-device push toggles and quiet hours (22.00–07.00, errors batched to the morning). E-mail and SMS stay on desktop. |
| `MA12-Supportadgang` | `/support-access/[grantId]` | **Approve or reject** an Agentor support request (case, scope, max 24 h, audit-logged). Opened from push. Must call the same server action as desktop D8. |
| `MA13-Installer` | `/install` | Install guide (iOS share sheet, Android prompt). Hide when already running standalone. |
| `MA14-Push` | (no route) | Reference for push copy and deep links. |
| `MS1`–`MS6` | `/signup/*` (mobile view) | Full signup on the phone: SSO or e-mail, code, CVR and systems, plan, card payment with the two required checkboxes. README decision 22. |
| `MO1`–`MO5` | `/onboarding/*` (mobile view) | Connect webshop and accounting via OAuth in the system browser, pick the template, review the test run, go live as draft. |
| `MA15-Abonnement` | `/billing` (mobile view) | Read plan, usage, support this month, invoices (download PDF). Update the card via QuickPay's hosted page. Plan changes go to desktop. |

Agentor Platform (navy header, tabs: Kunder, Sager, Fejl, Finans, where Finans is visible to `superadmin` only):

| Board | Route | Allowed actions |
| --- | --- | --- |
| `MP01-Kunder` | `/platform/customers` | Search and filter. The customer list shows only name, plan and overall status, as on desktop. No tenant data without a grant. |
| `MP02-Sager` | `/platform/cases` | List instead of board, filtered as Mine, Ikke tildelt, Venter. Create a case. |
| `MP03-Sag` | `/platform/cases/[id]` | Reply to the customer or write an internal note (yellow, never sent to the customer). The case timer runs and shows a "Stop og gem" bar. |
| `MP04-Tid` | `/platform/cases/[id]` + modal | Register time in a **centred modal** over the dimmed case: quick picks 15/30/60 min, type, description, billable switch with the customer's plan, Annullér / Gem. Round up to 15 min as on desktop. |
| `MP05-Fejl` | `/platform/errors` | Read error codes and counts across customers. Never customer data. |
| `MP06-Finans` | `/platform/finance` | Superadmin only. One list of key figures with trend pills, plus "Kræver handling". |
| `MP07-Forfaldne` | `/platform/finance/invoices?status=overdue` | Send a reminder or a payment link (confirmation step first). |

## 4. Components to build (in `packages/ui`, mobile namespace)

Build these once and reuse them. Match the boards pixel for pixel at 390 px.

- `MobileShell` (top bar 60 px + content + tab bar 76 px), `TopBar` (logo, or back button + title + subtitle, bell with badge, navy Platform variant), `TabBar` (active tab = lime pill behind the icon, navy pill on Platform).
- `StatusHero` (circle icon + headline + meta), `RowLink` (56 px row: leading icon or logo, title + meta, trailing chevron, pill or button), `FlowCard` (connector logos source → destinations, status pill, name, meta), `ConnectorLogo` (uses the cleaned SVGs in `docs/design/runde-1/logos/`).
- `MobileKpi` (label + trend pill, value, sparkline, meta, with a lime "featured" variant), `MobileRing`, `WeekBars` (7 days, today hatched, red cap on days with errors).
- `SectionHeading` (12 px, 700, uppercase, `#1A1A18`, 14 px top margin, as on the boards), `DeskNote`, `Chip` group, `Switch`, `BigButton` (52 px), `Modal` (centred, 20 px radius, close button, focus trap, Esc and backdrop close), `ChatBubble` + `InternalNote` for cases.
- Every list and card has content, skeleton, empty and error states (designspecifikation and `Komponenter-Tilstande`).

## 5. PWA and push

- Web app manifest (name "Agentor", short name, lime theme colour, icons 192/512 + maskable, `display: standalone`, start URL `/`).
- Service worker: cache the app shell and the last overview, integrations and activity responses per tenant for offline **read-only** viewing. Show an offline banner with "Viser data fra 14:21". Never cache secrets, request/response bodies or other tenants' data. Clear the cache on logout and on tenant switch.
- Web Push with VAPID. Store subscriptions per user and device. iOS needs the app installed to the home screen (iOS 16.4+), so `MA13` explains it, and the settings screen shows whether push is available.
- Push events and copy as on `MA14`: flow error, connection broken, support access requested, quota 80 %, error resolved, weekly summary (off by default). Every push says what happened and deep-links to the right screen. Respect quiet hours. No customer personal data in the push payload.
- Passkeys: Better Auth passkey plugin, registration on desktop under Sikkerhed or on mobile after password + TOTP login.

## 6. Gaps to design-check before building

These are not on the canvas yet. Build them only after I have approved a board, or ask me:

1. Offline, empty and loading states for mobile.
2. E-mail + password + TOTP login screen.
3. Connections list (status and expiry for all connections).
4. Payment failed / quota reached screen.
5. Platform customer detail + request support access.
6. Platform "løs sag og send forløb" (the mobile S8).
7. Platform "Mere" tab (profile, switch to the customer app, log out).

## 7. How to work

1. **Plan first.** Write `docs/PLAN-MOBILE.md`: milestones, acceptance criteria per board, the routes above, the components, and open questions. Show it to me and wait for approval.
2. **M1 – Shell and components:** responsive switch at 768 px, `MobileShell`, tab bars, the component list, Storybook or a `/dev/mobile` page showing every component in every state.
3. **M2 – Customer app:** MA01–MA15 against seeded Nordlys Cykler data (designspecifikation §10.1). Retry, pause, reconnect and support approval call the same server actions as desktop.
4. **M3 – PWA and push:** manifest, service worker, offline banner, push subscription, event fan-out, quiet hours, deep links.
5. **M4 – Platform:** MP01–MP07 with the same role checks as desktop. Superadmin-only Finans. Supporters without an active grant see no tenant data.

For every milestone:
- Playwright at 390 × 844 (and 360 × 780) for every board, with screenshots next to the board in the PR.
- e2e paths: push → `MA12` → approve support access, which is visible in the customer's audit log. `MA03` → `MA06` → retry. `MP03` → stop timer → `MP04` → save 15 min.
- The tenant-isolation suite must cover the new endpoints (push subscriptions, offline cache keys, deep links).
- Lighthouse PWA and accessibility checks pass. Report the scores.
- Never fake a passing state. Ask before adding a dependency the spec doesn't name.

## 8. First reply I expect

1. Confirmation that you have read the README decisions 16, 18, 19 and 20 and found all 22 mobile boards (list any that are missing).
2. Your proposal for the responsive switch (one route tree with layout components vs. a parallel route group) and why.
3. `docs/PLAN-MOBILE.md` with milestones, acceptance criteria and open questions.

Then stop and wait for my go-ahead.
