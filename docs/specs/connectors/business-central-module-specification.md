# Dynamics 365 Business Central Integration Module — Specification

**Status of prior deliverables:** WooCommerce, Shopify, Magento 2, PrestaShop, Dinero, and e-conomic Integration Module Specifications — finalized, ready for handover.

**Roadmap status:** This is a **later-tier ERP spec**, prepared ahead of build per your direction. Tier 1 ERP targets remain Dinero and e-conomic; this document doesn't change that sequence.

**Role for this document:** integration engineer, solution architect, and finance specialist.

**This document:** Target-side (ERP) module specification for Dynamics 365 Business Central — API approach, document posting model, VAT/dimension handling, and field-level write requirements. Follows the same structure as the Dinero and e-conomic specs.

---

## 1. API approach & authentication — the biggest structural difference from Dinero/e-conomic

Business Central is a fundamentally different integration profile from either Nordic ERP already specified, in two important ways:

- **Auth model**: Microsoft Entra ID (Azure AD) OAuth 2.0 — requires an **app registration in the merchant's own Entra tenant**, a client secret or certificate, and **admin consent** granted by the merchant's IT administrator. This is meaningfully heavier onboarding than Dinero's OAuth-via-Visma-Connect or e-conomic's two-token grant flow — it's an enterprise-grade auth model, not a simple "generate an API key" step. **The connection wizard needs a distinctly different, more guided flow for this connector** — likely involving the merchant looping in an IT admin, not something the business owner completes solo in five minutes the way the e-commerce connectors are designed to work.
- **Native multi-company support**: a single Business Central environment can contain multiple companies. The connection flow needs an explicit **company selection step** (`companies({companyId})` is part of every API path) — this doesn't exist as a concept for Dinero or e-conomic, which are single-company-per-agreement by nature. Flag clearly in onboarding: which company within the tenant should this integration post to.

**API surface**: OData v4 REST, API v2.0 (the stable, Microsoft-maintained standard API — not the Beta API, which is pre-release and unsuitable for production). Covers roughly 55 standard entities including customers, items, sales invoices, sales credit memos, and G/L accounts — broader native coverage than either Dinero or e-conomic.

**Rate limits**: per-user (not per-environment) — 6,000 requests per user per 5-minute window, 600 req/min in production, 300 req/min in sandbox. Since limits are per-user/per-service-principal, a merchant with heavy sync volume can be given a dedicated service principal without contending with their own staff's interactive usage — worth designing the connection to use a dedicated integration user/service principal by default, not a shared one.

---

## 2. Document posting model

Business Central's sales documents follow a native, purpose-built lifecycle that's an excellent match for the platform's three-mode sync model — arguably the cleanest of all three ERPs evaluated:

1. **Create** a `salesInvoices` (or `salesCreditMemos`) entity via POST — this creates the document in an editable, unposted state (Business Central's own document status concept — comparable to e-conomic's "draft" and functionally equivalent for this platform's purposes).
2. **Post** the document via an explicit posting action on the entity, which converts it into a finalized, immutable posted invoice and generates the corresponding G/L entries.

**Maps directly onto the three sync modes:**

- **Dry-run** → no API call, local simulation
- **Draft sync** → create the unposted document only, leaving it for a bookkeeper to review and post inside Business Central's own interface
- **Live sync** → create and immediately invoke the posting action

**Note for implementation**: the exact posting action name/endpoint should be confirmed directly against the current v2.0 API reference at build time rather than assumed here — Microsoft's API surface for bound actions has had naming variations across versions, and this is worth pinning precisely rather than guessing.

**This resolves the sync-execution-modes dependency for Business Central with the same confidence level as e-conomic** — the draft/post distinction is a first-class, explicit part of how Business Central's document model works, not an inferred behavior.

---

## 3. Entity coverage (target-side)

| Entity | Business Central target | Write pattern | Notes |
|---|---|---|---|
| Sales invoices | `salesInvoices` | Create unposted, optionally post | Primary posting mechanism — see §2 |
| Credit memos | `salesCreditMemos` | Create unposted, optionally post | Mirrors refund line items |
| Customers | `customers` | Create/update, matched by email or external reference | |
| Items (products) | `items` | Optional — only needed if invoice lines reference BC items rather than G/L accounts directly | |
| G/L accounts | Read-only reference for mapping setup | Used to populate the account-mapping dropdown (§4) | |
| Dimensions | Dimension/DimensionValue entities | Optional, see §5 | BC-specific categorization mechanism, genuinely useful here |

---

## 4. How this module consumes the account mapping

Same principle established across all ERP-side specs: this module doesn't define its own mapping UI, it consumes the resolution already made on the e-commerce source side. Business Central's sales invoice lines can post against either an **Item** (with its own default G/L posting behind it) or a **G/L Account line type directly** — this is actually closer to Dinero's direct-account-line flexibility than to e-conomic's product-mediated posting, which simplifies the mapping translation here.

---

## 5. VAT handling — and a genuinely useful BC-specific feature

Business Central resolves VAT through **VAT Posting Groups** (a combination of the customer's VAT business posting group and the item/G/L account's VAT product posting group, which together determine the applicable VAT rate) — a more structured, matrix-based approach than either Dinero's per-line code or e-conomic's zone model.

**Module behavior**: same three-level override concept carried through, translated to BC's terms — the merchant maps "VAT applies / exempt" resolution to the appropriate **VAT Business Posting Group** on the customer side and **VAT Product Posting Group** on the line side, letting Business Central's own matrix resolve the actual rate. Same conflict-flagging principle as the other ERP specs applies.

**A genuinely valuable BC-specific feature worth calling out**: Business Central natively supports **Dimensions** — a tagging mechanism (e.g., "Department," "Channel," "Project") that can be attached to any G/L line independent of which account it posts to. This offers an elegant alternative to the "one account per category" mapping pattern used elsewhere: a merchant could use **fewer G/L accounts** and instead tag each posted line with a Dimension value representing the WooCommerce/Shopify category or activity type. This achieves the same "automated finance based on activity type" goal from the original requirement, but through BC's native reporting mechanism rather than proliferating G/L accounts — worth offering as a configuration choice specifically for this connector (Category → Account **or** Category → Dimension value, merchant's choice) when this tier is built, since it's a genuine BC-native capability the other two ERPs don't have an equivalent for.

---

## 6. Customer/contact matching

Same principle as Dinero and e-conomic: match by email, consistent with the pattern established across all e-commerce specs.

---

## 7. Value-add features worth including

| Feature | Value proposition |
|---|---|
| **Dimension-based categorization option** | Per §5 — a BC-specific alternative to account-per-category mapping, worth surfacing as a real choice at setup |
| **Dedicated service principal per integration** | Per §1 — avoids rate-limit contention with the merchant's own interactive BC users, and gives clean audit-trail attribution (postings clearly show as coming from "the integration," not a named employee) |
| **Order reference in external document number field** | BC sales documents support an external document number field — use this to carry the source order number, same reconciliation pattern as Dinero/e-conomic |
| **Native webhooks** | BC supports outbound webhook subscriptions (POST/PATCH with validation handshake) — same status-visibility opportunity flagged for e-conomic: reflect back when a bookkeeper posts a draft invoice inside BC itself |
| **Multi-company awareness in the dashboard** | Since one BC connection is scoped to one company (§1), the integration detail page should clearly label which company an integration posts to, especially relevant for merchants who might have multiple legal entities in one BC tenant |

---

## 8. Field-level write requirements (unposted sales invoice)

| Field | Required / Optional | Source |
|---|---|---|
| Posting date / order date | Required | Order date |
| Customer reference | Required | Matched customer (§6) |
| Currency code | Required | Order currency |
| Sales invoice lines (item/account, quantity, unit price) | Required | Resolved mapping + order line items |
| VAT Business/Product Posting Group resolution | Required | Resolved VAT mapping (§5) |
| Dimension value (if Dimension-based mapping chosen) | Conditional | Only if merchant selects Dimension mode over Account mode (§5) |
| External document number | Optional | Recommended default: on — carries source order number (§7) |
| Payment terms | Optional | Merchant-configured default if not derivable from order |

---

## 9. Explicitly out of scope for this later-tier spec

| Feature | Why deferred |
|---|---|
| Beta API usage | Production integrations must use the stable v2.0 API only |
| Custom API pages (AL-based custom entities) | Only relevant for bespoke merchant extensions — no place in a generic connector manifest |
| On-premises Business Central | This spec assumes Business Central Online (SaaS); on-prem has a different endpoint/auth model entirely and would need its own evaluation if ever required |
| Multi-company sync from a single integration instance | One integration = one company, per §1; syncing multiple companies from one Business Central tenant means the merchant configures multiple integration instances, not a single instance with multi-company logic |

---

## 10. Open questions for you to confirm (when this tier is prioritized)

1. **Onboarding model for the heavier Entra ID auth flow** (§1) — confirm whether the integration wizard should assume the business owner has IT support to complete Entra app registration, or whether a more guided/white-glove setup process is needed specifically for this connector, given it doesn't fit the "five-minute self-serve" pattern the other connectors are designed around.
2. **Account mapping vs. Dimension mapping** (§5) — confirm whether offering both as a merchant choice is worth the added setup complexity, or whether defaulting to Account-based mapping (consistent with every other connector) is preferable for consistency, with Dimensions as a documented advanced option only.
3. **Posting action confirmation** — needs direct verification against the current v2.0 API reference at build time (§2), not assumed from this spec.

---

*This completes the current round of ERP-side specs. With Dinero, e-conomic, and Business Central all documented, the connector manifest pattern (source entity coverage + target posting model, joined by the shared account-mapping/VAT-override/sync-execution-mode design) should now be consistent and provable across all seven modules specified so far.*
