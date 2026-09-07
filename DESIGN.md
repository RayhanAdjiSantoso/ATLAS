---
name: ATLAS
description: A light, dense analytics console for MIL Digital — one Inter-set world, hairline-ruled surfaces, and numbers that never lie about themselves.
colors:
  acc: "#1e3eb8"
  acc-700: "#142c82"
  acc-300: "#b8c5f5"
  acc-100: "#eef1fc"
  cyan: "#00c2e0"
  gold: "#f5a623"
  biz-teal: "#0d9488"
  sum-violet: "#7c3aed"
  shopee: "#ee4d2d"
  shopee-700: "#a83417"
  shopee-100: "#fff4f2"
  tiktok: "#0a0a0a"
  good: "#15803d"
  good-100: "#eefcf2"
  bad: "#c81e1e"
  bad-100: "#fef1f0"
  warning: "#b45309"
  warning-100: "#fef3c7"
  bg: "#fbfcfe"
  surface: "#ffffff"
  s2: "#eef1f7"
  border: "#dde2ee"
  rule: "#e7ebf5"
  text: "#0f1a3a"
  muted: "#5a6a90"
  muted2: "#61708f"
  shell-primary: "#2563eb"
  shell-bg-elevated: "#f8fafc"
  shell-border: "#e2e8f0"
  shell-text: "#0f172a"
  shell-muted: "#334155"
  shell-placeholder: "#94a3b8"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.4rem"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.22rem"
    fontWeight: 800
    letterSpacing: "-0.03em"
  figure:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 750
    lineHeight: 1.1
    letterSpacing: "-0.025em"
    fontFeature: "'tnum' 1, 'lnum' 1"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 750
    letterSpacing: "-0.02em"
  subtitle:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.88rem"
    fontWeight: 700
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.63rem"
    fontWeight: 800
    letterSpacing: "0.09em"
  shell-body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xs: "5px"
  sm: "6px"
  md: "9px"
  lg: "12px"
  xl: "14px"
  pill: "99px"
spacing:
  hairline-row: "0.55rem"
  tight: "0.5rem"
  card: "0.9rem"
  panel: "1.35rem"
  stack: "1.25rem"
  rail-gap: "1.75rem"
  page-x: "clamp(18px, 2.4vw, 34px)"
components:
  button-primary:
    backgroundColor: "{colors.acc}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.acc-700}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.acc}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
  button-secondary-hover:
    backgroundColor: "{colors.acc-100}"
  input-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0.48rem 0.7rem"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "0.9rem 1rem 1rem"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.xl}"
    padding: "1.35rem"
  delta-up:
    backgroundColor: "{colors.good-100}"
    textColor: "{colors.good}"
    rounded: "{rounded.xs}"
    padding: "0.1rem 0.38rem"
  delta-down:
    backgroundColor: "{colors.bad-100}"
    textColor: "{colors.bad}"
    rounded: "{rounded.xs}"
    padding: "0.1rem 0.38rem"
  delta-flat:
    backgroundColor: "{colors.s2}"
    textColor: "{colors.muted}"
    rounded: "{rounded.xs}"
    padding: "0.1rem 0.38rem"
  band:
    backgroundColor: "{colors.acc-100}"
    textColor: "{colors.acc}"
    rounded: "{rounded.sm}"
    padding: "0.1rem 0.5rem"
  band-watch:
    backgroundColor: "#fdf3e0"
    textColor: "#92400e"
  rail-item:
    textColor: "{colors.muted}"
    rounded: "0"
    padding: "0.48rem 0.7rem"
  rail-item-active:
    backgroundColor: "{colors.acc-100}"
    textColor: "{colors.acc}"
  sidebar-link:
    textColor: "{colors.shell-muted}"
    rounded: "{rounded.lg}"
    padding: "0.75rem"
  sidebar-link-active:
    backgroundColor: "#eff6ff"
    textColor: "{colors.shell-primary}"
---

# Design System: ATLAS

## Overview

**Creative North Star: "The Lit Reading Room"**

ATLAS is a working instrument, not a presentation. Its world is a bright, low-contrast room — a near-white ground (`#fbfcfe`) with a single soft radial wash at the top of the canvas — in which every mark that exists is either a number, a rule that separates numbers, or a label that names them. Depth is almost absent: surfaces are white cards on an off-white floor, held apart by a one-pixel border and two very diffuse blue-black shadows. Nothing glows, nothing floats, nothing is decorated. Density is high on purpose; the people who read these screens already know the product and are reading for a figure, not an introduction.

The system is older than the surface that made it explicit. It lives in the `.mil-ui` block of `frontend/src/reportGenerator/index.css`, which is **generated** by `frontend/scripts/scope-css.py` from the standalone Monthly Report Generator and **must never be hand-edited**. Beranda and the Report Generator render in it. The Dashboard Business Overview console joined it via a hand-authored stylesheet, `frontend/src/components/dashboard/console.css`, which copies those token values under a `.con` scope onto ATLAS's *original* custom-property names (`--text`, `--border`, `--primary`, `--radius`) so roughly two thousand lines of inline-styled renderers adopt the world without being rewritten. Copied, not inherited: `.mil-ui` also carries `& *{margin:0;padding:0}`, which would tie with `.card{padding:1.5rem}` at equal specificity.

Two token sets are genuinely live in this app at once, and pretending otherwise is the fastest way to break it. The **shell** — the fixed sidebar, the mobile drawer, `.mobile-bar`, `.sidebar-scrim` — runs on ATLAS's original `:root` tokens in `frontend/src/index.css` (DM Sans, `#2563eb`, 12px radius). Everything *inside* a page that opts into the design system — `.mil-ui` on Beranda and the Report Generator, `.con` on the console — runs on the Inter set above. Both faces are loaded in `frontend/index.html`. New page interiors are written in the design-system set; the shell is not repainted to match.

**Key Characteristics:**
- One typeface, Inter, at 400–800, for every surface inside the design system; no second "mono" family anywhere.
- Light room: near-white ground, white cards, hairline rules, two whisper-soft shadows.
- Meta blue as the only interactive accent; brand hues (Shopee, TikTok) are hue-locked identity, never decoration.
- Green and red are reserved for movement over time; category and rank never use them.
- Tabular lining figures everywhere a number appears, so a changing value never reflows its neighbours.
- Three data states — absent, zero, not-yet-fetched — always visually distinct.

## Colors

A cool, ink-blue palette on a paper-white ground: one saturated accent, a set of hue-locked platform identities, and a strictly rationed semantic pair.

### Primary
- **Meta Blue** (`#1e3eb8`): the only interactive accent. Links, active navigation, focus rings, caret and selection, primary buttons, the funnel step meter, and every emphasis tint (`#eef1fc`) derive from it. Its deep press state is `#142c82`; `#b8c5f5` is the pale echo used for hover borders, ready-state dots and empty-state icons.

### Secondary
- **Shopee Orange** (`#ee4d2d`) and **Shopee Deep** (`#a83417`): hue-locked platform identity. Used only to say "this data came from Shopee" — the console's data-scope chip, tab identity in the Report Generator. Never a general-purpose warm accent.
- **TikTok Ink** (`#0a0a0a`) with **TikTok Cyan** (`#69c9d0`): same rule, same restriction.

### Tertiary
- **Business Teal** (`#0d9488`), **Summary Violet** (`#7c3aed`), **Signal Cyan** (`#00c2e0`), **Gold** (`#f5a623`): established per-tab identities in the Report Generator, formalized as tokens. In the console they serve as the categorical chart palette alongside the accent and the muted slate.

### Neutral
- **Ground** (`#fbfcfe`): the page floor, carrying one radial wash at `50% -8%` so the top of the canvas is not flat behind the sticky bar.
- **Surface** (`#ffffff`) and **Raised** (`#eef1f7`): card faces and inert control fills (table headers, static readouts, the flat delta pill).
- **Border** (`#dde2ee`) and **Rule** (`#e7ebf5`): the structural hairline and the lighter internal divider. `--rule` divides content *within* a surface; `--border` bounds the surface itself.
- **Ink** (`#0f1a3a`), **Muted** (`#5a6a90`), **Quiet** (`#61708f`): three text tiers, all AA on white (17.5:1 / 5.4:1 / 4.6:1). The tiers are compressed by design — the third separates from the second by size and weight more than by value, because the earlier lighter greys failed AA.

### Semantic
- **Gain Green** (`#15803d` on `#eefcf2`) and **Loss Red** (`#c81e1e` on `#fef1f0`): darkened from the stock 500-weights specifically so the delta pill — the most repeated element in the product, and the one clients read in an exported PDF — clears AA on its own wash.
- **Warning** (`#b45309` on `#fef3c7`), and the watch band's `#92400e` on `#fdf3e0`.

### Named Rules
**The Movement-Only Rule.** Green and red mean change over time and nothing else. Deltas and direction arrows may use them. Categories may not — they use the chart palette. Rankings may not — they use `--text`. Threshold states may not — they use the band (accent tint, or amber for watch) and always name the band in words as well as colour.

**The No-Red-In-The-Wheel Rule.** The categorical chart palette is accent blue, cyan, teal, violet, gold, slate, pale accent — and deliberately contains no red. On a page where red means "worse", spending it on a neutral residual category makes an ordinary slice read as an alert.

**The Hue-Lock Rule.** Shopee orange, TikTok ink/cyan and the per-tab identity hues are locked to their meaning. A colour that identifies a platform is never reused for emphasis, state, or ornament.

## Typography

**Display / Body / Label Font:** Inter, variable weight 400–800 (with `system-ui, sans-serif`)
**Shell Font:** DM Sans (the app chrome only — sidebar, drawer, top bar)

**Character:** One neutral grotesque doing all the work, differentiated by weight and tracking rather than by family. Headings are heavy (750–800) and tightly tracked (−0.02 to −0.03em) so a small heading still reads as structure; labels go the other way — tiny, extra-bold, and widely tracked in caps. The contrast between the two extremes is the entire hierarchy. Inter's `cv05` stylistic set is on across the console, and numbers run in Inter's own tabular lining figures rather than switching to a mono face.

### Hierarchy
- **Display** (800, 1.4rem, 1.15, −0.03em): the page masthead title. Drops to 1.2rem below 760px.
- **Headline** (800, 1.22rem, −0.03em): the focused panel's title. Deliberately both larger *and* heavier than the KPI figure below it, so the strip does not introduce itself louder than the module it introduces.
- **Figure** (700–750, 1.02–1.2rem, −0.025em, tabular lining): every headline number — module values, KPI values, funnel ratios.
- **Title** (750, 1.05rem, −0.02em): section headings inside a panel.
- **Subtitle** (700, 0.88rem, −0.01em): sub-section headings inside a section card.
- **Body** (400–550, 0.78–0.84rem, 1.45–1.55): captions, descriptions, table cells. Prose is capped at 46–62ch; the panel's framing question at 52ch.
- **Label** (800, 0.6–0.64rem, 0.07–0.13em, uppercase): field labels, KPI names, table headers, rail title. The most distinctive mark in the system.

### Named Rules
**The One Family Rule.** Inter is the only face inside the design system, including for code and numerals. `code { font-family: inherit }`; digits get their distinctiveness from `tabular-nums lining-nums`, never from a second family. (This is why the `overused-font` detector finding on Inter is a recorded exception in `.impeccable/config.json`, not debt — see Do's and Don'ts.)

**The Tabular Figures Rule.** Every number on screen carries `font-variant-numeric: tabular-nums lining-nums`. Digits stack in columns and a value that changes on filter never reflows its neighbours.

**The Never-Abbreviate Rule.** Domain and metric names wrap; they are never truncated or shortened. Below 900px the rail's labels drop `white-space: nowrap` and take two lines rather than clip a word.

## Layout

The shell is a fixed 240px sidebar (66px collapsed, with a 240px hover peek) plus a 2rem-padded main column. Below 900px it becomes a drawer: the sidebar goes off-canvas at 260px with a scrim, and a 52px sticky translucent `.mobile-bar` holds the menu button and the wordmark.

The console lays out inside that column as a two-track grid: a 232px domain rail and a `minmax(0, 1fr)` canvas, 1.75rem apart, both starting at the top. It cancels the shell's 2rem padding (`margin: -2rem`) and sets its own `clamp(18px, 2.4vw, 34px)` gutters, so the sticky control bar can bleed to the full column width. The rail is sticky under the 64px bar; the canvas is a vertical stack at 1.25rem rhythm: KPI strip, focused panel, then a summary grid of `auto-fill minmax(268px, 1fr)` cards at 0.85rem.

Spacing is small and consistent: 0.55rem for table and list rows, 0.85–1rem for card interiors, 1.35rem for panel interiors, 1.25rem between stacked sections.

Breakpoints and what changes: **1180px** — KPI strip goes 4-up to 2-up and re-cuts its hairlines. **900px** — the shell becomes a drawer, the console goes single-column, and the rail turns into a two-column grid of the same rows above the panel. **760px** — summary cards go single-column, panel padding drops to 1rem, labels wrap. **359px** — the rail finally goes one column.

### Named Rules
**The Re-Cut Rule.** Every grid that divides itself with hairlines re-declares those hairlines at each breakpoint. A rule that leads nowhere — a border on the last column of a row that no longer exists — is a defect, not a leftover.

**The No-Degrading-To-Pills Rule.** Below the rail's width the console keeps its shape. The domain selector becomes a two-column grid where every domain is still visible at once and still one tap away; it never becomes a horizontally scrolling pill bar.

## Elevation & Depth

Nearly flat, and tonal before it is shadowed. Separation comes from a 1px `#dde2ee` border and a change in ground tone; shadows exist only to lift a surface off the floor by a hair, never to dramatize it. Both shadows are two-part, blue-black, and very diffuse — they read as ambient settling, not as a light source.

### Shadow Vocabulary
- **Ambient** (`box-shadow: 0 1px 2px rgba(15,26,58,.04), 0 8px 28px rgba(15,26,58,.06)`): the focused panel and the top-level generator surfaces.
- **Ambient-sm** (`box-shadow: 0 1px 2px rgba(15,26,58,.05), 0 3px 10px rgba(15,26,58,.04)`): cards, the KPI strip, the mobile rail, handoff rows.
- **Hover lift** (`box-shadow: 0 2px 4px rgba(15,26,58,.05), 0 12px 26px -12px rgba(15,26,58,.22)`): interactive cards and handoff rows on hover, paired with a border shift to `#b8c5f5`.
- **Stuck bar** (`box-shadow: 0 10px 30px -18px rgba(15,26,58,.4)`): appears only when the sticky control bar leaves the flow, alongside its border and a step up in backdrop opacity.
- **Focus ring** (`box-shadow: 0 0 0 3px rgba(30,62,184,.12)`): the soft accent halo on generator controls.

### Named Rules
**The One Depth Level Rule.** A card inside a panel is already inside a card. Nested surfaces lose their shadow (`.con-focus-body .card { box-shadow: none }`), and a third tier becomes a tinted borderless region (`#f6f8fd`, 10px) instead of a third stacked box. White-on-white-on-white is a defect.

**The Earned Shadow Rule.** Surfaces at rest carry at most the ambient pair. Any stronger shadow is a response to state — hover, or a sticky element that has actually detached.

## Shapes

Softly rounded rectangles at a small, consistent set of radii, with one deliberate square exception. Radii scale with the surface: 5–6px for pills and micro-chips (delta, band, step, skeleton), 9px for controls (buttons, inputs, selects, icon tiles), 10px for tinted inner regions, 12px for cards and handoff rows, 14px for top-level panels and the KPI strip. Meters, switch tracks and scrollbar thumbs use a 99px pill.

Borders are always 1px and always one of two greys — `#dde2ee` around a surface, `#e7ebf5` between rows inside one. Nothing uses a heavier stroke, and no surface uses a coloured left rule as a category marker.

The exception: the console's active rail band is **square-edged and flush**, bleeding past the rail's own padding to both edges. That squareness is the whole point of the separation described under Navigation.

### Named Rules
**The Hairline Rule.** Structure is drawn with 1px greys, not with weight, tint blocks, or coloured bars. The KPI strip is one surface divided by rules, not eight floating boxes, because the eight metrics are one reading of one period.

## Components

### Buttons
- **Shape:** gently rounded (9px in the design system; 12px in the shell).
- **Primary:** Meta blue fill, white text, 0.5rem/1rem padding, 700 weight at 0.82rem. Hover deepens to `#142c82`.
- **Secondary:** white fill, accent text, 1px `#dde2ee` border. Hover fills with `#eef1fc` and shifts the border to `#b8c5f5`.
- **Hover / Focus:** 0.18s colour-only transitions on the shared ease. No press-scale inside the console (`.con .btn:active { transform: none }`); focus is the 2px accent outline at 2px offset.

### Cards / Containers
- **Corner Style:** 12px for cards, 14px for the top-level panel and KPI strip.
- **Background:** white on the `#fbfcfe` ground; tinted inner regions at `#f6f8fd`.
- **Shadow Strategy:** ambient-sm at rest, hover lift on interactive ones only, none when nested (see Elevation).
- **Border:** 1px `#dde2ee`; internal dividers 1px `#e7ebf5`.
- **Internal Padding:** 0.9–1rem for cards, 1.35rem for panels (1rem below 760px).

### Inputs / Fields
- **Style:** white fill, 1px `#dde2ee`, 9px radius, 0.48rem/0.7rem padding, 0.84rem text. Labels above in the uppercase Label style.
- **Hover:** border darkens to `#cfd8ec`.
- **Focus:** 2px accent outline at 2px offset (or the soft `rgba(30,62,184,.12)` 3px halo on generator controls). Caret and `accent-color` are the accent.
- **Switch:** a drawn 30×17 pill track with a 12px white thumb; on-state turns the track accent and the whole control adopts the accent tint. Raw browser checkboxes are not used in a drawn bar.

### Navigation
Two navigations, two identities, and the difference is load-bearing.
- **App sidebar** (shell tokens, DM Sans): icon-led, each row a 12px **rounded, inset pill**; active is `#eff6ff` with `#2563eb` text at 600. Collapses to a 66px icon rail with fading labels; becomes an off-canvas drawer under 900px.
- **Console domain rail** (design-system tokens, Inter): purely typographic, **no icons at all**. Rows are 0.82rem/550 muted text with a 7px state dot; active is `#1e3eb8` at 680 behind a **square-edged, flush** `#eef1fc` band that bleeds to both rail edges and slides between rows on a framer-motion spring (`stiffness 520, damping 42, mass 0.8`).
- The module summary cards and the mobile selector follow the rail's identity, not the sidebar's.

### Signature: The KPI Strip
One white surface at 14px radius, `repeat(4, 1fr)`, divided by internal hairlines rather than gaps. Each cell: uppercase label with an optional 13px circled italic "i" footnote, a tabular figure at 1.04rem/700, and a footer row carrying the delta pill and an optional 46×15 sparkline. Present in every domain, because it is one reading of one period.

### Signature: The Delta Pill
The most repeated element in the product. Inline-flex, 5px radius, 0.7rem/700, with an 11px direction glyph: gain in `#15803d` on `#eefcf2`, loss in `#c81e1e` on `#fef1f0`, flat in muted ink on `#eef1f7`. This pill is the *only* place on a page where colour carries meaning by itself.

### Signature: The Three Data States
- **Absent** (`null`): an em dash in the quiet text tier at weight 500 with `cursor: help` and a `title` that says why it is missing.
- **Zero:** prints "0" in the same weight and tier as any other figure.
- **Not yet fetched:** a shimmering bar at 5px radius (72% or 44% width), never a dash.
The registry's `absent()` helper returns `value: null` rather than falling back to 0 precisely to keep these apart. Rail dots carry the same idea by *shape*, not colour alone: filled = in memory, spinning ring = fetching, hollow = not yet.

### Signature: The Threshold Band
For values read against a scale rather than a previous period: accent tint by default, `#fdf3e0`/`#92400e` for watch, at 6px radius — and it always spells the band out in words.

### Signature: The Funnel Ghost
Each stage bar is drawn in front of a pale bar the width of the stage above it, so the loss is the visible thing. Step conversion between stages gets its own channel — a small accent-tinted chip with a 72×5 meter — because absolute bars cannot show it: at 3% of the basis a stage is a sliver whether it kept 94% or 17%.

### Motion
One grammar: `cubic-bezier(.22, 1, .36, 1)`, named `--ease` in the console and `--ease-out` in the generated system. State changes on controls run 0.18–0.3s. The single authored moment is the **focus exchange**: the incoming panel body plays `con-settle` (0.42s — opacity, 10px rise, and a 6px blur that clears), while the re-ordered summary cards follow on `con-rise` (0.34s, 7px, staggered 40ms apart from a 90ms delay) so the last card lands before the panel finishes and the whole thing reads as one movement. Charts never re-animate on a filter change. Everything collapses under `prefers-reduced-motion: reduce`.

### Browser Surfaces
The parts nobody draws still belong to the system: selection is `#d9e1fb` on ink, caret and `accent-color` are the accent, scrollbars are an 11px track with a `#ccd4e6` inset pill thumb (`#a8b5d4` on hover), and focus-visible is a 2px accent outline at 2px offset with a 6px radius.

## Do's and Don'ts

### Do:
- **Do** write new page interiors against the design-system token set (Inter, `#1e3eb8`, `#fbfcfe`), and leave the shell — sidebar, drawer, `.mobile-bar` — on ATLAS's original `:root` tokens in `frontend/src/index.css`. Both sets are live; keep the boundary at the page interior.
- **Do** bridge rather than rewrite when adopting an existing screen: scope a class, re-declare ATLAS's own custom property names with the design system's values, and copy the tokens (never inherit `.mil-ui`, whose `& *{margin:0;padding:0}` collides with `.card{padding:1.5rem}` at equal specificity).
- **Do** render all three data states distinctly — em dash with an explanation for absent, a normal "0" for zero, a shimmer bar for not-yet-fetched. This implements PRODUCT.md's NULL ≠ 0 rule; collapsing it makes numbers wrong without looking wrong.
- **Do** reserve green and red for period-over-period movement, and give categories the chart palette, rankings `--text`, and thresholds the band.
- **Do** put `tabular-nums lining-nums` on every number.
- **Do** use one motion curve, `cubic-bezier(.22, 1, .36, 1)`, and guard every animation with `prefers-reduced-motion`.
- **Do** reserve the sticky bar's height on the scroll container (`html:has(.con-bar) { scroll-padding-top }`) on any page that pins a bar, so a keyboard-focused control is never parked underneath it (WCAG 2.2 Focus Not Obscured).
- **Do** treat Inter as a decided exception to the `overused-font` detector: it is what the project's own generated design system declares (`--f`) and shares across surfaces, and PRODUCT.md records one-family platform coherence as a brand commitment. The suppression is scoped to that one value in `.impeccable/config.json`.
- **Do** state every status in words as well as colour, and differentiate load states by shape as well as fill.

### Don't:
- **Don't** hand-edit `frontend/src/reportGenerator/index.css`. It is generated by `frontend/scripts/scope-css.py` from the Monthly Report Generator; changes belong upstream and arrive by re-running the script.
- **Don't** merge the two token sets into one "tidy" system, or repaint the shell in design-system tokens as a side effect of a page change. The coexistence is a fact of this codebase, not an oversight.
- **Don't** give the console's domain rail icons, or a rounded inset active pill. Copying the app sidebar's treatment makes the first viewport read as an application with two navigations instead of a console with a mode selector.
- **Don't** mark a callout, section, or category with a thick coloured left rule. Tone reads from a small drawn dot and the heading colour — the same signal the delta pills use.
- **Don't** nest a bordered, shadowed card inside a bordered, shadowed card. Flatten the inner one or tint it.
- **Don't** put red in a categorical palette, and don't use a platform hue (Shopee orange, TikTok cyan) as a general accent.
- **Don't** re-animate charts or entrances on a filter change; a page that redraws on every keystroke reads as slow no matter how fast it is.
- **Don't** truncate a domain or metric name, and don't abbreviate one to make it fit. Let it wrap.
- **Don't** ship an undrawn native control (a raw checkbox, a bare select) into a bar that has otherwise been drawn.
