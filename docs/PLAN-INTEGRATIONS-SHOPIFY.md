# PLAN: Shopify integration module (source and destination)

Status: **draft for review, 25 Oct 2026. Nothing built.** Decisions SD1–SD9 open (§10). Base branch: `v1.0`.

**Sources**
- Official Shopify developer docs and changelog (shopify.dev), fetched 25 Oct 2026. Links in §13. API version in force: **2026-10** (latest stable, supported until 16 Oct 2027).
- `docs/PLAN-INTEGRATIONS-WOO-DINERO.md` (manifest v2, model v2, template engine, the WooCommerce module) and `docs/PLAN-INTEGRATIONS-WOO-ODOO16.md` (dynamic catalogues, version profiles, `shipment` and `invoiceStatus`). This plan builds on both and does not repeat them.
- Current code: `packages/connectors` (`manifests/index.ts` with the WooCommerce 1.2.0 manifest and a mock-only `shopify` 1.0.0 stub, `live/woocommerce.ts`, `live/dinero.ts` for OAuth with refresh tokens, `live/http.ts`, `adapter.ts` `verifyWebhookSignature`), `packages/flows`, the editor templates `shopify-dinero` and `shopify-economic`.

Items marked *(verify)* are not confirmed in the docs and are checked against a dev store in P1.

**Goal**
- Add a live `shopify` connector that is both a **source** and a **destination**.
- **Reuse the WooCommerce module.** Shopify gets the same ports, the same option keys, the same variable paths and the same write-back inputs wherever the meaning is the same. Every destination built for WooCommerce (Dinero, Odoo, e-conomic, HubSpot, Brevo, Mailchimp) then works with Shopify without changes. So does every flow back into the shop (stock, shipments, invoice status from Odoo).
- Every behaviour on both ends is one of three things: an option, a mapping table, or a template variable or target field. The customer changes them in the UI; a developer changes the same things with expressions and Shopify search filters. Nothing is hard-coded per merchant.
- Shopify merchants keep their own fields in **metafields**, so the variable and target-field catalogues are read from the shop's metafield definitions. This works like Odoo's `fields_get` (Odoo plan §3.1).

---

## 1. Findings that shape the design

| # | Finding | Impact |
|---|---|---|
| S1 | **The REST Admin API has been legacy since Oct 2024.** New public apps must be GraphQL-only (since Apr 2025). REST product endpoints are frozen at 100 variants. Versions are quarterly (`/admin/api/2026-10/graphql.json`), each supported for at least 12 months. A retired version "falls forward" to the oldest supported one without an error. | **GraphQL only**, with the version pinned per release. A **version profile** like Odoo's (§3.3). The client logs the `X-Shopify-API-Version` response header and raises an alert when it differs from the requested version. Upgrading the version is a quarterly chore with contract tests. |
| S2 | **Custom apps can no longer be created in the Shopify admin** (cutoff reported as 1 Jan 2026 *(verify official entry)*); existing ones keep their static `shpat_` token. New apps live in the **Dev Dashboard**. The client-credentials grant (24 h token) only works when the app and the store are in the **same Shopify organization**. | Multi-merchant access means **one Agentor public app** with the OAuth authorization-code grant (§4.1). Two fallbacks: the merchant pastes an existing legacy `shpat_` token, or creates their own Dev Dashboard app (client id and secret, client credentials). Decision SD1. |
| S3 | **New public apps must use expiring offline tokens** (1 h access, 90-day refresh, rotated on every refresh). Existing public apps must switch by 1 Jan 2027. Running two refreshes for the same shop at once invalidates one of them. | The token flow reuses the Dinero OAuth code (refresh a minute early, new tokens to the key box), plus a **per-connection refresh lock** (a DB advisory lock). If the refresh token is unused for 90 days, the connection becomes "Forbind igen". |
| S4 | **Protected customer data**: name, e-mail, phone and address are Level 2 and each is requested separately. A public app needs Shopify's review for them. Without approval, GraphQL returns `null` plus an `errors` entry (still HTTP 200), and webhooks are redacted. Level 2 also requires encryption at rest, retention limits and an incident policy. Dev stores skip the review. | Without Level 2 an order has no customer, so **accounting sync is useless**. Apply early (P3), and document what we already meet (ADR-0002 key box, RLS). The client treats a `null` protected field plus an access error as a **connection error** ("Shopify har ikke givet adgang til kundedata"), never as an empty customer. |
| S5 | **Order scopes only cover the last 60 days** of orders. `read_all_orders` lifts that, but Partner-organization apps must request it from Shopify. | Backfill beyond 60 days needs `read_all_orders`. Without it, `backfill.from` is capped at 60 days in the UI, with an explanation. |
| S6 | **Rate limits are cost-based**: per app and shop, 100 points/s (Standard), 200 (Advanced), 1,000 (Plus), 2,000 (Enterprise). A single query costs at most 1,000 points, and a mutation costs 10. `extensions.cost.throttleStatus` reports the bucket. There are no HTTP rate headers. **Bulk operations** are exempt: since 2026-01, up to 5 concurrent queries and 5 concurrent mutations, with JSONL results. | The client reads `throttleStatus` on every response and paces itself from it (§3.4). It does not use the `rateLimit.perMinute` counter WooCommerce uses. Backfills and full catalogue reads use **bulk queries**, and large stock or product pushes use **bulk mutations**. |
| S7 | **Webhooks**: delivered over HTTPS, Pub/Sub or EventBridge, and signed with `X-Shopify-Hmac-Sha256` (base64 HMAC of the raw body with the **app's client secret**). Use `X-Shopify-Webhook-Id` to deduplicate. Shopify retries 8 times over 4 h, then **deletes shop-specific subscriptions**. **No ordering guarantee**; Shopify itself recommends reconciliation jobs. App-level subscriptions (in `shopify.app.toml`) are never auto-deleted. | Same pattern as WooCommerce: **webhook plus reconcile poll** on `updated_at`. App-level subscriptions are set in the app config and routed by `X-Shopify-Shop-Domain`. Shop-specific ones are used only when a connection needs a filter, and auto-heal recreates them (§5.5). `verifyWebhookSignature()` already supports the scheme; the secret is the app's, not per connection. |
| S8 | **Mandatory compliance webhooks** for public apps: `customers/data_request`, `customers/redact`, `shop/redact`. They are configured only in the app config. | They connect to our GDPR handling (§5.6). `customers/redact` removes the customer's data from `raw` payloads, run logs and cross-reference previews. `shop/redact` purges the connection 48 h after uninstall. `app/uninstalled` disables the connection at once. |
| S9 | **Idempotency**: `@idempotent(key:)` became **mandatory from 2026-04** for `refundCreate` and every inventory quantity mutation. Keys last 24 h. There is no idempotency for product, customer or order mutations. | The idempotency key is derived from our record key (`sha256(connection, entity, sourceId, version)` as a UUID), so a retry after a timeout replays safely. For other writes we keep our own cross-reference and **`$app` metafields with our external id** (S11) and look up before create, as with Odoo's external ids. |
| S10 | **Inventory writes need `changeFromQuantity` from 2026-04**: either the expected current quantity or an explicit `null` to skip the check. A stale value gives `CHANGE_FROM_QUANTITY_STALE`. Quantities are per InventoryItem × Location, with names like `available` and `on_hand`. | Stock option `stock.compare`: `strict` (send the last quantity we read; on a stale value re-read and retry once, then warn) or `overwrite` (`null`, the ERP wins). A **Location mapping table** maps ERP warehouses to Shopify locations. |
| S11 | **Metafields**: `metafieldDefinitions(ownerType:)` lists the merchant's custom fields with name, type and validations (at most 128 per owner type). `$app` is the namespace reserved for app-owned fields. Standard fields can be discovered through introspection. | **Dynamic catalogues** come from metafield definitions (§3.1): variables `order.metafields.<ns>.<key>`, targets `product.metafields.<ns>.<key>`. Our own sync state (external id, last write) goes in `$app:agentor.*`. |
| S12 | **An order has no single status.** It is a combination of `displayFinancialStatus` (PENDING, AUTHORIZED, PAID, PARTIALLY_PAID, REFUNDED, PARTIALLY_REFUNDED, VOIDED, EXPIRED), `displayFulfillmentStatus` (from 2026-10 including `FULFILLMENT_NOT_REQUIRED`), `cancelledAt` and `closed`. | The normalised `Order.status` comes from a documented mapping, and `sourceStatus` carries `<financial>/<fulfillment>`. The trigger options filter on **financial** and **fulfillment** status separately (§5.2), not on a WooCommerce-style status list. |
| S13 | **Money comes in two currencies**: every amount is a MoneyBag with `shopMoney` and `presentmentMoney` (Markets). `taxesIncluded` says whether prices include tax. `taxLines` carry `rate`, `title` and `priceSet` per line and per shipping line. | Connection setting `currency.basis`: `shop` (default; book in the shop's currency) or `presentment`. The VAT mapping uses `taxLines` the way WooCommerce uses `tax_lines`. `pricesIncludeVat` = `taxesIncluded`. |
| S14 | **Shopify-specific money flows**: gift-card sales are a liability, not revenue. Gift cards used as payment show up as a `gift_card` transaction. Tips, duties (cross-border) and order edits (`orders/edited`) also occur. Shopify Payments payouts and fees are separate balance transactions. | New source options: `giftCards.sold` (`line` / `exclude`), `tips` (`line` / `exclude`), `duties` (`line` / `exclude`). The payment-method table handles `gift_card` like any other gateway. Payouts and fees are out of scope (§11). |
| S15 | **The fulfillment model**: shipping goes through **FulfillmentOrders**. `fulfillmentCreate` takes line items grouped by fulfillment order plus `trackingInfo {company, number, url}` and `notifyCustomer`. All fulfillment orders in one call must share the same location. It needs `write_merchant_managed_fulfillment_orders`, which Shopify must approve. | The `shipment` input (from Odoo or another ERP) creates one fulfillment per location group. Lines are matched by SKU; a delivery without lines fulfils everything that is open. Options in §6.3. |
| S16 | **B2B**: Company, CompanyLocation and CompanyContact, with orders linked through `purchasingEntity`. Net-terms orders stay unpaid until settled. The customer's VAT number is `Customer.taxSettings.taxId` (2026-07); companies have their own tax settings on the location. | Connection setting `vatNumber.source` with several sources (§5.1), the equivalent of WooCommerce's `meta.vatNumber`. B2B company orders become `customer.kind = 'company'`. The `invoiceStatus` → Shopify `orderMarkAsPaid` write-back matters most for net terms. |
| S17 | `orderCancel` is **asynchronous** (poll the job; `jobResult` in 2026-10). `orderUpdate` on an unfulfilled order's shipping address **recalculates taxes** (2026-10). `ProductVariant.barcode` is deprecated (2026-10) in favour of `barcodes`. `productSet` **deletes variants that are left out**. | These go into the version profile. `orderCancel` is polled to completion inside the job. We never write the shipping address. EAN is read from `barcodes` first. Product writes default to **variant updates**, not `productSet` (§6.5). |

---

## 2. Model: what Shopify does in a flow

```
 Shopify (source)                                    any destination (Dinero, Odoo, e-conomic, CRM, …)
 Ordrer ─────────────────────────────────────────▶ invoices / sales orders / deals
 Refunderinger (refunds) ────────────────────────▶ credit notes
 Kunder (customers, B2B companies) ──────────────▶ contacts
 Produkter (products, variants) ─────────────────▶ products                      [optional]
 Lager (inventory levels) ───────────────────────▶ stock (other shop, ERP)      [optional]

 any source (Odoo, another shop, PIM, …)             Shopify (destination)
 Lager ──────────────────────────────────────────▶ Lager (inventorySetQuantities)
 Afsendelser (shipment) ─────────────────────────▶ Fulfillment + tracking
 Fakturastatus (invoiceStatus) ──────────────────▶ note / tags / metafield / mark as paid
 Kunder ─────────────────────────────────────────▶ Kunder (customerSet)
 Produkter ──────────────────────────────────────▶ Produkter (variant update / productSet)
```

The configuration layers are the same as in the earlier plans: **L1** connection settings, **L2** route options on both ends, **L3** mapping tables with live lookups, a **variable** catalogue (source) and a **target-field** catalogue (destination).

**WooCommerce ↔ Shopify** (shop to shop, e.g. a migration or a B2B/B2C split) comes free from the same ports: WooCommerce `product` → Shopify `product`, Shopify `stock` → WooCommerce `stock`. It is a template, not extra code (§7).

---

## 3. Framework changes

The framework is in place from the earlier plans: manifest v2, dynamic catalogues, `relation:<model>` lookups, `LookupOption.meta`, `shipment` and `invoiceStatus`, and `expandPort()`. Shopify needs five additive changes.

### 3.1 Shared webshop definitions (reuse the WooCommerce module)

Move the shop-neutral parts out of the WooCommerce manifest into `manifests/webshop.ts` and use them in both manifests:

- `WEBSHOP_ORDER_VARIABLES`, `WEBSHOP_CREDIT_NOTE_VARIABLES`, `customerVariables()`, `lineVariables`: the common paths (`order.number`, `order.total`, `line.sku` …).
- `WEBSHOP_SHIPMENT_INPUT`, `WEBSHOP_INVOICE_STATUS_INPUT`: the targets and route settings that WooCommerce 1.2.0 has today (note templates, `invoice.events`, …), with shop-specific settings added by each manifest.
- Each manifest adds its own variables under its own prefix (`woo.*` stays as it is; Shopify adds `shopify.*`, §5.3) and its own options.

WooCommerce's manifest output must stay **byte-identical** (a snapshot test), so no existing flow changes. This refactor is the "reuse" step: once it is done, a template or flow written for WooCommerce validates against Shopify when it only uses common paths.

### 3.2 Metafield catalogues

`DynamicCatalogue` (Odoo plan §3.1) gets a `kind`:

```ts
interface DynamicCatalogue {
  kind?: 'odooFields' | 'shopifyMetafields';   // default 'odooFields' (existing)
  model: string;        // Odoo model, or Shopify owner type: 'ORDER' | 'CUSTOMER' | 'PRODUCT' | 'PRODUCTVARIANT' | 'COMPANY'
  scope: 'record' | 'line';
  prefix: string;       // 'order.metafields', 'product.metafields'
  include?: 'custom' | 'all';
}
```

- The worker runs `metafieldDefinitions(ownerType:, first: 250)` at the connection test and caches the result with the lookups as `fields:shopify:<ownerType>`. No migration is needed (same as Odoo).
- Type mapping: `single_line_text_field`/`multi_line_text_field`/`rich_text_field` → string (template). `number_integer`/`number_decimal`/`money` → number (expression). `date`/`date_time` → date. `boolean`. A text field with a `choices` validation → select. `*_reference` → lookup by GID (developer). `list.*` and `json` → developer only (a json value is limited to 128 KB).
- `$app` definitions (ours) are hidden from customers. A definition that disappears gives a publish warning and is skipped at run time, as in Odoo.
- Line items have no metafields. Line-level custom data is `customAttributes` (line properties), exposed as `line.properties.<name>` (§5.3).

### 3.3 Version profile

`live/shopify.ts` holds the client and `SHOPIFY_PROFILES['2026-10']`, the same pattern as `ODOO_PROFILES` (one file, as built for Odoo). A profile holds:
- the `apiVersion` string;
- field names that change between versions: barcode vs `barcodes`, `territoryCode` vs `countryCode`, `changeFromQuantity`, the async `orderCancel` result, the `FULFILLMENT_NOT_REQUIRED` status;
- the GraphQL documents per entity, so an upgrade is a new profile plus re-recorded fixtures.

The connection stores the version it was tested on. A scheduled CI job runs the contract suite against the newest release candidate each quarter (§8).

### 3.4 GraphQL transport

`live/http.ts` gets a small `graphql(doc, vars, { cost })` helper (SSRF guard and retries as today) that:
- reads `extensions.cost.throttleStatus` and keeps a per-connection estimate of available points. Before a call whose requested cost exceeds what is available, it waits `(cost − available) / restoreRate` seconds;
- turns a `THROTTLED` error into a wait and a retry, and any other top-level `errors` into `invalid`. Mutation `userErrors` become `invalid` with Shopify's message and field path. An `ACCESS_DENIED` on a protected field becomes `unauthorized` with the protected-data message (S4);
- pages through `pageInfo { hasNextPage endCursor }` with `first: 100` by default;
- runs a **bulk query** helper (`bulkOperationRunQuery` → poll `bulkOperation(id:)` and listen for `bulk_operations/finish` → stream the JSONL), used for backfills above `bulk.threshold` (default 2,000 records) and for the full product/SKU index.

`manifest.rateLimit` gains `{ kind: 'cost', pointsPerSecond: 'plan' }`. The plan is read from `shop.plan` at the connection test.

### 3.5 Credentials and auth

- `auth.type: 'oauth2'` gets the fields `shopDomain` (asked before the redirect), `expiring: true` and `refresh: 'rotating'`. The callback (`/connect/[connector]/callback`) gets a `shopify` branch that:
  - checks the `hmac` query parameter with the app secret (constant-time compare) and the `state`;
  - checks that `shop` matches `^[a-z0-9-]+\.myshopify\.com$`;
  - exchanges the code with `expiring=1`.
- Two alternative auth forms in the same manifest (`auth.alternatives`), each behind an "Avanceret" disclosure:
  - **Legacy custom-app token**: `shopDomain` + `accessToken` (`shpat_…`).
  - **Own Dev Dashboard app**: `shopDomain` + `clientId` + `clientSecret`, using the client-credentials grant (24 h token, renewed by the worker).
- A per-connection refresh lock in the worker for rotating refresh tokens (S3).

---

## 4. Connection

### 4.1 Connect and test

**"Forbind med Shopify"** (recommended): the customer types `din-butik.myshopify.com` (or picks it when they start from the Shopify App Store install link), and we redirect to `https://{shop}/admin/oauth/authorize?client_id=…&scope=…&redirect_uri=…&state=<signed, single-use, 15 min>`.

Scopes: the minimum for the routes the customer picks, requested again (re-authorise) when a new route needs more:

| Use | Scopes |
|---|---|
| Orders, refunds as source | `read_orders` (+ `read_all_orders` for backfill > 60 days, S5) |
| Customers / B2B | `read_customers` / `write_customers`, `read_companies` |
| Products | `read_products` / `write_products` |
| Stock | `read_inventory`, `write_inventory`, `read_locations` |
| Shipments | `read_merchant_managed_fulfillment_orders`, `write_merchant_managed_fulfillment_orders` (Shopify approval) |
| Invoice status write-back | `write_orders` (notes, tags, metafields, mark as paid) |
| Returns (later) | `read_returns` |
| Metafield catalogue | covered by the owner's scope; `read_metaobject_definitions` for reference types |

Connection test, in order, each step with its own Danish error:
1. `shop { name myshopifyDomain plan { displayName shopifyPlus } currencyCode enabledPresentmentCurrencies taxesIncluded ianaTimezone shopAddress { countryCodeV2 } }`: plan (for the cost limit), currency, tax basis, timezone.
2. `currentAppInstallation { accessScopes { handle } }` compared with what the chosen routes need. "Mangler adgang til Lager: forbind igen."
3. **Protected-data probe**: read `orders(first:1) { customer { email } shippingAddress { zip } }`. A `null` together with an access error → the S4 message.
4. `locations(first: 50)` → location lookup; `metafieldDefinitions` for ORDER, CUSTOMER, PRODUCT, PRODUCTVARIANT (and COMPANY when B2B is in use) → catalogues.
5. Counts: `ordersCount`, `customersCount`, `productsCount` (capped counts; they show "10.000+").
6. Lookups cached (§4.3).

### 4.2 Connection settings (L1)

Same keys as WooCommerce where the meaning is the same; Shopify-only keys are marked ★.

| Key | Type | Default | Level | Notes |
|---|---|---|---|---|
| `meta.vatNumber` → shown as **Momsnummer fra** | select + text | `customerTaxId` | basic | Sources: `customerTaxId` (`Customer.taxSettings.taxId`), `companyLocationTaxId` (B2B), `noteAttribute:<name>` (checkout field), `metafield:<ns>.<key>` (customer or order). Same key as WooCommerce, extended value syntax |
| `meta.cvr` | same syntax | none | basic | Danish CVR |
| `meta.ean` | same syntax | none | basic | EAN for public-sector e-invoices |
| `meta.extra[]` | list `{source, alias}` | [] | advanced | Becomes `order.meta.<alias>` (same as WooCommerce); source is a note attribute, metafield or tag prefix |
| `orderNumber.source` | select `name` / `number` / `id` | `number` | advanced | `name` = `#1001` with prefix/suffix as the shop sets it; `number` = `1001`; `id` = the GID's numeric part |
| ★ `currency.basis` | select `shop` / `presentment` | `shop` | advanced | S13 |
| ★ `apiVersion` | read-only | profile | advanced | Shown with "opdateres automatisk" |
| `webhooks.mode` | select `webhook+poll` / `poll` | `webhook+poll` | advanced | As WooCommerce |
| `reconcile.minutes` | number | 60 | advanced | Safety poll |
| ★ `bulk.threshold` | number | 2000 | advanced | Above this, backfill uses a bulk query |
| ★ `locations.default` | select (lookup `locations`) | primary location | basic | Stock and fulfillment fallback when the table has no row |
| `ignoreNoteAttributePrefixes` | text | `_` | advanced | Kept out of `meta` and previews (equivalent of WooCommerce `ignoreMetaPrefixes`) |

### 4.3 Lookups

`orderStatuses` (financial and fulfillment status enums, fixed), `paymentGateways` (no list API: collected from `paymentGatewayNames` on the last 250 orders plus the known ones `shopify_payments`, `manual`, `gift_card`, `paypal`, `mobilepay` *(verify names)*), `shippingMethods` (from `shippingLines.title`/`code` on recent orders, plus `deliveryProfiles` rates *(verify)*), `categories` (standard taxonomy category + `productType` + collections), `locations`, `salesChannels` (`sourceName` values: `web`, `pos`, `shopify_draft_order`, app handles), `markets`, `taxRates` (from `taxLines` titles and rates on recent orders, since Shopify has no tax-rate list for Danish shops), `fields:shopify:<ownerType>` (S11).

---

## 5. Shopify as a source

### 5.1 Output ports

| Port | Shopify object | Trigger | Webhook topics | Poll query |
|---|---|---|---|---|
| `order` (Ordrer) | `Order` | webhook + poll | `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled`, `orders/edited` | `orders(query:"updated_at:>='…'", sortKey: UPDATED_AT)` |
| `creditNote` (Refunderinger) | `Refund` on an order | from the order (as WooCommerce) | `refunds/create` *(verify)* + `orders/updated` | derived from `order.refunds` |
| `customer` (Kunder) | `Customer` (+ `Company` when B2B) | webhook + poll | `customers/create`, `customers/update` | `customers(query:"updated_at:>='…'")` |
| `product` (Produkter) | `ProductVariant` with its `Product` | webhook + poll | `products/create`, `products/update` | `productVariants(query:"updated_at:>='…'")` |
| ★ `stock` (Lager) | `InventoryLevel` per location | webhook + poll | `inventory_levels/update` | `inventoryItems(query:"updated_at:>='…'")` → levels |

`stock` as a Shopify output is new compared with WooCommerce. It serves Shopify → ERP (Shopify owns stock) and Shopify → WooCommerce.

### 5.2 Source options (L2)

**Ordrer** (WooCommerce key where one exists):

| Key | Type | Default | Level | Notes |
|---|---|---|---|---|
| `trigger.financialStatuses` | multiselect | `PAID`, `PARTIALLY_REFUNDED`, `REFUNDED` | basic | Replaces WooCommerce `trigger.statuses`. Empty = all. `AUTHORIZED` for shops that capture on shipment |
| ★ `trigger.fulfillmentStatuses` | multiselect | empty (all) | advanced | e.g. only `FULFILLED` for invoice-on-shipment |
| `trigger.updateStatuses` | multiselect | same as trigger | advanced | Which later changes update a draft |
| `cancel.statuses` → `cancel.onCancelled` | boolean | true | advanced | `cancelledAt` set → the destination's cancel path (same as WooCommerce §4.7 A) |
| ★ `trigger.salesChannels` | multiselect (lookup `salesChannels`) | `web` | basic | POS orders often go to the ERP another way |
| ★ `trigger.query` | text (Shopify search syntax) | empty | advanced (developer) | Extra filter, e.g. `tag:wholesale -tag:test`. Validated with a `ordersCount(query:)` before save |
| `date.field` | select `processedAt` / `createdAt` / `paidAt` | `processedAt` | basic | `paidAt` = time of the first successful SALE/CAPTURE transaction |
| `skipZeroTotal` | boolean | false | basic | Same as WooCommerce |
| ★ `skipTestOrders` | boolean | true | basic | `Order.test` |
| ★ `giftCards.sold` | select `line` / `exclude` | `line` | basic | `line` makes a line with `kind: 'fee'` and category `giftCard`, so the destination can map it to a liability account; `exclude` drops it and lowers the total |
| ★ `tips` / ★ `duties` | select `line` / `exclude` | `line` | advanced | Same mechanism |
| ★ `discounts.mode` | select `perLine` / `ownLine` | `perLine` | advanced | `perLine`: `discountAllocations` reduce each line (`line.discount`). `ownLine`: one negative line per discount application with its code |
| `bundles` | select `children` / `parent` | `children` | advanced | Shopify bundles (`lineItemGroup`) |
| `backfill.from` | date | connection date | basic | Capped at 60 days without `read_all_orders` |
| `customer.guestMatch` | select `email` / `none` | `email` | basic | Orders without a customer |
| ★ `b2b.companyAsCustomer` | boolean | true | basic | `purchasingEntity` company → `customer.kind = 'company'`, `companyName`, location address, tax id |

**Refunderinger**: `refund.minAgeMinutes` (0; Shopify writes a refund in one go *(verify)*), `refund.includeRestockOnly` (false: a refund with no money is not a credit note), `refund.amountOnly` (`line` / `lumpSum`, as WooCommerce; order adjustments such as refunded shipping and discrepancies become lines with `kind: 'fee'`). `refundsPayment` = any successful REFUND transaction.

**Kunder**: `customer.fromOrders` (true), ★ `customer.state` (`ENABLED`, `INVITED`, `DISABLED`, `DECLINED`; default all), ★ `customer.marketingOnly` (false; true = only customers with `emailMarketingConsent.marketingState = SUBSCRIBED`, for Brevo and Mailchimp), ★ `customer.query` (search syntax, developer).

**Produkter**: `product.statuses` (`ACTIVE` default, `DRAFT`, `ARCHIVED`), `product.variationsAs` (`variant` default / `parent`), ★ `product.query`.

**Lager**: ★ `stock.locations` (multiselect, default all active; quantities are summed or kept per location by `stock.perLocation`), ★ `stock.quantityName` (`available` default / `on_hand`), `stock.match` (`sku` / `barcode`).

### 5.3 Variables

All common WooCommerce paths (`order.*`, `order.customer.*`, `line.*`, `creditNote.*`, `customer.*`) are filled the same way. A template written against them works for both shops. Shopify adds:

`shopify.order.{gid, name, legacyId, sourceName, financialStatus, fulfillmentStatus, tags, test, presentmentCurrency, presentmentTotal, riskLevel, customerLocale, market}` · `shopify.order.discountCodes` · `order.noteAttributes.<name>` (custom attributes, the equivalent of Woo meta) · `order.metafields.<ns>.<key>` (dynamic) · `line.properties.<name>` · `line.variantTitle` · `line.vendor` · `line.productType` · `line.giftCard` · `customer.metafields.<ns>.<key>` · `customer.tags` · `customer.marketingConsent` · `shopify.company.{name, externalId, locationName}` · `product.metafields.<ns>.<key>` · `product.{handle, vendor, productType, tags, status}` · `raw.*` (developer).

Each variable has an example taken from the newest real record (as WooCommerce does), so the template preview shows real data.

### 5.4 Normalisation (to the common model)

| Model field | Shopify |
|---|---|
| `Order.sourceId` | the order GID (stored in full; idempotency key) |
| `Order.number` | per `orderNumber.source` |
| `Order.status` | `cancelledAt` → `cancelled`; REFUNDED → `refunded`; PAID/PARTIALLY_REFUNDED + FULFILLED → `completed`; PAID/AUTHORIZED/PARTIALLY_PAID → `processing`; otherwise `pending` |
| `Order.total` | `totalPriceSet` (before refunds) in the chosen currency basis, in øre. Rule (SD4): the invoice is the original order, and refunds go out as credit notes. `currentTotalPriceSet` is available as a variable |
| `lines[].unitPrice` | `originalUnitPriceSet` without VAT (computed from `taxLines` when `taxesIncluded`), `discount` from `discountAllocations` |
| `lines[].vatRate`, `vatLines` | `taxLines.rate` / `title` / `priceSet` |
| `shipping`, `shippingVatRate` | sum of `shippingLines` (after discounts), their `taxLines` |
| `paymentMethod` | the gateway of the first successful SALE/CAPTURE transaction (`paymentGatewayNames` as fallback); split payments (gift card + card) → the largest one, and `raw` keeps all |
| `transactionId` | that transaction's `authorizationCode` / `receiptJson` id *(verify per gateway)* |
| `customer.vatNumber/cvr/ean` | per `meta.*` source settings |
| `CreditNote.lines` | `refundLineItems` (quantity, `subtotalSet`, tax) + `orderAdjustments` + refunded shipping |

### 5.5 Change detection and reliability

- **Webhooks**: app-level subscriptions in `shopify.app.toml` for the topics in §5.1, all to `https://ingest.agentor.dk/shopify`. Ingest:
  - checks the HMAC with the app secret and finds the connection by `X-Shopify-Shop-Domain`;
  - deduplicates on `X-Shopify-Webhook-Id`, answers 200 within 5 s, and queues `{entity, gid}`;
  - reads `include_fields` down to `id, updated_at`. We always re-read over GraphQL (as with WooCommerce F9), so webhook payloads never carry protected data into our logs.
- **Reconcile poll** every `reconcile.minutes` per entity, cursor on `updated_at` minus 2 minutes, `sortKey: UPDATED_AT`. Shopify does not guarantee order (S7), so the version check uses `updatedAt` against the last processed version.
- **Shop-specific subscriptions** only for the own-app auth modes (§3.5), created through `webhookSubscriptionCreate` with the connection's own secret. Auto-heal runs on each poll: `webhookSubscriptions` is listed and missing ones are recreated, with an Aktivitet entry.
- **Echo suppression**: our own writes (notes, tags, fulfillments, stock) are tagged in the cross-reference with the write time and the `$app:agentor.lastWrite` metafield, so the `orders/updated` they cause is ignored.
- **Bulk backfill**: above `bulk.threshold`, one bulk query per entity, JSONL streamed into the normal pipeline.
- **Deletes**: `orders/delete` and `products/delete` are recorded. Destination documents are never deleted automatically (as with WooCommerce).

### 5.6 Privacy webhooks

| Topic | What happens |
|---|---|
| `customers/data_request` | An Aktivitet task for the tenant's owner, listing what we hold for that customer (cross-reference ids, logs). We store no customer profile beyond records in flight. |
| `customers/redact` | Delete `raw` and log payloads for that customer's orders, and pseudonymise the cross-reference. Destination documents (invoices) are the merchant's legal records and are not touched. |
| `shop/redact` | Delete the connection's stored payloads, cursors and secrets (the connection itself was already disabled by `app/uninstalled`). |

---

## 6. Shopify as a destination

### 6.1 Input ports

| Input | Write | Modes |
|---|---|---|
| `stock` (Lager) | `inventorySetQuantities` (`@idempotent`, `changeFromQuantity`), batches of 250; bulk mutation above `bulk.threshold` | dry run, live |
| `shipment` (Afsendelser) | `fulfillmentCreate` per location group + `trackingInfo` | dry run, live |
| `invoiceStatus` (Fakturastatus) | `orderUpdate` note / `tagsAdd` / `metafieldsSet` / optional `orderMarkAsPaid` | dry run, live |
| `customer` (Kunder) | `customerSet` (upsert by email/phone) or `customerCreate`/`customerUpdate` | dry run, live |
| `product` (Produkter) | `productVariantsBulkUpdate` (default) / `productSet` / `productCreate` | dry run, draft (`status: DRAFT`), live |
| `creditNote` → ★ refund (P4) | `refundCreate` with guards | dry run, approval, live |

The same entity names as the WooCommerce inputs, so the Odoo template "Lager og levering fra Odoo" works with Shopify by changing the destination.

### 6.2 Lager

Options (WooCommerce keys kept):

| Key | Type | Default | Notes |
|---|---|---|---|
| `stock.match` | select `sku` / `barcode` / `externalId` | `sku` | SKU → InventoryItem index built by a bulk query, refreshed by `inventory_items/update` |
| `stock.onlyManaged` | boolean | true | Only `InventoryItem.tracked = true` |
| `stock.neverNegative` | boolean | true | |
| ★ `stock.quantityName` | select `available` / `on_hand` | `available` | `on_hand` when the ERP counts physical stock and Shopify reserves itself |
| ★ `stock.compare` | select `strict` / `overwrite` | `overwrite` | S10 |
| ★ `stock.activateMissing` | boolean | false | `inventoryActivate` at the location when the item is not stocked there |
| ★ `stock.reason` | select | `correction` | Shopify's reason enum, shown in Shopify's history |

Table **Lager-lokation → Shopify-lokation** (source `warehouses`/`locations` of the other system; destination `locations`). Empty = `locations.default`. Several source warehouses may map to one location; they are summed.

### 6.3 Afsendelser

The order is found through `orderSource` (our cross-reference from the original order) first. Otherwise `orderRef` is searched with `orders(query:"name:<ref>")`.

| Key | Type | Default | Notes |
|---|---|---|---|
| `shipment.notifyCustomer` (= Woo `shipment.customerNote`) | boolean | true | Shopify's shipping-confirmation e-mail |
| ★ `shipment.lines` | select `match` / `all` | `match` | `match` by SKU against open fulfillment-order lines; `all` fulfils everything open |
| ★ `shipment.carrierMap` | table carrier → Shopify `company` | empty | Shopify recognises named carriers (PostNord, GLS, DAO, Bring *(verify list)*) and builds the tracking URL itself |
| ★ `shipment.trackingUrl` | template | `{shipment.trackingUrl}` | Used when the carrier is unknown to Shopify |
| ★ `shipment.partial` | select `each` / `whenComplete` | `each` | |
| ★ `shipment.alreadyFulfilled` | select `addTracking` / `skip` | `addTracking` | If the order is already fulfilled (e.g. by hand), `fulfillmentTrackingInfoUpdate` adds tracking instead |
| `note.text` (target) | template | as WooCommerce | Optional staff note on the order (`orderUpdate note` is appended, never replaced) |

### 6.4 Fakturastatus

| Key | Type | Default | Notes |
|---|---|---|---|
| `invoice.events` | multiselect | `paid` | As WooCommerce |
| ★ `invoice.writeAs` | multiselect `note` / `tags` / `metafield` | `tags`, `metafield` | Notes in Shopify are a single field, so appending to it is noisy; tags (`faktura-betalt`) are filterable in the admin; the metafield `agentor.invoice` (json: number, state, payment state, url) shows on the order page with a definition we create (pinned) |
| ★ `invoice.tagTemplates` | targets per event | `faktura-{invoiceStatus.number}`, `betalt` | template |
| ★ `invoice.markPaid` | select `never` / `manualGatewaysOnly` | `never` | `orderMarkAsPaid` when the ERP reports paid and the order is still pending. `manualGatewaysOnly` = bank transfer / net terms (B2B). Never for card gateways. The guard is a re-read of `displayFinancialStatus` right before the call |

### 6.5 Kunder and Produkter

**Kunder**: `customer.match` (`email` / `phone` / `externalId` metafield), `customer.update` (multiselect of fields; same as Odoo `contact.update`), `customer.tags` (template), `customer.marketingConsent` (`keep` default / `fromSource`; we never set consent to subscribed without a source that has it, for GDPR), `customer.addresses` (`merge` default: we read and resend the list, since `customerSet` replaces addresses / `replace`), targets `customer.note`, `customer.metafields.<ns>.<key>` (dynamic), B2B: `customer.asCompany` (`companyCreate` + location + contact) *(P5)*.

**Produkter**:
- `product.writeMode`: `variantsOnly` (default; updates price, compare-at price, SKU, barcode and metafields on variants found by SKU, and never creates or deletes anything) / `upsert` (creates missing products with `productCreate` or `productSet`, one variant each or grouped by `variantOf`) / `fullSync` (`productSet`, which **deletes variants that are missing in the source**. Only behind an explicit confirmation and Avanceret).
- `product.statusOnCreate` (`DRAFT` default), `product.fields` (multiselect: title, description, price, compareAtPrice, barcode, weight, vendor, productType, tags), `product.priceBasis` (`inclVat` when the shop's `taxesIncluded`, else `exclVat`, with conversion from the common model's ex-VAT price).
- Table **category → productType / collection**.
- Targets `product.title`, `product.descriptionHtml`, `product.vendor`, `product.tags`, `variant.metafields.*`, `product.metafields.*` (dynamic).
- Our external id goes in `$app:agentor.externalId`.

### 6.6 Write algorithm (shipment, the most used destination path)

```
order    = link(route, shipment.orderSource) ?? orders(query:"name:<orderRef>") → else "Kræver handling"
fos      = order.fulfillmentOrders(status: OPEN|IN_PROGRESS) { id assignedLocation lineItems { id sku remainingQuantity } }
if none open and alreadyFulfilled = addTracking → fulfillmentTrackingInfoUpdate on the newest fulfillment; done
lines    = shipment.lines matched by SKU to remaining quantities (shipment.lines = all → every open line)
groups   = lines grouped by fulfillment order's assigned location
for each group: fulfillmentCreate({ lineItemsByFulfillmentOrder, trackingInfo{company, number, url}, notifyCustomer })
          @idempotent not available → dedupe by our cross-reference (shipment.sourceId + group) checked before each call
note / tags per targets
errors: userErrors → invalid with Shopify's text; THROTTLED → wait; 5xx/timeouts → transient, re-read fulfillments before retry
```

---

## 7. UI and templates

Generated from the manifest as for the other connectors, plus:
- **Connect step**: the shop-domain field, then the redirect. Under "Avanceret": a legacy token or your own app. The test checklist from §4.1, where the protected-data step has its own explanation and a link to what to do.
- **Fields tab**: metafields with a "Shopify-felt" badge, `namespace.key` shown in Avanceret.
- **Mapping tab**: payment gateway table (with `gift_card`), VAT table from `taxLines`, location table, carrier table.
- **Templates** (existing ids kept and made live):
  - `shopify-dinero` and `shopify-economic` (already in `templates.ts`; they switch from mock to live when the manifest becomes live);
  - new `shopify-odoo` ("Shopify til Odoo"), the same routes as "Webshop til Odoo";
  - new `odoo-shopify` ("Lager og levering fra Odoo til Shopify");
  - new `woocommerce-shopify` (products and stock, shop to shop);
  - `customers-hubspot`, `customers-brevo` and `customers-mailchimp` already list Shopify.

---

## 8. Phases

| Phase | Content | Done when |
|---|---|---|
| **P0 Framework** | `manifests/webshop.ts` extracted from WooCommerce (snapshot unchanged), `DynamicCatalogue.kind = shopifyMetafields`, GraphQL helper with cost pacing and bulk query, OAuth `shopify` branch (hmac, shop check, expiring tokens, refresh lock), `auth.alternatives` | All existing tests green; WooCommerce manifest snapshot identical; unit tests for cost pacing, the HMAC check, and the metafield → catalogue mapping |
| **P1 Shopify client (read)** | `live/shopify.ts` with profile 2026-10, connection test (§4.1), lookups, counts, metafield catalogues, normalisation of orders/refunds/customers/products/stock, webhook parsing and ingest route, reconcile poll, bulk backfill, privacy webhooks | Contract tests on fixtures recorded from the dev store; read-only live suite skipped without `SHOPIFY_TEST_*` |
| **P2 Shopify writes** | `stock`, `shipment`, `invoiceStatus`, `customer`, `product` (variantsOnly, upsert) inputs, echo suppression | Every §9 write case passes against the dev store |
| **P3 UI, templates, app** | Connect step, mapping tables, templates §7, `shopify.app.toml` (scopes, webhooks, compliance topics), app listing draft, **protected-data and `read_all_orders` / fulfillment-scope requests to Shopify** | Playwright e2e on mocks; a round trip on test systems: Shopify order → Odoo invoice → delivery → Shopify fulfilled with tracking → invoice paid → Shopify tag |
| **P4 Refund return flow** | ERP credit note → Shopify `refundCreate` (`@idempotent`), with the 9 guards from the Dinero plan §4.7 C (opt-in per gateway, approval by default, never more than refundable, same currency, no echo) | As Dinero §4.7 C |
| **P5 Later** | B2B company writes, returns (`read_returns`), Next Gen Events (GA since 2026-10) instead of classic webhooks, Pub/Sub delivery, `productSet` full sync | Per item |

P0 and the WooCommerce refactor come first because they protect existing flows. P1 can start as soon as a dev store exists (SD6). The Shopify review (P3) has a lead time we don't control, so **the protected-data application is filed during P1**.

---

## 9. Test matrix (dev store + the existing WooCommerce and Odoo test systems)

- **Orders**: Danish B2C with 25% included, prices excl. tax, EU B2C under OSS (Markets with local tax), EU B2B with a tax id (reverse charge), export, POS order (filtered out by default), draft order converted, test order (skipped), order edit after payment, gift card sold and gift card used as payment, tips, discount code per line vs order-level, free shipping, several shipping lines, bundles, multi-currency (presentment ≠ shop).
- **Refunds**: full, partial lines, shipping only, restock-only (no money), refund with order adjustment, refund on a presentment-currency order.
- **Statuses**: authorised then captured, pending (bank transfer) then marked paid, cancelled before and after an invoice exists.
- **Customers**: guest, account, B2B company contact, marketing consent filter, protected data missing (test with a scope removed).
- **Destination**: stock with `strict` and `overwrite` (stale value), item not stocked at location, two locations, SKU missing; shipment full, partial, two locations, already fulfilled by hand, unknown carrier; invoice status tag + metafield + mark paid only for manual gateway; product variant update, upsert in draft.
- **Reliability**: webhook duplicates, out-of-order webhooks, webhook subscription deleted (auto-heal), throttling on a Standard-plan store, bulk backfill of 5,000 orders, token refresh while two jobs run, app uninstalled and reinstalled, API version fall-forward detected.

Test credentials go in `.env.local` (git-ignored), never in the repo or the chat:

```
SHOPIFY_TEST_SHOP=agentor-dev.myshopify.com
SHOPIFY_TEST_CLIENT_ID=
SHOPIFY_TEST_CLIENT_SECRET=
SHOPIFY_TEST_ACCESS_TOKEN=        # optional: legacy shpat_ token or a token from the client-credentials grant
SHOPIFY_APP_CLIENT_ID=            # the Agentor app (OAuth, webhook HMAC)
SHOPIFY_APP_CLIENT_SECRET=
```

The live suites skip themselves when these are empty.

---

## 10. Decisions needed

| # | Question | My recommendation |
|---|---|---|
| SD1 | **How merchants connect** (S2): one Agentor public app (App Store review, Level 2 data review, can install on any shop), or custom distribution per merchant (no review, but one app per store, created by us), or only "bring your own app"? | **Public app** as the main path; "own Dev Dashboard app" and "legacy token" as Avanceret fallbacks. Custom distribution doesn't scale. |
| SD2 | **App Store listing**: listed publicly, or unlisted (installable by link, still reviewed)? | **Unlisted first** (the review is the same, but no marketing obligations), listed when the Danish templates are done. |
| SD3 | **Who owns stock** when Shopify and an ERP are both connected? | Same rule as OD3: **one owner per shop**, chosen in the template. With Odoo Inventory, Odoo owns it, and Shopify → ERP stock routes are blocked for that shop. |
| SD4 | **Invoice total rule**: invoice the original order and send refunds as credit notes, or invoice the current total (after refunds) when the refund comes before the invoice? | **Original + credit notes** (consistent with WooCommerce and Danish bookkeeping). A refund before the invoice exists follows the destination's existing `refund.beforeInvoice` behaviour. |
| SD5 | **Currency basis** default (S13). | **Shop currency.** The accountant books in DKK; the presentment amount is available as a variable. |
| SD6 | **Test store**: a dev store in an Agentor Shopify organization (needed for the client-credentials route and for installing our own app before review). Who creates the Partner/Dev Dashboard organization? | You create the organization (it needs your company details) and a dev store on the **Plus** plan (B2B and higher limits for testing), with `--demo-data`. I wire up `.env.local` from there. |
| SD7 | **Webhook delivery**: HTTPS to our ingest, or Google Pub/Sub (Shopify's recommendation at scale)? | **HTTPS first** (it reuses the ingest app and the WooCommerce code path). Pub/Sub when volume calls for it (P5). |
| SD8 | **Mark as paid** from the ERP (§6.4): offer it at all? | **Yes, opt-in, manual gateways only.** It closes the loop for bank transfer and B2B net terms, which is where Danish merchants ask for it. |
| SD9 | **Scope of the first release**: all inputs in §6, or source + stock + shipment + invoice status first, customers and products after? | **Source + stock + shipment + invoice status** in P2; customer and product inputs follow in the same phase only if time allows. They have more edge cases (consent, `productSet` deletes) and fewer requests. |

---

## 11. Out of scope here

- Shopify Payments payouts, fees and balance transactions (a separate bookkeeping module: bank reconciliation of payouts).
- Shopify POS as its own channel with cash registers and Z-reports.
- Draft orders and B2B quotes created from an ERP.
- Storefront, checkout extensions, Shopify Functions, theme app extensions.
- Multi-store routing (several Shopify stores into one ERP is supported as several connections, not as one).
- Returns (`read_returns`) beyond refunds: P5.
- The REST Admin API.

## 12. Risks

- **Shopify review lead time and requirements (S4, S5, S15)**: protected customer data Level 2, `read_all_orders` and merchant-managed fulfillment scopes all need approval. Without Level 2, the main use case does not work on merchant stores. Mitigation: file during P1, with dev stores for all development; document our data handling (encryption, retention, incident policy) as part of the application.
- **Quarterly API versions (S1)**: a forgotten upgrade falls forward silently. Mitigation: the version header alert, a quarterly CI job against the release candidate, and profiles.
- **Expiring tokens (S3)**: a refresh race logs the merchant out. Mitigation: the refresh lock, and refreshing before expiry in the worker only, never in the web app.
- **`productSet` deletes variants (S17)**: one wrong source sync could wipe a catalogue. Mitigation: `variantsOnly` default, `fullSync` behind a confirmation, and dry-run previews that list deletions.
- **Tax data from Markets**: shops that sell into the EU with local tax have many `taxLines` titles. The VAT mapping table is pre-filled from recent orders and shows unmapped rates as a publish error, as for WooCommerce.
- **Shopify's own e-mails** (shipping confirmation, mark as paid) fire on our writes. `notifyCustomer` is explicit per input, and the UI says that Shopify's notification settings still apply.

## 13. Sources

- Versioning: https://shopify.dev/docs/api/usage/versioning · release notes https://shopify.dev/changelog/release-notes/2026-01, …/2026-04, …/2026-07, …/2026-10
- GraphQL Admin API: https://shopify.dev/docs/api/admin-graphql · REST status https://shopify.dev/docs/api/admin-rest
- New product model: https://shopify.dev/docs/apps/build/graphql/migrate/new-product-model
- Auth: https://shopify.dev/docs/apps/build/authentication-authorization · offline tokens https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens · client credentials https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant · authorization code https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant
- Distribution: https://shopify.dev/docs/apps/launch/distribution · scopes https://shopify.dev/docs/api/usage/access-scopes · protected customer data https://shopify.dev/docs/apps/launch/protected-customer-data
- Limits: https://shopify.dev/docs/api/usage/limits · https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits
- Bulk: https://shopify.dev/docs/api/usage/bulk-operations/queries · https://shopify.dev/docs/api/usage/bulk-operations/imports
- Webhooks: https://shopify.dev/docs/apps/build/webhooks/subscribe · best practices https://shopify.dev/docs/apps/build/webhooks/best-practices · topics https://shopify.dev/docs/api/webhooks/latest · Next Gen Events https://shopify.dev/changelog/next-generation-events-are-now-generally-available
- Objects and mutations: Order https://shopify.dev/docs/api/admin-graphql/latest/objects/Order · productSet …/mutations/productSet · inventorySetQuantities …/mutations/inventorySetQuantities · customerSet …/mutations/customerSet · fulfillmentCreate …/mutations/fulfillmentCreate · orderCancel …/mutations/orderCancel · orderMarkAsPaid …/mutations/orderMarkAsPaid · Refund …/objects/refund
- Idempotency: https://shopify.dev/docs/apps/build/apis/graphql-admin/implementing-idempotency · https://shopify.dev/changelog/making-idempotency-mandatory-for-inventory-adjustments-and-refund-mutations
- Metafields: https://shopify.dev/docs/apps/build/custom-data/metafields/definitions · B2B https://shopify.dev/docs/apps/build/b2b · dev stores https://shopify.dev/docs/apps/build/dev-dashboard/development-stores
- **Not verified** (checked in P1): official date for the end of admin custom apps; per-topic scopes and the `refunds/create`, `orders/updated`, `shop/redact` topic listings; whether `productSet`/`customerSet` accept handle/customId; per-plan bucket sizes; Shopify's carrier name list for Danish carriers; payment gateway handle names.
