# Dinero Integration Module — Specification

**Status of prior deliverables:** WooCommerce, Shopify, Magento 2, and PrestaShop Integration Module Specifications — finalized, ready for handover.

**Role for this document:** integration engineer, solution architect, and finance specialist — this spec evaluates not just API mechanics but what's actually required for correct, auditable bookkeeping.

**Note on `dinero.md`:** not yet received. This document is grounded in Dinero's public API documentation and developer guidance. Once `dinero.md` arrives, I'll cross-check it against this spec and flag any gaps or corrections.

**This document:** Target-side (ERP) module specification for Dinero — API approach, document posting model, how it consumes the account mapping already designed on the e-commerce side, VAT handling, and field-level write requirements.

---

## 1. API approach & authentication

- **Auth**: OAuth 2.0 via Visma Connect — different auth mechanism from e-conomic (see that spec), worth flagging clearly in the connection wizard since merchants/developers may otherwise expect uniform auth across ERP targets.
- **API surface**: REST, JSON. Covers contacts, invoices, purchase vouchers, manual vouchers, entries (postings), products, and file attachments.
- **Rate limiting**: actively enforced (Dinero's own changelog confirms this was tightened) — the sync engine's existing rate-limit handling (already part of the platform's entitlement/rate-limit design) applies here without modification.

---

## 2. Document posting model — the central finance decision

Dinero offers two distinct ways to post a sale, and **which one this module uses is the single most important design decision in this spec** — it determines how well the "map to specific accounting lines" requirement is actually satisfied.

### 2.1 Option A — Dinero Invoice entity

Creates a formal invoice document inside Dinero, tied to a contact, with line items (optionally referencing Dinero's own product catalog). Dinero generates the invoice number and document.

**Problem for this platform's use case**: the e-commerce order already has a real invoice/order confirmation from WooCommerce/Shopify. Creating a second, separate invoice document inside Dinero for the same sale is redundant and can confuse the merchant's own records (two invoice numbers for one sale, one customer-facing from the webshop, one from Dinero).

### 2.2 Option B — Manual Voucher (recommended)

A manual voucher posts **accounting entries directly** — account-coded lines (account number, amount, VAT code, description) — without generating a second customer-facing invoice. This is the mechanism Dinero itself recommends for exactly this scenario: *"Does your integration book daily sales, then it would probably make sense to create a manual voucher."*

**This is the better fit for the stated requirement.** The category/product → account-line mapping model already designed on the e-commerce side (WooCommerce/Shopify/Magento/PrestaShop specs, §4) maps directly onto manual voucher lines: each order line item, already resolved to a specific account number via the mapping hierarchy, becomes one voucher line. This satisfies "custom mapping to specific line numbers in the accounting" and "automated finance based on activity type" precisely as specified — Dinero doesn't need to know about products or categories at all; it just receives already-resolved account-coded lines.

**Recommendation**: build this module around **Manual Vouchers as the primary posting mechanism**, with the original order (as a PDF or structured reference) attached to the voucher for audit trail. Offer Invoice-entity posting as a secondary, optional mode only for merchants who specifically want Dinero to be the system of record for invoice documents/numbering — flagged as a distinct configuration choice, not the default.

### 2.3 Draft vs. booked — confirms the sync execution modes dependency

This directly resolves the open dependency flagged in every e-commerce connector spec (§7.1 of each): **Dinero does support a draft state before final booking.** Entries/vouchers can be created and left unbooked, pending manual review and approval inside Dinero's own interface, or booked immediately. This maps exactly onto the platform's three-mode sync model:

- **Dry-run** → no API call at all, pure local simulation
- **Draft sync** → create the manual voucher, leave it unbooked
- **Live sync** → create and immediately book the voucher

**To verify before implementation**: confirm this behavior applies identically to Manual Vouchers specifically (not just generically to "entries"), via Dinero's current Postman collection/API reference rather than the secondary sources this spec was grounded in — the mechanism is well-attested but the exact request parameter controlling draft-vs-book state should be pinned down precisely during build.

---

## 3. Entity coverage (target-side)

| Entity | Dinero target | Write pattern | Notes |
|---|---|---|---|
| Sales postings | Manual Voucher (primary) or Invoice (optional mode) | Create, draft or booked | See §2 |
| Credit notes / refunds | Manual Voucher (reversing entry) or Invoice credit note | Create, draft or booked | Mirrors the original posting's line-item structure |
| Contacts (customers) | Contacts API | Create/update, matched by email or contact reference | Contacts are shared debitor/creditor list — no separate "customer" entity |
| Products | Products API | Optional — only relevant if using Invoice-entity mode (§2.1) | Not needed for the recommended Manual Voucher approach |
| Files | Files API | Attach source order (PDF/reference) to the voucher | Supports the audit-trail requirement |

---

## 4. How this module consumes the account mapping

This module does **not** define its own mapping UI — it consumes the mapping already resolved on the source connector side (WooCommerce/Shopify/Magento/PrestaShop specs, §4: category → product override → fallback account, resolved to specific Dinero account numbers by the merchant during setup). The Dinero-side setup step is simply: **which Dinero account numbers exist and are selectable** as mapping targets, pulled from Dinero's chart of accounts, so the merchant picks from real account names/numbers rather than typing raw codes — consistent with the "pick from a dropdown of real accounts" UX principle established in the original SaaS architecture plan.

---

## 5. VAT / tax code handling

Dinero vouchers carry a **VAT code per account line** (`accountVatCode`), not a free-form tax rate — this is a real difference from the e-commerce side's percentage-based tax lines and needs an explicit translation step:

- The three-level VAT override already resolved on the e-commerce side (store default → category → product, per each connector spec §5) needs to map to **one of Dinero's defined VAT codes** (e.g., standard-rate, VAT-exempt/no-VAT codes) rather than a raw percentage.
- **Setup requirement**: at connection time, pull Dinero's available VAT codes for the merchant's account and let them map "VAT applies" / "VAT exempt" (and any finer distinctions the merchant's VAT setup requires) to specific Dinero VAT codes — a small, one-time mapping step, not per-transaction.
- Same conflict-flagging principle as the e-commerce specs: if the resolved VAT code and the order's actual tax amount don't reconcile, flag for review rather than posting silently.

---

## 6. Customer/contact matching

- Match by email (consistent with the guest-checkout matching pattern established across all four e-commerce specs) or, if unavailable, by a stored external reference ID.
- A contact only becomes a "debitor" in Dinero once a sale is posted against them — this happens naturally as a side effect of the first voucher/invoice, no separate "activate as customer" step needed.

---

## 7. Value-add features worth including

| Feature | Value proposition |
|---|---|
| **Order reference in voucher description/external reference** | Since Dinero's invoice API has no dedicated invoice-number field (confirmed limitation per Dinero's own integration partners), the source order number should go into the voucher's description or external-reference field so merchants can trace a Dinero entry back to its originating WooCommerce/Shopify/Magento/PrestaShop order |
| **PDF/order attachment for audit trail** | Attach the original order confirmation as a file on the manual voucher — satisfies bookkeeping audit-trail expectations without requiring Dinero to generate a duplicate invoice |
| **Draft-first default for new integrations** | Recommend defaulting new Dinero connections to draft-sync mode for the first sync cycle (per §2.3), so the merchant's bookkeeper reviews the very first batch of postings before switching to live sync — a good safety net given accounting errors are costly to unwind |
| **Currency assumption check** | Dinero has historically not supported multi-currency invoicing per third-party integration documentation — this needs direct verification against current Dinero capabilities before assuming DKK-only, since it affects any merchant selling in EUR/SEK/NOK who wants to use Dinero |

---

## 8. Field-level write requirements (Manual Voucher mode)

| Field | Required / Optional | Source |
|---|---|---|
| Voucher date | Required | Order date |
| Account number (per line) | Required | Resolved account mapping (§4) |
| Amount (per line) | Required | Order line total (net or gross, per VAT resolution) |
| VAT code (per line) | Required | Resolved VAT mapping (§5) |
| Description (per line) | Required | Product/category name + order reference |
| Contact reference | Required | Matched contact (§6) |
| Balancing account | Required | Merchant-configured default (e.g., bank/payment clearing account) |
| Attached file (order PDF/reference) | Optional | Recommended default: on |
| External reference | Optional | Recommended default: on — carries the source order number (§7) |

---

## 9. Explicitly out of scope for MVP-equivalent (Dinero module)

| Feature | Why deferred |
|---|---|
| Invoice-entity posting mode (§2.1) | Secondary/optional mode, not default — build after the primary Manual Voucher path is proven |
| Multi-currency posting | Pending direct verification of current Dinero capability (§7) |
| Payment reconciliation / marking vouchers as paid via API | Not requested as part of this platform's scope, and payment status lives with QuickPay/the ERP's own bank reconciliation, not this sync module |

---

## 10. Open questions for you to confirm

1. **Manual Voucher vs. Invoice-entity as primary mode** — confirm the Manual Voucher approach (§2.2) matches your intent, given it best satisfies the account-line mapping requirement without creating duplicate customer-facing invoices.
2. **Draft-first default** — confirm whether new Dinero integrations should default to draft-sync mode for an initial review period (§7), or start in live mode with the merchant opting into draft manually.
3. **Multi-currency** — flag if any known Tier 1/2 merchants need non-DKK invoicing through Dinero, since this needs direct verification and may be a real constraint.
4. **`dinero.md` cross-check** — once available, will be checked against this entire spec, particularly §8's field list.

---

*Next suggested step: e-conomic module spec, which has a notably different auth model and a more explicit, better-documented draft/book API — worth reading immediately after this one while the comparison is fresh.*
