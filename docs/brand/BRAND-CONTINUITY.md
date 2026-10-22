# Agentor — Brand Continuity Guide

The **single source of truth** for every new page. `Home.html` + the `tokens/` design system define the brand. Do **not** redesign, modernize, or reinterpret. Every new page must look like the same designer built it on the same day. All values below are extracted verbatim from the live source.

> Always link the system first: `<link rel="stylesheet" href="styles.css">` (adjust relative depth). Load Lucide once: `<script src="https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js"></script>` and call `lucide.createIcons()` after the DOM. Font is **Plus Jakarta Sans** (loaded by the tokens).

---

## 1. Visual language (non-negotiable rules)
- Pure **white** page canvas (`#fff`). The warm `--color-bg-base #F0EDE8` is only a desk/inset backdrop, not the page.
- Exactly **three surface families**: white cards, **lime** panels (`--color-primary` / `--color-primary-bright`), **navy** blocks (`--color-secondary-navy`). No other backgrounds. No gradients. No textures.
- Everything interactive is a **full pill** (`--radius-full`) or a soft-rounded card. No sharp corners on UI.
- Shadows are soft and rare: `--shadow-card: 0 8px 32px rgba(0,0,0,0.10)`, `--shadow-sm: 0 2px 12px rgba(0,0,0,0.06)`. Depth = layered white cards, never heavy shadow.
- Photography is full-bleed inside rounded frames, cropped with `background-size: cover` / tuned `background-position`. Dark photos → white text; light photos → dark text.
- Icons are **Lucide** stroke icons only. Default 24px, small 18px. Never emoji, never hand-drawn SVG.

## 2. Color hierarchy (exact hex)
| Token | Value | Use |
|---|---|---|
| `--color-primary` | `#D0E84A` | CTAs, active chips, stat cards, progress, phone frame |
| `--color-primary-bright` | `#DCEE55` | large lime panel fills |
| `--color-dark` / `--color-fg-1` | `#1A1A18` | headings, logo, strong text, underlines |
| `--color-fg-2` | `#6B6B67` | body copy, nav links (resting) |
| `--color-fg-3` | `#9B9B97` | eyebrows, muted meta |
| `--color-secondary-navy` | `#13293A` | CTA band / dark sections |
| `--color-on-navy` / muted | `#FFFFFF` / `rgba(255,255,255,0.78)` | text on navy |
| `--color-border` | `#E4E1DB` | hairline dividers, progress track |
| `--color-border-strong` | `#C8C5BF` | secondary button ring, chip outline |
| on-lime text | `#1A1A18` (`rgba(26,26,24,.7/.55/.4)` for muted) | text on lime |

## 3. Typography hierarchy
Family `--font-sans` (Plus Jakarta Sans). Weights: 400/500/600/700/800.
| Role | Size | Weight | Line-height | Tracking | Color |
|---|---|---|---|---|---|
| Hero H1 | 72px | **500** | 1.04 | −0.02em | #fff on photo |
| Display heading (section/CTA) | 36–44px | **500** (`--text-display-weight`) | 1.2–1.28 | −0.01em | fg-1 / on-navy |
| Card heading (lime panel h3) | 40px | **700** | 1.15 | −0.02em | dark |
| Eyebrow label | 14px | 500 | — | +0.08em, UPPERCASE | fg-3 |
| Body / hero p | 15–18px | 400 | 1.5–1.6 | 0 | fg-2 / rgba white |
| Stat number | 60px | 700 | 1 | −0.03em | dark (unit 24px, `rgba(26,26,24,.4)`) |
| Button / CTA label | 12–13px | 700 | — | +0.10em, UPPERCASE | per variant |
| Nav link | 15px | 500 | — | 0 | fg-2 → dark |

**Rule:** big display headlines are Medium 500; only the lime-panel card heading is Bold 700. Never bold the hero or CTA headline.

## 4. Layout proportions
- Page wrapper: `.page { max-width: 1600px; margin: 0 auto; padding: 0 40px; }` — fluid, capped at 1600, 40px gutters.
- Header height **88px**, flex space-between (logo · centered links · right CTA).
- Hero: **620px** tall, `--radius-xl` (28px), full-width, `margin-top: 8px`.
- Feature split: `grid-template-columns: 1fr 1fr; gap: 24px; height: 620px`.
- App preview: `grid-template-columns: 1fr auto 1fr; gap: 56px; align-items: center`.
- Vertical rhythm between sections: **96px** (`.section`), **112px** before app-preview and CTA band.
- Content max-widths: hero text 720px, hero p 560px, section copy ~380–460px, CTA heading 880px, CTA p 620px.

## 5. Spacing rules
4px base grid. Recurring literals: card padding **48px** (lime panel), **24px** (stat card), **20px** (routine card), **26px** (phone); gaps **8/16/24/40/56px**; button padding `17–19px × 44px`; nav-link gap **40px**; social gap **28px**. Reuse these — do not invent new spacing.

## 6. Component patterns
**Header/nav** — `<span class="tri">` triangle (10px sides / 18px bottom) + wordmark `Agent<u>or</u>` (24px/700, "or" underlined 2px). Links `.nav-links a`: 15px/500 fg-2; resting has an invisible `::after` underline (2px, `--color-dark`, `transform: scaleX(0)`, origin left). **Hover** → color dark + underline `scaleX(1)` over 0.25s (slides left→right). `.active` = permanent dark + shown underline. Right-aligned `btn-primary btn-nav`.

**Buttons** — `.btn`: pill, 700, +0.10em, UPPERCASE, `gap:8px`. Variants: `.btn-primary` (lime/dark), `.btn-secondary` (white/dark + `box-shadow: 0 0 0 1.5px var(--color-border-strong)`), `.btn-join` (white on navy). Sizes: nav `13px 26px`/12px, hero `17px 44px`/13px, join `19px 44px`/13px, full-width panel button `19px`.

**Cards** — radius `--radius-md` (16px), `--shadow-card`, no border. Lime stat card = `--color-primary`; routine/white card = `#fff`. Chips: pills `7px 14px`, active = lime fill dark 600, inactive = `1px solid --color-border` fg-2. Progress: 18px track `--color-bg-base`, lime fill, pill.

**Lime feature panel** — `--color-primary-bright`, `--radius-lg` (20px), padding 48px, flex column: top progress rule (3px, dark fill) → h3 (40/700) → divider row (hairline + centered triangle) → **centered** body (16/1.6, `rgba(26,26,24,.62)`) → full-width secondary button pinned bottom.

**Phone mockup** — width 372px, `--color-primary`, `--radius-2xl` (**44px**), padding 26px. Bar: 34px circle back button (1.5px border) + centered h4 (14/700/uppercase/+0.06em). Inner cards white, radius 14px, `--shadow-sm`. Hub = dark pill. Animated flow line + spinning `refresh-cw`.

**CTA band** — `--color-secondary-navy`, `--radius-xl` (28px), padding `72px 48px`, centered: display h2 (44/500, on-navy) → p (18, on-navy-muted) → white `btn-join`.

**Footer** — social row right-aligned, gap 28px, links 16/500 fg-1 + Lucide `arrow-up-right` (18px) that **translates (3px,−3px) on hover, 0.2s**. Then hairline `border-top: 1px var(--color-border)`; bottom bar space-between: `Agentor` (15/700) + rights (14/fg-3) left, underlined "Privacy Policy" (15/fg-1) right.

## 7. Border radius values
`--radius-sm 8` · `--radius-md 16` (cards) · `--radius-lg 20` (panels) · `--radius-xl 28` (hero, CTA band) · `--radius-2xl 44` (device frames) · `--radius-full` (pills/avatars/progress).

## 8. Navigation behavior
Nav is the header only (no sticky). Links use the slide-in underline on hover; current page carries `.active`. Below **1000px** the desktop `.nav-links` are hidden and a **hamburger** (`.nav-toggle`) appears, opening a full-screen white overlay menu — both are injected by `mobile-nav.js` from the existing `.nav-links`, so no per-page mobile markup is written. The desktop→stacked collapses (feature-split → 1 col, app-preview → 1 col, social row → left) still fire at 1000px.

## 8a. Responsive system (shared)
Every page loads **`responsive.css`** (linked after its inline `<style>`) and **`mobile-nav.js`** (before `</body>`). Do not re-solve responsiveness inline. Three tiers, layered mobile-last: **≤1000px** stack · **≤768px** tablet · **≤480px** phone. Page gutters 40 → 28 (≤768) → 20px (≤480). Display headings and large numerals scale via global `clamp()` in `responsive.css`. Hero keeps its floating widgets and grows taller on mobile (min-height 600px ≤768, 660px ≤480); the avatar chip + watch pill move to the top row. The 372px app mockup is fluid (`max-width:372px`); `.field-row` / `.price-grid` / `.cs-grid` / `.kb-grid` / `.rc-dl` / `.pricing-lead` go single-column by 768px; overlay stat/routine cards drop below the photo at 480px.

## 9. Motion
Short, functional easing (`ease`, 0.15–0.25s). Underline slide 0.25s; button/hover color 0.2s; social arrow 0.2s. Decorative loops only inside the phone (sync spin 3s, flow 1.4s) and gated by `@media (prefers-reduced-motion: reduce)`. No page-load/scroll animations elsewhere.

## 10. New-page checklist
1. `.page` wrapper (1600 max, 40px gutters) on white.
2. Copy the **header** and **footer** verbatim; set the correct nav `.active`.
3. Link **`responsive.css`** after the inline `<style>` and load **`mobile-nav.js`** before `</body>` — this gives the page the hamburger, overlay menu, and all three breakpoint tiers for free.
4. Use only existing tokens, radii, shadows, spacing literals.
4. Display headlines = Medium 500; card headings = Bold 700.
5. Sections separated by 96px (112px before feature/CTA blocks).
6. Buttons/chips/cards from the patterns above — never restyle.
7. Lucide icons only; run `createIcons()`.
8. Photos: cover-cropped in rounded frames; match text color to photo luminance.
9. Honor the 1000px responsive collapse rules.
10. When unsure, copy the closest existing block from `Home.html` rather than inventing.
