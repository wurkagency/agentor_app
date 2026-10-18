# Shopify Integration Module — Specification

**Status of prior deliverable:** WooCommerce Integration Module Specification — **APPROVED**, ready for handover.

**This document:** Connector-level specification for the Shopify source module, covering API approach, entity coverage, accounting mapping model, VAT handling, field-level sync selection, and value-add features. Specification only — no implementation.

---

## 1. API approach

Shopify's REST Admin API is now legacy — frozen for new apps since late 2024, no new fields going forward. This module should be built on the **GraphQL Admin API** from the outset; this is not a stylistic preference, it's the only path that stays current with Shopify's feature surface (inventory, metafields, bulk operations, and multi-location all live GraphQL-first).

**Practical implications for the module design:**

- **Cost-based rate limiting** — every GraphQL query has a calculated point cost based on requested fields/nesting, rather than a flat requests-per-second REST limit. This makes field-level selection (§8) directly useful for efficiency, not just UI tidiness — only querying selected/mapped fields keeps cost down.
- **Bulk operations** (async, no point cost) — recommended for full catalog imports and historical order backfills rather than paginating synchronously through large result sets.
- **60-day default order history window** — orders older than 60 days aren't accessible via the standard scope; full history requires Shopify's approval of the `read_all_orders` access scope. This needs to be a flagged setup step in the connection wizard for merchants who want historical data synced, not just orders going forward.
- **API versioning** — Shopify ships a new API version quarterly; pin the integration to a specific version explicitly (never default to "stable") and schedule a review each quarter, consistent with the version-pinning discipline any GraphQL integration needs.
- **Webhooks**: topic-based (`orders/create`, `orders/updated`, `refunds/create`, `products/update`, `inventory_levels/update`), HMAC-signed, retried with exponential backoff for up to 48 hours, then auto-removed on repeated failure. Same pattern as the WooCommerce module: webhook-driven sync as primary mechanism, scheduled polling fallback, periodic health check that re-registers any webhook Shopify has silently dropped.

---

## 2. Authentication & connection

- **Auth method**: custom app OAuth, producing an Admin API access token, scoped to only the permissions the module needs (`read_orders`, `read_all_orders` if historical sync is enabled, `read_customers`, `read_products`, `read_inventory`).
- **Connection wizard step**: standard Shopify OAuth redirect flow — merchant approves scopes on Shopify's own screen, token returned via callback. Validate immediately with a lightweight shop-info query before saving.

---

## 3. Entity coverage

| Entity | Shopify source | Sync direction | Notes |
|---|---|---|---|
| Orders | `Order` (GraphQL) | Read | Line items, taxes, discounts, shipping, refund references |
| Refunds | `Refund` (GraphQL) | Read | Line items, shipping, duties, taxes, restocking — strong parity with WooCommerce refund handling |
| Customers | `Customer` (GraphQL) | Read | |
| Products | `Product` + `ProductVariant` (GraphQL) | Read | Variants are first-class here, more granular than WooCommerce |
| Stock levels | `InventoryItem` + `InventoryLevel` per location | Read | **Native multi-location support** — no plugin dependency, unlike WooCommerce |

---

## 4. Custom accounting mapping model

### 4.1 Mapping hierarchy — adapted for Shopify's categorization model

Shopify exposes two distinct categorization concepts, which changes the mapping approach from WooCommerce:

- **`Product Type`** — a single free-text value per product. **Recommended as the primary account-mapping key**, since being single-valued it avoids the "which category is primary" ambiguity WooCommerce required a workaround for (§4.2 of the WooCommerce spec).
- **`Collections`** — multiple per product, closer to WooCommerce's category model. Offered as a **secondary, optional mapping override** for merchants who organize more by collection than by type.

Mapping precedence: **Product Type default → Collection override (if enabled) → product-level override → fallback account** — same "most specific wins" principle as the WooCommerce model, extended with one more optional layer.

### 4.2 Line-item-level mapping

Same principle as WooCommerce: a single order's line items post to their individually-mapped accounts rather than the whole order lumping to one account, enabling the same activity-type-based automated finance categorization.

### 4.3 Non-product line items

Shipping lines and discount applications need their own default account mapping, same as the WooCommerce module's treatment of shipping/fees/discounts (§4.4 of that spec).

---

## 5. VAT / tax handling

Shopify calculates tax per order line already (`taxLines`, comparable to WooCommerce's `taxes` array), and supports tax-inclusive or exclusive pricing set at the market/region level via Shopify Tax/Markets. **The same three-level VAT override model from the WooCommerce spec (§5.2) applies unchanged**:

1. Store-level default (from Shopify's tax settings)
2. Category-level override (using Product Type as the category key, per §4.1)
3. Product-level override

Same conflict-flagging behavior applies: if a category/product is overridden to exempt but Shopify's own order data still shows tax on that line, flag for merchant review rather than silently trusting either source.

**Multi-currency note**: orders carry both shop currency and presentment currency (what the customer saw at checkout). Recommend always syncing in **shop currency** for accounting consistency, with presentment-currency mismatches flagged (not blocked) for merchant awareness — this is a genuine difference from WooCommerce, which is single-currency per store at the core level.

---

## 6. Value-add features worth including

| Feature | Value proposition |
|---|---|
| **Multi-location inventory** | First-class Shopify feature (not phase-2/plugin-dependent as in WooCommerce) — sync stock per location if the merchant's ERP tracks multi-location, or aggregate to a single total if not |
| **Variant-level SKU matching** | Since variants are first-class in Shopify, match to ERP items at the variant level (e.g., "T-shirt — Blue — Large"), not just the parent product |
| **Order status / financial status filtering** | Same principle as WooCommerce's order-status filtering — sync only orders with a qualifying financial status (e.g., "paid"), not draft or pending orders |
| **Draft order exclusion** | Shopify draft orders are a distinct object from placed orders — explicitly exclude them from sync by default, since they aren't committed sales |
| **Partial refund handling** | Same line-item-granularity principle as WooCommerce — Shopify's `Refund` object natively supports line items, shipping, duties, and tax components together |
| **Discount transparency** | Discount applications shown as their own line in the ERP posting, not netted silently into product revenue |
| **Sync execution modes** | Same three-mode model as WooCommerce (dry-run / draft-post / live) — see §7 |
| **B2B/wholesale catalog pricing** | Shopify Plus-only feature — flag as phase-2, not MVP |

---

## 7. Sync execution modes & manual sync controls

Same confirmed requirement as the WooCommerce module (§7 of that spec) — reused identically here, since this is sync-engine/UI behavior, not connector-specific.

### 7.1 Three execution modes

1. **Dry-run** — pure simulation, nothing written to the ERP. Walks through mapping and VAT resolution and surfaces forecasted issues (unmapped Product Types/collections, VAT conflicts, missing required customer fields, currency mismatches) before anything real happens.
2. **Draft sync** — transfers data to the ERP but posts as **draft/unapproved entries**, pending manual bookkeeper approval inside the ERP before becoming a final posting. Real data movement, with a human checkpoint before finality.
3. **Live sync** — posts directly as final, approved ERP entries. Default/existing behavior assumed elsewhere in this spec.

**Same dependency flag as the WooCommerce spec**: draft-mode posting depends on whether Dinero and e-conomic's write APIs support creating entries in a draft/unposted state — to be confirmed at the ERP-module spec stage, with a documented fallback if either API only supports direct-final posting.

### 7.2 Manual sync — period selection and overwrite control

Identical to the WooCommerce module: developers get a manual sync control with two parameters, available in the developer/advanced layer of the integration detail page.

- **Period selection**: choose a specific date range to sync, rather than only the default "latest/unsynced records" behavior — useful for backfills, re-running a period after a mapping fix, or catching up after a paused connection.
- **Overwrite toggle**: for the selected period, choose between **overwrite existing** (re-push and update already-synced records — e.g., after correcting a mapping error) or **skip existing** (only sync new/missing records, the safer default that avoids duplication or clobbering correct data).

---

## 8. Field-level sync selection

Same Required/Optional/Default pattern as the WooCommerce module, reused deliberately so both connectors share one mental model for merchants and one manifest structure for the sync engine. Shopify-specific fields are added where the platform genuinely differs (variants, multi-location, presentment currency).

### 8.1 Customers

| Field | Required / Optional | Default | Notes |
|---|---|---|---|
| Name (first/last) | Required | On | |
| Email | Required | On | Also the matching key for repeat-customer reconciliation, mirroring the WooCommerce guest-checkout pattern |
| Default address (incl. country) | Required | On | Country needed for VAT logic |
| Phone | Optional | On | |
| Additional addresses (beyond default) | Optional | Off | Most ERPs only need one address per customer |
| Tags | Optional | Off | Useful for merchants doing segmented reporting in the ERP |
| Note | Optional | Off | Internal Shopify note, rarely accounting-relevant |
| Tax-exempt flag | Optional | On | Feeds directly into the VAT override logic (§5) when set |
| Custom metafields | Optional, merchant-specified | Off | Same mechanism as WooCommerce `meta_data` — merchant names the metafield key |

### 8.2 Orders

| Field | Required / Optional | Default | Notes |
|---|---|---|---|
| Order number, date, shop currency | Required | On | |
| Line items (variant, SKU, qty, price, tax) | Required | On | Core to §4.2 line-item-level posting |
| Order totals (subtotal, tax, total, discount) | Required | On | |
| Customer reference | Required | On | |
| Financial status | Required | On | Drives the order-status sync filter (§6) |
| Fulfillment status | Optional | Off | Useful for merchants wanting shipment-state visibility in the ERP, not accounting-critical |
| Presentment currency (if different from shop currency) | Optional | Off | Flagged, not blocking, per §5 |
| Discount application details | Optional | On | |
| Shipping line label | Optional | On | |
| Tags | Optional | Off | |
| Order note | Optional | Off | |
| Custom metafields | Optional, merchant-specified | Off | |

### 8.3 Products

| Field | Required / Optional | Default | Notes |
|---|---|---|---|
| Variant SKU / ID, title | Required | On | Needed for variant-level matching (§6) |
| Price (and compare-at price) | Required | On | |
| Product Type (primary category key) | Required | On | Drives the account mapping (§4.1) |
| Tax status | Required | On | Drives VAT resolution (§5) |
| Collections | Optional | Off | Only needed if the merchant enables Collection-based mapping override (§4.1) |
| Vendor | Optional | Off | Occasionally useful for merchants tracking supplier-level reporting |
| Description | Optional | Off | No accounting value |
| Weight / dimensions | Optional | Off | Only relevant if the ERP tracks logistics |
| Images | Not exposed | — | No accounting/ops value |
| Tags | Optional | Off | |
| Custom metafields | Optional, merchant-specified | Off | |

### 8.4 Stock & Refunds

- **Stock levels**: `available` quantity is Required if the Stock entity is enabled. **Per-location breakdown** is Optional, default off — most merchants will want a single aggregated total in the ERP unless they specifically manage multi-location inventory there too.
- **Refunds**: refund amount, date, and refunded line items (with quantities) are Required — mirrors the original order's line-item structure. Shipping refund amount and duties are Optional, default on, since they commonly need to reconcile against the original order's shipping/duties lines. Restocking flag is Optional, default off — operational detail, not accounting-relevant.

### 8.5 Custom fields (metafields)

Shopify's equivalent of WooCommerce's `meta_data` is the metafield system — namespaced key/value pairs on customers, orders, and products. Same mechanism as the WooCommerce module: merchant names the specific metafield (namespace + key), with a test-lookup confirmation against a real record, mapped to a chosen ERP custom field. Optional, off by default, developer-layer feature.

---

## 9. Explicitly out of scope for MVP (Shopify module)

| Feature | Why deferred |
|---|---|
| B2B/wholesale catalog pricing | Shopify Plus-only, not core MVP |
| Draft order sync | Not committed sales — excluded from sync entirely, not just deferred |
| Per-location inventory as default behavior | Available as an optional field (§8.4), but aggregated single-total stock is the MVP default |
| Multi-currency accounting (presentment currency reconciliation) | Flagged for merchant awareness only; full multi-currency ledger handling is a bigger feature than MVP scope warrants |
| Shopify Functions / Checkout Extensibility hooks | No relevance to this connector's accounting-sync purpose |

---

## 10. Open questions for you to confirm

1. **Historical order sync** — should merchants be offered `read_all_orders` (full history) by default at setup, or only sync orders going forward unless the merchant explicitly requests history? This needs Shopify's scope approval and affects the onboarding wizard.
2. **Product Type vs. Collections as default mapping key** — confirm Product Type as primary (as proposed in §4.1) rather than Collections, given the single-value simplicity argument.
3. **Field-selection defaults** (§8) — same review invitation as the WooCommerce module: confirm nothing essential is marked optional/off, or vice versa, before this becomes a fixed part of the connector manifest.

---

*Next suggested step: with WooCommerce and Shopify specs both drafted, I can move to the ERP-side modules (Dinero, e-conomic) next — once `dinero.md` is available, that'll ground the Dinero spec directly rather than needing a review pass first.*
