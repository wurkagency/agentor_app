# Magento 2 Integration Module — Specification

**Status of prior deliverables:** WooCommerce and Shopify Integration Module Specifications — **APPROVED**, ready for handover.

**Roadmap status:** This is a **Tier 2 connector spec**, prepared ahead of build for planning purposes. The MVP build sequence remains WooCommerce/Shopify × Dinero/e-conomic (Tier 1) as previously agreed — this document does not change that sequence.

**This document:** Connector-level specification for the Magento 2 source module, following the same structure as the WooCommerce and Shopify specs — API approach, entity coverage, accounting mapping model, VAT handling, sync execution modes, field-level sync selection, and value-add features. Specification only — no implementation.

---

## 1. API approach

Magento exposes four integration surfaces: REST, GraphQL, SOAP, and Adobe I/O Events (Adobe Commerce only). **REST is the correct choice for this module** — it's the default for third-party/back-office integrations and covers essentially every entity this connector needs (products, customers, orders, invoices, shipments, credit memos, categories, inventory). GraphQL is Magento's storefront/cart-experience API and isn't the natural fit for an ERP-sync use case; SOAP is legacy.

**A platform-edition distinction that materially affects sync design:**

- **Adobe Commerce** (paid edition) has supported native outbound webhooks since 2.4.4.
- **Magento Open Source** (free edition) has **no native outbound webhooks** — only internal Events/Observers, which require a custom module to expose externally. A merchant on Open Source can't just "turn on" webhooks the way a WooCommerce or Shopify merchant can.

**This means the module needs two sync postures, not one**, and the connection wizard should detect which edition a merchant is running:

- **Adobe Commerce merchants**: webhook-driven sync as primary mechanism, same pattern as WooCommerce/Shopify, with polling fallback.
- **Magento Open Source merchants**: **polling-only by default**, similar in posture to how Uniconta is already handled in the platform's design — no webhook option unless the merchant is willing to install a small companion module (a real option, but added setup friction, not the default assumption).

**Other practical notes:**

- **Async/Bulk REST endpoints** — recommended for full catalog imports and historical backfills, to avoid timeouts and reduce load risk versus synchronous pagination through large datasets.
- **Multi-Source Inventory (MSI)** — Magento's native multi-warehouse stock model (salable quantity per source). Unlike WooCommerce, this is core to Magento, not a plugin dependency — comparable to Shopify's native multi-location inventory.

---

## 2. Authentication & connection

- **Auth method**: OAuth 1.0a or bearer token, generated via an **Integration** created in Magento Admin (System → Extensions → Integrations) with scoped Resource Access (ACL) — recommend the connection wizard instructs the merchant to grant only the specific resources this module needs (Catalog, Sales, Customers, Inventory), not full admin access.
- **Connection wizard step**: merchant creates the Integration in their Magento Admin per guided instructions, pastes the resulting token into the wizard. Validate immediately with a lightweight `GET /rest/V1/products` (paginated, size 1) call before saving.
- **Edition detection**: as part of connection validation, detect whether the store is Adobe Commerce or Open Source (via store info/module list) to determine which sync posture (§1) applies, and surface this to the merchant plainly ("Real-time sync available" vs. "Sync runs on a schedule — real-time available with a small additional setup step").

---

## 3. Entity coverage

| Entity | Magento source | Sync direction | Notes |
|---|---|---|---|
| Orders | Orders API (`/V1/orders`) | Read | Line items, tax, discounts, shipping, payment method |
| Credit Memos (Refunds) | Credit Memos API | Read | Maps directly to ERP credit notes — Magento's own terminology already matches |
| Customers | Customers API | Read | Includes guest checkout — same treatment as WooCommerce (§6.1 pattern) |
| Products | Products API + Categories | Read | Category links support multiple categories per product, same complexity as WooCommerce |
| Stock levels | Inventory/MSI API (salable quantity per source) | Read | Native multi-source — no plugin dependency, unlike WooCommerce |

---

## 4. Custom accounting mapping model

### 4.1 Mapping hierarchy

Same "most specific wins" model as WooCommerce and Shopify: **category-level default → product-level override → fallback account**, with income split at the line-item level across an order's individual products (§4.2).

Magento products can belong to multiple categories, same ambiguity as WooCommerce — apply the same resolution: merchant designates one category per product as the "primary" category for accounting purposes at mapping time.

### 4.2 Line-item-level mapping

Same principle carried through from both prior specs: each order line posts to its own mapped account, not the whole order to one lump sum.

### 4.3 Non-product line items

Shipping amount and discount amount need their own default account mapping, consistent with the WooCommerce/Shopify treatment.

---

## 5. VAT / tax handling

Magento's tax engine is more explicitly B2B-aware out of the box than WooCommerce's — it natively supports a **Tax Class per product**, region-based tax calculation rules, and a **VAT Number / EU VAT validation attribute** on B2B customer accounts. This is a genuine advantage for the DACH/Nordic market and worth designing for directly rather than treating as an edge case.

**Module behavior — same three-level override model as WooCommerce/Shopify:**

1. Store-level default (Magento's configured tax rules)
2. Category-level override
3. Product-level override

Same conflict-flagging behavior: if an override marks something exempt but Magento's own order data still shows tax, flag for merchant review.

**Reverse-charge / B2B VAT**: because Magento already captures VAT ID and validates it against VIES natively (EU VAT package), this connector is well-positioned to implement the **conditional reverse-charge routing** that was deliberately deferred to phase-2 in the WooCommerce spec (§5.2 of that document) — the underlying data (validated VAT ID, customer country) is already structured and reliable here. Still recommend phase-2 sequencing for consistency across connectors, but flag that Magento is the connector where this is cheapest to build first if reverse-charge becomes a priority sooner.

---

## 6. Value-add features worth including

| Feature | Value proposition |
|---|---|
| **Edition-aware sync posture** | Detect Adobe Commerce vs. Open Source at connection time (§1) and set expectations accordingly — avoids merchants on Open Source assuming real-time sync is available when it isn't by default |
| **Guest checkout customer handling** | Same pattern as WooCommerce (§6.1 of that spec) — Magento orders carry billing/shipping data independent of registered customer status; match on email to avoid duplicate ERP customer records |
| **SKU-based product matching** | Same rationale as WooCommerce/Shopify — reduces onboarding friction for large catalogs |
| **Credit memo (refund) handling at line-item granularity** | Magento's credit memos already model partial refunds at the line-item level natively — this maps cleanly onto the same granular credit-note posting used elsewhere |
| **VAT ID capture and reverse-charge readiness** | Per §5 — Magento's native VAT validation makes this connector the strongest candidate for early reverse-charge support |
| **Multi-source inventory awareness** | Native multi-warehouse stock (§1) — surface per-source stock if the merchant's ERP tracks multiple locations, or aggregate to a single total otherwise, same optionality as the Shopify module |
| **Sync execution modes and manual sync controls** | Same three-mode model (dry-run / draft-post / live) and period-selection/overwrite controls as WooCommerce and Shopify — see §7 |

---

## 7. Sync execution modes & manual sync controls

Same confirmed requirement and identical behavior to the WooCommerce and Shopify modules — reused without variation, since this is sync-engine/UI behavior, not connector-specific.

### 7.1 Three execution modes

1. **Dry-run** — pure simulation, nothing written to the ERP. Surfaces forecasted issues (unmapped categories/products, VAT conflicts, missing required customer fields) before anything real happens.
2. **Draft sync** — transfers data to the ERP as **draft/unapproved entries**, pending manual bookkeeper approval before becoming a final posting.
3. **Live sync** — posts directly as final, approved ERP entries.

**Same dependency flag as the other two specs**: draft-mode posting depends on whether Dinero and e-conomic's write APIs support creating unposted/draft entries — to be confirmed at the ERP-module spec stage.

### 7.2 Manual sync — period selection and overwrite control

Identical mechanism to WooCommerce/Shopify: developer-layer control to select a specific date range for manual sync, with a toggle between **overwrite existing** (re-push and update already-synced records) and **skip existing** (only sync new/missing records, the safer default).

---

## 8. Field-level sync selection

Same Required/Optional/Default pattern as WooCommerce and Shopify, reused so all three connectors share one manifest structure and one mental model for merchants.

### 8.1 Customers

| Field | Required / Optional | Default | Notes |
|---|---|---|---|
| Name (first/last or company) | Required | On | |
| Email | Required | On | Also the guest-checkout matching key, same pattern as WooCommerce |
| Billing address (incl. country) | Required | On | Country needed for VAT logic |
| Phone | Optional | On | |
| Shipping address (if different) | Optional | On | |
| VAT Number (B2B) | Optional | On | Higher default relevance here than other connectors, given Magento's native VAT validation (§5) |
| Customer group | Optional | Off | Useful for merchants segmenting B2B/B2C/wholesale pricing tiers in the ERP |
| Custom attributes | Optional, merchant-specified | Off | Same mechanism as WooCommerce `meta_data` / Shopify metafields |

### 8.2 Orders

| Field | Required / Optional | Default | Notes |
|---|---|---|---|
| Order increment ID, date, currency | Required | On | |
| Line items (SKU, qty, price, tax) | Required | On | Core to §4.2 line-item-level posting |
| Order totals (subtotal, tax, total, discount) | Required | On | |
| Customer reference | Required | On | |
| Order status | Required | On | Drives the order-status sync filter, same as WooCommerce/Shopify |
| Payment method | Optional | On | |
| Shipping description | Optional | On | |
| Discount description | Optional | On | |
| Custom attributes | Optional, merchant-specified | Off | |

### 8.3 Products

| Field | Required / Optional | Default | Notes |
|---|---|---|---|
| SKU, name | Required | On | |
| Price (regular/special) | Required | On | |
| Category (primary, per §4.1) | Required | On | |
| Tax class | Required | On | Drives VAT resolution (§5) |
| Weight | Optional | Off | Only relevant if the ERP tracks logistics |
| Custom attributes | Optional, merchant-specified | Off | |

### 8.4 Stock & Credit Memos

- **Stock levels**: salable quantity is Required if Stock entity is enabled. Per-source breakdown is Optional, default off — same aggregation-by-default approach as the Shopify module.
- **Credit memos**: refunded amount, date, and refunded line items are Required. Refund comments/reason are Optional, default off.

### 8.5 Custom fields (custom attributes)

Same mechanism as WooCommerce `meta_data` and Shopify metafields: merchant names a specific custom attribute code, with a test-lookup confirmation, mapped to a chosen ERP custom field. Optional, off by default, developer-layer feature.

---

## 9. Explicitly out of scope for MVP (Magento 2 module)

| Feature | Why deferred |
|---|---|
| Adobe I/O Events / native webhooks | Adobe Commerce-only — Open Source merchants (likely the majority in this platform's target market segment) get polling by default; treat webhook support as an edition-conditional enhancement, not a baseline assumption |
| Reverse-charge VAT routing | Deferred for cross-connector consistency (§5), despite Magento being technically the cheapest connector to build it on first |
| B2B company/shared catalog features | Adobe Commerce B2B-only, no relevance to a core accounting-sync module |
| Multi-store/multi-website Magento instances (single Magento install running several storefronts) | Real merchant pattern, but adds real mapping complexity (per-store category/tax rules) — treat as a distinct future feature requiring its own design pass, not folded into this spec |

---

## 10. Open questions for you to confirm

1. **Open Source vs. Adobe Commerce assumption** — confirm the majority of target merchants are expected to be Open Source (polling-only default) vs. Adobe Commerce (webhook-capable) — this affects how much emphasis the sync engine puts on polling robustness for this connector specifically.
2. **Reverse-charge sequencing** — given Magento's native VAT validation makes it the cheapest connector to build reverse-charge routing on, confirm whether it's still deferred to a uniform phase-2 across all connectors, or accelerated for Magento specifically.
3. **Field-selection defaults** (§8) — same review invitation as prior specs.

---

*Next suggested step: PrestaShop module spec, or move to the ERP-side modules once `dinero.md` is available.*
