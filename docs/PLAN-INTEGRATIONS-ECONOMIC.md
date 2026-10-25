# PLAN: e-conomic integration module (source and destination)

Status: **draft for review, 25 Oct 2026. P0–P3 built in the same pass (status after §8).** Base branch: `v1.0`.

**Sources**
- Official e-conomic docs and live calls with the public demo tokens, 25 Oct 2026 (links in §13).
- REST JSON schemas (`restapi.e-conomic.com/schema/*.schema.json`) and the OpenAPI specs embedded in `apis.e-conomic.com/<api>/redoc.html` (Q2C 6.0.0, Journals 16.0.1, Webhooks 1.0.0).
- `docs/PLAN-INTEGRATIONS-WOO-DINERO.md` (manifest v2, template engine, the WooCommerce module) and `docs/PLAN-INTEGRATIONS-WOO-ODOO16.md` (return flows, `shipment`/`invoiceStatus`, dynamic catalogues). This plan builds on both and does not repeat them.
- The old target spec `docs/specs/connectors/economic-module-specification.md`. §1 lists where it is now wrong.
- Current code: `packages/connectors` (the `economic` manifest is a mock copy of Dinero's), `packages/flows`.

**Goal**
- Replace the mock `economic` connector with a live client that works as a **destination** (customers, products, invoices, credit notes, payments, journal postings) and as a **source** (customers, products, stock, invoice status).
- Pair it with the existing WooCommerce module as it is. Shopify pairs the same way when its live client lands (PLAN-INTEGRATIONS-SHOPIFY).
- Every behaviour on both ends is a setting, a mapping table or a template field. A developer changes the same things with expressions. Nothing is hard-coded per merchant.

---

## 1. Findings that shape the design

| # | Finding | Impact |
|---|---|---|
| E1 | **Auth is two headers, not OAuth:** `X-AppSecretToken` (our app, one secret for the platform) + `X-AgreementGrantToken` (per customer). Grant tokens don't expire; the customer revokes them under Indstillinger → Udvidelser → Apps. A revoked grant gives 401 `E02250`. No Visma Connect migration is announced. | The app secret is platform config (`ECONOMIC_APP_SECRET_TOKEN`), never in a customer's credentials. The connection stores only `grantToken`. 401 → `unauthorized` → "Genforbind". |
| E2 | **Installation URL flow:** the app's Tokens page has an installation URL. With a Redirect URL set, e-conomic sends the browser back with `?token=<grant>`. Accountants must first open "Administrér" on the client's agreement in the same browser. | "Forbind med e-conomic" uses the start/callback routes we have. The callback reads `token` instead of `code`. Manual paste of a grant token stays as a fallback. The connect guide explains the accountant step. |
| E3 | **Writes need the Plus plan or higher.** Basis agreements are read-only (403 "The license is read-only."). `GET /self` gives `subscriptionPlanLevel`, `agreementNumber`, the company and CVR, and `canSendElectronicInvoice`. | The connection test calls `/self` first and stores the plan. A Basis agreement can still be a source (stock). Writes then fail early with a clear message instead of 403s. |
| E4 | **Two API families, same tokens.** REST (`restapi.e-conomic.com`) is "frozen, not deprecated". OpenAPI (`apis.e-conomic.com/<api>/vX.Y.Z`) is where new features land. Booking an invoice, `/self`, VAT zones, layouts, payment terms and booked/paid invoice reads exist **only in REST**. Draft invoices with `externalId`, journal draft entries with booking, and webhooks exist **only in OpenAPI**. SOAP is gone. | One client with two base URLs. Each call uses the family that has it (§4.7). The OpenAPI version numbers live in one table (`ECONOMIC_APIS`), so a version bump is a one-line change. |
| E5 | **A priced invoice line must reference a product.** Q2C: "quantity and product number must be provided together", and `unitNetPrice` "can only be set when a product number is provided". **The revenue account comes from the product's product group, per VAT zone.** No account or VAT code can be set on a line. | The old spec's open question 2 is answered: **no per-line account override.** Invoice mode books through products. Lines match products by SKU/EAN, else a generic product. The account mapping (accounts × sale kind) does not apply to invoices; it applies to the journal posting type (§4.3). |
| E6 | **VAT follows the invoice's VAT zone × the product group.** Zones on a Danish agreement: 1 Domestic, 2 EU, 3 Abroad, 4 Domestic exempt, and **one zone per EU country** (8 Austria, …, 13 Germany …), with OSS VAT codes per country (`FR`, `RO`, …). The zone also decides whether amounts include VAT (`isVatIncluded`). | The sale kind picks the zone (mapping group "Momszoner"). Unlike Dinero, **e-conomic can book OSS**: under `oss.mode` = `destinationVat`, EU private sales go to the buyer's country zone. Line prices are sent incl. or excl. VAT, following the draft's `isVatIncluded`. |
| E7 | **Draft → book is explicit.** Q2C creates and updates drafts. REST `POST /invoices/booked {draftInvoice, bookWithNumber?, sendBy?: none/EAN/Email}` books them. Booked invoices are immutable: there is no PUT or DELETE. | Route modes map 1:1: Test = no writes; Kladde = draft; Live = draft + book (+ payment + send). Changes after booking are never applied (D5 from the Dinero plan); they give a warning. |
| E8 | **No idempotency on create, but two tools.** (a) `externalId` (max 50, filterable) on Q2C drafts, "preserved on the booked invoice". (b) An `Idempotency-Key` header on POST/PUT/DELETE caches the response for 1 hour and costs 0 tokens on replay. **`externalId` cannot be read on booked invoices over any documented endpoint.** `references.other` (250, printed on the invoice) is filterable on booked invoices. | The draft carries `externalId` (our key). Booked invoices are found by `references.other` + customer number, so that template is required and is validated as non-empty. Creates send an `Idempotency-Key` derived from the external id, so a timeout followed by a retry inside an hour never creates two drafts. |
| E9 | **Credit notes are negative invoices.** There is no separate resource. A draft with negative quantities is booked like any invoice. | The credit-note route builds a draft with negative quantities. It finds the original booked invoice by `references.other`, so the credit note keeps the original's customer and VAT zone and names the invoice number in its text. |
| E10 | **Customer payments are journal entries.** Journals API: `POST /draft-entries` with `entryTypeNumber: 2` (customer payment), `customerNumber`, `customerInvoiceNumber`, `contraAccountNumber`, `amount` (a minus sign marks the side), `currency`, `date`, `text`. `POST /journals/{n}/bookdraftentries {entryNumbers}` books **only those entries**. `/journals/{n}/book` books **everything** in the journal, including other people's drafts. | Payments go to a chosen journal (kassekladde). Default: left as a draft for the bookkeeper. "Bogfør" books only our own entry numbers, **never** the whole journal. The sign is a profile constant to confirm on a trial agreement (§11). |
| E11 | **Customers:** `customerNumber` is an integer that we may choose. Required: `name`, `currency`, `customerGroup`, `paymentTerms`, `vatZone`. There is no external-id field. `email`, `corporateIdentificationNumber` (CVR/VAT, 40), `ean`, `name` and `lastUpdated` are filterable. `vatNumber` exists only on SE/UK/DE/PL/FI agreements. `country` is free text ("Denmark", "Danmark"). | Matching uses e-mail, CVR/VAT number, a number derived from the shop's id, or one shared customer. Countries are mapped between ISO codes and names in both directions with `Intl.DisplayNames`, in Danish and English. The CVR or EU VAT number goes in `corporateIdentificationNumber`. |
| E12 | **Products:** `productNumber` is a string (max 25) and can be the SKU. `barCode` holds the EAN. `productGroup` is required. With the Inventory module, `inventory.available`/`inStock` are read-only and `costPrice` is ignored. `lastUpdated` is filterable. | The SKU is the product number. Missing products follow a policy: generic product, create in a product group chosen per category, or stop. Stock as a source reads `inventory.*` from product groups with `inventoryEnabled`. |
| E13 | **Change detection:** the Webhooks API v1.0.0 (May 2026, SuperUser role) allows **one webhook per event type per agreement**. Our app only sees its own. Events are `*_UPDATED` (customer, product, invoice, order, …), `INVOICE_BOOKED [INVOICENO]` and `JOURNAL_BOOKED`. There are **no create/delete events and no signature.** Delivery has 5 retries; more than 250 failures in 24 h disables the webhook, and nothing is queued while it is disabled. `postData` (a body template with merge fields) and up to 5 `customHeaders` are configurable. | Webhooks are hints: register `CUSTOMER_UPDATED`, `PRODUCT_UPDATED` and `INVOICE_BOOKED` with a secret in a custom header (new manifest scheme `secret-header`), re-read the record by number, and keep the poll as the safety net. Auto-heal re-enables disabled hooks at each connection test. |
| E14 | **Polling keys:** `lastUpdated$gt` on customers and products. Booked invoices have **no `lastUpdated`** (the filter gives 400); `date` and `bookedInvoiceNumber` are filterable. Payment status shows as `remainder`. | Invoice status polls booked invoices in a date window (default 90 days) and versions each record by its content hash, so a payment (a `remainder` change) becomes a new version. Stock reads a full inventory scan by default (verify whether stock moves change `lastUpdated`, §11). |
| E15 | **Rate limit: a cost-based token bucket per app + agreement** (examples: 2,000 burst, 30/s refill). Headers `X-CallCost` and `X-RateLimiting`; 429 carries `Retry-After`. Guidance: **sequential requests**. | Concurrency 1 per connection. Honour `Retry-After` (→ `rate_limited`). Manifest `rateLimit` 300/min as the engine's ceiling. |
| E16 | **Errors:** REST `{message, developerHint, logId, errors{…}}`; OpenAPI `problem+json` `{title, detail, errors[], traceId}`; 409 on a stale `objectVersion`. | `economicError()` maps 400 → `invalid` (with e-conomic's own message and the `logId`), 401/403 → `unauthorized`, 409 → re-read and retry once, 429 → `rate_limited`, 5xx → `transient`. |
| E17 | **Developer Terms (12 Jun 2026):** production apps need CVR and identity verification; 20 installations until verified; **"no parallel database"** (cache temporarily, refresh on user activity); API access is free today. | Store only mappings (shop id ↔ e-conomic number) and the lookup cache. No full mirror of e-conomic data. Go-live (P4) includes the verification. Polls are bounded by the routes the customer runs (§11 risk). |

**Corrections to `economic-module-specification.md`:** the "experimental invoice-write" risk is gone; draft CRUD is stable in Q2C 5.1+ and booking in REST. Payment registration **is** possible on Danish agreements through journal entries (its §9 said it wasn't). Webhooks are a source of change hints, not just a status display. VAT is zone × product group, and OSS is possible.

---

## 2. Model: what the pairing does

```
 WooCommerce (source)                         e-conomic (destination)
 Ordrer ─────────────────────────────────▶ Fakturaer (draft → booked) + betaling i kassekladde
                                            or Kassekladde (finance vouchers, posting.type journal)
 Kreditnotaer (refunds) ─────────────────▶ Kreditnotaer (negative draft → booked)
 Kunder ─────────────────────────────────▶ Kunder
 Produkter ──────────────────────────────▶ Varer                                   [optional]

 e-conomic (source)                           WooCommerce (destination)
 Lager (inventory.available) ────────────▶ Lager (stock, exists)
 Fakturastatus (booked / paid / credited) ▶ Ordrenote + status (invoiceStatus, exists)
 Kunder / Varer ─────────────────────────▶ any destination (CRM, newsletter, other shops)
```

The same configuration layers apply as in the Dinero plan §2: **L1** connection settings, **L2** route options on both ends, **L3** mapping groups and tables with live lookups, plus the **variable** catalogue (source) and the **target-field** catalogue (destination).

---

## 3. Framework changes (small, additive)

| # | Change | Why |
|---|---|---|
| X1 | `LookupId` gains `layouts`, `vatZones`, `customerGroups`, `productGroups`, `units`, `products`. | e-conomic lists for dropdowns. `journals`, `accounts`, `vatCodes` and `paymentTerms` exist already. |
| X2 | Manifest `webhook.scheme` gains `'secret-header'`. The worker compares the header with the connection's `webhookSecret` in constant time (`verifyWebhookSecret`). | e-conomic webhooks have no signature (E13). The ingest URL token stays as the first secret; the header is the second. |
| X3 | The engine asks for accounts only when the destination needs them **under the route's settings**: an `accounts.*` field that is `required`, or `requiredIf` matched. | e-conomic needs accounts only for `posting.type` = `journal` (E5). Dinero is unchanged (its account fields are required). |
| X4 | `saleKeys(kind, vatRate, services, oss, prefix)` moves from the engine to `@agentor/connectors` (model) and is shared. | The e-conomic adapter picks generic products and VAT zones with the same goods/services and OSS rules the engine uses for accounts. |
| X5 | Templates get `connection.short` (the first 8 characters of the source connection id). | `externalId` has 50 characters, so a full UUID plus an order id doesn't fit (E8). |
| X6 | `LiveContext.economic` carries the app secret token from the worker's environment, like `oauth` for Dinero. | E1: the platform secret never goes into a customer's key box. |

---

## 4. e-conomic destination module (`economic` 2.0.0)

### 4.1 Connection and auth

- **Forbind med e-conomic** (recommended): `/connect/economic/start` → the installation URL `https://secure.e-conomic.com/secure/api1/requestaccess.aspx?appPublicToken=<public>&locale=da-DK&redirectUrl=<app>/connect/economic/callback?state=<token>`. e-conomic adds `&token=<grant>`. The callback stores `{ grantToken }` and asks the worker to test the connection. The URL format is configurable (`ECONOMIC_INSTALL_URL`); the format the Tokens page generates is authoritative (§11, EV1).
- **Manual**: paste the grant token (today's form). This covers accountants who copy the token from the agreement.
- **Platform env**: `ECONOMIC_APP_SECRET_TOKEN` (worker, secret), `ECONOMIC_APP_PUBLIC_TOKEN` (web), optional `ECONOMIC_INSTALL_URL`, `ECONOMIC_REST_URL`, `ECONOMIC_APIS_URL` (tests and staging).
- **App role: SuperUser.** Sales covers invoices but not journals (payments), and webhooks need SuperUser (E13).
- **Connection test**, in order:
  1. `GET /self` → agreement number, company name, plan, `canSendElectronicInvoice`, modules.
  2. A Basis plan is stored as `planLevel` → writes fail early with "Aftalen er e-conomic Basis og kan kun læses" (E3).
  3. Lookups are cached (X1).
  4. Counts: customers, products, booked invoices (`pagination.results` with `pagesize=1`).
  5. With a webhook URL: `ensureWebhooks()` (§5.4).

### 4.2 Connection settings (L1)

| Key | Type | Default | Level | Notes |
|---|---|---|---|---|
| `layout` | select (lookup `layouts`) | the first layout | basic | Invoice layout when a route doesn't choose one |
| `customerGroup` | select (lookup `customerGroups`) | 1 | basic | Group for new customers |
| `paymentTerms` | select (lookup `paymentTerms`) | the agreement's default | basic | Terms for new customers and unpaid orders |
| `countryNames` | select `da` / `en` | `da` | advanced | Language of country names written to e-conomic (E11) |
| `stock.quantity` | select `available` / `inStock` | `available` | basic | Stock as a source: available = in stock minus ordered by customers |
| `stock.safetyBuffer` | number | 0 | basic | Subtracted, never below 0 |
| `stock.scan` | select `all` / `changed` | `all` | advanced | `changed` reads only products with a newer `lastUpdated` (E14) |
| `invoiceStatus.days` | number | 90 | advanced | Window of booked invoices the status poll reads |
| `invoiceStatus.orderRefPattern` | text | (empty: the whole `references.other`) | advanced | A regex whose first group is the shop's order number |
| `webhooks.mode` | select `webhook+poll` / `poll` | `webhook+poll` | advanced | |

Stock and invoice-status options are connection settings, not route options, for the reason in the Odoo plan: the engine reads an entity once per flow and shares it between routes.

### 4.3 Destination options per input port (L2)

**Fakturaer** (`order`). `posting.type` decides which other options appear (`showIf`):

| Key | Type | Default | Level | What it does |
|---|---|---|---|---|
| `posting.type` | select `invoice` / `journal` | `invoice` | basic | `invoice`: an e-conomic invoice with e-conomic numbering, sending and payment. `journal`: finance vouchers in the kassekladde, one voucher per order, on mapped accounts with VAT codes (the shop's own invoice is the document) |
| `invoice.bookAutomatically` | boolean | false | basic | Off: the draft waits in e-conomic (Kladde). On, and the route is Live: booked. Key kept from v1 (§4.5 stable keys) |
| `invoice.updateDrafts` | boolean | true | basic | Changes in the shop update the draft (header PUT with `objectVersion`, lines replaced). A booked invoice is never changed → warning `CHANGED_AFTER_BOOKING` |
| `invoice.layout` | select (lookup `layouts`) | connection `layout` | basic | |
| `invoice.date` | select `paid` / `order` / `today` | `paid` (falls back to the order date) | advanced | |
| `invoice.bookWithShopNumber` | boolean | false | advanced | `bookWithNumber` = the shop's order number when it is numeric. Off: e-conomic's own sequence |
| `invoice.delivery` | boolean | true | basic | The shipping address goes in the delivery fields |
| `zones.oss` = `oss.mode` | select `danishVat` / `destinationVat` | `danishVat` | basic | `destinationVat`: EU private customers get their country's VAT zone (E6). Key shared with Dinero and Odoo |
| `paymentTerms.paid` | select (lookup `paymentTerms`) | connection `paymentTerms` | basic | Terms on paid orders, e.g. a "Betalt" term of type `paidInCash`/`prepaid` |
| `paymentTerms.unpaid` | select (lookup `paymentTerms`) | the customer's terms | basic | |
| `products.match` | select `sku` / `barcode` / `none` | `sku` | basic | `none`: every line uses the generic product |
| `products.missing` | select `useGeneric` / `create` / `fail` | `useGeneric` | basic | `create` makes the product in the group from the category table (else `products.group`) |
| `products.group` | select (lookup `productGroups`) | none | basic (`showIf` missing=create) | |
| `products.updatePrices` | boolean | false | advanced | Never touch prices on existing products unless chosen |
| `lines.unit` | select (lookup `units`) | none | advanced | Unit on every line (`stk.`) |
| `rounding.policy` | select `line` / `ignoreBelow` / `fail` | `line` | basic | After creating the draft, `grossAmount` is compared with the order total. `line` adds the rounding product |
| `rounding.maxDiff` | number | 1 | advanced | DKK |
| `payment.register` | boolean | true | basic | Paid orders get a customer payment in the journal after booking (E10) |
| `payment.journal` | select (lookup `journals`) | none | basic (`showIf` register) | Kassekladde for payments |
| `payment.account` | select (lookup `accounts`) | none | basic | Contra account when the payment method has no row (bank or the acquirer's clearing account) |
| `payment.book` | boolean | false | basic | Off: the payment waits in the kassekladde. On: our entries are booked with `bookdraftentries` (never the whole journal) |
| `send.eInvoice` | boolean | false | basic | `sendBy: EAN` when the customer has an EAN and `/self` says the agreement can send e-invoices |
| `send.email` | boolean | false | advanced | `sendBy: Email` (verify, §11 EV4) |
| `contact.*` | §4.3 Kunder | | | |
| `journal.number` | select (lookup `journals`) | none | basic (`showIf` posting=journal) | |
| `journal.book` | boolean | false | basic (`showIf` posting=journal) | Book our voucher with `bookdraftentries` |

**Kreditnotaer** (`creditNote`): `creditNote.bookAutomatically` (false), `creditNote.missingInvoice` (`wait` default: retry until the invoice is booked / `standalone`: a negative invoice without the link), `creditNote.registerRefund` (false: the payout as a journal entry with the opposite sign), plus the product and payment-journal keys above.

**Kunder** (`customer`):

| Key | Type | Default | What it does |
|---|---|---|---|
| `contact.match` | select `email` / `cvr` / `number` / `none` | `email` | Search order: the chosen key, then the cross-reference. `number`: the shop's numeric customer id (+ offset) is the customer number. `none`: one shared customer |
| `contact.shared` | number | none | Customer number of the shared "Webshopkunde" (`showIf` match=none) |
| `contact.numberOffset` | number | 0 | advanced, for `number` |
| `contact.update` | multiselect name, address, zip, city, country, email, phone, cvr, ean | all but cvr | Fields overwritten on customers that exist. REST PUT is a full replace, so the client reads the customer, merges the chosen fields and writes it back |
| `contact.group` | select (lookup `customerGroups`) | connection `customerGroup` | |
| `contact.groupForeign` | select (lookup `customerGroups`) | (same) | advanced: group for EU and export customers |
| `contact.currency` | select `base` / `order` | `order` | advanced |
| `contact.attention` | boolean | true | Company customers get the buyer as a customer contact, set as `attention` |

**Varer** (`product`): `product.create` (true), `product.update` (true), `product.fields` (multiselect name, price, barcode; default name and barcode), `products.group` (as above), `lines.unit`.

### 4.4 Mapping groups and tables (L3, live lookups)

1. **Momszoner** (`zones.*`, lookup `vatZones`, all optional with the standard numbers as fallback):

| Key | Fallback | Used for |
|---|---|---|
| `zones.domestic` | 1 Domestic | Danish customers, and Danish VAT charged abroad |
| `zones.euB2b` | 2 EU | EU companies with a VAT number and no VAT charged |
| `zones.euB2c` | `zones.domestic` | EU private customers under `danishVat` |
| `zones.export` | 3 Abroad | Outside the EU |

   Under `destinationVat`, EU private customers get the zone whose name is the buyer's country (English or Danish), or the row in table 3.

2. **Varer** (`products.*`, lookup `products`): `products.generic` (required when generic products can be used), `products.genericServices` (EU/export services, optional), `products.shipping` (required when an order has shipping), `products.fees`, `products.rounding` (should sit in a VAT-free product group). One generic product serves all sale kinds, because the zone changes the account and VAT (E6). Only services need their own group.
3. **OSS-zoner** (table `ossZones`: country → `vatZones`), advanced.
4. **Kategori → varegruppe** (table `productGroups`: `categories` → `productGroups`), used when `products.missing` = `create`.
5. **Betalingsmetoder** (table `paymentMethods`: `paymentGateways` → `accounts` contra account + `journals`).
6. **Konti** (`accounts.*`), the existing group with stable keys. Required only when `posting.type` = `journal` (X3). Each account's VAT code comes from the chart (`accounts` lookup `vatCode`) and is sent as the entry's `vatCode`.

### 4.5 Target fields

| Target key | e-conomic field | Max | Default template | Editable |
|---|---|---|---|---|
| `invoice.externalId` | Q2C `externalId` | 50 | `ag:{connection.short}:o:{order.sourceId}` | expression (idempotency key, E8) |
| `invoice.otherReference` | `otherReference` (REST `references.other`) | 250 | `{order.number}` | template, **required** (finds booked invoices, feeds `invoiceStatus.orderRef`) |
| `invoice.heading` | `heading` | 250 | `Ordre {order.number}` | template |
| `invoice.textLine1` | `textLine1` | 1000 | `{order.note}` | template |
| `invoice.textLine2` | `textLine2` | 1000 | (empty) | template |
| `invoice.publicEntryNumber` | `publicEntryNumber` | 30 | (empty) | template (public-sector requisition number on EAN invoices) |
| `line.description` | line `description` | 2500 | `{line.name}` | template |
| `payment.text` | entry `text` | 250 | `{order.paymentMethod.title} {order.transactionId}` | template |
| `voucher.text` | finance voucher `text` (journal) | 250 | `Ordre {order.number}` | template |
| `creditNote.externalId` | `externalId` | 50 | `ag:{connection.short}:r:{creditNote.sourceId}` | expression |
| `creditNote.invoiceReference` | finds the original | 250 | `{creditNote.meta.orderNumber}` | expression |
| `creditNote.otherReference` | `otherReference` | 250 | `{creditNote.meta.orderNumber}-R{creditNote.number}` | template, required |
| `creditNote.heading` | `heading` | 250 | `Kreditnota for ordre {creditNote.meta.orderNumber}` | template |
| `customer.name` | `name` | 255 | (the customer's name; company name for companies) | template |
| `product.name` | `name` | 300 | `{product.name}` | template |

### 4.6 Write algorithm (invoice mode)

```
plan Basis               → invalid "kun læse" (E3)
customer                 → engine dependency (customer route logic): number
products per line        → match sku/barcode (cache per run) → missing policy → generic/services/shipping/fees
zone                     → saleKind → zones.* (OSS: country zone)
ext = render(invoice.externalId); ref = render(invoice.otherReference)
existing = existingId ("d:<n>" | "b:<n>")
        ?? Q2C GET /invoices/drafts?filter=externalId$eq:ext
        ?? REST GET /invoices/booked?filter=references.other$eq:ref$and:customer.customerNumber$eq:<n>
booked   → skip; order total changed → warning CHANGED_AFTER_BOOKING
draft    → updateDrafts? PUT header (objectVersion) + delete lines + bulk lines : skip
none     → POST /invoices/drafts (Idempotency-Key: ext+hash) → GET → isVatIncluded → bulk lines (≤100 per call)
totals   → GET draft: grossAmount vs order.total → rounding.policy (line with products.rounding)
live && bookAutomatically → REST POST /invoices/booked {draftInvoice, bookWithNumber?, sendBy?} (Idempotency-Key)
paid && payment.register  → Journals POST /draft-entries {entryTypeNumber 2, …} → payment.book? bookdraftentries
result: destinationId "b:<booked>" or "d:<draft>"; warnings TOTAL_ROUNDED, PAYMENT_NOT_REGISTERED, CHANGED_AFTER_BOOKING
```

- **Journal mode**: one finance-voucher entry (type 5) per planned line (the engine's account per line, D3), with the amount incl. VAT, the account's `vatCode`, and the contra account from the payment-method table or `payment.account`. The first entry gets a voucher number from e-conomic; the others reuse it. Optional `bookdraftentries`. No document numbering in e-conomic, so the cross-reference is the only idempotency (plus `Idempotency-Key` within an hour).
- **Foreign currency**: the draft gets `currencyCode`; e-conomic applies its rate. The payment entry carries the currency and the amount in that currency.
- **Errors**: §1 E16. A 409 on a draft PUT re-reads and retries once.

### 4.7 API family per operation

| Operation | Family | Endpoint |
|---|---|---|
| Who/plan | REST | `GET /self` |
| Lookups | REST | `/layouts`, `/vat-zones`, `/payment-terms`, `/customer-groups`, `/product-groups`, `/units`, `/journals`, `/accounts`, `/vat-accounts`, `/products` |
| Customers | REST | `/customers` (filters, `lastUpdated`, contacts) |
| Products | REST | `/products` (filters, `lastUpdated`, inventory) |
| Draft invoices | OpenAPI Q2C 6.0.0 | `/invoices/drafts`, `/invoices/drafts/{n}/lines[/bulk]` (`externalId`) |
| Book | REST | `POST /invoices/booked` |
| Booked/paid status | REST | `/invoices/booked` (date window, `references.other`) |
| Payments, journal | OpenAPI Journals 16.0.1 | `/draft-entries`, `/journals/{n}/bookdraftentries` |
| Webhooks | OpenAPI Webhooks 1.0.0 | `/webhooks`, `/webhooks/{eventType}` |

---

## 5. e-conomic source module

### 5.1 Output ports

| Port | Read | Trigger | Notes |
|---|---|---|---|
| `customer` (Kunder) | REST `/customers?filter=lastUpdated$gte:…&sort=lastUpdated` | webhook `CUSTOMER_UPDATED` + poll 15 min | Country names → ISO (E11) |
| `product` (Varer) | REST `/products?filter=lastUpdated$gte:…` | webhook `PRODUCT_UPDATED` + poll | Barred products are skipped |
| `stock` (Lager) | REST `/products` in groups with `inventoryEnabled` | poll 15 min (+ product webhook as a hint) | `inventory.available`/`inStock` − safety buffer. Versioned by content, so unchanged stock is never resent |
| `invoiceStatus` (Fakturastatus) | REST `/invoices/booked?filter=date$gte:<today−days>` | webhook `INVOICE_BOOKED` + poll 15 min | `posted`, `paid` when `remainder` = 0, `partial` in between; negative totals → `creditNote`. `orderRef` from `references.other` |

### 5.2 Variables

Static catalogue on each port: `customer.{customerNumber,name,email,phone,cvr,ean,address…,group}`, `product.{sku,name,price,ean,group}`, `stock.{sku,quantity}`, `invoiceStatus.{number,orderRef,state,paymentState,total,residual,date,dueDate,currency}`, plus `raw.*` in the developer view.

### 5.3 Write-backs on WooCommerce

Unchanged WooCommerce inputs: `stock` and `invoiceStatus` (notes "Faktura {invoiceStatus.number} er betalt.", status on paid). The shop order is found by `orderRef` (the shop's order number, E8), because e-conomic gives no external id on booked invoices.

### 5.4 Webhooks

- `ensureWebhooks()`: for each event in `CUSTOMER_UPDATED`, `PRODUCT_UPDATED`, `INVOICE_BOOKED`:
  - `GET /webhooks/{eventType}`; missing → `POST`, disabled or with a different URL → `PUT` with `objectVersion`.
  - Body: `name` `Agentor <connection>`, `url` = the connection's ingest URL, `contentType` `application/json`, `postData` `{"event":"<TYPE>","old":"[OLDNUMBER]","new":"[NEWNUMBER]","invoice":"[INVOICENO]"}`, `customHeaders` `[{X-Agentor-Secret: <secret>}]`.
- `parseWebhook()`: event → entity (`CUSTOMER_UPDATED` → customer, `PRODUCT_UPDATED` → product + `alsoPoll: ['stock']`, `INVOICE_BOOKED` → invoiceStatus). The id is the new number, else the old one. Unknown events → null.
- The worker verifies `x-agentor-secret` (X2). The record is always re-read over the API.

---

## 6. UI

Generated from the manifest, as for Dinero and Odoo:
- **Connect step**: "Forbind med e-conomic" button (installation URL) and a "Har du et token?" field. The guide covers the accountant's "Administrér" step and the Plus-plan requirement.
- **Mapping tab**: Momszoner (zones with their numbers), Varer (generic, services, shipping, fees, rounding), Konti (only under `journal`), OSS-zoner, payment-method table with contra account and journal.
- **Felter tab**: the §4.5 targets with variable picker and preview.
- **Templates**: "Webshop til e-conomic" (Ordrer → Fakturaer with paid statuses, Kreditnotaer, Kunder) and "Lager og fakturastatus fra e-conomic" (Lager → Lager, Fakturastatus → Fakturastatus on WooCommerce).

---

## 7. Phases

| Phase | Content | Done when |
|---|---|---|
| **P0 Framework** | X1–X6 | Existing tests pass; new unit tests for `saleKeys`, `verifyWebhookSecret`, needs-accounts |
| **P1 Client + source** | Two-family client, error mapping, rate-limit handling, `/self` test, lookups, counts, customers/products/stock/invoice-status reads, webhooks | Contract tests on recorded responses; read-only live test against the demo agreement (`demo`/`demo`) |
| **P2 Destination** | Customers (match, merge PUT, attention contact), products (match, create, update), invoices (Q2C draft, update, rounding, book, send), payments (journal entry, optional booking), credit notes, journal posting type | Every §9 case passes on a trial agreement in Kladde, then Live |
| **P3 Wiring + UI** | Manifest 2.0.0, install-URL connect flow, worker env, secret-header webhooks, templates, i18n | Templates and connect step work in mock and live mode |
| **P4 Go-live** | Developer agreement app (SuperUser, Redirect URL), CVR + identity verification (E17), pilot merchants on Kladde | 2 pilot shops booking in Kladde for a week without manual fixes |

---

## 8. Build status

See the commit that adds this file; this section is updated at the end of the build pass.

---

## 9. Test matrix (trial agreement + the WooCommerce test shop)

- **Sale kinds**: domestic B2C/B2B, EU B2B with VAT number (goods and services), EU B2C under `danishVat` and under `destinationVat` (country zone), export, VAT-free products.
- **Prices**: shop incl. and excl. VAT × zones with `isVatIncluded` true/false; coupons; fees; several shipping lines; rounding 0.01–0.05.
- **Products**: SKU match, EAN match, missing (each policy), barred products, SKUs longer than 25 characters (→ invalid with a clear message).
- **Flows**: draft only, draft updated, booked by us, booked by the bookkeeper (found through `references.other`), shop number as invoice number, e-invoice to an EAN customer.
- **Payments**: card (clearing account), MobilePay, bank transfer (no payment), foreign currency, payment booked vs left in the journal.
- **Credit notes**: full, partial, shipping only, before the invoice is booked (wait), standalone.
- **Source**: customer and product webhooks, invoice booked webhook, paid status by poll, stock with the Inventory module, disabled webhook re-enabled.
- **Failures**: Basis plan, revoked grant (E02250), 429 storm, stale `objectVersion`, deleted layout or payment term, closed accounting year.

Credentials for the live suites go in `.env.local` (git-ignored), never in the repo or the chat:

```
ECONOMIC_TEST_APP_SECRET_TOKEN=
ECONOMIC_TEST_GRANT_TOKEN=
ECONOMIC_TEST_WRITE=        # 1 to let the live test create and delete a draft
```

Without them, the live test runs read-only against the public demo agreement (`demo`/`demo`, GET only).

---

## 10. Decisions needed

| # | Question | My recommendation (built as the default) |
|---|---|---|
| ED1 | Default posting type: e-conomic invoice or journal vouchers? | **Invoice.** It gives e-conomic numbering, debtor ledger, e-invoicing and payment matching. Journal is the option for shops whose own invoice is the legal document. |
| ED2 | Payments: book them, or leave them in the kassekladde? | **Leave them as drafts** (`payment.book` off). Danish bookkeepers usually review the kassekladde, and a wrong payment is easy to fix before booking. Live + `payment.book` books only our own entries. |
| ED3 | Missing products: generic product or create? | **Generic product** by default (one per goods/services). Creating products floods the product register with webshop variants; `create` is one switch away. |
| ED4 | Invoice number: e-conomic's sequence or the shop's order number (`bookWithNumber`)? | **e-conomic's sequence** (the Odoo decision OD6), with the shop number in `references.other`. |
| ED5 | OSS: offer `destinationVat` with country zones? | **Yes**, off by default. e-conomic has the zones and OSS codes (E6), unlike Dinero. |
| ED6 | App role | **SuperUser** (journals and webhooks need it, E10/E13). The install screen shows the role, so the guide explains why. |
| ED7 | Credit note before the invoice is booked | **Wait** (retry hourly), as for Dinero and Odoo. |

---

## 11. Risks and things to verify on a trial agreement

| # | Verify | Fallback in the code |
|---|---|---|
| EV1 | The installation URL format with a per-request `redirectUrl` carrying our state | `ECONOMIC_INSTALL_URL` template; manual token paste |
| EV2 | The sign of a customer-payment `amount` (E10) | One constant, `PAYMENT_SIGN` |
| EV3 | Whether stock movements change a product's `lastUpdated` | `stock.scan` = `all` by default |
| EV4 | `sendBy: Email` on booking actually e-mails | Advanced option, off |
| EV5 | Whether a REST draft needs `unit` on lines in some agreements | `lines.unit` setting |
| EV6 | That the Q2C `POST /invoices/drafts` response `number` is the id for `GET/PUT /invoices/drafts/{number}` and the lines' `documentId`, and that `draftInvoiceNumber` is what REST booking wants | Both are read back after create |
| EV7 | Webhook body when `postData` is set, and whether deletes arrive as `*_UPDATED` with an empty new number | Re-read by number; a missing record is a no-op |
| EV8 | Rate-limit headers on production (not seen on the demo) | `Retry-After`, else 60 s |

Other risks:
- **"No parallel database" (E17)**: polling customers/products for other destinations reads data out of e-conomic on a schedule. We store only cross-references and short-lived lookups. Confirm with Visma that customer-configured sync flows are within the terms before go-live.
- **20-installation cap until verification (E17)**: P4 must start before the pilot.
- **Customised agreements**: layouts, payment terms or product groups deleted in e-conomic → validation warns at publish (lookup check) and the write fails with e-conomic's message.

---

## 12. Out of scope here

- e-conomic orders and quotes as a source or destination (sent orders reserve stock; a later module).
- Supplier invoices and purchase.
- Projects, dimensions/departments, accruals (fields exist; options later).
- PDF of the booked invoice back to the shop (`/invoices/booked/{n}/pdf`); a later write-back.
- The Shopify pairing beyond what the generic routes give (PLAN-INTEGRATIONS-SHOPIFY).

## 13. Sources

- Auth and tokens: https://www.e-conomic.dk/support/artikler/authentication-and-tokens · https://www.e-conomic.com/developer/connect · https://techtalk.e-conomic.com/tokens-for-administrators/
- `/self` and read-only plans: https://www.e-conomic.dk/support/artikler/why-get-self-should-be-your-first-api-request
- Choosing an API: https://www.e-conomic.com/developer/choosing-your-api · roles: https://www.e-conomic.com/developer/permissions
- REST: https://restdocs.e-conomic.com/ · schemas `https://restapi.e-conomic.com/schema/invoices.drafts.post.schema.json`, `invoices.booked.post`, `journals.journalNumber.vouchers.post`, `customers.post`, `customers.get`, `products.get`, `invoices.booked.get`
- OpenAPI: https://apis.e-conomic.com/q2capi/redoc.html (6.0.0) · https://apis.e-conomic.com/journalsapi/redoc.html (16.0.1) · https://apis.e-conomic.com/webhooksapi/redoc.html (1.0.0) · https://apis.e-conomic.com/customersapi/redoc.html · https://apis.e-conomic.com/productsapi/redoc.html
- Webhooks: https://www.e-conomic.com/developer/working-with-web-hooks · https://techtalk.e-conomic.com/webhooks-api-is-now-available-in-openapi/
- Rate limiting: https://techtalk.e-conomic.com/building-a-more-stable-api-ecosystem-together/ · https://www.e-conomic.dk/support/artikler/rate-limiting-on-the-e-conomic-public-api
- Developer terms: https://www.e-conomic.com/developer/api-terms-of-service
- SOAP shutdown: https://www.e-conomic.com/soap-deprecation
