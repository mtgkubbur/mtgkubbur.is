# Rotisserie Deckbuilder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/rotisserie/deck` subpage where a player loads their pool, arranges it in mana-value columns (creatures above, non-creatures below), cuts to a sideboard, adds basic lands, and pulls still-available cards in as speculative picks.

**Architecture:** Pure frontend feature on the existing `/data/rotisserie` payload. One new template + one new JS module (string-template rendering, native HTML5 DnD, delegated events — same idiom as `rotisserie.js`). All user state in localStorage, derived deck = live pool + speculative − sideboard. Only backend change: the Scryfall card cache always includes the five basic lands.

**Tech Stack:** FastAPI + Jinja (route/template), vanilla ES module JS, hand-written CSS in `mtg.css`, pytest for server-side tests.

## Global Constraints

- All copy Icelandic in `app/strings.py` under `rotisserie_deck_*` keys (test enforces no hard-coded copy ≥ 4 chars in templates).
- Unlisted + `noindex`: no public page links to `/rotisserie/deck`; only `/rotisserie` ↔ `/rotisserie/deck` interlink.
- No new dependencies; no new files in `data/kubbur/` (rsync-exclude contract).
- Bump `?v=N` on any changed versioned asset tag (CSS links in `base.html`).
- Icelandic-text edits that won't byte-match via Edit → Python `str.replace` splice.
- Commit per task with `git -C` (parent-tree hook blocks bare git).

---

### Task 1: Basic lands in the card cache

**Files:**
- Modify: `scripts/fetch_rotisserie.py` (add `BASIC_LANDS`, `cache_names()`, use in `main`)
- Test: `tests/test_rotisserie_build.py`, `tests/test_rotisserie_schema.py`
- Regenerate: `data/kubbur/rotisserie_cards.json` (+ `rotisserie.json` timestamp churn, committed together)

**Interfaces:**
- Produces: `fetch_rotisserie.BASIC_LANDS: tuple[str, ...]` and `cache_names(cube_names: list[str]) -> list[str]` (cube order preserved, basics appended, deduped).
- The published `cards` payload then always contains `Plains/Island/Swamp/Mountain/Forest` entries with images — `rotisserie-deck.js` relies on this.

- [x] Step 1: failing tests — `cache_names` unit test + committed-data test asserting all five basics in `rotisserie_cards.json`.

```python
def test_cache_names_appends_basics_once():
    assert build.cache_names(["Explore", "Plains"]) == ["Explore", "Plains", "Island", "Swamp", "Mountain", "Forest"]
```

- [x] Step 2: run, expect FAIL (no `cache_names`).
- [x] Step 3: implement in `fetch_rotisserie.py`:

```python
BASIC_LANDS = ("Plains", "Island", "Swamp", "Mountain", "Forest")

def cache_names(cube_names: list[str]) -> list[str]:
    """Cube names plus the five basics the deckbuilder needs, deduped in order."""
    return list(dict.fromkeys([*cube_names, *BASIC_LANDS]))
```

and in `main()`: `cards = scryfall.merge_cache(_load(CARDS_PATH) or {}, cache_names(cube_names))`.

- [x] Step 4: regenerate data by running the fetch script (network); run full pytest — schema tests must pass unchanged (cards schema is per-entry, key-agnostic).
- [x] Step 5: commit.

### Task 2: Page shell — strings, route, template, link

**Files:**
- Modify: `app/strings.py` (new `rotisserie_deck_*` keys, Icelandic), `app/routes/rotisserie.py` (add route), `app/templates/rotisserie.html` (link to deck page)
- Create: `app/templates/rotisserie_deck.html`
- Test: `tests/test_rotisserie_deck_page.py` (new), `tests/test_rotisserie_page.py` (nav policy for both unlisted pages)

**Interfaces:**
- Produces: GET `/rotisserie/deck` → 200 HTML, `noindex`, mount points `rd-topbar`, `rd-columns`, `rd-side`, `rd-available`, `rd-filters`, `rd-popover`, `rot-lightbox`; loads `/static/js/rotisserie-deck.js?v=1`.
- Route handler mirrors `rotisserie()` with `page="rotisserie_deck"`, header from `S.rotisserie_deck_title` / `S.rotisserie_deck_desc`.

- [x] Step 1: failing tests (new file mirrors `test_rotisserie_page.py`: renders, noindex, mount points, module loaded, absent from public navs; parent page links to `/rotisserie/deck`; deck page links back).
- [x] Step 2: run, expect FAIL (404).
- [x] Step 3: implement strings + route + templates. Template body: topbar div, columns div, sideboard section, available `<details>` with the same filter control ids pattern as the parent (`rd-search`, `rd-colour-filters`, `rd-cmc-filters`, `rd-type-filter`, `rd-clear`), popover div, lightbox div.
- [x] Step 4: pytest passes.
- [x] Step 5: commit.

### Task 3: Deck JS — state, derivation, rendering (no drag yet)

**Files:**
- Create: `app/static/js/rotisserie-deck.js`
- Modify: `app/static/css/mtg.css` (minimal layout: columns grid, piles, spec/lost markers), `app/templates/base.html` (CSS `?v` bump)

**Interfaces (module-internal, exact names):**
- `loadState(player) -> state` / `saveState(player, state)` — localStorage `rot-deck:<player>`, version-checked (`version !== 1` → fresh state), `rot-deck:last-player` for the selector default.
- `reconcile(state, poolNames, remainingCounts)` — speculative→real/lost rules from the spec; clamps sideboard counts to owned copies.
- `deriveBoards(poolNames, state) -> {columns, lands, side, counts}` where `columns[0..7] = {creatures: Entry[], noncreatures: Entry[]}`, `Entry = {name, card, spec, lost}`; lands = drafted non-basic lands (front-face type check identical to `rotisserie.js`); deck cards file by `cmcBucket`; `pile_overrides` decide the pile, natural type otherwise.
- `isCreature(entry)`, `cmcBucket(card)`, `colourGroup(card)`, `primaryType(card)`, `esc()` — copied from `rotisserie.js` (duplication accepted: the two modules must not couple; noted in both file headers).

- [x] Step 1: implement state + derivation + render functions; render player select, counts (total incl. basics, creatures, lands), eight fixed MV columns with two labelled piles each, lands column with five steppers, sideboard strip, available browser with filters (reuse parent page's filter logic shape), spec cards dashed + badge, lost cards marked with dismiss.
- [x] Step 2: verify in preview browser (read_page + screenshot): correct pools for two different players, duplicates (Diddi's two Explores render as two tiles), state survives reload.
- [x] Step 3: commit.

### Task 4: Interactions — popover, drag, steppers, export, reset

**Files:**
- Modify: `app/static/js/rotisserie-deck.js`, `app/static/css/mtg.css` (drop highlight, popover)

**Interfaces:**
- Delegated `click` → `openPopover(target)`: deck card → to-sideboard / switch-pile (non-lands) / enlarge / (spec: remove-spec); sideboard card → to-deck / enlarge; lost chip → dismiss; available card → add-spec / enlarge. Popover closes on outside click/Escape.
- HTML5 DnD: `dragstart` on tiles sets `{name, from}` JSON; dropzones = creature pile, non-creature pile, lands column (no-op target), sideboard, available region (drop = remove speculation). Drop on a pile stores/clears `pile_overrides[name]` relative to natural type; drop from available → add speculative.
- Steppers mutate `state.basics`; export builds `"N Name"` lines + `Hliðarborð:` section → `navigator.clipboard.writeText`; reset = `confirm(S.rotisserie_deck_reset_confirm)` → drop storage key, re-derive.

- [x] Step 1: implement; every mutation runs `saveState` then a full re-render (same immediate-mode idiom as the parent page).
- [x] Step 2: preview verification of each action path (popover moves, drag deck↔side, pile override, stepper, export writes clipboard, reset clears).
- [x] Step 3: commit.

### Task 5: Verification & ship

- [x] `uv run --extra dev --extra data pytest tests/ -q` — all pass.
- [x] `uv run --extra dev ruff check .` — clean.
- [x] Preview walkthrough with screenshots (light + dark, desktop + narrow).
- [x] Review pass (workflow: correctness/state/XSS dimensions, adversarially verified); fix confirmed findings.
- [x] Update `mtgkubbur.is/CLAUDE.md` architecture bullet (deck subpage exists, asset-version note) in the same commit as any fix.
- [x] `git -C … push` (Fly auto-deploys; hard-reload after deploy per post-deploy rule).

## Self-review

- Spec coverage: data change (T1), page shell + unlisted policy (T2), layout/state/derivation (T3), all interactions incl. speculation + export + reset (T4), testing/i18n (T2–T5). Export cross-device import is read-by-eye (copy list), matching spec ("escape hatch") — no import parser in v1.
- Deviation from spec, deliberate: available-browser click opens the action popover (add-spec inside it) instead of instant-add, for consistency with the click idiom everywhere else on the page; prevents accidental adds. Spec text updated? No — recorded here.
- Types consistent: `Entry` shape and function names used across T3/T4 as listed.
