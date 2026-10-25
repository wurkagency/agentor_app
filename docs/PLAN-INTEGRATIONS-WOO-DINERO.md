# PLAN: WooCommerce → Dinero live integration modules

Status: **draft for review, 25 Oct 2026.** This is a plan only. No code has been written. Base branch: `v1.0`.

**Sources**
- Official docs fetched 25 Oct 2026 (links in §12).
- Dinero's OpenAPI spec: `https://api.dinero.dk/openapi/v1/swagger.json`.
- Existing specs: `docs/specs/connectors/woocommerce-module-specification.md`, `dinero-module-specification.md`, `docs/integrations/Dinero.md`, and produktspecifikation §4–5.
- Current code: `packages/connectors`, `packages/flows`.

**Goal**
- Replace the mock adapters for `woocommerce` and `dinero` with live clients.
- Make every source and destination behaviour an option or a variable the customer can change in the UI. A developer can change the same things with expressions.
- Hard-code nothing per merchant.

---

## 1. Findings that change the existing specs and code

| # | Finding | Impact |
|---|---|---|
| F1 | **Dinero invoice lines have no VAT-code field.** The line's `AccountNumber` decides VAT, via the account's own `VatCode`. Manual vouchers and the ledger do take `AccountVatCode` per line. **Confirmed 25 Oct: VAT follows the accounts and where the sale comes from** (country, VAT number, goods or services). | Account mapping is VAT mapping for invoices. The sale's origin picks the account (§5.4), and the account carries the VAT. Validation must check that the chosen account's VAT code fits the sale kind, e.g. the EU B2B account must carry `UEUV` or `UEUY`, not `U25`. |
| F2 | **Dinero has no stock.** `Product.Quantity` is a default line quantity, not inventory. **Confirmed 25 Oct: WooCommerce owns stock in this integration.** | Remove the `stock` output from the Dinero manifest. The WooCommerce → Dinero pairing has no stock route. The WooCommerce `stock` input stays for future WMS/CSV sources. |
| F3 | Dinero scopes are `dineropublicapi:read`, `dineropublicapi:write` and `offline_access`. `read` and `write` belong to the legacy authz flow. | Fix the manifest scopes. Without `offline_access` there is no refresh token. |
| F4 | Dinero rate limit is enforced (since 30 Apr 2026): **100 requests/min per organisation** for ISV apps. A 429 has no `Retry-After`. A deprecated endpoint returns `480`. | The per-connection queue backs off at least 60 s on a 429. Treat 480 as an alert to the platform, not as a customer error. |
| F5 | Dinero has **no idempotency key**. It has a client-supplied `Guid` on create and `ExternalReference` (max 128) that can be searched with `queryFilter`. | Write path: look up by `ExternalReference` first, then create with a deterministic Guid (§6.4). |
| F6 | Dinero uses optimistic concurrency. `Timestamp` is required to update, book, register a payment or generate a credit note. Error 58 means the timestamp is stale. | The adapter re-GETs the entity and retries once on error 58. |
| F7 | **Dinero does not support OSS.** Sales to private customers in other EU countries carry Danish 25% VAT only while the merchant's total EU distance sales stay under €10,000 a year (this year and last year). Above that, the buyer's country's VAT applies, and Dinero can't book it. Private customers **outside** the EU are a separate case: exported goods are VAT-free (`UVV`), not 25%. | Add an explicit `euB2c` account and an `oss.mode` setting (§5.3, decision D3). The VAT the shop actually charged on the order is checked against the account's VAT code. |
| F8 | Dinero splits EU and export sales into **goods and services**: `UEUV`/`UEUY` (accounts 1100/1200) and `UVV`/`UVY` (accounts 1255/1260). | `saleKind()` and the account group need a goods/services dimension. |
| F9 | WooCommerce refunds have **no webhook topic of their own**. They arrive as `order.updated`. Webhooks are async (Action Scheduler) and coalesced. A webhook auto-disables after about 5 failures. Permanent deletes fire nothing. | Webhooks are only hints: always re-GET the order and diff its `refunds[]`. Run a reconciliation poll and an auto-heal for disabled webhooks (§5.5). |
| F10 | WooCommerce `customers` and `refunds` have **no `modified_after` filter**. Orders and products do. | Read customers from orders. Read refunds from the orders that changed (§5.4). |
| F11 | The order `number` is not the `id`. Sequential-number plugins rewrite `number`. | Use `number` for display and references, and `id` for the cross-reference. |
| F12 | VAT number, CVR and EAN are not core WooCommerce fields. They live in plugin meta, and in block checkout under `_wc_other/<ns>/<field>` or `_wc_billing/<ns>/<field>`. | Each connection gets **configurable meta keys** with a "test lookup" (§5.2). |
| F13 | Product Bundles: child lines can have a total of 0 (`bundled_by`). | Add a source option for how bundle lines are handled (§5.3). |
| F14 | Dinero has had webhooks since 2024, but only the `entries` event is confirmed. The `invoices` event is unverified. | Dinero → anything stays on polling (`changesSince`) until `/webhooks/events` confirms an invoice event. |

---

## 2. The model: three layers of configuration and one variable catalogue

The UI is still generated from the manifest (produktspecifikation §4.3). This plan widens the manifest so that both ends of a route are configurable:

```
            SOURCE (WooCommerce)                         DESTINATION (Dinero)
 ┌────────────────────────────────┐        ┌───────────────────────────────────────┐
 │ L1 Connection settings          │        │ L1 Connection settings                 │
 │    meta keys, number source,    │        │    organisation, base currency,        │
 │    webhook mode                 │        │    PSP clearing account                │
 │ L2 Source options (per route)   │ route  │ L2 Destination options (per route)     │
 │    trigger statuses, date field,│──────▶ │    posting type, book, pay, send,      │
 │    bundle handling, filters     │        │    contacts, products, rounding        │
 │ Variables: order.*, customer.*, │        │ L3 Mapping tables (lookups, live)      │
 │    meta.*, line.*, refund.*     │        │    accounts × sale kind, category →    │
 │                                 │        │    account, payment method → deposit   │
 │                                 │        │ Target fields: templates + JSONata     │
 └────────────────────────────────┘        └───────────────────────────────────────┘
```

- **L1, connection settings** belong to the connection and are shared by every flow that uses it. Examples: WooCommerce meta keys, and the Dinero organisation.
- **L2, route options** belong to a route in a flow version, so they are versioned, diffed and published.
  - Source options are new: today `Port` has no settings.
  - Destination options already exist as `routeSettings`.
- **L3, mapping tables** are value tables backed by live lookups: accounts, VAT types, deposit accounts, templates, and also the source's own lists (statuses, payment methods, shipping methods, tax classes, categories).
- **Variables** are a catalogue that the *source* declares: path, label, type and an example value. Two things consume them:
  - **Customers** use them in text templates on target fields, e.g. invoice header `Ordre {order.number} · {order.paymentMethodTitle}`. The UI shows a variable picker and a live preview on a real record.
  - **Developers** use the same paths in JSONata expressions (already implemented in `packages/flows/src/expressions.ts`), plus `raw.*`, the untouched source payload.
- **Target fields** are a catalogue that the *destination* declares: key, type, required flag, max length, default template and lookup. They tell templates and expressions what they can write to, and they validate length and type before the write. For example `ExternalReference` has a maximum of 128 characters.

Every option has a `level`:
- `basic`: shown to the business owner.
- `advanced`: shown in Udvikler/"Avanceret".

The defaults reproduce what a typical Danish webshop needs, so a customer can go live after picking accounts.

---

## 3. Framework changes (packages/connectors, packages/flows)

### 3.1 Manifest v2 (additive; existing keys unchanged)

```ts
type SettingType = 'boolean' | 'select' | 'multiselect' | 'text' | 'number' | 'template' | 'metaKey';

interface SettingField {
  key: string;
  label: string;
  type: SettingType;
  default: unknown;
  level?: 'basic' | 'advanced';           // default 'basic'
  options?: { value: string; label: string }[];
  lookup?: LookupId;                        // live options from the source or the destination
  lookupFrom?: 'source' | 'destination';    // whose adapter answers the lookup
  showIf?: { key: string; equals: unknown }; // e.g. payment.register = true
  help?: string;
  validate?: { min?: number; max?: number; maxLength?: number; pattern?: string };
}

interface MappingTable {                      // generalises categoryAccounts
  key: string;                                // e.g. 'paymentMethods'
  title: string;
  from: { lookup: LookupId; lookupFrom: 'source' };      // e.g. WooCommerce gateways
  to: { lookup: LookupId; lookupFrom: 'destination' }[]; // e.g. deposit account + payment term
  fallbackKey?: string;                       // setting holding the default
}

interface VariableDef {
  path: string;                 // 'order.number', 'order.meta.vatNumber', 'line.sku'
  label: string;
  type: 'string' | 'number' | 'money' | 'date' | 'boolean';
  scope: 'record' | 'line';     // line variables only inside line templates
  example?: string;
}

interface TargetField {
  key: string;                  // 'invoice.externalReference'
  label: string;
  type: 'string' | 'number' | 'date';
  scope: 'record' | 'line';
  required: boolean;
  maxLength?: number;
  default?: string;             // a template, e.g. 'woo:{order.id}'
  editable: 'template' | 'expression' | 'none';
}

interface Port {
  /* existing fields */
  options?: SettingField[];            // NEW: source options (L2, source side)
  variables?: VariableDef[];           // NEW: outputs only
  targets?: TargetField[];             // NEW: inputs only
  tables?: MappingTable[];             // NEW: inputs only
}

interface ConnectorManifest {
  /* existing fields */
  connectionSettings?: SettingField[]; // NEW: L1
  lookups?: LookupId[];                // what this adapter can list
}
```

`LookupId` grows from `'accounts' | 'vatCodes' | 'templates'` to a string union declared per connector:
- Dinero: `accounts`, `depositAccounts`, `vatTypes`, `invoiceTemplates`, `units`, `organizations`.
- WooCommerce: `orderStatuses`, `paymentGateways`, `shippingMethods`, `taxClasses`, `taxRates`, `categories`, `metaKeys`.

`ConnectorAdapter.lookup(list: string)` widens to match. The old literal type keeps compiling.

### 3.2 Flow definition (route schema, additive)

- `sourceOptions: Record<string, scalar | string[]>`: L2 source side. `settings` stays the destination side for backward compatibility.
- `tables: Record<string, Array<Record<string, string>>>`: generic mapping tables. `categoryAccounts` stays and is migrated later.
- `templates: Record<targetKey, string>`: customer templates. They are evaluated before `expressions`, and an expression for the same key wins.
- `diffDefinitions` reports `sourceOptions`, `tables` and `templates` changes.
- Validation adds: template variables exist; required target fields resolve; lookup values still exist (an account deleted in Dinero gives Advarsel, per produktspecifikation §4.5).

### 3.3 Template engine

`{path}` tokens with a few filters: `{order.number}`, `{order.date|date:dd-MM-yyyy}`, `{order.billing.company|default:order.billing.name}`, `{line.name|truncate:80}`.
- It is a pure function with no code execution, and much cheaper than JSONata for the 95% case.
- An unknown variable is a validation error at publish time, not a runtime failure.
- After rendering, values are checked against `TargetField.maxLength`. The policy for an over-long value is a setting: `truncate` (default) or `fail`.

### 3.4 Common model v2 (`model.ts`)

The current `Order` and `OrderLine` are too thin for correct bookkeeping. Additions, all amounts in øre:

| Type | New fields |
|---|---|
| `Order` | `updatedAt`, `paidAt`, `completedAt`, `pricesIncludeVat`, `paymentMethod` {id, title}, `transactionId`, `billing` and `shipping` (full `Address` + name, company), `note`, `lines[]` with `kind`, `discounts[]` {code, amount, vat}, `fees[]`, `shippingLines[]` (replaces the scalar `shipping`), `vatLines[]` {rateId, code, label, rate, amount}, `meta: Record<string,string>` (configured keys only), `refundIds[]` |
| `OrderLine` | `kind: 'product' \| 'shipping' \| 'fee' \| 'discount'`, `variantId`, `ean`, `taxClass`, `unitPriceInclVat`, `discount` (øre), `lineTotal`, `lineVat`, `vatRateId`, `bundleParent`, `supplyType: 'goods' \| 'services'` (from mapping, F8) |
| `Customer` | `companyName`, `cvr`, `ean`, `vatNumber` (exists), `isGuest`, `shippingAddress`, `line2`, `state` |
| `CreditNote` | `reason`, `refundsPayment`, `amount`, lines carry `originalLineId` |
| `Product` | `variantOf`, `ean`, `taxClass`, `categories[]`, `primaryCategory`, `stockManaged` |
| every record | `raw: unknown`: the untouched source JSON. Available to expressions and to the record view, never logged, and PII-masked in "Rå request/response" (produktspecifikation §9.6). |

`saleKind()` becomes `saleKind(o, settings) → 'domestic' | 'euB2b' | 'euB2c' | 'export'` plus a per-line `supplyType`. Per D3, the VAT the order actually carries (`vatLines`, line `vatRate`) decides first, and the country and VAT number only break ties. For example, a non-EU order charged 25% books as `domestic`. The tests in `connectors.test.ts` are extended, not replaced.

---

## 4. WooCommerce source module (`woocommerce` 2.0.0)

### 4.1 Connection and auth

Two ways to connect, both ending in the same stored credentials (`baseUrl`, `consumerKey`, `consumerSecret`; key box per ADR-0002):

1. **"Forbind med WooCommerce"** (recommended). Redirect to `{store}/wc-auth/v1/authorize?app_name=Agentor&scope=read_write&user_id=<signed state>&return_url=…&callback_url=https://ingest.agentor.dk/woo/keys`.
   - The store POSTs `consumer_key` and `consumer_secret` as raw JSON to the callback.
   - `user_id` carries a signed, single-use, 15-minute token that binds the callback to tenant and connection.
2. **Manual**: paste the URL and keys (today's form). It is kept for locked-down stores.

Transport rules:
- HTTPS only.
- Basic auth. If the store answers 401 with "consumer key is missing", it is stripping the header, so retry once with query-string auth and remember the fallback on the connection.
- Plain HTTP (OAuth 1.0a) is not offered.
- Self-hosted URLs go through the existing SSRF guard (produktspecifikation §9.4).

Connection test:
- `GET /wc/v3/system_status` reports the WooCommerce version, HPOS flag, currency, `prices_include_tax`, permalinks and active plugins.
- From the plugin list it auto-suggests meta keys, e.g. "EU VAT Number" detected → `_billing_vat_number`.
- It records counts from `X-WP-Total`.

### 4.2 Connection settings (L1)

| Key | Type | Default | Level | Notes |
|---|---|---|---|---|
| `meta.vatNumber` | metaKey | auto-detected, else `_billing_vat_number` | basic | "Test lookup" against the last 20 orders shows the hit rate |
| `meta.cvr` | metaKey | none | basic | Danish CVR for B2B |
| `meta.ean` | metaKey | none | basic | Required for EAN invoices to the public sector |
| `meta.extra[]` | list of {key, alias} | [] | advanced | Becomes the variable `order.meta.<alias>` |
| `orderNumber.source` | select `number` / `id` / `meta` | `number` | advanced | F11; `meta` + key for odd plugins |
| `webhooks.mode` | select `webhook+poll` / `poll` | `webhook+poll` | advanced | `poll` for stores behind a firewall |
| `reconcile.minutes` | number | 60 | advanced | Safety poll (§5.5), bounded by the plan |
| `product.eanSource` | select `global_unique_id` / `meta` | `global_unique_id` | advanced | WooCommerce 9.2+ field, or a legacy meta key |
| `ignoreMetaPrefixes` | text | `_wc_order_attribution_` | advanced | Kept out of `meta` and `raw` previews |

### 4.3 Source options per output port (L2)

**Ordrer**

| Key | Type | Default | Level |
|---|---|---|---|
| `trigger.statuses` | multiselect (lookup `orderStatuses`, includes custom statuses) | `processing`, `completed` | basic |
| `trigger.updateStatuses` | multiselect | same as trigger | advanced (which later statuses push updates to a draft) |
| `cancel.statuses` | multiselect | `cancelled`, `failed` | advanced (delete the draft if it is not booked; otherwise warn) |
| `date.field` | select `date_paid` / `date_created` / `date_completed` | `date_paid`, falling back to `date_created` | basic |
| `skipZeroTotal` | boolean | true | basic |
| `bundles` | select `children` / `parent` / `all` | `children` when children carry price, else `parent` | advanced |
| `backfill.from` | date | connection date | basic (Kørsel tab) |
| `customer.guestMatch` | select `email` / `none` | `email` | basic |

**Kreditnotaer** (derived from `refunds[]` on changed orders)

| Key | Type | Default |
|---|---|---|
| `refund.minAgeMinutes` | number | 2 (WooCommerce writes the refund lines after the header) |
| `refund.includeManual` | boolean | true (refunds with `refunded_payment=false` are still credit notes) |
| `refund.amountOnly` | select `line` / `lumpSum` | `line`; a refund without lines becomes one line on the original account mix, pro rata |

**Kunder**: `customer.roles` (multiselect, default `customer`), `customer.fromOrders` (boolean, default true: guests become customers from the order's billing data).

**Produkter**: `product.types` (simple, variable, bundle), `product.variationsAs` (`variant` / `parent`), `product.statuses` (`publish`).

### 4.4 Variables exposed (catalogue excerpt)

`order.id · order.number · order.date · order.paidAt · order.status · order.currency · order.total · order.totalVat · order.paymentMethod.id · order.paymentMethod.title · order.transactionId · order.shippingMethod · order.couponCodes · order.note · order.billing.{name,company,email,phone,line1,line2,postalCode,city,country} · order.shipping.{…} · order.meta.vatNumber · order.meta.cvr · order.meta.ean · order.meta.<alias> · customer.* · line.{name,sku,ean,quantity,unitPrice,unitPriceInclVat,discount,category,taxClass,vatRate} · refund.{id,number,reason,date,amount} · raw.*` (developer only).

Each variable has an example taken from the connection's newest real record, so the template preview is real.

### 4.5 Fetching, webhooks and reliability

- **Registration**: on activation, `POST /webhooks` for `order.created`, `order.updated`, `order.deleted`, `product.updated`, `customer.created` and `customer.updated`.
  - Each webhook gets its own random secret (key box) and API version `wp_api_v3`.
  - Name format: `Agentor <connectionId>`, so we can find our own webhooks and clean them up.
- **Receive**: the ingest app checks `X-WC-Webhook-Signature` with the existing `verifyWebhookSignature()`.
  - Deduplicate on `X-WC-Webhook-Delivery-ID`, return 200 within a few ms, and queue `{entity, id}`.
  - Answer the creation ping with 200.
- **Process**: always `GET /orders/{id}` (F9) and normalise.
  - Compare `refunds[]` with the refunds already linked and emit `creditNote` records for new ones, after `refund.minAgeMinutes`.
- **Reconcile poll** every `reconcile.minutes`:
  - `GET /orders?orderby=modified&order=asc&modified_after=<cursor-2min>&dates_are_gmt=true&per_page=100`, following the `Link` header.
  - Products are polled the same way.
  - Customers have no `modified_after` (F10), so registered customers are polled with `orderby=registered_date` for new ones only. Customer changes otherwise arrive via webhooks and orders.
- **Auto-heal**: each poll reads `/webhooks?status=disabled` for our own webhooks, sets them back to `active`, and records an Aktivitet entry.
- **Deletes**: `order.deleted` is trash only. Permanently deleted orders are not chased. An existing Dinero document is never deleted automatically.
- **Rate**: WooCommerce has no API limit, but hosts do. Default 120/min per connection (manifest `rateLimit`). On a 429 or 503, back off with jitter. Use `per_page=100`.

### 4.6 Write-back (WooCommerce as destination)

| Input port | Write | Options |
|---|---|---|
| `stock` (exists) | `POST /products/batch` and `/products/{id}/variations/batch`, at most 100 items in total. Look up by SKU, cache SKU → (product, variation), set `manage_stock: true, stock_quantity` | `stock.match` (`sku` / `ean`), `stock.onlyManaged` (true), `stock.neverNegative` (true) |
| `orderStatus` (NEW entity) | `PUT /orders/{id} {status}` | `status.map` table: destination event → WooCommerce status, e.g. "Faktura betalt" → `completed`. `status.notifyCustomer` (whether it may send e-mails) |
| `orderNote` (NEW, a side effect of a route rather than a port) | `POST /orders/{id}/notes` | Option on the *Dinero* route `writeBack.note` (default on): template `Bogført i Dinero som faktura {dest.number}`, with `customer_note: false` |

### 4.7 Cancellations, and Dinero → WooCommerce callbacks

The assumption is that customers manage orders, invoices and credit notes in WooCommerce. Cancellations can still start in either system.

**A. The order is cancelled in WooCommerce** (status in `cancel.statuses`):

| State in Dinero | What happens | Option |
|---|---|---|
| Not created yet | Nothing is sent | |
| Draft | The draft is deleted (`DELETE /invoices/{guid}`) | `cancel.draft`: `delete` (default) / `keep` |
| Booked | A booked invoice can't be deleted in Dinero, only credited. A full credit note is created with `generate-creditnote` and follows the route mode (draft or booked) | `cancel.booked`: `creditNote` (default) / `warn` |
| Booked + paid | As above, and the payout is registered on the credit note when `creditNote.refundPayment` is on | |

If WooCommerce also has a refund on the cancelled order, the refund path makes the credit note, and the cancel path skips. The cross-reference prevents two credit notes.

**B. The invoice is cancelled in Dinero** (draft deleted, or credited in Dinero). Dinero can call back, but not reliably yet:
- Dinero's only confirmed webhook event is `entries`, which covers new ledger entries (F14).
- So the return flow is a **Dinero poll** using `GET /v1/{org}/sales?changesSince=<cursor>`, plus `deletedOnly=true` for deleted drafts.
- The connection polls every 15 min by default, as Dinero's `customer` output does today.
- If `/webhooks/events` lists an invoice event when P2 starts, the webhook replaces the poll, and the poll stays as a safety net.

What the return flow can write to WooCommerce, as options on a new Dinero output port `salesStatus` ("Fakturastatus") → WooCommerce input `orderStatus`:

| Dinero event | WooCommerce write | Default |
|---|---|---|
| Invoice booked | Order note `Bogført i Dinero som faktura {dest.number}` | on |
| Invoice paid (`PaymentStatus` = Paid) | Note; optionally status → `completed` | note on, status off |
| Draft deleted in Dinero | Note `Fakturakladden er slettet i Dinero`; cross-reference removed so a later order change can create it again | on |
| Credit note created in Dinero against our invoice (`CreditNoteFor`) | Note; optionally status → `cancelled` or `refunded`; optionally a WooCommerce refund **record only** (`api_refund: false`, so no money moves through the gateway, and `api_restock` is an option) | note on, status and refund off |

**C. Refund through the payment gateway when a paid invoice is credited in Dinero**

This is possible. `POST /orders/{id}/refunds` with `api_refund: true` asks the order's payment gateway to send the money back to the card or wallet. It only works when the gateway plugin supports refunds: `method_supports` contains `refunds` on `GET /payment_gateways`. Card, MobilePay, Stripe and WooPayments plugins usually do. Bank transfer and cash on delivery don't.
- If the gateway refuses, WooCommerce deletes the refund it just created and returns an error. Nothing is recorded, and nothing is paid out.
- Gateways that only authorise until capture (common with Danish acquirers) may cancel the authorisation instead of refunding. That behaviour belongs to each plugin and is unverified, so it must be tested per gateway.

Because this moves real money, it is **off by default** and goes through guards. The goal is that a customer is never refunded twice and never refunded by hand as well.

| # | Guard | How |
|---|---|---|
| 1 | Opt-in per payment method | New column in the payment-method table: `refund via gateway` (yes/no, default no). Shown only for gateways that support refunds |
| 2 | Only booked credit notes on our own invoices | The credit note must be booked (not a draft) and have `CreditNoteFor` = an invoice in our cross-reference. Credit notes on other invoices are ignored |
| 3 | Approval (default) | `refund.approval`: `manual` (default) or `automatic`. In manual mode the refund waits in a "Afventer godkendelse" list on the flow, with order, amount, gateway and the Dinero credit-note number. A person approves or rejects it. Notification E-mail/push as for errors |
| 4 | Never more than is left | Just before the call, re-GET the order: refundable = `total` − sum of existing `refunds[]`. Credit-note amount > refundable → blocked, "Kræver handling". WooCommerce also rejects refunds above the remaining amount |
| 5 | Exactly once | The refund carries `meta_data` `_agentor_credit_note` = Dinero credit-note guid. Before writing, and before any retry, the adapter looks for a refund with that meta on the order. **No automatic retry after a timeout**: the job re-reads the order first, and if the result is unclear it goes to "Kræver handling" rather than trying again |
| 6 | Same currency | The credit note's currency must equal the order's currency. Otherwise blocked |
| 7 | Refunded elsewhere already | If the order already has refunds that cover the amount (refunded in WooCommerce or in a gateway plugin that syncs back), nothing is sent, and a note explains why |
| 8 | Close the loop in Dinero | After the gateway confirms, the payout is registered on the Dinero credit note (`POST /sales/creditnotes/{guid}/payments`, deposit account from the payment-method table). Dinero then shows the credit note as paid, so nobody pays it again from the bank |
| 9 | No echo | The WooCommerce refund is linked to the Dinero credit note before it is written. When it returns as `order.updated`, no new credit note is made in Dinero |

Options: `refund.approval`, `refund.restock` (default off; stock is WooCommerce's job, and goods may not have come back), `refund.lines` (`amount` default: one amount with the credit-note number as reason; `lines`: match credit-note lines to the order lines we sent, through the stored line map), `refund.reasonTemplate` (`Kreditnota {dest.number} fra Dinero`).

Payment methods without gateway refunds fall back to section B. The note says "Kreditnota {n} skal udbetales manuelt", and the flow shows the case as an open task until the payout is registered in Dinero.

Safeguards:
- A refund that we write to WooCommerce is linked to the Dinero credit note before it is written. When it comes back as `order.updated`, echo suppression sees it and no second credit note is made.
- Status changes can send WooCommerce customer e-mails. `status.notifyCustomer` is off by default, and the UI says that WooCommerce's own e-mail settings still apply.

Echo suppression (produktspecifikation §4.2) tags our own writes so that `order.updated` webhooks caused by our status or note writes are ignored. The check uses `date_modified` against the write time and the cross-reference.

---

## 5. Dinero destination module (`dinero` 2.0.0)

### 5.1 Connection and auth

- **Visma Connect OAuth2**, authorization-code flow.
  - Authorize: `connect.visma.com/connect/authorize` with scopes `dineropublicapi:read dineropublicapi:write offline_access` and `ui_locales=da-DK`.
  - Token: `POST /connect/token` with a form-urlencoded body.
  - Visma Developer Portal client: a **re-use refresh token with a 365-day lifetime**.
  - The refresh job rotates tokens before they expire. Thirty days before the 365-day expiry, raise a "Genforbind" notification (E19 flow).
- **Organisation picker**: after consent, call `GET /v1.1/organizations`. One grant can cover many organisations. The customer picks one, which becomes the connection's `accountHint`.
  - Block the connection if the organisation lacks Pro/Total (`HasPro`, `HasPayingPro`, `HasTotal`); otherwise every call fails with 403, error 90. Show why.
- **Errors**: 401 means `unauthorized` and the connection waits. A 403 with code 90 means the licence was lost; tell the customer.
  - Repeated 400/401/403 responses pause the route automatically. Dinero's technical review requires this.
- Remove `read` and `write` from the scopes (F3).

### 5.2 Connection settings (L1)

| Key | Type | Default | Notes |
|---|---|---|---|
| `organizationId` | select (lookup `organizations`) | none | Required |
| `baseCurrency` | text, read-only | DKK | Shown for clarity |
| `clearingAccount` | select (lookup `depositAccounts`) | none | PSP clearing account for payments and vouchers (55000–55999). "Opret konto" calls `POST /accounts/deposit` with the next free number. |
| `rateLimitPerMinute` | number, advanced | 100 | Lowered automatically when 429s repeat |

### 5.3 Destination options per input port (L2)

**Fakturaer** (`order`). `posting.type` decides which other options appear (`showIf`):

| Key | Type | Default | Level | What it does |
|---|---|---|---|---|
| `posting.type` | select `invoice` / `manualVoucher` / `ledger` | `invoice` | basic | `invoice` uses the Dinero invoice and Dinero numbering. `manualVoucher` books the shop's own invoice with its PDF attached (Dinero's webshop guide). `ledger` adds lines to the kassekladde (the "cashbook" option in Dinero.md) |
| `invoice.book` | boolean | false | basic | Off: draft (route mode Kladde). On: book (Live). Today's `invoice.bookAutomatically`; that key is migrated |
| `invoice.updateDrafts` | boolean | true | basic | Changes in the shop update the draft with `PUT v1.2` and the Timestamp. A booked invoice is never changed |
| `invoice.linesInclVat` | boolean | follows the shop's `prices_include_tax` | advanced | Sets `ShowLinesInclVat` |
| `invoice.language` | select `da-DK` / `en-GB` / `byCountry` | `byCountry` (English outside DK) | basic | |
| `invoice.template` | select (lookup `invoiceTemplates`) | Dinero default | basic | |
| `invoice.currency` | select `order` / `base` | `order` | advanced | Dinero applies the day's rate (§5.6) |
| `oss.mode` | select `danishVat` / `destinationVat` | `danishVat` | basic | Decides `accounts.euB2c` and the VAT check for EU private customers (F7, D3) |
| `invoice.date` | select `order` / `today` | `order` | advanced | Dinero advises the send date. A date in a closed VAT period fails (error 94), so the policy is a setting: `moveToToday` or `fail` |
| `paymentTerms.default` | select Netto / NettoCash / CurrentMonthOut / Paid + days | `Paid` for paid orders, else Netto 8 | basic | |
| `paymentTerms.useContact` | boolean | false | basic | Use the contact's own terms in Dinero |
| `rounding.policy` | select `line` / `fail` / `ignoreBelow` | `line`, max 1.00 DKK | basic | Before booking, `POST /invoices/fetch` compares Dinero's total with the shop's total. The difference becomes a line on the rounding account or fails the record |
| `rounding.account` | lookup `accounts` | none | basic (`showIf` policy=line) | |
| `products.use` | boolean | false | basic | Link lines to Dinero products, which needs a SKU on every line. Off: description lines with `AccountNumber` |
| `payment.register` | boolean | true when the order is paid | basic | `POST /invoices/{guid}/payments` after booking, with deposit account from the payment-method table |
| `payment.remainderIsFee` | boolean | false | advanced | |
| `send.email` | boolean | false | basic | Requires booking. The message template must contain `[link-to-pdf]` |
| `send.eInvoice` | boolean | false | basic | When `order.meta.ean` is present: `POST /v3/.../e-invoice` with `PaymentMeanEnum` (option) and `OrderReference` template |
| `attach.shopPdf` | boolean | true for `manualVoucher`, false otherwise | advanced | Upload with `POST /files` (max 6 MB) |
| `writeBack.note` | boolean + template | on | basic | §4.6 |
| `contact.match` | select `externalReference` / `email` / `vatNumber` / `ean` / `none` | `email` | basic | Search order: the chosen key, then `ExternalReference`. `none` books on one shared "Webshopkunde" contact |
| `contact.update` | multiselect name, address, zip, city, country, phone, email, vat, ean | all | basic | Dinero.md "Select fields to update". Update is GET + merge + `PUT v2` (full replace) |
| `contact.paymentDays` | number | 8 | basic | |
| `contact.useCvr` | boolean | false | advanced | Dinero fills the name and address from CVR |

**Kreditnotaer** (`creditNote`):
- `creditNote.book` (false).
- `creditNote.mode`: `fromInvoice` uses `generate-creditnote` for full refunds and a standalone note with `CreditNoteFor` for partial ones. `standalone` is the alternative.
- `creditNote.refundPayment`: register the payout on the credit note.
- `creditNote.accounts`: `same` reuses the original line accounts, `refundAccount` uses the mapped accounts.
- Header template.

**Kunder** (`customer`): the `contact.*` keys above as a standalone route.

**Produkter** (`product`):
- `product.create` and `product.update`, with a field multiselect.
- `product.unit` (fixed Dinero list: parts, hours, …; default `parts`).
- `product.accountFrom`: `mapping` (from category) or `fixed`.

### 5.4 Mapping tables (L3, live lookups)

1. **Sales accounts by sale kind × supply type** (replaces `ACCOUNT_GROUP`):

| Key | Default suggestion (Dinero standard chart) | Required VAT code on the account |
|---|---|---|
| `accounts.domestic` | 1000 | U25 |
| `accounts.vatFree` | (customer's choice) | none / momsfri |
| `accounts.euB2c` | 1000 | U25 (see D3) |
| `accounts.euB2bGoods` | 1100 | UEUV |
| `accounts.euB2bServices` | 1200 | UEUY |
| `accounts.exportGoods` | 1255 | UVV |
| `accounts.exportServices` | 1260 | UVY |
| `accounts.shipping` / `accounts.shippingVatFree` | 1000 / per sale kind | follows the order's sale kind by default; `shipping.accountMode`: `own` / `followSaleKind` |
| `accounts.fees` | 1000 | per sale kind |
| `accounts.discounts` | (empty means discounts are netted into lines) | `discount.mode`: `perLine` (Dinero `Discount` %) / `ownLine` |
| `accounts.refunds` | (empty means the same as the sale) | |
| `accounts.rounding` | (customer's choice) | |

   The suggestions are pre-filled only when the account exists in the organisation and carries the expected `VatCode` (read from `/accounts/entry`). A mismatch is a validation **warning** that names the account's actual VAT code (F1).

2. **Category → account** (exists: `categoryAccounts`). It gains a `supplyType` column (goods/services) and a primary-category rule (`category.primary`: `first` / `lowestId` / `deepest`).
3. **Payment method → deposit account, payment terms, register?**
   - Source lookup `paymentGateways`; destination lookups `depositAccounts` and the terms list. Fallback: `clearingAccount`.
4. **Shipping method → account** (optional; otherwise `accounts.shipping`).
5. **Tax rate → sale-kind override** (advanced): WooCommerce `tax_lines[].rate_id`/`rate_code` → force `vatFree` / `domestic` / `euB2c`. This handles stores whose tax setup disagrees with the address rule.
6. **Country → language** (advanced; overrides `byCountry`).

### 5.5 Target fields (templates and expressions)

| Target key | Max | Default template | Editable |
|---|---|---|---|
| `invoice.externalReference` | 128 | `woo:{connection.id}:{order.id}` | expression only. Also the idempotency key (§5.6), so customers can't break it |
| `invoice.description` (header) | 256? | `Ordre {order.number}` | template |
| `invoice.comment` | (unverified) | `{order.note}` + delivery address when `comment.includeShipping` | template |
| `line.description` | (unverified) | `{line.name}` + ` ({line.sku})` | template |
| `line.comments` | | empty | template |
| `contact.externalReference` | 128 | `woo:{connection.id}:{customer.key}` | expression |
| `contact.name` | | `{order.billing.company\|default:order.billing.name}` | template |
| `contact.attPerson` | | `{order.billing.name}` when company | template |
| `voucher.lineDescription` (manualVoucher) | | `Ordre {order.number} {line.name}` | template |
| `payment.description` | | `{order.paymentMethod.title} {order.transactionId}` | template |
| `creditNote.description` | | `Kreditnota for ordre {order.number} ({refund.reason})` | template |
| `email.subject` / `email.message` | | Danish defaults; message must contain `[link-to-pdf]` | template |
| `eInvoice.orderReference` | | `{order.number}` | template |

The Dinero.md shortcodes `[order_number]` and `[refund_number]` map to `{order.number}` and `{refund.number}`. Imported settings convert them automatically.

### 5.6 Write algorithm (invoice mode)

```
resolve deps: contact (match → create/update), products (if products.use)
ext = render(invoice.externalReference)
existing = link(route, order) ?? GET /invoices?queryFilter=ExternalReference eq 'ext'
if existing booked  → skip (or credit-note path if totals changed: warn, never auto-amend)
if existing draft   → PUT /v1.2/invoices/{guid} with Timestamp (if updateDrafts)
else                → POST /v1/invoices with Guid = uuidv5(ext)        (F5)
fetch totals        → POST /invoices/fetch; apply rounding.policy
mode live && invoice.book → POST /invoices/{guid}/book {Timestamp}
payment.register && paid  → POST /invoices/{guid}/payments {DepositAccountNumber, Amount(DKK), AmountInForeignCurrency?}
send.email / send.eInvoice / attach / writeBack.note
on 58 → re-GET, retry once; on 429 → rate_limited 60 s; on 480 → platform alert
```

- **Manual voucher** mode: lines are amounts **incl. VAT** with `AccountVatCode` from the sale-kind table and `BalancingAccountNumber` = deposit or clearing account. Upload the shop PDF and set `FileGuid`. Book when Live.
- **Ledger** mode: `POST /v1.2/ledgeritems` in batches of up to 1000. Booking is asynchronous, so poll `/ledgeritems/status`. Error 70 (concurrent posting) is serialised per organisation.
- **Foreign currency**: the invoice gets `Currency`. The payment needs DKK `Amount` and `AmountInForeignCurrency`, so the DKK amount comes from the booked invoice's `TotalInclVatInDkk`, pro rata.
- **Route modes** map 1:1: Test (no API writes; `invoices/fetch` is allowed as a read for the preview), Kladde (create, no book), Live (create + book + payment + send).

---

## 6. UI (generated, no connector-specific screens)

- **Route inspector** (produktspecifikation §5.3) renders:
  - Generelt: source options + destination options, `basic` level.
  - Mapping: sale-kind accounts table, category table, payment-method table, with lookup dropdowns and VAT-code badges.
  - Felter: new tab. Target fields with a template editor, variable picker and live preview on the last 10 records. Developers get a JSONata toggle per field.
  - Kørsel and Historik as today.
  - "Avanceret" reveals the `advanced` settings and `raw.*`.
- **Connection page** renders `connectionSettings`, the meta-key "test lookup" with hit rate, and webhook health (active, disabled-and-healed, last delivery).
- **Template**: "WooCommerce → Dinero (bogføring)" pre-wires Ordrer→Fakturaer, Kreditnotaer→Kreditnotaer and Kunder→Kunder, and opens the guide at Konti.
- Copy is Danish. Settings labels reuse Dinero.md wording where it exists.

---

## 7. Phases (each phase ends green: lint, typecheck, unit, contract, e2e)

| Phase | Content | Done when |
|---|---|---|
| **P0 Framework** | Manifest v2 types, route schema (`sourceOptions`, `tables`, `templates`), template engine, model v2, `saleKind` v2, lookup widening, validation, migration of `invoice.bookAutomatically` and `categoryAccounts` | Existing tests pass unchanged; new unit tests for templates, saleKind matrix and validation |
| **P1 WooCommerce client** | HTTP client (Basic + query fallback, SSRF guard, backoff), `test`/`count`/`fetch`/`get`/`lookup`, normaliser incl. refunds diff, bundles and meta keys, webhook register/verify/heal, reconcile poll, `wc-auth` key flow, stock/status/note writes | Contract tests against recorded fixtures + a docker WordPress/WooCommerce 11.x in CI with HPOS on and off |
| **P2 Dinero client** | Visma Connect OAuth + refresh, organisation picker + licence check, lookups, contacts (v1 create / v2 update), products, invoices (draft/update/fetch/book), credit notes (both modes), payments, files/attachments, manual voucher, ledger, email/e-invoice, error mapping (58/429/480/90) | Contract tests on fixtures + a nightly run against a Dinero test company (free partner Pro year) |
| **P3 UI** | Inspector Felter tab, variable picker, mapping tables, connection settings, webhook health, Dinero organisation picker, template flow | Playwright e2e for the full WooCommerce → Dinero setup on mocks; screenshots for desktop and mobile |
| **P4 Go-live** | Visma Developer Portal app (`isv_Agentor`, Web application, DK team), Dinero scope approval, **Dinero technical review** (email api@dinero.dk with Client ID and test window), pilot merchants on Kladde first | Review passed; 2 pilot shops booking in Kladde for a week without manual fixes |

P1 and P2 can run in parallel after P0.

---

## 8. Test matrix (must pass before Live)

- **Sale kinds**: domestic B2C/B2B, EU B2C, EU B2B with a valid VAT number (goods and services), export (goods and services), VAT-free store.
- **Prices**: prices incl. and excl. VAT; multi-rate orders; coupons (fixed, percent, free shipping); fees (taxable and none); several shipping lines.
- **Refunds**: full, partial lines, amount-only, shipping-only, manual (no gateway).
- **Edge cases**: bundles (priced and not priced individually); variable products; guest vs registered; foreign currency (EUR); rounding differences of 0.01–0.05.
- **Failure handling**: closed VAT period; account deleted in Dinero; stale Timestamp; 429 storm; webhook auto-disabled; header-stripping host; sequential order numbers; block-checkout custom fields.

---

## 9. Decisions needed

| # | Question | My recommendation |
|---|---|---|
| D1 | ~~Default `posting.type`: Dinero invoice or manual voucher with the shop's PDF?~~ | **Resolved 25 Oct: invoice by default**, matching what Danish merchants expect: Dinero numbering, sending, EAN and payments. Manual voucher and ledger are options. |
| D2 | ~~Offer the `wc-auth` one-click key flow in v1?~~ | **Resolved 25 Oct: yes**, with a public HTTPS callback on ingest. Manual keys stay as a fallback. |
| D3 | ~~EU B2C VAT (F7)~~ | **Resolved 25 Oct: book what the shop charged.** The VAT on each WooCommerce order decides the account:<br>• 25% Danish VAT → 1000/U25. This is the default for all private customers.<br>• 0% shipped outside the EU → export account 1255/UVV.<br>• Foreign VAT rate → the `destinationVat` account, with a warning.<br>The integration never recalculates VAT. The original recommendation follows. Setting `oss.mode`: `danishVat` (default: under the threshold, `accounts.euB2c` = 1000/U25, same as domestic) or `destinationVat` (over the threshold: a dedicated account per the accountant, the VAT is reported through OSS outside Dinero). In both modes, warn when the VAT the shop charged on the order doesn't match the account's VAT code. Non-EU private customers always go to the export accounts (UVV/UVY). |
| D4 | ~~Stock source~~ | **Resolved 25 Oct:** WooCommerce manages stock. Dinero `stock` is removed. |
| D5 | ~~Changes to an order after its invoice is booked~~ (cancellations: §4.7) | **Resolved 25 Oct: never amend.** Show a warning "Ordren er ændret efter bogføring" with a one-click credit note + new invoice (manual action). |
| D6 | ~~Payment registration default~~ | **Resolved 25 Oct: on for paid orders** (`date_paid` set), using the payment-method table, falling back to the clearing account. |
| D7 | ~~Gateway refunds from Dinero credit notes (§4.7 C): manual approval or automatic by default?~~ | **Resolved 25 Oct: manual approval by default.** Automatic only per payment method, switched on by an Administrator, with an audit-log entry. |

---

## 10. Out of scope here

- WooCommerce Subscriptions as its own entity (renewal orders still sync as orders).
- Multi-warehouse stock.
- OSS reporting.
- Dinero purchase vouchers.
- PSP payout reconciliation (that is the Indløser → ERP product).
- wc/v4 and the Dual API: not public yet.

## 11. Risks

- **Dinero technical review lead time**: about 1 day for scopes, plus the review itself. Start P4 paperwork during P0.
- **Undocumented Dinero error body**: log the raw body (masked) and map on HTTP status + `code`.
- **Hosts that block wp-json or strip headers**: the query-string fallback and a clear message in the connection test.
- **WooCommerce webhook delays** (Action Scheduler depends on WP-Cron): the reconcile poll bounds the worst case at `reconcile.minutes`.

## 12. Sources

- WooCommerce REST v3: https://woocommerce.github.io/woocommerce-rest-api-docs/
- WooCommerce docs (auth, HPOS, release posts): https://developer.woocommerce.com/docs/apis/rest-api/ · https://developer.woocommerce.com/docs/features/high-performance-order-storage/ · https://developer.woocommerce.com/release-posts/
- Webhook topics and delivery: `plugins/woocommerce/includes/class-wc-webhook.php` (WooCommerce trunk)
- Additional checkout fields: https://developer.woocommerce.com/docs/block-development/extensible-blocks/cart-and-checkout-blocks/additional-checkout-fields/
- Dinero developer docs: https://developer.dinero.dk/ · OpenAPI: https://api.dinero.dk/openapi/v1/swagger.json
- Dinero rate limit (30 Apr 2026): https://developer.dinero.dk/news/rate-limit-in-effect/
- Refresh tokens: https://developer.dinero.dk/news/grace-period-on-refresh-tokens/
- Webshop guide: https://developer.dinero.dk/news/how-to-create-a-webshop-integration/
- Dinero VAT codes: https://dinero.dk/support/hvilke-momskoder-har-vi-dinero/
- OSS: https://dinero.dk/nyheder/moms-one-stop-shop/
- Technical review: https://developer.dinero.dk/documentation/review/
