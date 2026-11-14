# Agentor Design System

> **Note:** This design system is reverse-engineered from the uploaded screenshots (`fit_01.jpg`, `fit_02.jpg`). The screenshots carry placeholder "fitnoo" fitness branding; per direction, the brand has been rebranded to **Agentor** throughout. Imagery is currently cropped from the source composites — real Agentor photography/logo will be supplied later.

---

## Company / Product

**Agentor** — the brand applied to the product surfaces recreated here:

1. **Marketing website** — Hero-driven landing page with navigation, CTA funnels, and editorial-style feature sections.
2. **App / Dashboard** — Metric cards, routine tracking chips, progress bars, and slide-style feature carousels.
3. **iPaaS SaaS application** — the product surface flows/integrations run in: object lists and settings/editor forms. See "Components" and "iPaaS App Shell" below.

## Components

- `Button` — pill CTA, 4 variants (primary/secondary/ghost/dark), 3 sizes
- `Badge` — status pill (default/primary/dark)
- `Chip` — filter/tag toggle
- `StatCard` — large-numeral metric card (lime or white)
- `ProgressBar` — track + fill
- `Nav` — marketing site top nav
- `DataTable` — object list with status pills + row "open settings" action
- `FormField` / `TextInput` / `Textarea` / `Select` / `Switch` (`FormControls` module) — form primitives for settings/editors
- `Icon` (`Icons` module) — self-contained stroke icon set used across the app shell

## iPaaS App Shell

The app-shell chrome (sidebar/header/right-panel) has been pulled pending rework — not part of the system yet. What remains as the app-oriented foundation:

- **Layout tokens** — `tokens/app-shell.css` (right-panel width, z-index scale — sidebar/header sizes will return with the reworked chrome).
- **Content components** — `DataTable` for object lists (flows, connections) and `FormControls` for settings/editors.
- **Multi-tenant white-labeling** — every tenant runs the identical component set; only a documented set of `--tenant-*` brand tokens may be overridden (primary color scale + optional font), plus data props for name/logo. See `tokens/theming.css` and `guidelines/white-label.card.html` for the mechanism and a live two-tenant demo. No component hardcodes a color, spacing, radius, or shadow value — everything routes through tokens, so a re-theme requires zero code changes.

**Sources used:**
- `uploads/fit_01.jpg` — App/feature section screenshot (split-panel tracker card)
- `uploads/fit_02.jpg` — Marketing website homepage hero screenshot
- No codebase, Figma file, or additional brand assets were provided.

---

## Content Fundamentals

- **Tone:** Motivational, clean, direct. Energetic without being aggressive.
- **Voice:** Second-person ("your goals", "your potential", "Unlock your potential"). Speaks directly to the user.
- **Casing:** Headlines in sentence case. CTAs in ALL CAPS with tracked spacing ("LEARN MORE", "DISCOVER MORE", "START YOUR JOURNEY").
- **Copy style:** Short, punchy headlines (5–8 words). Descriptive body text is 2–3 sentences, ~20–30 words. No bullet lists in marketing copy.
- **Numbers:** Used for metric display (87%, 0.9%, 3km). Numbers are a design element — large, bold, prominent.
- **Emoji:** Not used.
- **Vibe:** Modern fitness brand. Clean, premium, optimistic.
- **Example headlines:**
  - "Unlock your potential, fitness & health hub"
  - "Track your health progress"
- **Example body:**
  - "Stay on top of your goals with our intuitive health tracking tools. Monitor your workouts, nutrition, and overall well-being effortlessly."
  - "Welcome to your ultimate wellness destination! explore our curated resources and expert tips to embark on a transformative fitness and health journey."

---

## Visual Foundations

### Colors
- **Primary accent:** Electric chartreuse-lime `#D0E84A` — extremely high-saturation yellow-green. Used for buttons, active state chips, progress bars, and full panel backgrounds.
- **Dark:** Near-black `#1A1A18` — slightly warm undertone, used for all headings and the logo mark.
- **Body text:** Mid-gray `#6B6B67` — readable on white and cream surfaces.
- **Page canvas:** Warm off-white `#F0EDE8` — a cream-gray that reads warm and soft. Used as the outer wrapper background on mockup frames.
- **Cards:** Pure white `#FFFFFF` — clean, high-contrast against the warm canvas.

### Typography
- **Font:** Geometric humanist sans-serif. Identified closest match as **Plus Jakarta Sans** (Google Fonts). ⚠️ The original may be a licensed typeface (Neue Haas Grotesk, Aktiv Grotesk, or bespoke). Please provide original font files.
- **Hero text:** ~88px, ExtraBold (800), tight letter-spacing (−0.02em), tight line-height (1.05).
- **Card headings:** ~36px, Bold (700), snug leading (1.2).
- **Body:** ~15px, Regular (400), relaxed leading (1.65).
- **CTA buttons:** ~13px, Bold (700), ALL CAPS, +0.10em letter-spacing.
- **Stat numbers:** ~48–64px, Bold (700), displayed as large as possible.

### Backgrounds
- Full-bleed editorial photography (outdoor sports/running). Images are high-contrast, slightly warm-toned. Hero images run edge-to-edge behind navigation.
- The lime `#D0E84A` is used as a full panel background — not just an accent.
- No gradients, textures, or patterns visible.

### Spacing & Grid
- 4px base unit, multiples of 4/8/16px throughout.
- Cards: ~40px internal padding on feature cards, ~24px on compact overlays.
- Nav: ~64px tall.
- Split-panel layout: approximately 50/50 columns.

### Corner Radii
- Pill buttons/chips: fully rounded (`9999px`).
- Standard cards: `16px`.
- Feature/panel cards: `20px`.
- Outer mockup wrapper: `28px`.

### Shadows
- Overlay stat cards: `0 8px 32px rgba(0,0,0,0.10)` — soft, diffuse.
- No harsh shadows. Depth is created by layering white cards over photos.

### Animation & Hover States
- Not directly observed. Estimated: buttons darken on hover (primary `→ #BDD435`); white buttons gain a light gray fill.
- Slide carousels implied by "3/4" pagination indicator.

### Imagery
- Athletic editorial photography. Subjects are mid-action (running outdoors). Warm, slightly desaturated post-processing. Not stock-flat — candid/cinematic feel.
- Image cropping: portraits (9:16-ish) for the right panel, landscape crops behind the hero.

### Iconography
- **Logo mark:** Solid upward-pointing triangle `▲`. Used as standalone brand icon.
- **Decorative triangle:** Same `▲` mark appears smaller, in a muted gray, as a decorative element within cards.
- **Horizontal line:** Thin `<hr>`-style divider lines used as decorative spacers in the lime panel.
- **Trend arrow:** `↗` unicode used inline in stat cards for positive trend indicators.
- No icon font or icon set observed. Icons are minimal — triangle + arrows only.
- No SVG icon library identified. No Lucide/Heroicons/etc usage visible.

### Cards
- White background, `16px` border radius, `0 8px 32px rgba(0,0,0,0.10)` shadow.
- Internal padding: `24px` on compact stat/routine cards.
- No visible border — depth via shadow alone.

---

## Iconography

See `assets/` folder. Assets included:
- `logo.svg` — Dark wordmark with triangle mark (⚠️ approximated from screenshots).
- `logo-white.svg` — White version for dark/photo backgrounds.
- `icon-triangle.svg` — Standalone triangle mark.

**Usage rules (estimated):**
- Triangle mark is the primary brand symbol — used as logo prefix, decorative accent, and standalone icon.
- CTA buttons use `↗` (arrow diagonal) for external/action links, inline unicode.
- No icon system beyond these minimal glyphs was observed in the source.

---

## File Index

```
styles.css              Global CSS entry point (@imports tokens)
tokens/
  colors.css            Color custom properties (tenant-overridable brand tokens)
  typography.css        Font face + type scale tokens
  spacing.css           Spacing scale + component sizing
  shadows.css           Shadow tokens
  radii.css             Border radius tokens
  theming.css           White-label tenant override mechanism (docs + hook)
  app-shell.css         iPaaS app layout tokens (sidebar/header/panel/z-index)
assets/
  logo.svg              Dark logo (wordmark + triangle)
  logo-white.svg        White logo for dark backgrounds
  icon-triangle.svg     Standalone triangle mark
components/
  buttons/              Button, button card specimen
  chips/                Chip/tag, chip card specimen
  cards/                StatCard, RoutineCard, card specimen
  progress/             ProgressBar component + specimen
  nav/                  Nav component + specimen
  badge/                Badge component + specimen
  table/                DataTable + specimen
  form/                 FormControls (FormField/TextInput/Textarea/Select/Switch) + specimen
  icons/                Icon set + specimen
guidelines/
  colors.card.html      Color palette specimens
  colors-semantic.card.html   Semantic color map
  typography.card.html  Type scale specimens
  spacing.card.html     Spacing scale
  shadows.card.html     Shadow + radius system
  white-label.card.html Two-tenant theming demo
ui_kits/
  Agentor/index.html     Marketing site + app UI recreation
readme.md               This file
SKILL.md                Agent skill descriptor
```
