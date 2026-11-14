# Claude Code prompt: designed e-mails and invoice/credit note PDFs

Paste everything below the line into Claude Code in the `agentor_app` repo. The standing brief is still `docs/CLAUDE-CODE-BUILD-PROMPT.md` (stack, security, tokens, Danish copy, working style). This prompt only covers e-mail templates and the two PDF documents.

---

You are replacing the plain-text e-mails in app.agentor.dk with designed HTML e-mails, adding the four notification e-mails that the settings promise but nothing sends, and building PDF templates for invoices and a new credit note document. Read the whole prompt and the sources before you plan.

## 1. Sources (read in this order)

1. `docs/design/runde-1/README.md`:
   - Decision **26 "E-mails"**
   - The board table "E-mails"
   - The PDF rows `I01`/`I02`
   - Decision 18 (Finans: VAT, support billing, failed payments)
2. The boards in `docs/design/runde-1/boards/`. On the live canvas (https://claude.ai/artifact/PM26ZBLDG84UP6EMwvRw1a) they are on the page **"Emails & Invoices"**.
   - `E01`–`E22`: one board per e-mail. Each shows the inbox preview (sender, subject, preheader), the 600 px mail and a **"Til udvikling"** strip with subject, preheader, trigger, recipient and fields.
   - `I01-Faktura` and `I02-Kreditnota`: A4 PDF templates, also with a "Til udvikling" strip.
3. The source list of e-mails: the artifact "Agentor e-mails" (https://claude.ai/artifact/4epZPbNWdwSVQR7UQGAohN). It lists each current mail, its trigger, recipient, subject, expiry and code location.
4. Current code:
   - Senders: `apps/web/src/server/mail.ts` (nodemailer over Brevo SMTP, text only), `server/signup-mail.ts`, `server/auth/auth.ts`, `server/auth/new-device.ts` and `server/auth/security-events.ts`
   - Action files: `app/(app)/settings/team/actions.ts`, `app/platform/customers/actions.ts`, `app/platform/customers/[id]/admin-actions.ts`, `app/platform/actions.ts` (case mail), `app/actions/desk-link.ts`, `app/platform/admin/product/actions.ts` and `app/platform/finance/actions.ts`
   - Billing: `packages/db/src/repo/billing.ts` and the invoice number migrations (`0010_billing_security.sql`, `0043_invoice_number_width.sql`)

The board decides layout and copy, and the list and spec decide triggers and rules. Where the board's subject or body differs from today's text, **the board wins**. If they conflict on a rule, ask me.

## 2. E-mail system

### 2.1 Template architecture

- **Shared layout.** Build one `EmailLayout` used by every mail:
  - logo
  - content slot
  - footer with "Agentor ApS · app.agentor.dk · support@agentor.dk" and a per-mail **reason line** ("Du får denne mail, fordi …")
- **Blocks.** Build these reusable blocks, matching `E01`–`E22` pixel for pixel at 600 px:
  - `Heading` (30 px bold, no icon)
  - `Paragraph`
  - `Button` (lime, pill, built as a table cell so it renders in Outlook)
  - `FallbackLink` (mono, breaks anywhere)
  - `ExpiryChip` (clock icon on light grey)
  - `CodeBoxes` (6 cells, mono 30 px)
  - `KeyValueTable` (optional bold total row)
  - `Notice` (info, warning or error, with a shield icon)
  - `Panel`
  - `Divider`
  - `SmallPrint`
  - `SignOff`
  - `StatGrid`
  - `ProgressBar`
  - `Timeline` (case history)
  - `AttachmentChip`
  - `Ledger` (statement lines)
- **HTML rules:**
  - Table layout, inline styles, max width 600 px.
  - Fonts: Plus Jakarta Sans with an Arial/Helvetica fallback, and JetBrains Mono with a Consolas fallback.
  - Logo as a hosted **PNG at 2x** with `alt="Agentor"`, not SVG.
  - Include `color-scheme: light dark` meta, and check dark mode in Apple Mail, Gmail and Outlook. Keep contrast at 4.5:1.
- **Text version.** Every mail sends `html` **and** `text`. The text version follows the same order: heading, body, link written out, expiry, safety note and footer.
- **Subject and preheader.** Both come from the board. The preheader is a hidden first element in the HTML.
- **Templates are code.** Use typed props, one file per mail, and Danish copy through the existing i18n setup. No string concatenation in the action files: the actions call `sendEmail('team-invite', props)`.
- **Dependencies.** Recommend an approach (plain TSX-to-string, React Email, or MJML) with reasons, and **ask before adding a dependency**.
- **Preview.** Add a dev-only route, `/dev/emails`, that renders every template with the board's sample data, in light and dark mode, plus the text version.

### 2.2 Mail-specific rules

| Board | Template key | Trigger and recipient (unchanged unless noted) | Rules |
| --- | --- | --- | --- |
| `E01` | `verify-email` | Login without a verified e-mail · person | Link expires in 24 h |
| `E02` | `reset-password` | "Glemt adgangskode?" · person | Link expires in 1 h. The current password keeps working until it is changed. |
| `E03` | `new-device-login` | Login from an unknown device · person | **No button.** Shows device, approximate location and time. |
| `E04` | `email-change-code` | Login e-mail change · **new** address | 6-digit code, 10 min. Code first in the subject. |
| `E05` | `email-changed` | After the change · **old** address | **No button**, only support. The new address is masked (`me•••@…`). |
| `E06` | `signup-code` | Signup step 1 / resend · person | 6-digit code, 10 min. Code first in the subject. |
| `E07` | `signup-existing-account` | Signup with an existing e-mail · person | Sent **instead of** `E06`. The page response must be identical (no enumeration). |
| `E08` | `subscription-receipt` | First payment completed · invoice e-mail | VAT table. Link to the invoice; the PDF is not attached. |
| `E09` | `team-invite` | Invite under Settings › Team · invitee | Expires in 7 days. Access and expiry rows only when set. |
| `E10` | `customer-created` | Platform creates a customer · future owner | Expires in 14 days. Shows plan and first payment incl. VAT. |
| `E11` | `owner-reinvite` | Platform resends the invite · owner | Expires in 14 days. **Invalidates all earlier links.** |
| `E12` | `case-resolved` | Support resolves a case and chooses to send · each chosen contact | Timeline, time and satisfaction blocks are toggled by the supporter. Internal notes never appear. `Reply-To` is the case's reply address. A reply within 14 days reopens the case. |
| `E13` | `desk-link` | "Send link til min computer" · person | The link requires login and grants nothing by itself. |
| `E14` | `plan-price-change` | Price change "Alle fra næste fornyelse", sent 30 days before · invoice e-mail per customer | Old and new price incl. VAT, and the effective date |
| `E15` | `invoice-reminder` | "Send rykker" · invoice e-mail | Amount and due date. The second reminder uses the same template with "2. påmindelse" in the subject. |
| `E16` | `update-card` | "Betalingslink" on a declined card · invoice e-mail | The link opens QuickPay's hosted page. No card data in the mail. |
| `E17` | `account-statement` | "Send kontoudtog" · invoice e-mail | One ledger line per open invoice, or "Ingen åbne poster" |
| `E18` | `monthly-report` | "Send til bogholder" · Agentor bookkeeper | CSV attached (`agentor-finans-ÅÅÅÅ-MM.csv`). Internal. |
| `E19` | `notify-connection-broken` | **New.** A connection stops working · members with e-mail enabled | Critical, so it ignores quiet hours. Shows the affected flow and the queue count. |
| `E20` | `notify-systematic-error` | **New.** At least 3 errors on one route within 15 min (threshold from settings) · members with e-mail enabled | Why plus how to fix, the same text as in the app. Batched in quiet hours. |
| `E21` | `notify-quota-80` | **New.** Usage passes 80 % · members with e-mail enabled | At most once per month per tenant |
| `E22` | `weekly-summary` | **New.** Monday 08:00 Europe/Copenhagen · members who opted in (off by default) | Max 5 flows, problems first. Needs an unsubscribe link and a `List-Unsubscribe` header. |

The notification mails (`E19`–`E22`) use the existing notification preferences and quiet hours (`MA11`, `MA35`, `D12-Notifikationer`). They are sent from the scheduler or worker, never inline in a request. They are idempotent per event, and each send is logged.

### 2.3 Sending and safety

- **Sender.** One sender service wraps nodemailer/Brevo. It handles from, reply-to, html, text, attachments and headers (`List-Unsubscribe` where relevant, `X-Entity-Ref-ID` per event), plus retries with backoff. It logs template key, recipient hash and message id, and **never logs bodies, codes or links**.
- **Links.** Links come from the existing token services, with the expiries in §2.2. Every link is absolute (`APP_URL`). Codes and tokens never appear in logs or analytics.
- **Security mails** (`E03`, `E05`) never contain a sign-in link.
- **Amounts** are formatted with the shared money formatter (Danish format). They are stored in øre.

## 3. PDF documents: invoice and credit note

### 3.1 Invoice (`I01-Faktura`)

- **Page.** A4 portrait (794 × 1123 px at 96 dpi), 15 mm margins, rendered **server-side** from an HTML template to PDF (PDF/A-2b preferred). Fonts are embedded.
- **Sections:**
  - **Header:** logo, Agentor company block, a lime "FAKTURA" pill, and the invoice number large in mono.
  - **Meta:** invoice date, due date, period and customer number.
  - **Billed to:** name, address, CVR and invoice e-mail.
  - **About:** a short description.
  - **Line table:** description, quantity, unit price and amount, plus the subtotal excl. VAT, VAT 25 % and total incl. VAT.
  - **Status box:**
    - paid by card, with card mask, date and QuickPay transaction
    - **or** for Enterprise/EAN: due date, EAN number and bank details
  - **Notes**, and a footer with company, bank and "Side x af y".
- **Variants from one template:**
  - **Subscription:** one line with plan, interval and period.
  - **Support:** one line per case, with registered and rounded time, the 640 kr. excl. VAT hourly rate, and the timelog attachment.
  - **EAN invoice.**
- Long line lists paginate with a repeated table header.
- **Company details.** Agentor's own details (CVR, address, bank, IBAN) are placeholders on the board. Read them from platform settings (add them to `A2-Produkt` or a settings table, Superadmin only). **Never hard-code them.**
- **Numbering.** Use the existing invoice sequence without gaps. Respect migration 0043's number width.

### 3.2 Credit note (`I02-Kreditnota`), new

- **Data model.** Add a `credit_notes` model (and lines):
  - its own gap-free number series `K-ÅÅÅÅ-nnnn`
  - a **required** reference to the credited invoice (number and date)
  - reason, created by, date
  - lines with negative quantity/amount, net, VAT and total
  - refund method: QuickPay refund to card, or "modregnes i næste faktura"
- **Full or partial credit.** A full credit copies all lines. A partial credit picks lines and quantities. The sum may never exceed what is still uncredited on the invoice.
- **The original invoice is never changed.** Its outstanding/paid status and the "after credit" amount are derived.
- **Template.** Same as the invoice, with a navy "KREDITNOTA" pill, "Krediteres til", "Årsag", negative amounts and an info box about the refund.
- **Where it's created.** On `F4-Kunde-Oekonomi` and `F6-Betalinger` (Finans, Superadmin only): a "Kreditér" action on an invoice opens a sheet with full or partial credit, the reason, and the refund method.
- **Audit and money.** Audit-log every credit note. A QuickPay refund is idempotent and only marked done on QuickPay's confirmation.
- **Customer view.** The credit note appears on the customer's Abonnement › Fakturaer list, and the PDF can be downloaded there.

### 3.3 Storage and delivery

- **Render once.** Each PDF is rendered once when the document is finalised, stored **immutably** in object storage with a content hash, and served via a signed, short-lived URL. Re-rendering is only allowed for drafts.
- **E-mail.** E-mails link to the PDF (`E08`, `E15`, `E17`); they don't attach it. The support invoice's timelog can be attached as CSV/PDF if the setting on `F5` is on.
- **Rendering engine.** Recommend one (headless Chromium via Playwright, which the repo may already use for e2e, or a PDF library) and **ask before adding a dependency**.

## 4. How to work

1. **Plan first.** Write `docs/PLAN-EMAILS-PDF.md` covering:
   - the template architecture and the dependency choice
   - a mapping of the 22 boards to template files and call sites
   - the notification triggers and scheduler jobs for `E19`–`E22`
   - the credit note data model and migration
   - the PDF engine and storage
   - acceptance criteria per board
   - open questions (Agentor company details, credit note numbering, PDF/A)

   Show it to me and wait for approval.
2. **M1, e-mail foundation:** layout, blocks, sender service, text versions, `/dev/emails`, and migrating `E01`–`E07` (auth and signup).
3. **M2, the rest of today's mails:** `E08`–`E18`, with all call sites switched to `sendEmail(key, props)`.
4. **M3, notification mails:** `E19`–`E22`, with preferences, quiet hours, idempotency and the weekly job.
5. **M4, invoice PDF:** `I01` in all three variants, storage, signed download, and company details in settings.
6. **M5, credit note:** the model, migration, Finans UI, refund, the `I02` PDF, and the customer list.

Every milestone needs:

**Tests**
- Snapshot tests per template (HTML and text) using the board's sample data.
- Render checks: no unresolved `{…}` placeholders, every link absolute, subject and preheader present.
- e2e paths (with a mail catcher in CI):
  - signup sends `E06`, or `E07` when the e-mail exists, and the page response is the same in both cases
  - password reset
  - team invite
  - case resolved, then reply reopens it
  - `E19` fires on a broken connection with e-mail enabled, and is suppressed when e-mail is disabled
  - `E22` is only sent when opted in, and unsubscribe works
- PDF tests:
  - the generated PDF's text contains the number, totals and VAT
  - totals equal the sum of the lines in øre
  - a multi-page invoice repeats the header
  - a credit note can never exceed the uncredited amount
  - the number series has no gaps under concurrency
- Tenant isolation: invoice and credit note downloads only for the right tenant or Superadmin.

**Screenshots**
- Each e-mail in light and dark mode at 600 px, and each PDF page as PNG, next to the board in the PR.

**Honesty**
- Never fake a passing state. Ask before adding a dependency the spec doesn't name.

## 5. First reply I expect

1. Confirmation that you have read decision 26 and found all 24 boards (`E01`–`E22`, `I01`, `I02`). List any that are missing.
2. A table of today's send sites (file and function) mapped to `E01`–`E18`, and which of `E19`–`E22` have a trigger already.
3. Your recommendation for the e-mail template approach and the PDF engine, and why.
4. `docs/PLAN-EMAILS-PDF.md`.

Then stop and wait for my go-ahead.
