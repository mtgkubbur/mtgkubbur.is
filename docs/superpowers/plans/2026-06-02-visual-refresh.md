# MtG Kubbur Visual Refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the "ClaudeDesign MtG Kubbur Design System" into the live `mtgkubbur.is` site — warm-parchment palette, vendored Spectral display serif, rank medallions, more legible data surfaces, and cleaner Observable Plot charts that keep their Bayesian uncertainty bands.

**Architecture:** In-place, token-first. Merge the new design-token *values* into `app/static/css/input.css` (the CSS-variable cascade warms the whole site in one edit), rebuild Tailwind, then make surgical edits to named blocks in `app/static/css/mtg.css` using the deliverable's `components.css` as the per-block source of truth (identical class names). One Jinja template edit adds rank medallions. Charts are refined via the existing `theme.js` palette reader plus a small shared options helper. Production-only CSS (methods page, calendar, 404, a11y fixes) is left untouched.

**Tech Stack:** FastAPI + Jinja2, standalone Tailwind CLI (`bin/tailwindcss`), vanilla ES-module JS, Observable Plot 0.6.17 (vendored), `uv` + `pytest` + `ruff`. Theme = `[data-theme]` + CSS custom properties (never Tailwind `dark:`).

**Source of truth for component CSS:** `MagicTheGathering/ClaudeDesign MtG Kubbur Design System/` — referred to below as `«DS»/`. Block line-ranges in `«DS»/components.css`: navbar 8–59, page-header 61–95, mana-pips 97–105, date-badge 107–115, generic card 117–126, controls 128–150, score-table 152–186, rank medallions + podium 188–210, win-rate bar 212–217, delta pills 219–227, player-summary 229–242, h2h 244–260, affinity/data tables 262–278, empty-state 280–282, footer 284–300.

**Design spec:** `~/Obsidian/MagicTheGathering/Architecture/MtG Kubbur Visual Refresh — Design Spec.md` (committed `8d9f893`).

---

## Pre-flight

- [ ] **P.1 — Branch off `master`**

```bash
cd mtgkubbur.is
git switch -c feat/visual-refresh
```

- [ ] **P.2 — Establish a green baseline**

Run: `uv run --extra dev --extra data pytest -q && uv run --extra dev ruff check .`
Expected: all tests pass, ruff clean. (If anything is red before we start, stop and report — do not build on a red baseline.)

- [ ] **P.3 — Start the preview server for visual checks**

The `.claude/launch.json` config `mtgkubbur-is` serves the live app on `:8011`. Use `preview_start` (name `mtgkubbur-is`) and `preview_inspect`/`preview_screenshot` for all visual verification. **Use `preview_inspect` for exact colours/sizes — not screenshots.**

---

## Task 1: Asset & token invariants (failing test first)

Locks the vendoring rule (no CDN), Spectral presence, and the warm-palette/new-token merge into a regression test.

**Files:**
- Create: `tests/test_assets.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_assets.py — guards the design-token contract & font vendoring.
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "app" / "static" / "css" / "input.css"
SPECTRAL = ROOT / "app" / "static" / "fonts" / "spectral"


def test_no_cdn_anything_in_css():
    text = CSS.read_text(encoding="utf-8")
    assert "fonts.googleapis.com" not in text
    assert "@import" not in text  # everything is vendored


def test_spectral_fontface_declared():
    text = CSS.read_text(encoding="utf-8")
    assert 'font-family: "Spectral"' in text


def test_spectral_files_vendored():
    assert (SPECTRAL / "spectral-600.woff2").exists()
    assert (SPECTRAL / "spectral-500-italic.woff2").exists()


def test_warm_palette_tokens():
    text = CSS.read_text(encoding="utf-8")
    assert "--body-bg: #f7f4ee" in text
    assert "--surface-card: #fffefb" in text


def test_new_token_systems_present():
    text = CSS.read_text(encoding="utf-8")
    for tok in ("--font-display", "--foil", "--podium-gold", "--h1-size", "--ring-gold"):
        assert tok in text, f"missing token {tok}"
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `uv run --extra dev --extra data pytest tests/test_assets.py -q`
Expected: FAIL — Spectral files missing, tokens not yet present.

Tasks 2–3 make this test pass.

---

## Task 2: Vendor the Spectral subset (Phase 0)

Only two faces are used: **600 roman** (page `<h1>`) and **500 italic** (subtitle). YAGNI — vendor exactly those. Google's `latin` subset already covers Icelandic glyphs (þ ð æ ö á é í ó ú ý), so the `woff2` files can be pulled straight from the Google CSS.

**Files:**
- Create: `app/static/fonts/spectral/spectral-600.woff2`
- Create: `app/static/fonts/spectral/spectral-500-italic.woff2`

- [ ] **Step 1: Resolve the woff2 URLs from Google's CSS**

```bash
mkdir -p app/static/fonts/spectral
curl -s -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" \
  "https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,600;1,500&display=swap"
```
Expected: two `@font-face` blocks. Inside each, note the `latin` block's `src: url(https://fonts.gstatic.com/...woff2)` (the one whose `unicode-range` includes `U+00C0-00FF` — that range carries the Icelandic letters). There will be one roman (600) and one italic (500).

- [ ] **Step 2: Download the two latin woff2 files**

```bash
# Substitute the two latin URLs printed above:
curl -s -o app/static/fonts/spectral/spectral-600.woff2        "<ROMAN_600_LATIN_URL>"
curl -s -o app/static/fonts/spectral/spectral-500-italic.woff2 "<ITALIC_500_LATIN_URL>"
ls -l app/static/fonts/spectral/
file app/static/fonts/spectral/*.woff2
```
Expected: two non-empty `*.woff2` files; `file` reports "Web Open Font Format (Version 2)".

- [ ] **Step 3: Verify Icelandic glyph coverage**

```bash
uv run --extra dev python - <<'PY'
from fontTools.ttLib import TTFont
for f in ("spectral-600.woff2", "spectral-500-italic.woff2"):
    ft = TTFont(f"app/static/fonts/spectral/{f}")
    cmap = ft.getBestCmap()
    need = "þÞðÐæÆöÖáéíóúýÁÉÍÓÚÝ"
    missing = [c for c in need if ord(c) not in cmap]
    print(f, "MISSING:", missing or "none")
PY
```
Expected: `MISSING: none` for both. If `fontTools` isn't available, `uv run --extra dev python -c "import fontTools"` first; if the extra lacks it, instead verify visually in Step-checks of Task 5 (the subtitle "ELO-stigaröðun" must render its ö). If any glyph is missing, the chosen subset was wrong — re-pick the `latin` (not `latin-ext`-only) URL.

---

## Task 3: Merge tokens + Spectral @font-face into `input.css` (Phase 1)

Replace the `:root`, `[data-theme="dark"]`, and font sections with the merged set. Keep `--bg-surface` and the `color-mix` utilities (production-only; the deliverable dropped them).

**Files:**
- Modify: `app/static/css/input.css:1-86`

- [ ] **Step 1: Replace `:root` (currently lines 2–30) with the merged warm token set**

```css
:root {
  /* ===== MTG mana colours ===== */
  --mtg-blue: #0e68ab;
  --mtg-green: #00733e;
  --mtg-red: #d3202a;
  --mtg-gold: #c9a84c;
  --mtg-black: #150b00;
  --mtg-white: #f9faf4;

  /* ===== Warm-paper surfaces & text (refresh) ===== */
  --text-primary: #241c12;
  --text-body: #3a2f22;
  --text-muted: #6f6354;
  --border-default: #e6e1d6;
  --surface-card: #fffefb;
  --surface-soft: #f4f1ea;
  --body-bg: #f7f4ee;
  --bg-surface: #16161e;          /* preserved from live (not in deliverable) */
  --blue-light: #eef3f8;

  /* ===== Chart tokens ===== */
  --chart-grid: #d4cfc9;
  --chart-blue-area-1: rgba(14, 104, 171, 0.12);
  --chart-blue-area-2: rgba(14, 104, 171, 0.25);

  /* ===== Podium metals ===== */
  --podium-gold: #c9a84c;
  --podium-silver: #a8a8a8;
  --podium-bronze: #b87333;

  /* ===== Win / loss semantics ===== */
  --win: var(--mtg-green);
  --loss: var(--mtg-red);

  /* ===== Gold accents (sparingly) ===== */
  --gold-soft: rgba(201, 168, 76, 0.10);
  --gold-line: rgba(201, 168, 76, 0.28);
  --gold-glow: rgba(201, 168, 76, 0.22);
  --foil: linear-gradient(135deg, #b8902f, #c9a84c 55%, #a07f30);

  /* ===== Radii (refresh: md 10->12, lg 12->14) ===== */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 14px;

  /* ===== Elevation — two-layer warm ===== */
  --shadow-soft:  0 1px 2px rgba(58, 42, 22, 0.04), 0 1px 6px rgba(58, 42, 22, 0.03);
  --shadow-card:  0 1px 2px rgba(58, 42, 22, 0.04), 0 4px 14px rgba(58, 42, 22, 0.06);
  --shadow-hover: 0 2px 5px rgba(58, 42, 22, 0.06), 0 10px 26px rgba(58, 42, 22, 0.10);
  --ring-gold:    0 0 0 1px rgba(201, 168, 76, 0.07);

  /* ===== Type families ===== */
  --font-body: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-display: "Spectral", Georgia, "Times New Roman", serif;
  --font-mana: "Mana";

  /* ===== Semantic type scale ===== */
  --h1-size: 2.25rem;  --h1-weight: 600;  --h1-tracking: 0;
  --h2-size: 1.5rem;   --h2-weight: 700;
  --h3-size: 1.25rem;  --h3-weight: 600;
  --subtitle-size: 1.1rem;  --subtitle-weight: 400;
  --body-size: 1rem;   --body-line: 1.6;
  --small-size: 0.875rem;
  --label-size: 12px;  --label-weight: 600;  --label-tracking: 0.05em;
  --stat-size: 1.5rem; --stat-weight: 700;
  --table-num: 16px;
}
```

- [ ] **Step 2: Replace `[data-theme="dark"]` (currently lines 32–56) with the merged dark set**

```css
[data-theme="dark"] {
  --mtg-blue: #3b9edd;
  --mtg-green: #2ecc71;
  --mtg-red: #e74c3c;
  --mtg-gold: #d4a843;
  --mtg-black: #0a0a0f;
  --mtg-white: #f0ece4;

  --text-primary: #e8e4dc;
  --text-body: #c8c4bc;
  --text-muted: #7a7670;
  --border-default: rgba(255, 255, 255, 0.10);
  --surface-card: rgba(255, 255, 255, 0.04);
  --surface-soft: rgba(255, 255, 255, 0.04);
  --body-bg: #0e0e14;
  --bg-surface: #16161e;
  --blue-light: rgba(59, 158, 221, 0.08);   /* refresh: dark-tinted hover (live left this light) */

  --chart-grid: rgba(255, 255, 255, 0.12);
  --chart-blue-area-1: rgba(59, 158, 221, 0.10);
  --chart-blue-area-2: rgba(59, 158, 221, 0.20);

  --gold-soft: rgba(212, 168, 67, 0.14);
  --gold-line: rgba(212, 168, 67, 0.40);
  --gold-glow: rgba(212, 168, 67, 0.32);
  --foil: linear-gradient(135deg, #9c7a28 0%, #e0c473 30%, #f3e4ab 46%, #d4a843 64%, #8a6a1e 100%);

  --shadow-soft:  0 2px 10px rgba(0, 0, 0, 0.30);
  --shadow-card:  0 6px 22px rgba(0, 0, 0, 0.38);
  --shadow-hover: 0 14px 38px rgba(0, 0, 0, 0.48);
}
```

- [ ] **Step 3: Add Spectral `@font-face` after the Inter block (after current line 64, before `@tailwind base;`)**

```css
@font-face {
  font-family: "Spectral";
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url("/static/fonts/spectral/spectral-600.woff2") format("woff2");
}
@font-face {
  font-family: "Spectral";
  font-style: italic;
  font-weight: 500;
  font-display: swap;
  src: url("/static/fonts/spectral/spectral-500-italic.woff2") format("woff2");
}
```

Leave the Inter `@font-face`, the three `@tailwind` directives, the `@layer base` block, and the `@layer utilities` `color-mix` rules exactly as they are. **Do not add an `@import`.**

- [ ] **Step 4: Rebuild Tailwind**

Run: `./scripts/build-css.sh`
Expected: regenerates `app/static/css/tailwind.css` with no errors. (This is required after any `input.css` change — the served CSS is the built file.)

- [ ] **Step 5: Make the invariant test pass**

Run: `uv run --extra dev --extra data pytest tests/test_assets.py -q`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Visually confirm the palette warmed site-wide**

`preview_start` (`mtgkubbur-is`), navigate to `/`, then `preview_inspect` `body` → expect `background-color: rgb(247, 244, 238)` (`#f7f4ee`). Spot-check a `.mtg-card`/`.score-table` reads `rgb(255, 254, 251)`.

- [ ] **Step 7: Commit**

```bash
git add app/static/fonts/spectral app/static/css/input.css app/static/css/tailwind.css tests/test_assets.py
git commit -m "feat(design): warm-parchment tokens + vendored Spectral; assets test"
```

---

## Task 4: Typography — Spectral titles (Phase 2a)

The base `h1` already inherits `var(--font-display)` once the token exists, but `.page-header h1` and `.subtitle` in `mtg.css` have their own (Inter) rules that must be updated.

**Files:**
- Modify: `app/static/css/mtg.css` (the `.page-header h1` and `.page-header .subtitle` blocks)

- [ ] **Step 1: Update `.page-header h1` to the display serif**

Find the current rule (`font-size: 2.5rem; font-weight: 700; color: #1a1008; letter-spacing: -0.02em;`) and replace its body to match `«DS»/components.css:77-81`:

```css
.page-header h1 {
  font-family: var(--font-display);
  font-size: var(--h1-size);
  font-weight: 600;
  color: #2a2013;
  margin: 0 0 0.4rem;
  letter-spacing: 0;
  line-height: 1.1;
}
```

- [ ] **Step 2: Update `.page-header .subtitle` to italic serif**

Match `«DS»/components.css:82-85`:

```css
.page-header .subtitle {
  font-family: var(--font-display);
  font-weight: 500;
  font-style: italic;
  color: #6f6354;
  font-size: 1.1rem;
  margin: 0;
  letter-spacing: 0;
}
```

Also add the dark overrides from `«DS»/components.css:93-95` (`[data-theme="dark"] .page-header h1/.subtitle/.page-desc`) if not already present.

- [ ] **Step 3: Verify the serif renders, with Icelandic glyphs, offline**

`preview_eval` reload `/`. `preview_inspect` `.page-header h1` → `font-family` must list `Spectral`. Confirm the subtitle (e.g. `ELO-stigaröðun`) shows correct ö in italic serif. Then in DevTools-equivalent, confirm no network request to `fonts.gstatic.com`/`fonts.googleapis.com` (the `preview_network` log should show only `/static/...` font fetches).

- [ ] **Step 4: Tests + commit**

Run: `uv run --extra dev --extra data pytest -q` → PASS (route smoke must stay green).
```bash
git add app/static/css/mtg.css
git commit -m "feat(design): Spectral display serif for page titles & subtitles"
```

---

## Task 5: Chrome — nav, hero, footer (Phase 2b)

Update three chrome blocks to the deliverable's versions. These use identical class names; **preserve any production-only declarations** in each block (notably ARIA/focus styles from the a11y commit `58c00c2` — diff before overwriting).

**Files:**
- Modify: `app/static/css/mtg.css` (`.site-nav*`, `.nav-*`, `.theme-toggle`, `.page-header*`, `.mana-pips*`, `.site-footer*`, `.footer-*`)

- [ ] **Step 1: Diff current vs target per block**

For each selector group, compare the current `mtg.css` rule against the target lines in `«DS»/components.css`: navbar 8–59, page-header (background/ring) 61–76 + 87–92, mana-pips 97–105, footer 284–300. List any production-only declarations to keep.

- [ ] **Step 2: Apply the navbar block**

Replace the `.site-nav`, `.site-nav::before/::after`, `.nav-brand`, `.nav-links`, `.nav-link(:hover/.active/.active::after)`, `.nav-right`, `.nav-skra(:hover)`, `.theme-toggle(:hover)`, and the two `[data-theme="dark"] .site-nav/.nav-link.active` rules with `«DS»/components.css:8-59` — re-adding any preserved ARIA/focus declarations from Step 1.

- [ ] **Step 3: Apply the page-header hero (gradient + frame ring) and mana-pips**

Replace the `.page-header` background/box-shadow, `.page-header::before` (frame ring), `.page-header::after`, the dark `.page-header` background, and `.mana-pips*` to match `«DS»/components.css:62-76, 87-92, 97-105`. **Keep** the `.page-header h1/.subtitle` rules from Task 4.

- [ ] **Step 4: Apply the footer block**

Replace `.site-footer(::before)`, `.footer-brand`, `.footer-tagline`, `.footer-nav(a)`, `.footer-mana-sep`, and the dark footer rules to match `«DS»/components.css:284-300`.

- [ ] **Step 5: Verify all five pages, light + dark**

`preview_start`; for each of `/`, `/throun`, `/einvigi`, `/kubbar`, `/dagatal`: screenshot light, then `preview_eval` `document.documentElement.setAttribute('data-theme','dark')` and screenshot dark. Confirm: gold nav hairline, parchment hero with faint ring, gold date badge, footer top-rule. No layout breaks.

- [ ] **Step 6: Tests + commit**

Run: `uv run --extra dev --extra data pytest -q` → PASS.
```bash
git add app/static/css/mtg.css
git commit -m "feat(design): gold-ruled nav, parchment hero ring, footer rule"
```

---

## Task 6: Score-table — rank medallions, podium, win-rate legibility (Phase 2c)

The **one template edit** of the whole plan, plus matching CSS. Podium row classes (`podium-1/2/3`) and the win-rate bar markup already exist in `index.html`; only the medallion span is new.

**Files:**
- Modify: `app/templates/index.html:64`
- Modify: `app/static/css/mtg.css` (score-table, `.rank-medallion*`, podium rows, `.winrate-bar-*`)

- [ ] **Step 1: Add the medallion span to the player cell**

Replace `app/templates/index.html:64`:

```jinja
            <td class="player-cell" data-sort="{{ r.nr }}">{{ r.nr }}. {{ r.player }}</td>
```
with:
```jinja
            <td class="player-cell" data-sort="{{ r.nr }}"><span class="rank-medallion{% if r.podium %} rank-{{ r.podium }}{% endif %}">{{ r.nr }}</span>{{ r.player }}</td>
```
(The `.rank-medallion` rule carries `margin-right: 11px`, so the trailing space is handled by CSS; the `"{{ r.nr }}. "` text prefix is intentionally dropped in favour of the disc.)

- [ ] **Step 2: Add the medallion + podium CSS**

Insert the rank-medallion and podium-row rules from `«DS»/components.css:188-210` into `mtg.css` (after the `.score-table` block). This includes `.rank-medallion`, `.rank-medallion.rank-1/2/3`, the dark overrides, and `.score-table tr.podium-1/2/3` (metal left-edge + light tint).

- [ ] **Step 3: Update score-table + win-rate bar styling**

Update `.score-table`, `.score-table thead/tbody/...`, and the `.winrate-bar-track/-fill` + `.winrate-label` rules to match `«DS»/components.css:152-186, 212-217`. The legibility win is the warm track background (`rgba(60,40,10,0.08)`), the `inset` track shadow, and the fill's `inset 0 1px 0 rgba(255,255,255,0.35)` sheen — the fill colour/width still come from the server (`r.bar_colour`, `r.pct`) inline.

- [ ] **Step 4: Verify the leaderboard**

`preview_start`, navigate `/`. Confirm: numbered medallion discs (1/2/3 gold/silver/bronze tint, rest plain), podium rows have a metal left edge + faint tint, win-rate bars are clearly filled red→green with visible track. `preview_inspect` `.rank-medallion.rank-1` → expect the gold-tinted `background-color`. Re-run search + sort (type in the search box, click an `S`/`ELO` header) to confirm `stigatafla.js` still works with the new cell markup.

- [ ] **Step 5: Tests + commit**

Run: `uv run --extra dev --extra data pytest -q` → PASS (esp. `test_rankings.py`, `test_pages.py`).
```bash
git add app/templates/index.html app/static/css/mtg.css
git commit -m "feat(design): rank medallions, podium accents, legible win-rate bars"
```

---

## Task 7: Chrome — remaining components (Phase 2d)

Cards, controls, badges, player-summary, head-to-head, affinity/data tables, delta pills, empty state. Pure CSS, identical class names.

**Files:**
- Modify: `app/static/css/mtg.css`

- [ ] **Step 1: Apply the remaining blocks**

Update these selector groups to match the cited `«DS»/components.css` ranges, preserving production-only declarations: generic `.mtg-card` 117–126; `.mtg-select`/`.score-table-search` 128–150; `.date-badge` 107–115; `.delta-pill*` 219–227; `.player-summary*` 229–242; `.h2h-*` 244–260; `.cube-affinity-title`/`.data-table*`/`.cube-record-pip`/`.calendar-next-event` 262–278; `.empty-state*` 280–282. Keep the `@media (max-width: 768px)` and `prefers-reduced-motion` rules (already present in production).

- [ ] **Step 2: Verify the affected pages**

`/throun` (player-summary strip, affinity table), `/einvigi` (h2h card + bar), `/kubbar` + `/dagatal` (data tables, date badge, next-event gold edge). Light + dark. Confirm delta pills (▲/▼) keep their green/red.

- [ ] **Step 3: Tests + commit**

Run: `uv run --extra dev --extra data pytest -q` → PASS.
```bash
git add app/static/css/mtg.css
git commit -m "feat(design): warm-polish cards, controls, summary, h2h, tables, badges"
```

---

## Task 8: Plot restyle — cleaner charts, keep uncertainty (Phase 3)

The bands stay. "Cleaner" = consistent tighter margins + a lighter grid across all six charts, factored into a shared helper to keep it DRY. Charts already read live tokens via `chartTheme()` (called inside each `render()`), so Task 3's tokens already flow.

**Files:**
- Modify: `app/static/js/theme.js` (add `basePlot` + `baseGridStyle`)
- Modify: `app/static/js/charts/{elo,rank,winrate,games,strength,elodiff}.js`

- [ ] **Step 1: Add shared options helpers to `theme.js`**

Append to `app/static/js/theme.js` (no `Plot` import needed — these return plain option objects):

```javascript
// Shared Plot.plot() top-level options (tighter margins, transparent bg, token text).
export function basePlot(t, container, height = 380) {
  return {
    width: container.clientWidth || 700,
    height,
    marginLeft: 54,
    marginRight: 18,
    marginBottom: 36,
    marginTop: 12,
    style: {
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: "12px",
      background: "transparent",
      color: t.text,
    },
  };
}

// Lighter, finer gridlines than the old 0.6 / "3,4" dash.
export function baseGridStyle(t) {
  return { stroke: t.grid, strokeOpacity: 0.45, strokeDasharray: "2,5" };
}
```

- [ ] **Step 2: Refactor `charts/elo.js` to use the helpers (worked example)**

Change the imports line 2 to include the helpers, and replace the top-level options + grid mark. New import:
```javascript
import { chartTheme, isMonth, basePlot, baseGridStyle } from "/static/js/theme.js";
```
Replace `Plot.plot({ width…, height…, marginLeft…, …, style: {…}, x:…, y:… })` opening (current lines 18–31) so the call begins:
```javascript
  const chart = Plot.plot({
    ...basePlot(t, container, 380),
    x: { type: "time", label: null, axis: null },
    y: { label: null, domain: [yMin, yMax], axis: null },
    color: {
      domain: [S.legend_90, S.legend_50, S.legend_median],
      range: [t.blueArea1, t.blueArea2, t.blue],
      legend: true,
    },
    marks: [
      Plot.gridY(baseGridStyle(t)),
```
Keep the rest of `marks` unchanged — **both `Plot.areaY` band marks (the 90% and 50% credible intervals), the median `lineY`, the `dot`, and the `text` stay exactly as-is.** This is the "keep uncertainty" guarantee.

- [ ] **Step 3: Apply the same transform to the other five charts**

For each of `rank.js`, `winrate.js`, `games.js`, `strength.js`, `elodiff.js`: (a) add `basePlot, baseGridStyle` to the `theme.js` import; (b) replace the inline `width/height/margin*/style` options with `...basePlot(t, container, <keep this file's existing height>)`; (c) replace the existing `Plot.gridY({...})` with `Plot.gridY(baseGridStyle(t))`. **Do not touch any data marks** (lines, areas, dots, the ELO-diff zero rule, etc.) — only the container options and the grid. Verify each file still has all its original marks after editing.

- [ ] **Step 4: Verify all six charts, light + dark, bands intact**

`preview_start`, `/throun` → select a player. Confirm ELO chart still shows the two shaded credible-interval bands + median + endpoint label, now over a lighter grid with consistent margins. Toggle dark (`preview_eval` set `data-theme=dark`) and re-select to re-render — confirm colours recolour and bands remain. Repeat the visual check on `/einvigi` (ELO-diff) and the player rank/win-rate/games charts.

- [ ] **Step 5: Tests + commit**

Run: `uv run --extra dev --extra data pytest -q` → PASS. (`uv run --extra dev ruff check .` — note: ruff is Python-only; JS isn't linted here.)
```bash
git add app/static/js/theme.js app/static/js/charts
git commit -m "feat(design): cleaner shared chart theme (tighter margins, lighter grid); bands kept"
```

---

## Task 9: QA pass — contrast, responsive, motion, dark

**Files:** none (verification only; fix forward into the relevant block if something fails)

- [ ] **Step 1: WCAG AA contrast on the warm palette**

Pre-computed: `--text-muted #6f6354` on `--body-bg #f7f4ee` ≈ **5.4:1**, on `--surface-card #fffefb` ≈ **5.8:1** — both pass AA (≥4.5:1). Verify the two real pairings with `preview_inspect` + a contrast check (e.g. the micro-labels `.label-eyebrow`/`thead th` colour vs their background). Also check `--text-body #3a2f22` on parchment (much higher). If any pairing fails, darken `--text-muted` one step in `input.css`, rebuild Tailwind, re-commit.

- [ ] **Step 2: Responsive**

`preview_resize` preset `mobile` (375×812): `/` table scrolls-x (no overflow break), `/throun` + `/einvigi` collapse to one column, nav wraps acceptably. Spot-check `tablet`.

- [ ] **Step 3: Reduced motion & dark glass**

Confirm the `prefers-reduced-motion` block still nulls transitions (`preview_resize`/emulate). In dark mode at ≥900px, confirm `.mtg-card` glass `backdrop-filter` blur renders.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix(design): QA — contrast/responsive/motion adjustments"
```
(Skip if Steps 1–3 needed no changes.)

---

## Task 10: Finalize — full suite, lint, docs

**Files:**
- Modify: `mtgkubbur.is/CLAUDE.md`

- [ ] **Step 1: Full green run**

Run: `uv run --extra dev --extra data pytest -q && uv run --extra dev ruff check .`
Expected: all pass, ruff clean.

- [ ] **Step 2: Update repo docs**

In `mtgkubbur.is/CLAUDE.md`, under the `app/static/` description, note: Spectral display serif vendored at `app/static/fonts/spectral/` (h1 + subtitles, `--font-display`); shared Plot options live in `theme.js` (`basePlot`/`baseGridStyle`); the design tokens follow the design spec in the Obsidian `Architecture/` vault.

- [ ] **Step 3: Commit + open PR**

```bash
git add mtgkubbur.is/CLAUDE.md
git commit -m "docs: note Spectral vendoring + shared plot theme"
git push -u origin feat/visual-refresh
gh pr create --title "Visual refresh: warm palette, Spectral, medallions, cleaner charts" \
  --body "Implements the design spec (Obsidian Architecture/MtG Kubbur Visual Refresh — Design Spec). Token-first warm-parchment palette, vendored Spectral serif, rank medallions + legible win-rate bars, gold-ruled chrome, and cleaner Observable Plot charts that keep the credible-interval bands. No stack/architecture change."
```

---

## Self-Review

**Spec coverage** (every spec section → a task):
- Decision 1 (full refresh) → Tasks 3 (tokens), 4 (type), 5 (nav/hero/footer), 6 (table/medallions), 7 (rest). ✓
- Decision 2 (vendor Spectral) → Tasks 2 (fonts), 3 (@font-face), 4 (apply). ✓
- Decision 3 (restyle plots, keep uncertainty) → Task 8 (bands explicitly preserved in Steps 2–3). ✓
- Decision 4 (in-place token-first) → ordering: tokens (3) before chrome (4–7) before plots (8). ✓
- Token delta table → Task 3 Steps 1–2 (every changed value + new system). ✓
- Chrome cherry-pick table → Tasks 4–7 (every named block, with `components.css` line refs). ✓
- Spectral vendoring detail → Task 2 (latin subset, 600 + 500i, glyph check). ✓
- Plot detail (`chartTheme`/bands) → Task 8. ✓
- Risks: contrast → Task 9.1 (pre-computed pass); medallion markup → Task 6.1; Icelandic glyphs → Task 2.3 + 4.3; token-before-charts ordering → enforced; Tailwind rebuild → Task 3.4; scope creep → "preserve production-only" in Tasks 5–7. ✓
- Verification (pytest/ruff, visual, offline, charts) → every task's verify step + Task 10. ✓

**Placeholder scan:** Only `<ROMAN_600_LATIN_URL>`/`<ITALIC_500_LATIN_URL>` (Task 2.2) and `<keep this file's existing height>` (Task 8.3) are intentional fill-ins resolved by the immediately preceding step — not vague TODOs. No "add error handling"/"write tests for the above" placeholders.

**Type/name consistency:** `basePlot(t, container, height)` and `baseGridStyle(t)` defined in Task 8.1 are used with those exact signatures in 8.2–8.3. `.rank-medallion` class (Task 6.2 CSS) matches the span class emitted in 6.1 template. Token names in the test (Task 1) match those written in Task 3.

---

## Execution note

This plan is for a **later session**. It is uncommitted on purpose (the deliverable is the plan). When executing, start at Pre-flight P.1 (branch first — the repo is on `master`).
