# PLAN: WooCommerce ↔ Odoo 16 integration module

Status: **decisions OD1–OD7 resolved, 25 Oct 2026.** This is a plan only. No code has been written. Base branch: `v1.0`.

**Sources**
- Official Odoo 16 docs and the `odoo/odoo` 16.0 and 17.0 source, fetched 25 Oct 2026 (links in §12).
- `docs/PLAN-INTEGRATIONS-WOO-DINERO.md` (manifest v2, model v2, template engine, the WooCommerce module). This plan builds on it and does not repeat it.
- Current code: `packages/connectors` (manifest v2, `live/woocommerce.ts`, `live/http.ts`), `packages/flows`.
- Test systems: the user's WooCommerce test shop and Odoo 16 Enterprise test database.

**Goal**
- Add a live `odoo` connector that works as a **destination and a source**, and pairs with the existing WooCommerce module.
- Reuse WooCommerce 2.x as it is. The only additions are two write-backs it does not have yet (shipment/tracking and invoice status, §4.7).
- Every behaviour on both ends is an option, a mapping table or a template variable the customer can change in the UI. A developer changes the same things with expressions. Nothing is hard-coded per merchant.
- Odoo is customisable in a way Dinero is not (custom fields, Studio, many apps), so **the variable and target-field catalogues for Odoo are read from the customer's database**, not fixed in the manifest (§3.1).

---

## 1. Findings that shape the design

| # | Finding | Impact |
|---|---|---|
| O1 | **Odoo 16 has been out of standard support since September 2025.** 17 ends September 2026, 18 in 2027, 19 in 2028. Odoo Online upgrades databases on its own, so a 16 database today runs on Odoo.sh or on-premise. | Build the adapter **version-aware from day one**: one client, a profile per major version (16 first, 17–19 later). Field and method differences sit in the profile (§3.3), not scattered in the code. |
| O2 | The external API is **XML-RPC** (`/xmlrpc/2/common`, `/xmlrpc/2/object`, `execute_kw`). The same service is also reachable as JSON-RPC at `/jsonrpc` (`{"service":"object","method":"execute_kw","args":[…]}`). | Use **JSON-RPC** over our existing `live/http.ts` (no XML library, same retry and SSRF code). One method, `call(model, method, args, kwargs)`. |
| O3 | Auth = database name + login + **API key** (in place of the password; Preferences → Account Security). 2FA doesn't block API keys. `common.authenticate` returns the `uid`. | Auth form: URL, database, login, API key. No OAuth. Recommend a **dedicated integration user** with only the groups it needs (§4.1). |
| O4 | On Odoo Online, API access needs the **Custom** plan; it is not available on One App Free or Standard. Self-hosted and Odoo.sh have no such limit. | Not relevant for the self-hosted test server (OD7). The connection test names it as the likely cause on `*.odoo.com` when authentication works but object calls are refused. |
| O5 | **Private methods can't be called over RPC** (names starting with `_`, or `@api.private`). Example: `sale.order._create_invoices`, `account.fiscal.position._get_fiscal_position`. | Business actions go through public buttons and wizards: `action_confirm`, `action_post`, `sale.advance.payment.inv.create_invoices`, `account.payment.register.action_create_payments`, `account.move.reversal`, `stock.quant.action_apply_inventory`. |
| O6 | **Odoo 16 has no webhooks in core.** The `base.automation` triggers are create/write/unlink/onchange/time only. Odoo 17 added an **"On webhook"** trigger (incoming) and a **"Send Webhook Notification"** server-action type (outgoing, `webhook_url`, `webhook_field_ids`). | Odoo → anything on 16 is **polling on `write_date`** (§5.4). On 17+, the adapter can create its own automated action with a webhook action over RPC (needs admin rights), and polling stays as the safety net. |
| O7 | Odoo has **no idempotency key**, but it has **external ids** (`ir.model.data`) and a public `load(fields, rows)` method that upserts by external id in one savepoint. | Cross-reference = external id `__agentor__.<conn>_<entity>_<sourceId>` plus a searchable reference field (`client_order_ref`, `ref`). Look up first, then create (§4.6). |
| O8 | Odoo **can decide VAT itself**: taxes on products, and fiscal positions that map taxes and accounts by delivery country, VAT number and country group. The "EU Intra-community Distance Selling" setting creates **OSS fiscal positions and taxes per EU country**. Dinero could not do OSS; Odoo can. | Tax handling becomes a strategy setting (§4.3 `tax.strategy`). The default follows D3 from the Dinero plan: book the VAT the shop charged, through a tax-mapping table. "Let Odoo decide" is the alternative. |
| O9 | `account.tax.price_include` decides whether a line's `price_unit` includes VAT. WooCommerce stores may price incl. or excl. VAT. The company setting `tax_calculation_rounding_method` (per line / globally) changes totals by øre. | The tax mapping table maps each WooCommerce rate to an Odoo tax **and** checks that `price_include` fits the price basis we send. After writing, the adapter reads `amount_total` and applies `rounding.policy` (as for Dinero). |
| O10 | Odoo has **stock** (`stock.quant`, `qty_available`, `free_qty` per warehouse/location). A confirmed `sale.order` creates a delivery (`stock.picking`) and reserves stock. | Unlike Dinero, Odoo can own stock. New flows: Odoo → WooCommerce stock, and Odoo delivery done → WooCommerce "completed" with tracking (§5). Requires decision OD3. |
| O11 | Odoo 16 analytic accounting uses `analytic_distribution` (a JSON field `{account_id: percent}`) on lines, not the older `analytic_account_id`. | Analytic is an optional target field/table, written as JSON. |
| O12 | `fields_get` returns every field of a model, including **custom `x_` and `x_studio_` fields**, with type, label, required, readonly, selection values and relation. | Variables (Odoo as source) and target fields (Odoo as destination) are generated from `fields_get` at each connection test and cached with the lookups (§3.1). |
| O13 | Deletes don't change `write_date`; unlinked records vanish. Archiving sets `active = False`. | Reconcile by id set on a slow schedule for the few entities where deletes matter (invoices in draft). Search with `active_test: false` in context when archived records count. |
| O14 | Odoo retries Postgres serialisation failures itself (up to 5 times), but long or concurrent writes on the same records can still fail. Odoo.sh and on-premise limit request time (`limit_time_real`). | Per-connection concurrency 1 for writes by default, batches of ~50 records per `create` call, and `transient` errors for timeouts and concurrency failures. |
| O15 | Multi-company: a user may have several companies. Calls run in the user's current company unless `context.allowed_company_ids` is set. | Connection setting `companyId`. Every call carries `allowed_company_ids: [companyId]` and lookups are filtered by company. |

Items marked *(verify)* below are not confirmed in the 16.0 docs or source and are checked on the test database during P1.

---

## 2. Model: what the pairing does

```
 WooCommerce (source)                         Odoo 16 (destination)
 Ordrer ──────────────────────────────────▶ Salgsordrer (sale.order) and/or Fakturaer (account.move)
 Kreditnotaer (refunds) ──────────────────▶ Kreditnotaer (account.move out_refund)
 Kunder ──────────────────────────────────▶ Kontakter (res.partner)
 Produkter ───────────────────────────────▶ Produkter (product.product)   [optional]

 Odoo 16 (source)                             WooCommerce (destination)
 Lager (stock.quant / free_qty) ──────────▶ Lager (stock, exists)
 Leveringer (stock.picking done) ─────────▶ Ordrestatus + note + tracking  (NEW input)
 Fakturastatus (payment_state) ───────────▶ Ordrenote / status            (orderStatus, planned)
 Produkter (price, name) ─────────────────▶ Produkter                     [later, §10]
```

The same three configuration layers apply as in the Dinero plan §2: **L1** connection settings, **L2** route options on both ends, **L3** mapping tables with live lookups, plus a **variable** catalogue (source) and a **target-field** catalogue (destination).

---

## 3. Framework changes

The framework from the Dinero plan (manifest v2, `sourceOptions`, `tables`, `templates`, template engine, model v2) is in place. Odoo needs four additive changes.

### 3.1 Dynamic catalogues

Static `variables` and `targets` in the manifest stay as the base. A port can also declare where more come from:

```ts
interface DynamicCatalogue {
  model: string;                      // 'sale.order', 'account.move', 'res.partner', 'product.product'
  scope: 'record' | 'line';           // line = 'sale.order.line', 'account.move.line'
  prefix: string;                     // variables: 'odoo.order', targets: 'order.fields'
  include?: 'custom' | 'all';         // default 'custom' (x_ / x_studio_), 'all' in Avanceret
}

interface Port {
  /* v2 fields */
  dynamicVariables?: DynamicCatalogue[];   // outputs
  dynamicTargets?: DynamicCatalogue[];     // inputs
}
```

- The worker runs `fields_get` (attributes `string, type, required, readonly, selection, relation, size`) for each declared model at the connection test and caches the result with the lookups.
- Field type mapping: `char`/`text`/`html` → string (template editable, `size` → `maxLength`); `integer`/`float`/`monetary` → number (expression); `date`/`datetime` → date; `boolean`; `selection` → select with the field's values; `many2one` → lookup by the relation's `name_search` (§3.2); `one2many`/`many2many` → developer only.
- Readonly, computed-not-stored and system fields (`create_uid`, `__last_update`, `message_*`, `activity_*`) are left out of targets.
- A target field that disappears from Odoo (a deleted Studio field) is a validation **warning** at publish and a skipped field at run time, never a crash.

### 3.2 Relation lookups

New `LookupId` values are needed, and Odoo needs one generic kind:

- Fixed Odoo lookups: `companies`, `journals` (filter by type), `taxes` (sale/purchase, with `amount`, `price_include`), `fiscalPositions`, `accounts`, `paymentMethodLines`, `paymentTerms`, `pricelists`, `warehouses`, `locations`, `productCategories`, `uoms`, `salesTeams`, `users`, `carriers`, `analyticAccounts`, `currencies`, `cashRoundings`.
- Generic: `relation:<model>` answered with `name_search`, so a many2one custom field on any model gets a working dropdown without code.
- `LookupOption` gains optional `meta: Record<string, string | number | boolean>` (for example a tax's `amount` and `price_include`), so the UI can show badges as it does for Dinero VAT codes.

### 3.3 Version profiles

`live/odoo/` holds one client and `profiles/v16.ts` (later `v17.ts` …). A profile is data plus small functions:

- field names that changed between versions (examples to confirm when 17 is added: the `sale.order` `done` state removed in 17, the `account.move.reversal` refund modes reworked in 17, Peppol fields on the partner in 17);
- how to create a credit note, confirm an order, register a payment, apply stock;
- capabilities: `webhooks: false` on 16, `true` on 17+.

The connection test reads `common.version()` (`server_version` like `16.0+e`), picks the profile and stores `odooVersion` and `edition` on the connection. Unsupported versions fail the test with a clear message.

### 3.4 Model additions

- New entity `shipment` (Leveringer): `orderRef`, `state`, `doneAt`, `carrier`, `trackingRef`, `trackingUrl`, `lines[] {sku, quantity}`. Source: Odoo `stock.picking`; destination: WooCommerce.
- New entity `invoiceStatus` (Fakturastatus), already planned as the Dinero `salesStatus` output: `orderRef`, `number`, `state` (`draft`/`posted`/`cancel`), `paymentState` (`not_paid`/`partial`/`paid`/`in_payment`/`reversed`), `amountResidual`.
- `Order` gains nothing; the `raw` field already carries everything a developer needs.

---

## 4. Odoo destination module (`odoo` 1.0.0)

### 4.1 Connection and auth

Auth form (`auth.type: 'api_key'`):

| Field | Notes |
|---|---|
| `baseUrl` | `https://<host>`. SSRF guard as for WooCommerce. |
| `database` | Pre-filled from the subdomain on `*.odoo.com` / `*.odoo.sh`. On-premise servers often hide the database list, so we never rely on `db.list`. |
| `login` | The integration user's login (e-mail). |
| `apiKey` | Secret, in the key box (ADR-0002). |

Connection test, in order, each with its own Danish error:
1. `common.version` → profile, edition (`+e`).
2. `common.authenticate` → `uid`. Fails: wrong database, login or key.
3. `res.users.read(uid, ['company_ids', 'company_id', 'groups_id', 'lang', 'tz'])` → company picker.
4. `ir.module.module.search_read([('state','=','installed'), ('name','in', [...])])` for `sale`, `stock`, `account`, `l10n_dk`, `l10n_eu_oss`, `account_edi_ubl_cii`, `delivery`, `sale_stock`. The result shows or hides options in the UI (no stock app → no stock routes).
5. `check_access_rights` (create/write/read) on every model the chosen routes need, so the customer sees "Brugeren mangler adgang til Fakturering" before the first run, not during it.
6. Counts with `search_count` for orders, invoices, partners and products.
7. `fields_get` and lookups cached (§3.1, §3.2).

Recommended integration-user groups are listed in the connect guide: Sales / User: all documents, Invoicing / Billing (or Accountant when payments are registered), Inventory / User when stock is used.

### 4.2 Connection settings (L1)

| Key | Type | Default | Level | Notes |
|---|---|---|---|---|
| `companyId` | select (lookup `companies`) | user's current company | basic | Sent as `allowed_company_ids` on every call |
| `lang` | select | user's `lang` | advanced | Context `lang`, decides translated names in lookups |
| `defaultWarehouseId` | select (lookup `warehouses`) | company's first | basic | Shown when `stock` is installed |
| `webhooks.mode` | select `poll` / `webhook+poll` | `poll` | advanced | `webhook+poll` only on profiles with `webhooks: true` (17+) |
| `poll.minutes` | number | 15 | advanced | Bounded by the plan |
| `batchSize` | number | 50 | advanced | Records per `create` / `search_read` page |
| `concurrency` | number | 1 | advanced | Parallel write calls per connection |
| `rateLimitPerMinute` | number | 120 | advanced | Lowered automatically after repeated timeouts |
| `externalIdModule` | text, read-only | `__agentor__` | advanced | Namespace for our external ids |

### 4.3 Destination options per input port (L2)

**Ordrer** (`order` → Odoo). `posting.type` decides which other options appear (`showIf`):

| Key | Type | Default | Level | What it does |
|---|---|---|---|---|
| `posting.type` | select `saleOrder` / `saleOrderAndInvoice` / `invoice` | `saleOrderAndInvoice` when `sale` is installed, else `invoice` | basic | `saleOrder`: quotation or confirmed order only. `saleOrderAndInvoice`: order, then invoice through `sale.advance.payment.inv` (regular invoice). `invoice`: an `account.move` of type `out_invoice` directly, no sales order |
| `order.confirm` | boolean | true | basic | `action_confirm` after create. Off: stays a quotation (route mode Kladde does the same) |
| `order.invoiceWhen` | select `onConfirm` / `onPaid` / `onDelivered` / `never` | `onPaid` | basic | When the invoice is created in `saleOrderAndInvoice`. `onDelivered` waits for the delivery to be done in Odoo (invoicing policy "delivered quantities") |
| `invoice.post` | boolean | false | basic | `action_post`. Off: draft (Kladde). On: posted (Live). Same meaning as Dinero `invoice.bookAutomatically` |
| `invoice.updateDrafts` | boolean | true | basic | Changes in the shop update a draft invoice or an unconfirmed quotation. A posted invoice is never changed (D5 from the Dinero plan) |
| `invoice.journalId` | select (lookup `journals`, type sale) | company's default sales journal | basic | A separate journal per shop keeps webshop numbering apart |
| `invoice.date` | select `order` / `paid` / `today` | `paid`, falling back to order date | advanced | A date in a locked period (`tax_lock_date`, `period_lock_date`) fails; `lockedPeriod` policy `moveToToday` / `fail` |
| `currency` | select `order` / `company` | `order` | advanced | Odoo converts with its own rates |
| `tax.strategy` | select `shopTax` / `odooFiscalPosition` / `odooProductTaxes` | `shopTax` | basic | `shopTax`: each line gets the Odoo tax mapped from the WooCommerce tax rate (table 2, §4.4); no fiscal position. `odooFiscalPosition`: product taxes, mapped by the fiscal position Odoo would pick (explicit `fiscalPositionId`, or table 3 by sale kind). `odooProductTaxes`: product taxes as they are |
| `tax.verify` | select `warn` / `fail` / `off` | `warn` | advanced | After create, compare `amount_tax` with the shop's VAT. Different → warning `VAT_MISMATCH` or failure |
| `lines.priceBasis` | select `shop` / `exclVat` | `shop` | advanced | `shop`: send the price the way the shop stores it (incl. or excl. VAT) and require mapped taxes with matching `price_include`. `exclVat`: always send net unit prices |
| `rounding.policy` | select `line` / `cashRounding` / `fail` / `ignoreBelow` | `line`, max 1.00 DKK | basic | Read `amount_total` after create. `line`: add a line with the rounding product. `cashRounding`: set `invoice_cash_rounding_id` |
| `rounding.productId` | select (lookup `relation:product.product`) | none | basic (`showIf` policy=line) | |
| `products.match` | select `sku` / `barcode` / `externalId` / `none` | `sku` | basic | `sku` = Odoo `default_code`, `barcode` = EAN. `none`: lines use the generic product |
| `products.missing` | select `create` / `useGeneric` / `fail` | `useGeneric` | basic | `create` makes the product from the WooCommerce line (type from table 4). `fail` → "Kræver handling" |
| `products.genericId` | select (lookup `relation:product.product`) | none | basic | Required when `products.missing` = `useGeneric` or `products.match` = `none` |
| `shipping.productId` | select (lookup) | none | basic | Product for shipping lines. With `delivery` installed: optional `carrier` table instead (table 5) |
| `fees.productId` / `discounts.productId` | select (lookup) | none | basic | Discount mode `perLine` (Odoo `discount` %) or `ownLine` |
| `pricelistId` | select (lookup `pricelists`) | partner's pricelist | advanced | Prices are always sent explicitly, so the pricelist only matters for currency and reports |
| `team.id` / `user.id` | select (lookups) | none | advanced | Sales team and salesperson on orders and invoices |
| `warehouseId` | select (lookup `warehouses`) | connection default | basic (`showIf` posting.type ≠ invoice) | Which warehouse delivers |
| `payment.register` | boolean | true for paid orders (D6) | basic | `account.payment.register` on the posted invoice, journal and payment method from table 1 |
| `payment.differenceHandling` | select `open` / `reconcile` | `open` | advanced | `reconcile` with `writeoffAccountId` books a small difference off |
| `send.email` | boolean | false | basic | Posts the invoice e-mail through `message_post_with_template` *(verify the 16 public method)* |
| `send.eInvoice` | boolean | false | advanced | When the partner has a GLN/EAN and `account_edi_ubl_cii` is installed *(verify the 16 partner fields)* |
| `contact.match` | select `email` / `vat` / `externalId` / `ref` / `none` | `email` | basic | Search order: the chosen key, then the external id |
| `contact.companyMode` | select `companyWithPerson` / `single` | `companyWithPerson` | basic | B2B: company partner (`is_company`, `vat`) with the buyer as child contact, invoice to the company. `single`: one partner |
| `contact.update` | multiselect name, street, zip, city, country, phone, email, vat, lang | all but vat | basic | Fields overwritten on later orders. Odoo validates `vat` (VIES check if enabled), so it is opt-in |
| `contact.shippingAddress` | select `childDelivery` / `none` | `childDelivery` | basic | A `type = 'delivery'` child partner used as `partner_shipping_id` |
| `contact.shared` | select (lookup `relation:res.partner`) | none | basic (`showIf` match=none) | One "Webshopkunde" partner for all B2C orders |
| `writeBack.note` | boolean + template | on | basic | WooCommerce order note `Oprettet i Odoo som {dest.name}` |

**Kreditnotaer** (`creditNote` → Odoo `out_refund`):
- `creditNote.mode`: `reversal` (default for full refunds: `account.move.reversal` on the posted invoice, then edit lines for partial) or `standalone` (an `out_refund` with `reversed_entry_id` = our invoice and only the refunded lines).
- `creditNote.post` (false), `creditNote.registerRefund` (register the payout through `account.payment.register` on the refund, journal from table 1).
- `creditNote.returnStock`: `none` (default) / `returnPicking` *(verify the 16 `stock.return.picking` wizard over RPC)*.
- Header template.

**Kunder** (`customer` → `res.partner`): the `contact.*` keys above, as a standalone route. Upsert through `load()` with the external id when the field set allows it.

**Produkter** (`product` → `product.product`): `product.create` / `product.update` (field multiselect), `product.type` default (`product` storable / `consu` / `service`, also table 4 per category), `product.categoryFrom` (`mapping` / `fixed`), `product.variantsAs` (`variants` with attributes / `separateProducts`; variants are harder and come after simple products).

### 4.4 Mapping tables (L3)

1. **Payment method → journal, payment method line, register?** (source `paymentGateways`; destination `journals` type bank/cash, `paymentMethodLines`). Fallback: a connection-level default journal. Same table drives refunds.
2. **WooCommerce tax rate → Odoo tax** (source `taxRates`; destination `taxes` sale). Pre-filled by matching rate % and `price_include` against the shop's `prices_include_tax`. Rows: Danish 25%, 0% EU B2B (reverse charge), 0% export, foreign OSS rates. Mismatched `price_include` is a validation **error** (it changes totals).
3. **Sale kind → fiscal position** (`odooFiscalPosition` strategy): `domestic`, `euB2b`, `euB2c`, `export` → lookup `fiscalPositions`. Empty = let Odoo auto-detect by partner (auto-apply positions only).
4. **Category → product type, product category, income account** (source `categories`; destination `productCategories`, `accounts`). Supply type (goods/services) as in the Dinero plan.
5. **Shipping method → product or carrier** (source `shippingMethods`; destination `relation:product.product` or `carriers`).
6. **Order status → Odoo action** (advanced): which WooCommerce statuses create, confirm, invoice or cancel. Default: `processing` → confirm, `completed` → invoice if `invoiceWhen` = `onDelivered` and Odoo has no stock, `cancelled` → cancel (§4.7).
7. **Analytic** (advanced): source key (category, shipping country, `order.meta.<alias>`) → `analyticAccounts`, written as `analytic_distribution` (O11).
8. **Field value maps** (advanced, generic): any source value → any Odoo selection or many2one, for custom fields. This is how customers map things we did not foresee without code.

### 4.5 Target fields

Static base (record scope unless noted); everything in `fields_get` with `include: custom` is added under `order.fields.*`, `invoice.fields.*`, `partner.fields.*`, `line.fields.*`.

| Target key | Odoo field | Default template | Editable |
|---|---|---|---|
| `order.externalId` | `ir.model.data` name | `woo_{connection.id}_order_{order.id}` | expression only (idempotency key) |
| `order.clientRef` | `sale.order.client_order_ref` | `{order.number}` | template |
| `order.origin` | `origin` / `invoice_origin` | `WooCommerce {order.number}` | template |
| `order.note` | `note` (html) | `{order.note}` | template |
| `invoice.ref` | `account.move.ref` | `{order.number}` | template |
| `invoice.paymentReference` | `payment_reference` | `{order.number}` | template |
| `invoice.narration` | `narration` (html) | empty | template |
| `line.name` (line) | `name` on order/invoice line | `{line.name}` + ` ({line.sku})` | template |
| `partner.externalId` | `ir.model.data` name | `woo_{connection.id}_customer_{customer.key}` | expression |
| `partner.name` | `name` | `{order.billing.company\|default:order.billing.name}` | template |
| `partner.ref` | `ref` | `{customer.id}` | template |
| `partner.comment` | `comment` | empty | template |
| `payment.memo` | wizard `communication` | `{order.paymentMethod.title} {order.transactionId}` | template |
| `creditNote.ref` | `ref` | `Refusion {refund.id} for ordre {order.number}` | template |

Many2one target fields (custom or standard) are filled by template **into a lookup**: the rendered text is resolved with `name_search` on the relation, and a miss follows the route's `relation.missing` policy (`empty` / `fail`).

### 4.6 Write algorithm (`saleOrderAndInvoice`)

```
ctx = { lang, tz, allowed_company_ids: [companyId], tracking_disable: true? (verify, see §11) }
resolve partner:  externalId → contact.match → create via load() with externalId
resolve products: sku/barcode → products.missing policy
xid = render(order.externalId)
so  = link(route, order) ?? ir.model.data(xid) ?? sale.order.search([client_order_ref = ref, origin = …])
if so confirmed/invoiced and order changed → warn "Ordren er ændret efter bogføring" (D5), stop
if so draft/sent and updateDrafts       → write lines with (5,) + (0,0,{…}) commands
else                                    → create sale.order with order_line commands; create ir.model.data(xid)
verify totals: read amount_untaxed, amount_tax, amount_total → tax.verify, rounding.policy
order.confirm && mode ≠ draft           → action_confirm
invoiceWhen reached                     → sale.advance.payment.inv.create({advance_payment_method:'delivered'},
                                            context active_ids=[so]).create_invoices()
                                          → find the new invoice on so.invoice_ids; write invoice.* targets
mode live && invoice.post               → account.move.action_post
payment.register && paid                → account.payment.register.create({journal_id, payment_method_line_id,
                                            payment_date, communication}, context active_model='account.move',
                                            active_ids=[inv], dont_redirect_to_payments=True).action_create_payments()
send.email / writeBack.note
errors: AccessError/UserError/ValidationError → invalid; timeouts, 5xx, concurrency → transient
```

- `invoice` mode skips the sales order and creates the `account.move` directly (same idempotency, `ref` as the search key).
- The external id is created right after the record. A crash between the two calls is caught by the second lookup (`client_order_ref`/`ref` search), so a record is never created twice.
- Route modes map 1:1: Test (reads only; totals are previewed with `new()`-style onchange *(verify a safe read-only way on 16; otherwise preview from our own computation)*), Kladde (quotation/draft invoice), Live (confirm, invoice, post, pay).

### 4.7 Cancellations and changes

| WooCommerce event | State in Odoo | What happens | Option |
|---|---|---|---|
| Cancelled | quotation | `action_cancel` | `cancel.quotation`: `cancel` / `keep` |
| Cancelled | confirmed, not invoiced, delivery not done | `action_cancel` (Odoo cancels the picking) | `cancel.confirmed`: `cancel` / `warn` |
| Cancelled | delivered or posted invoice | Never automatic. Warning plus a one-click credit note (D5) | `cancel.posted`: `creditNote` / `warn` (default `warn`) |
| Refund | posted invoice | Credit note per §4.3 Kreditnotaer | |
| Refund | no invoice yet | Lines are reduced on the quotation / order before invoicing | `refund.beforeInvoice`: `adjustOrder` / `wait` |

Echo suppression and the gateway-refund guards from the Dinero plan §4.7 C apply unchanged when the return flow (Odoo credit note → WooCommerce refund) is built in P4.

---

## 5. Odoo source module

### 5.1 Output ports

| Port | Odoo model | Trigger | Notes |
|---|---|---|---|
| `stock` (Lager) | `product.product` `free_qty` / `qty_available` with context `warehouse` or `location`, or `stock.quant` | poll 5 min (min) | Only products whose quants changed: `stock.quant.search_read([('write_date','>=',cursor), …])` → product ids → quantities |
| `shipment` (Leveringer) | `stock.picking` outgoing, `state = 'done'` | poll | `carrier_tracking_ref`, `carrier_id`, `date_done`, origin → order |
| `invoiceStatus` (Fakturastatus) | `account.move` out_invoice/out_refund | poll | `state`, `payment_state`, `amount_residual`, `name` |
| `customer` (Kontakter) | `res.partner` | poll | For Odoo → anything (CRM, newsletter) later |
| `product` (Produkter) | `product.product` | poll | For Odoo → WooCommerce catalogue later (§10) |
| `order` (Salgsordrer) | `sale.order` | poll | For Odoo → anything; not used in this pairing |

### 5.2 Source options (L2)

**Lager**: `stock.quantity` (`free_qty` default = on hand minus reserved / `qty_available` / `virtual_available` forecast), `stock.scope` (`warehouse` / `location`, lookups), `stock.onlyStorable` (true), `stock.match` (`sku` / `barcode`), `stock.safetyBuffer` (number, subtracted, default 0), `stock.neverNegative` (true).

**Leveringer**: `shipment.pickingTypes` (multiselect lookup, default outgoing types of the warehouse), `shipment.onlyOurs` (true: only pickings whose order has our external id), `shipment.partial` (`each` / `whenComplete`).

**Fakturastatus**: `invoice.onlyOurs` (true), `invoice.events` (multiselect `posted`, `paid`, `cancelled`, `reversed`).

**All ports**: `domain` (advanced, developer): an extra Odoo domain in JSON, validated with a `search_count` before save, so a developer can filter anything (`[["x_studio_channel","=","web"]]`).

### 5.3 Variables

Static base, plus `fields_get` on the port's model (`include: custom` in Basic, `all` in Avanceret):

`odoo.picking.{name, origin, dateDone, carrier, trackingRef, trackingUrl} · odoo.invoice.{name, state, paymentState, amountTotal, amountResidual, invoiceDate, dueDate} · odoo.product.{defaultCode, barcode, name, freeQty, qtyAvailable, listPrice} · odoo.partner.{name, ref, vat, email} · odoo.<model>.fields.<x_field> · raw.*`

Many2one values are exposed as `{id, name}` so templates read `{odoo.picking.carrier.name}`.

### 5.4 Change detection

- **Poll** every `poll.minutes`: `search_read([('write_date', '>=', cursor - 2 min)] + domain, fields, order='write_date asc, id asc', limit=batchSize)`, paging with `offset` until fewer than `batchSize` rows. The cursor is the last row's `write_date` (server time, UTC).
- Stock: `free_qty` is computed, not stored, so changes are found through `stock.quant.write_date` and `stock.move` done since the cursor *(verify that reservations touch the quant's `write_date` on 16)*.
- **17+ webhooks** (profile capability, P5): the adapter creates a `base.automation` (trigger `on_create_or_write`, filter domain) with a server action of type `webhook` pointing at `https://ingest.agentor.dk/odoo/<connectionId>/<secret>`. Odoo's webhook body has no signature, so the secret is in the URL and every hint is re-read over the API. Auto-heal checks the automation still exists on each poll.

### 5.5 Write-backs on WooCommerce (new inputs)

| WooCommerce input | Write | Options |
|---|---|---|
| `stock` (exists) | `POST /products/batch` as built in P1 | `stock.match`, `stock.onlyManaged`, `stock.neverNegative` |
| `shipment` (NEW) | `PUT /orders/{id} {status}` + `POST /orders/{id}/notes` with tracking | `shipment.status` (`completed` default), `shipment.noteTemplate` `Afsendt med {odoo.picking.carrier.name}: {odoo.picking.trackingRef}`, `shipment.customerNote` (true: the customer gets WooCommerce's note e-mail), `shipment.trackingMeta` (advanced: write the tracking number into a meta key a tracking plugin reads, e.g. `_wc_shipment_tracking_items` *(verify per plugin)*) |
| `orderStatus` (planned) | status + note | `status.map` table (Odoo event → WooCommerce status), `status.notifyCustomer` (false) |

---

## 6. UI

Generated as for Dinero, plus:
- **Connect step** for Odoo: URL, database, login, API key, with the test steps in §4.1 shown as a checklist (version, login, company, apps, access rights).
- **Fields tab**: the dynamic catalogue shows custom fields with an "Odoo-felt" badge and the technical name in Avanceret.
- **Mapping tab**: tax table with `%` and "inkl./ekskl. moms" badges; payment-method table with journals; sale-kind → fiscal position table.
- **Template**: "WooCommerce → Odoo (salg og bogføring)" pre-wires Ordrer → Salgsordrer, Kreditnotaer → Kreditnotaer, Kunder → Kontakter; and "Odoo → WooCommerce (lager og levering)" pre-wires Lager → Lager and Leveringer → Leveringer. Both open the guide at Moms.

---

## 7. Phases

| Phase | Content | Done when |
|---|---|---|
| **P0 Framework** | Dynamic catalogues, `relation:<model>` lookups, `LookupOption.meta`, `shipment` and `invoiceStatus` entities, version-profile shape | Existing tests pass; unit tests for the `fields_get` → catalogue mapping |
| **P1 Odoo client (read)** | JSON-RPC client on `live/http.ts`, auth, version profile 16, connection test (§4.1), lookups, `fields_get` cache, counts, polling for `stock`, `shipment`, `invoiceStatus` | Contract tests on fixtures recorded from the test database; a CI job against `odoo:16` (Community image with `sale_management`, `stock`, `account`, `l10n_dk`) |
| **P2 Odoo writes** | Partners (`load` upsert), products (match/create), sales orders, invoices (both modes), totals check and rounding, payments, credit notes, cancellations, error mapping | Every §8 case passes against the test database in Kladde, then Live |
| **P3 WooCommerce additions + UI** | `shipment` input on WooCommerce, tax/payment/fiscal-position tables, Odoo connect step, both templates | Playwright e2e for setup on mocks; one full round trip on the test systems: order → Odoo invoice → delivery done → WooCommerce completed with tracking |
| **P4 Return flow** | Odoo credit note → WooCommerce note/refund with the Dinero plan's guards | As Dinero §4.7 C |
| **P5 Odoo 17–19 profiles** | Profiles, native webhooks, Peppol partner fields | Same contract suite green on 17, 18, 19 |

P0 is small. P1 can start right away; P2 follows P1. P3's WooCommerce part can run in parallel with P2.

---

## 8. Test matrix (on the user's test WooCommerce + Odoo 16e)

- **Sale kinds**: domestic B2C/B2B, EU B2B with VAT number (goods and services), EU B2C under and over the OSS threshold (with the OSS fiscal positions on), export.
- **Prices**: shop incl. and excl. VAT × Odoo taxes with and without `price_include`; rounding per line vs globally; coupons; fees; several shipping lines.
- **Products**: SKU match, barcode match, missing product (each policy), variable products, service products, bundles.
- **Flows**: quotation only, confirm, invoice on paid, invoice on delivered, posted + paid, payment differences.
- **Refunds and cancellations**: full, partial, shipping only, before invoice, after posting, cancelled before and after delivery.
- **Stock and delivery**: reservation changes, partial deliveries, multi-warehouse scope, tracking number write-back.
- **Failures**: locked period, missing access rights, deleted Studio field, archived product/partner, invalid VAT number, concurrent write retry, timeout on a long `action_post`, multi-company with the wrong company.

The test credentials go in `.env.local` (git-ignored), never in the repo or the chat:

```
ODOO_TEST_URL=https://odoo.example.dk
ODOO_TEST_DB=
ODOO_TEST_LOGIN=
ODOO_TEST_API_KEY=
ODOO_TEST_COMPANY_ID=
WOO_TEST_URL=https://shop.example.dk
WOO_TEST_CONSUMER_KEY=
WOO_TEST_CONSUMER_SECRET=
```

The live-test suites skip themselves when these are empty, so CI and other developers are not affected.

---

## 9. Decisions needed

| # | Question | My recommendation |
|---|---|---|
| OD1 | ~~Default `posting.type`: sales order + invoice, or invoice only?~~ | **Resolved 25 Oct: sales order + invoice** when the `sale` app is installed. It keeps deliveries, stock reservation and Odoo's normal reporting. Invoice-only for accounting-only databases. |
| OD2 | ~~Tax strategy default (O8)~~ | **Resolved 25 Oct: `shopTax`**, consistent with D3: book exactly what the shop charged, mapped to Odoo taxes. `odooFiscalPosition` for merchants whose accountant wants Odoo to decide (for example OSS handled in Odoo). |
| OD3 | ~~Who owns stock when Odoo has Inventory?~~ | **Resolved 25 Oct: Odoo**: the Odoo → WooCommerce stock route is on in the template, and WooCommerce stock writes from other sources are blocked for that shop to avoid two owners. |
| OD4 | ~~Change detection on 16~~ | **Resolved 25 Oct: polling only.** No Odoo-side module. A small optional `agentor_connector` Odoo module could push webhooks on 16, but it means install, review and upgrades per customer for a version that is out of support. |
| OD5 | ~~Scope of versions~~ | **Resolved 25 Oct: design for 16–19, build and test 16 first**, because that is the test system. 17 next (support ends September 2026, so most new customers will be on 18/19). |
| OD6 | ~~Order number in Odoo~~ | **Resolved 25 Oct: Odoo's own sequence**, with the WooCommerce number in `client_order_ref` and `ref`. A shop-numbered journal is possible with `invoice.journalId`. |
| OD7 | ~~Where does the test Odoo 16e run?~~ | **Resolved 25 Oct: self-hosted Enterprise on the user's own server.** The Odoo Online plan limit (O4) does not apply. See §9.1 for what self-hosting changes. The integration user gets the groups in §4.1, including Accountant for the payment and credit-note tests. |

### 9.1 Self-hosted Odoo: consequences

- **Reachability**: the worker calls Odoo from our servers, so Odoo must be reachable over public HTTPS. Private IPs, `localhost` and plain HTTP are blocked by the SSRF guard, the same as for WooCommerce. Customers behind a firewall allowlist our outbound IPs, and the connect guide lists them.
- **Database selection**: self-hosted servers often run with `dbfilter` and `list_db = False`. The database name is always typed in, never discovered. A wrong name gives its own error in the connection test.
- **Reverse proxy and timeouts**: nginx/Apache in front of Odoo may cut long requests (e.g. 60 s) before Odoo's own `limit_time_real`. The connection test records the server's response times, and slow calls (`action_post`, `action_confirm`) run in small batches. A timeout is `transient`, and the record is looked up again before any retry (§4.6).
- **Workers**: a server with `workers = 0` (threaded mode) handles calls one at a time. The default `concurrency` of 1 respects that.
- **Modules and versions vary per server**: installed apps, the 16.0 patch level and third-party modules are read at every connection test (§4.1 step 4). They are shown on the connection page, and changes are recorded in Aktivitet.
- **Custom code** on the server (overridden `create`/`write`, extra required fields) is more likely than on Odoo Online. Odoo's error text is shown as is (§11).

---

## 10. Out of scope here

- Odoo → WooCommerce product catalogue (names, prices, images, variants). A later module; the `product` output port exists for it.
- Odoo purchase, manufacturing, POS, subscriptions, eCommerce (Odoo's own webshop).
- Multi-currency price lists and multi-company routing in one flow.
- Lots and serial numbers in stock sync.
- Odoo-side custom module (see OD4).

## 11. Risks

- **Odoo 16 is past standard support (O1)**: bugs in Odoo itself will not be fixed for free. Keep the adapter version-aware so customers can upgrade without a rewrite.
- **Customised databases**: Studio fields, required custom fields and automated actions can make creates fail in ways we can't predict. Mitigation: required custom fields are read from `fields_get` and must have a template or default before publish; Odoo's error text is shown as is.
- **Customer-side automations fire on our writes** (e-mails, activities, their own server actions). `tracking_disable` in the context would quiet chatter but also hides the audit trail; default off, an advanced option.
- **Long-running calls** (`action_post` on big invoices, confirm with many reservations) can hit `limit_time_real` on Odoo.sh. Mitigation: small batches, timeout = `transient`, and the idempotent re-lookup before any retry.
- **Tax configuration mistakes** are the most likely source of wrong books. Mitigation: the `price_include` check is an error, `tax.verify` defaults to `warn`, and Kladde is the go-live default.

## 12. Sources

- Odoo 16 External API: https://www.odoo.com/documentation/16.0/developer/reference/external_api.html
- Odoo support policy: https://www.odoo.com/documentation/19.0/administration/standard_extended_support.html
- EU distance selling (OSS) in Odoo 16: https://www.odoo.com/documentation/16.0/applications/finance/accounting/taxes/eu_distance_selling.html
- Source, 16.0: `odoo/service/model.py` (private methods, concurrency retries), `odoo/models.py` (`load`), `addons/base_automation/models/base_automation.py` (no webhook trigger), `addons/account/wizard/account_payment_register.py`, `addons/account/models/partner.py` (fiscal positions), `addons/sale/wizard/sale_make_invoice_advance.py`, `addons/stock/models/stock_quant.py` — https://github.com/odoo/odoo/tree/16.0
- Source, 17.0: `addons/base_automation/models/base_automation.py` (`on_webhook`), `odoo/addons/base/models/ir_actions.py` (`webhook` server action) — https://github.com/odoo/odoo/tree/17.0
