# Claude Code prompt: design changes of 21 October 2026

Paste everything below the line into Claude Code in the `agentor_app` repo.

This is a delta prompt. The standing briefs still apply:
- `docs/CLAUDE-CODE-BUILD-PROMPT.md`: stack, order of authority, security, tokens, Danish copy, working style.
- `docs/CLAUDE-CODE-MOBILE-PROMPT.md` and `docs/CLAUDE-CODE-MOBILE-FULL-PROMPT.md`: mobile.
- `docs/CLAUDE-CODE-SIGNUP-PROMPT.md`: signup.

This prompt covers only what the design changed on 21 October. Where it conflicts with an earlier prompt, this one wins.

---

You are rolling out the design changes made on 21 October 2026 to app.agentor.dk. There are four packages:

- **A.** New sitemap for Agentor Platform on desktop.
- **B.** The same sitemap on mobile.
- **C.** A profile dashboard for staff and customer users, desktop and mobile.
- **D.** A new mobile navigation bar with five tabs, Profil last.

Read the whole prompt and the sources before you plan.

## 1. Sources (read in this order)

1. `docs/design/runde-1/README.md`:
   - Decision **24** "Sitemap for Agentor Platform v2"
   - Decision **25** "Profil-dashboard og fem faner på mobil", including the paragraph on the navigation bar's look
   - The board tables "Platform v2: Support, Administration og profil" and "Mobile: alle sider fra Desktop"
2. The boards in `docs/design/runde-1/boards/`. On the live canvas (https://claude.ai/artifact/PM26ZBLDG84UP6EMwvRw1a):
   - Desktop boards are on the page "Desktop", in the rows Platform, Support, Finans and "Administration og profil".
   - Mobile boards are on the page "Mobile".
3. The updated route map in `docs/CLAUDE-CODE-BUILD-PROMPT.md` (the `/platform/*` and `/profile` rows) and the Platform section in `docs/CLAUDE-CODE-MOBILE-FULL-PROMPT.md`.
4. What is already built:
   - `docs/PLAN.md`, `docs/PLAN-MOBILE.md` and `docs/PLAN-SIGNUP.md`
   - The current Platform routes, layouts and nav components
   - `plan_entitlements`
   - Support access grants, time tracking and Finans

Board vs. spec: the board decides layout and copy, and the spec and README decide data and rules. If they disagree, ask me.

## 2. Package A: Platform sitemap v2 (desktop)

### 2.1 Top menu and sub-menus

Replace the old top menu (Kunder · Supportsager · Fejl · Tid · Systemstatus · Platformbrugere) with this:

| Top menu | Sub-menu (second row) | Visible for |
| --- | --- | --- |
| **Kunder** | Kunder | Superadmin, Supporter |
| **Support** | Sager · Adgange · Fejl · Tidsforbrug | Superadmin, Supporter |
| **Finans** | Oversigt · Abonnementer · Support · Fakturering | Superadmin |
| **Administration** | System Status · Brugere · Produkt · Rapporter | Superadmin |

Rules:
- **Role-based menu.** A Supporter sees only Kunder and Support. The server must also refuse Finans and Administration routes for a Supporter with 404, not only hide the links.
- **Profile button.** The profile button in the top bar (avatar, name, role) opens `/platform/profile`.
- **Kunder.** "Mine adgange" has moved to Support › Adgange, and "Seneste" is removed. The Kunder sub-row has one item.
- **Renames.**
  - Supportsager → Sager
  - Tid → Tidsforbrug
  - Platformbrugere → Brugere
  - Supportafregning → Support (under Finans)
  - Fakturaer og betalinger → Fakturering
- **Rapporter.** Rapporter moves from Finans to Administration.
- **Old URLs.** Keep the old URLs as permanent redirects to the new ones, for one release.

### 2.2 Views are filters, not menus

| Page | Filter (in the page header, right side) | URL state |
| --- | --- | --- |
| Support › Sager (`S1`, `S2`) | Segmented: Tavle · Liste · Arkiv · 412 | `?view=board\|list\|archive` |
| Support › Fejl (`S7`) | Segmented 24 timer · 7 dage · 30 dage **plus** a date picker Fra/til | `?period=24h\|7d\|30d` or `?from=YYYY-MM-DD&to=YYYY-MM-DD` (from/to wins) |
| Support › Tidsforbrug (`S6`) | Segmented: Min tid · Team · Pr. kunde | `?scope=me\|team\|customer` |
| Administration › Rapporter (`F7`, `A3`, `A4`) | Report type Omsætning · Support og tid · Fakturering, period Fra/til, buttons PDF and CSV | `/platform/admin/reports/revenue\|support\|invoicing?from=&to=` |

Filters are shareable via the URL, survive reload and are announced to screen readers. Team and Pr. kunde on Tidsforbrug follow the same permissions as today.

### 2.3 New desktop screens

| Board | Route | Content and rules |
| --- | --- | --- |
| `S9-Adgange` | `/platform/support/access` | KPI cards: active, pending, expiring within 2 h, requests in 30 days. Table "Aktive og ventende" with customer, case, scope, approved by, expires (with countdown) and staff member. Actions: Åbn som support, Forlæng, Afslut, Træk tilbage (pending). Table "Seneste udløbne" with action count and a link to the log. Filter Mine/Alle. "Anmod om adgang" opens the existing request flow (`P3`). Everything reads from `support_access_grants`, with no new permissions. |
| `A1-Systemstatus` | `/platform/admin/status` | Overall status banner, uptime over 30 days, runs in the last hour, queue latency (median/p95) and webhooks today. Tables for platform components and connectors with status, p95 latency and version. Incident list with status. "Opret hændelse" and "Planlæg vedligehold" create rows in a new `incidents` table (title, impact, status, start/end, notes). Metrics come from existing telemetry. If a metric doesn't exist yet, show the empty state and list it as an open question. Never invent numbers. |
| `A2-Produkt` | `/platform/admin/product` | **Supportpris:** hourly rate incl. VAT (excl. VAT calculated), rounding in minutes, billing rule, and which time types are non-billable. **Abonnementer:** a matrix of Startup/Business/Enterprise with monthly price (yearly = 10 ×), transactions, run interval, integration sets, users, opbevaring, trial, and switches for features (external users, SSO, white-label, >3 destinations, EAN invoice). "Når priserne ændres": new subscriptions only, or all from the next renewal with e-mail notice. Saving creates a **new price version** (history, effective date, who). Everything is data in `plan_entitlements` and settings, never in code. `[ANTAL]` placeholders stay until the data exists. |
| `A3-Rapport-Support` | `/platform/admin/reports/support` | Registered time, settled time, non-billable time and cases solved. Time per supporter, time per category and the largest customers. |
| `A4-Rapport-Fakturering` | `/platform/admin/reports/invoicing` | Invoiced, paid, outstanding and days to payment (average and median). Invoice list with number, customer, type, issued, due, paid, days to payment, amount and status, plus filter chips. |
| `F7-Rapporter` (now Administration) | `/platform/admin/reports/revenue` | Unchanged content, plus a report type switch and PDF/CSV. |
| `PR1-Profil` | `/platform/profile` | See package C. |

**Export (all three reports).** PDF and CSV for the chosen period, generated server-side and streamed as a download. Use Danish number and date formats in the PDF and ISO dates and dot decimals in the CSV, with a header row. Amounts are excl. VAT in revenue and support reports and incl. VAT in the invoicing report, as on the boards. Exports are audit-logged on the platform audit log. Ask before adding a PDF library the spec doesn't name.

### 2.4 Updated desktop screens

These screens get the new top menu, sub-menu and, where noted, filter or title changes:
- **Kunder:** `P1-Kunder`, `P1-Kunder-Menu`, `P2-Kunde`, `P3-Adgang`
- **Support:** `S1`–`S4`, `S6`, `S7`, `S8`
  - `S1` title is "Sager".
  - `S6` title is "Tidsforbrug" and loses its old Mig/Hele teamet toggle.
  - `S7` title is "Fejl".
- **Finans:** `F1`, `F1-Dage`, `F2`–`F6`. `F3` title is "Support · oktober 2026", and `F6` title is "Fakturering".
- **Administration:** `P6-Platformbrugere` (title "Brugere") and `F7`

## 3. Package B: the same sitemap on mobile

Mobile Platform follows decision 24:
- **Superadmin tabs:** Kunder · Support · Finans · Admin · Profil.
- **Supporter tabs:** Kunder · Support · Profil.
- **Sub-tab row (`PlatformSubTabs`):** Support, Finans and Admin each start with a horizontal, underlined sub-tab row that can scroll sideways:
  - Support: Sager · Adgange · Fejl · Tidsforbrug
  - Finans: Oversigt · Abonnementer · Support · Fakturering
  - Admin: Status · Brugere · Produkt · Rapporter
- **Filters** use the same URL state as desktop:
  - Sager: Liste/Arkiv. The board view is a list on mobile.
  - Fejl: chips plus Fra/Til.
  - Tidsforbrug: Min tid/Team/Pr. kunde.
  - Rapporter: type, period, and "Gem som PDF"/"Eksportér CSV" in a sticky bottom bar.

New mobile screens:
- `MP24-Adgange`
- `MP25-Systemstatus`
- `MP26-Produkt`
- `MP27-Rapport-Support`
- `MP28-Rapport-Fakturering`
- `MP29-Profil`

Updated mobile screens:
- `MP01` (the "Mine adgange" chip is replaced by "Alle 214")
- `MP02`, `MP05`, `MP06` (the old Finans link list is replaced by the sub-tabs), `MP07`
- `MP12`, `MP13`, `MP15`, `MP18`, `MP19`, `MP22`, `MP23`

The routes are the same as on desktop. Below 768 px the mobile layout renders.

## 4. Package C: profile dashboard (staff and customer)

Boards:
- **Platform:** `PR1-Profil` (desktop, Anne Supporter) and `MP29-Profil` (mobile).
- **Customer app:** `D15-Profil` (desktop, Mette Ejer) and `MA36-Profil` (mobile).

There is one shared component set with role-specific data.

**Layout.** A centred column, max 1040 px on desktop. From the top:

1. **Hero.** A navy surface with **no gradient glow**. It shows:
   - a large avatar (initials fallback) with a camera button to change the photo
   - an eyebrow with role and organisation, the name, and contact chips (e-mail, 2FA, language and city)
   - "Redigér profil", and "medlem/kunde siden"
   - four key numbers
2. **Anchor navigation:** Overblik · Personlige oplysninger · Login og sikkerhed · Notifikationer.
3. **Præstationer.** Six achievement medals. Earned medals are lime; locked medals are grey with a progress bar and "x af y".
4. **Engagement.** The current streak (with the best streak) and a 12-week activity heatmap with five levels and a legend, plus 2–3 summary lines.
5. **Personlige oplysninger.**
   - Profile photo: upload PNG/JPG, at least 256 × 256 px, or remove. It is shown to the team and in the audit log.
   - Form fields: first and last name, e-mail, phone, language, time zone, and title/role (read-only where the role decides).
   - Annullér / Gem ændringer.
6. **Login og sikkerhed:**
   - change password, with last-changed date and strength
   - TOTP on/off and show recovery codes
   - passkeys (add/remove)
   - active sessions (log out all others)
   - change login e-mail (with verification)
7. **Notifikationer.** The most important switches, plus "Alle indstillinger", which goes to the full notification settings.
8. **Log ud.**

**Mobile.** The same content as stacked cards. The hero is full-bleed with a rounded bottom. Medals scroll sideways. Personal details are rows that open edit sheets.

**Data and rules:**
- **Avatar.** Upload to the existing object storage under a per-user key. Strip EXIF, resize to 512 px, store a WebP. Validate type and size server-side. The old file is deleted on replace or remove. Audit-log the change.
- **Achievements are data, not code.**
  - Store them in an `achievement_definitions` table: key, audience (staff/customer), title, description, icon, metric, threshold, and an optional window.
  - Progress is computed from existing data (cases solved, response times, satisfaction answers, records synced, flows live, reconciliation, team 2FA).
  - Earned state is stored in `user_achievements` (user, key, earned_at).
  - Seed the six staff and six customer achievements shown on the boards.
  - Never show a percentage or number that the data can't back. If a metric doesn't exist yet, hide that medal and list it as an open question.
- **Engagement heatmap.** A daily count of meaningful actions for the last 84 days, bucketed into 5 levels per user:
  - Staff: solved cases and support sessions.
  - Customer: runs, retries and settings changes.
  - Use existing audit or event tables. Don't add tracking that the privacy policy doesn't cover. Ask if in doubt.
- **Password, TOTP, passkeys and sessions** reuse Better Auth flows and the existing security screens' server actions. Password change requires the current password and signs out other sessions on request. Changing e-mail requires verification of the new address.
- Each user sees and edits only their own profile. Support access never grants access to another user's profile.

## 5. Package D: mobile navigation v3 (all mobile screens)

The reference boards are `MX1-Navigation-Kunde` and `MX2-Navigation-Platform`. The look is already applied on every mobile board.

**Five tabs, Profil last:**
- **Customer app:** Overblik · Integrationer · Aktivitet · Mere · Profil (`/profile`). The profile card at the top of Mere also links to the profile.
- **Platform:** as in package B.

**`MobileTabBar` replaces the old 76 px full-width bar:**
- **Layout.** A floating bar with fully rounded ends, 56 px high, 6 px above and 14 px around it (14 px from the screen edges), sitting above the safe area (`env(safe-area-inset-bottom)`).
- **Inactive tabs:** icon only, 21 px, with a 44 × 44 px hit area and an `aria-label`.
- **Active tab:** icon (22 px) + label (15 px, bold) and `aria-current="page"`.
- **Customer app:**
  - White bar, shadow `0 10px 30px rgba(26,26,24,.10)` plus a 1 px hairline.
  - Inactive icons `#9B9B97`.
  - Active tab `#1A1A18` on a **very light grey pill** (`#F3F1EC`, 40 px high).
- **Platform:**
  - Navy bar `#13293A` with shadow.
  - All icons and labels white (inactive at 82 % opacity).
  - Active tab on a slightly lighter navy pill (white at 10 %). **No lime** in the bar.
- **Floating elements.** Floating actions (FAB) and the bulk-action bar sit above the bar, as on `MA19`, `MA29` and `MP15`.
- **Keyboard.** The bar hides while the on-screen keyboard is open.
- **Motion.** Use `prefers-reduced-motion` for any transition.

## 6. Cross-cutting

- **Logo.** All boards use the new logotype (`docs/design/runde-1/logos/agentor-logotype.svg`), white on navy via a filter. If the app still has the old text wordmark anywhere, replace it with the SVG, including the favicon/PWA icon check.
- **Copy.** Copy is Danish and exactly as on the boards, via next-intl, using "du".
- **Money** is stored in øre as integers.
- **Permissions.** No new permissions beyond what the tables above say. Everything new is audit-logged:
  - price versions
  - incidents
  - exports
  - avatar changes
  - password changes
  - 2FA changes
  - passkey changes
  - session changes

## 7. How to work

1. **Plan first.** Write `docs/PLAN-2026-10-21.md`:
   - what exists today and what you will reuse, change or remove
   - data model changes (`incidents`, price versions, `achievement_definitions`, `user_achievements`, avatar fields)
   - the route and redirect list
   - components
   - acceptance criteria per board
   - open questions

   Show it to me and wait for approval.
2. **M1, sitemap desktop:** role-based top menu and sub-menus, renames, redirects, the filters in §2.2, the `S9-Adgange` screen, and moving Rapporter under Administration.
3. **M2, Administration:** `A1`, `A2` with price versions, `A3`, `A4`, `F7`, and PDF/CSV export.
4. **M3, profile:** the shared profile components, `PR1`, `D15`, avatar upload, achievements, engagement and the security sections.
5. **M4, mobile:** `MobileTabBar` v3 on every mobile screen, Platform tabs per role and sub-tabs, and screens `MP24`–`MP29` and `MA36`, plus the updated `MP*` screens.

Every milestone needs:

**Tests and screenshots**
- Playwright screenshots next to each board in the PR:
  - desktop at 1440 × 900
  - mobile at 390 × 844 and 360 × 780
- Role tests:
  - A Supporter gets 404 on every `/platform/finance/*` and `/platform/admin/*` route and API.
  - A Supporter's menu shows only Kunder and Support.

**e2e paths**
- Old URL redirects to the new one.
- Fejl filter by from/to, then reload.
- Rapporter: Fakturering for October, then export CSV and PDF. Check that the file contents match the table.
- A2: change the Business price, save as a price version for new subscriptions only, check the history, and check that an existing subscription is unchanged.
- Profile:
  - upload an avatar
  - change password, then log out others
  - turn TOTP on/off and add a passkey
- Mobile: the tab bar on a customer screen and a Platform screen per role. The active tab has `aria-current` and the label is visible.

**Other checks**
- The tenant-isolation suite covers the new endpoints, and profile endpoints only ever touch the signed-in user.
- Lighthouse accessibility passes on `PR1`, `D15`, `MA36` and `MP29`. Report the scores.
- Never fake a passing state. Ask before adding a dependency the spec doesn't name.

## 8. First reply I expect

1. Confirmation that you have read README decisions 24 and 25 and found these boards:
   - Desktop: `S9`, `A1`–`A4`, `PR1`, `D15`
   - Mobile: `MP24`–`MP29`, `MA36`, `MX1`, `MX2`
   - The updated `P*`, `S*`, `F*` and `MP*` boards

   List any that are missing.
2. A short gap analysis against what is built today (Platform nav, filters, reports, `plan_entitlements`, profile, mobile tab bar).
3. Your choice for PDF generation and for the heatmap data source, and why.
4. `docs/PLAN-2026-10-21.md`.

Then stop and wait for my go-ahead.
