# e-conomic Integration Module — Specification

**Status of prior deliverables:** WooCommerce, Shopify, Magento 2, PrestaShop, and Dinero Integration Module Specifications — finalized, ready for handover.

**Role for this document:** integration engineer, solution architect, and finance specialist.

**This document:** Target-side (ERP) module specification for e-conomic — API approach, document posting model, VAT/zone handling, and field-level write requirements. Follows the same structure as the Dinero spec for consistency.

---

## 1. API approach & authentication

- **Auth**: `X-AppSecretToken` (app-level secret, identifies this platform's integration) + `X-AgreementGrantToken` (per-merchant grant, obtained when the merchant authorizes the connection) as request headers — a materially different mechanism from Dinero's OAuth 2.0/Visma Connect flow. The connection wizard needs distinct instructions per ERP target; these two shouldn't be assumed interchangeable in the UI.
- **API surface**: REST, JSON, well-documented with a live demo environment (`demo`/`demo` tokens).
- **A genuine risk already flagged in this platform's own prior notes**: the invoice-write functionality in e-conomic's REST API has been documented by e-conomic themselves as **experimental**. This isn't a assumption — it's confirmed directly in e-conomic's own developer content. This needs to stay a tracked risk through to Tier 1 delivery, not just a footnote: confirm current production-readiness status directly with e-conomic (or via their support channel) before committing to a Tier 1 ship date that depends on it, consistent with what was already flagged as a delivery risk earlier in this project.

---

## 2. Document posting model

e-conomic's invoice API has a **native, explicit, two-step draft → book workflow** — this is the cleanest match to the platform's three-mode sync model of any ERP evaluated so far.

### 2.1 The draft → book mechanism

1. **`POST /invoices/drafts`** — creates a draft invoice with customer, line items (referencing e-conomic products or free-form lines), currency, payment terms, and delivery info. Nothing is posted to the ledger yet — a draft invoice is explicitly described by e-conomic as "a work-in-progress invoice that is not yet ready to be sent to a customer."
2. **`GET /invoices/drafts/:draftInvoiceNumber/templates/booking-instructions`** — fetches a booking-instruction template.
3. **`POST /invoices/booked`** using that template — books the draft, generating a final invoice number (or a merchant-specified number via the optional `bookWithNumber` property).

**This maps directly onto the platform's three sync modes:**

- **Dry-run** → no API call, local simulation only
- **Draft sync** → stop after step 1 (`POST /invoices/drafts`) — the invoice sits in e-conomic exactly as its own "draft" concept, ready for a bookkeeper to review and book manually inside e-conomic's own interface. This is a better fit than Dinero's manual-voucher draft state, since e-conomic's draft state is a first-class, purpose-built concept rather than an "unbooked entry" — the merchant's bookkeeper sees exactly what a normal e-conomic user would see when preparing an invoice.
- **Live sync** → run all three steps, ending with a booked invoice

**This resolves the sync-execution-modes dependency flag for e-conomic with high confidence** — more confidently than for Dinero, since the draft/book split is explicit, named, and central to how e-conomic's own API documentation describes the invoicing flow, not an inferred behavior.

### 2.2 Credit notes

e-conomic supports credit notes as a standard sales-document type alongside invoices, following the same draft/book pattern. Refunds from the e-commerce side (§ each connector spec) map onto this directly, at the same line-item granularity already established.

---

## 3. Entity coverage (target-side)

| Entity | e-conomic target | Write pattern | Notes |
|---|---|---|---|
| Sales invoices | `/invoices/drafts` → `/invoices/booked` | Create draft, optionally book | Primary posting mechanism — see §2 |
| Credit notes | Same draft/book pattern, credit-note document type | Create draft, optionally book | Mirrors refund line items |
| Customers | Customers API | Create/update, matched by email or external reference | |
| Products | Products API | Optional — only needed if invoice lines reference e-conomic products rather than free-form lines | |
| VAT zones | VAT Zones API (read) | Read-only, used for VAT resolution (§5) | |

---

## 4. How this module consumes the account mapping

Same principle as the Dinero module (§4 of that spec): this module doesn't define its own mapping UI. It receives already-resolved data from the source connector's mapping hierarchy. Where this differs slightly from Dinero: e-conomic's invoice lines are more naturally **product- or description-based** (an invoice line references a product or free-text description + amount) rather than direct **account-number-coded** the way a Dinero manual voucher line is. This means the account-line mapping resolved on the e-commerce side needs to translate into **which e-conomic product or G/L account the invoice line ultimately posts against** — e-conomic's invoicing module posts revenue to whatever account is configured behind the referenced product (or a default sales account for free-form lines), rather than the invoice API taking a raw account number per line directly.

**Practical implication**: setting up an e-conomic integration likely requires either (a) pre-creating a matching e-conomic product per mapped category/account combination so each invoice line references the right product, or (b) confirming whether e-conomic's invoice-line schema accepts a direct account override per line. This is worth confirming directly against the current API schema before build — flagged as an open question (§10) rather than assumed.

---

## 5. VAT / tax handling — VAT zones

e-conomic resolves VAT primarily through **VAT Zones** (domestic, EU, outside-EU — the standard Danish VAT zone model) assigned per customer (`recipient.vatZone`), rather than a per-line VAT code the way Dinero works. This is a genuinely different mechanism from both the e-commerce side's per-line tax model and Dinero's per-line VAT code model, and needs its own translation layer:

- The three-level VAT override resolved on the e-commerce side (store default → category → product) determines **whether VAT applies at all** to a given line.
- The **customer's VAT zone** (derived from their billing country, already captured per the customer field mapping in every e-commerce spec) determines **which VAT treatment e-conomic applies** — domestic sales get standard VAT, other-EU B2B sales with a valid VAT ID may qualify for reverse charge (the same reverse-charge concept flagged as phase-2 across the e-commerce specs), outside-EU sales are typically VAT-exempt.
- **This is actually where the phase-2 reverse-charge design (deferred in every e-commerce spec) has its natural home** — e-conomic's VAT Zone model is built around exactly this distinction, arguably making e-conomic the ERP-side connector where reverse-charge logic is cheapest to implement, mirroring the Magento observation on the e-commerce side.

---

## 6. Customer/contact matching

Same principle as Dinero: match by email, consistent with the guest-checkout matching pattern from the e-commerce specs.

---

## 7. Value-add features worth including

| Feature | Value proposition |
|---|---|
| **`order_id`/reference field usage** | e-conomic's invoice schema includes fields for external references (order ID, vendor reference) — use these to carry the source e-commerce order number, enabling clean reconciliation exactly like the Dinero external-reference recommendation |
| **Draft-first default** | Same recommendation as Dinero (§7 of that spec) — new integrations default to draft-sync for an initial review window |
| **EAN/electronic invoicing awareness** | e-conomic supports booking and sending invoices via EAN (NemHandel, relevant for Danish public-sector customers) and MobilePay Invoice — not core to this platform's sync purpose, but worth knowing the capability exists if a future merchant request surfaces around B2G (business-to-government) invoicing |
| **Webhooks for status visibility** | e-conomic supports outbound webhooks — while this module's primary direction is write (push TO e-conomic), subscribing to invoice-status-change webhooks would let the platform's dashboard reflect back when a bookkeeper manually books a draft invoice inside e-conomic itself, closing the loop on the "pending approval" status shown in the integration detail page |

---

## 8. Field-level write requirements (draft invoice)

| Field | Required / Optional | Source |
|---|---|---|
| Invoice date | Required | Order date |
| Currency | Required | Order currency |
| Customer reference | Required | Matched customer (§6) |
| Line items (product/description, quantity, price) | Required | Resolved mapping + order line items |
| VAT zone (on recipient) | Required | Resolved from customer country (§5) |
| Payment terms | Optional | Merchant-configured default if not derivable from order |
| Delivery date/address | Optional | Default: on, if available from order |
| External/order reference | Optional | Recommended default: on — carries source order number (§7) |
| `bookWithNumber` (live sync only) | Optional | Only used if the merchant wants e-conomic to use a specific invoice number rather than its own sequence |

---

## 9. Explicitly out of scope for MVP-equivalent (e-conomic module)

| Feature | Why deferred |
|---|---|
| Reverse-charge VAT routing | Deferred for cross-connector consistency, despite e-conomic being a strong technical fit (§5) — same reasoning as the Magento deferral on the e-commerce side |
| EAN/MobilePay invoice sending | No relevance to this platform's ERP-sync purpose — a separate feature entirely |
| Payment matching/reconciliation via API | Confirmed **not currently available via REST for Danish and Norwegian agreements** (only Swedish agreements expose the ledger/`/vouchers` payment-matching system) — this is a hard platform limitation, not a scoping choice, and should be communicated clearly if a merchant ever asks for payment-status sync back from e-conomic |

---

## 10. Open questions for you to confirm

1. **Invoice-write API production status** — needs direct confirmation with e-conomic given the "experimental" label (§1) — this was already flagged as a Tier 1 delivery risk before this spec existed, and this spec doesn't resolve it, just grounds it more precisely.
2. **Line-item account targeting** (§4) — confirm whether e-conomic's invoice-line schema supports a direct G/L account override per line, or whether this module needs to pre-provision matching products per mapped category — this changes the setup flow meaningfully.
3. **Draft-first default** — same question as Dinero: opt-out or opt-in for new integrations.
4. **Reverse-charge acceleration** — same question as raised for Magento: build early on e-conomic specifically, or hold to uniform phase-2 sequencing across all connectors.

---

*Next suggested step: Dynamics 365 Business Central module spec (later-tier, per your direction) — its OData/Entra ID model and native multi-company support are different enough from both Dinero and e-conomic to warrant its own close read rather than assuming Nordic-ERP patterns transfer directly.*
