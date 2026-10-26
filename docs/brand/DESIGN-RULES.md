# Agentor — Strict Design Rules

Enforceable ruleset derived from `BRAND-CONTINUITY.md`, `Home.html`, and `tokens/`. Purpose: **eliminate design drift**. Every rule is binary — *Allowed* vs *Forbidden*. If a choice isn't explicitly allowed, it is forbidden. When in doubt, copy the closest existing block from `Home.html`.

---

## 1. Layout structure
**Allowed**
- One `.page` wrapper: `max-width: 1600px; margin: 0 auto; padding: 0 40px;` on a pure white (`#fff`) body.
- Grids from the system only: `1fr 1fr` (feature split), `1fr auto 1fr` (app preview), single column.
- Content max-widths: hero 720px, hero copy 560px, section copy 380–460px, CTA heading 880px, CTA copy 620px.

**Forbidden**
- Full-bleed content wider than 1600px, or gutters ≠ 40px.
- Off-white/tinted page backgrounds (`--color-bg-base` is a desk backdrop only, never the page).
- Inventing new column ratios, multi-container nesting, or asymmetric bespoke grids.

## 2. Vertical spacing
**Allowed**
- 4px base grid. Section gaps: **96px** default, **112px** before feature/app-preview and CTA band.
- In-component vertical steps from the set: 4 / 8 / 16 / 24 / 32 / 40 / 48 / 56px.

**Forbidden**
- Arbitrary values (e.g. 30px, 70px, 100px) not on the grid.
- Collapsing section rhythm below 96px or padding sections with random margins.

## 3. Horizontal spacing
**Allowed**
- 40px page gutters. Grid gaps: 24px (feature split), 56px (app preview), 28px (footer social).
- Inline gaps: 8px (button icon, chips), 12–18px (widgets), 40px (nav links).

**Forbidden**
- Per-element horizontal margins to fake layout — use flex/grid `gap`.
- Bare inline-block siblings separated by whitespace.

## 4. Section spacing
**Allowed**
- `.section { margin-top: 96px; }`; feature/app-preview/CTA get 112px.
- Lime panel padding 48px; CTA band padding `72px 48px`; phone padding 26px.

**Forbidden**
- Adjacent sections touching (0 gap) or exceeding 112px separation.
- Different top vs bottom section rhythm on the same page.

## 5. Typography
**Allowed**
- Family: Plus Jakarta Sans (`--font-sans`) only. Weights 400/500/600/700/800.
- Roles (size / weight): Hero 72/500, Display heading 36–44/**500**, Card heading 40/**700**, Eyebrow 14/500 +0.08em UPPERCASE, Body 15–18/400, Stat 60/700, Button 12–13/700 +0.10em UPPERCASE, Nav 15/500.
- Tracking: −0.02em (hero/card), −0.01em (display), +0.08/+0.10em (labels/buttons).

**Forbidden**
- Bold (700) on hero or CTA/section display headlines — those are **Medium 500**.
- Any other typeface, italic display text, or font sizes/weights outside the table.
- Sentence-case buttons/eyebrows (must be UPPERCASE) or all-caps body copy.

## 6. Buttons
**Allowed**
- `.btn`: pill (`--radius-full`), 700, +0.10em, UPPERCASE, `gap:8px`, no border.
- Variants: `btn-primary` (lime `#D0E84A` / dark text), `btn-secondary` (white / dark + `box-shadow: 0 0 0 1.5px var(--color-border-strong)`), `btn-join` (white on navy).
- Sizes only: nav `13px 26px`/12px, hero `17px 44px`/13px, join `19px 44px`/13px, full-width panel `19px`.

**Forbidden**
- Square/less-than-full radius buttons, outlined lime buttons, gradient or shadowed fills.
- New colors, drop shadows, or sizes; lowercase labels; icon-only primary buttons.

## 7. Forms
**Allowed** (extrapolated from button/card language — keep identical)
- Inputs: white fill, `1px solid var(--color-border)`, `--radius-md` (16px) or pill for single-line search, padding ~`14px 16px`, 15px/400 fg-1 text, `--color-fg-3` placeholders.
- Focus: `box-shadow: 0 0 0 2px var(--color-dark)` (or lime) — no browser default outline glow.
- Labels: 13–14px, 500, fg-2, above the field. Submit uses `btn-primary`.

**Forbidden**
- Pill+square mixing in one form, colored input fills, floating labels, placeholder-as-label.
- Multi-accent validation colors — use dark text + lime/`--color-border` only.

## 8. Cards
**Allowed**
- `--radius-md` (16px), `--shadow-card`, **no border**. White, lime (`--color-primary`), or bright-lime panel (`--radius-lg` 20px).
- Padding: 24px (stat), 20px (routine), 48px (feature panel), 14px inner (phone cards, radius 14 + `--shadow-sm`).

**Forbidden**
- Borders + shadow together, left-accent color bars, rounded-corner + colored-border cards.
- Radii other than 16/20/14px on cards; heavy/dark drop shadows.

## 9. Statistics
**Allowed**
- Stat number 60px/700/−0.03em dark; unit 24px/500 `rgba(26,26,24,0.4)`; label 15px/500 `rgba(26,26,24,0.7)`.
- Trend: right-aligned, 18px/700 dark, prefixed with Lucide/`↗` up-right arrow.
- Progress bars: 18px track `--color-bg-base`, lime fill, fully rounded.

**Forbidden**
- Multi-color stats, red/green semantic trend colors (trend stays dark; lime = positive accent only).
- Stat numbers not paired with a label; decorative chart junk.

## 10. Imagery
**Allowed**
- Full-bleed photos inside rounded frames (`--radius-lg`/`xl`), `background-size: cover`, tuned `background-position`.
- White text on dark photos; dark text on light photos. Avatar/thumb = circular, `cover`.

**Forbidden**
- Distorted (stretched) images, sharp-cornered photos, drop-shadowed images.
- Dark scrims/overlays on hero photos (rely on natural light regions); decorative stock unrelated to product.

## 11. Icons
**Allowed**
- Lucide stroke icons only. Sizes 24px (default) / 18px (small) / 15px (inline chips). Color inherits `currentColor` (dark, or white on dark).
- Run `lucide.createIcons()` after DOM; load pinned `lucide@0.460.0`.

**Forbidden**
- Emoji, Unicode glyph icons (except the brand ▲ triangle and `↗`), hand-drawn/custom SVG icons, filled icon sets, multi-color icons.

## 12. Navigation
**Allowed**
- Header only, 88px tall, flex space-between: triangle+`Agent<u>or</u>` wordmark · centered `.nav-links` (15/500 fg-2, gap 40) · right `btn-primary btn-nav`.
- Hover: color → dark + underline `::after` slides `scaleX(0)→(1)` from left, 0.25s. Current page = `.active` (dark + shown underline).
- Below 1000px: hide `.nav-links` and show the **hamburger** (`.nav-toggle`) that opens a full-screen white overlay menu (`.mobile-menu`). The overlay is built automatically by `mobile-nav.js` from the desktop `.nav-links` — never hand-author a second nav. Overlay links are 500 weight, fluid `clamp()` sized, current page underlined; the header CTA moves into the overlay.

**Forbidden**
- Leaving mobile with no navigation (bare `.nav-links { display:none }` and nothing else).
- Sticky/colored nav bars, drop shadows under header, underline that fades/centers instead of sliding left→right.
- More than the CTA button on the right; changing link weight/size per page.

## 13. Footers
**Allowed**
- Social row right-aligned, gap 28px, links 16/500 fg-1 + Lucide `arrow-up-right` (18px) that translates `(3px,−3px)` on hover (0.2s).
- Hairline `border-top: 1px var(--color-border)`; bottom bar space-between: `Agentor` (15/700) + rights (14/fg-3) left · underlined "Privacy Policy" (15/fg-1) right.

**Forbidden**
- Dark/lime footer backgrounds (footer sits on white), multi-column link farms, social icon badges/circles.
- Arrows that rotate or scale instead of the diagonal translate.

## 14. CTA sections
**Allowed**
- One navy block: `--color-secondary-navy #13293A`, `--radius-xl` (28px), padding `72px 48px`, centered content.
- Display h2 44/**500** on-navy (max 880) → p 18/400 on-navy-muted (max 620) → white `btn-join`.

**Forbidden**
- Lime or gradient CTA backgrounds, left-aligned CTA content, bold CTA headline, multiple buttons.
- Radius ≠ 28px or adding imagery/shadows inside the band.

---

## 15. Responsive system
**Allowed**
- Every site page loads `responsive.css` (after its inline `<style>`) and `mobile-nav.js` (before `</body>`). These carry the entire mobile layer — do not re-solve responsiveness inline.
- Three tiers, layered mobile-last: **≤1000px** desktop→stacked (each page's inline block), **≤768px** tablet, **≤480px** phone.
- Page gutters step down: 40px → 28px (≤768) → 20px (≤480).
- Display type scales with `clamp()` (defined globally in `responsive.css`, outside media queries) so headings degrade smoothly between breakpoints — no abrupt single-step jumps.
- Hero keeps its floating widgets on mobile; the frame grows taller (min-height 600px ≤768, 660px ≤480) and the avatar chip + watch pill move to the top row so they never collide with the headline.
- The 372px app mockup is fluid (`width:100%; max-width:372px`). Multi-column grids (`.field-row`, `.price-grid`, `.cs-grid`, `.kb-grid`, `.rc-dl`, `.pricing-lead`) collapse to one column by ≤768px. Overlay stat/routine cards drop below the photo (static) at ≤480px.

**Forbidden**
- New per-page `@media` blocks that duplicate what `responsive.css` already covers.
- Fixed pixel widths that can exceed a phone viewport (e.g. an un-capped 372px mockup, a 340px absolute card) without a fluid fallback.
- Skipping the tablet tier and jumping desktop→phone.

### Drift-prevention meta-rules
1. No new colors, fonts, radii, shadows, or spacing values — only tokens.
2. Display headlines are Medium 500; only lime card headings are Bold 700.
3. Reuse header/footer verbatim across pages.
4. If a pattern isn't in `Home.html`, replicate the nearest existing one — never design a new one.
