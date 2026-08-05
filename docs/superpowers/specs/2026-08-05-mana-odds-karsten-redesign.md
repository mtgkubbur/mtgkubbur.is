# Mana odds panel — Karsten-style redesign

**Date:** 2026-08-05 · **Page:** `/rotisserie/deck` (unlisted) · **Status:** approved design, pending implementation
**Predecessor:** `2026-08-04-rotisserie-deckbuilder-design.md` (panel v1: unconditional P(≥1 source), turns 1–4)

## Goal

Replace the panel's "P(≥1 land source seen)" grid with a defensible model of
**P(can pay k pips of colour X on turn t)**, and display it in a form that tells a
drafter both *how likely* their manabase is to work and *what to change*.

## Model

For a deck of `N` cards with `L` lands, `K` of which are sources of colour X
(per `manaSources()`, with the fetch fix below), the probability of casting a
cost with `k` X-pips on turn `t` **on the play** is the conditional bivariate
hypergeometric

```
P(cast) = P(sources_seen ≥ k AND lands_seen ≥ t) / P(lands_seen ≥ t)
```

over the `n = 7 + (t − 1)` cards seen by turn t, computed exactly as a double
sum over (sources seen `s`, other lands seen `l`):

```
num = Σ_{s≥k} Σ_{l: s+l≥t} C(K,s)·C(L−K,l)·C(N−L, n−s−l) / C(N,n)
den = Σ_{j≥t} C(L,j)·C(N−L, n−j) / C(N,n)
```

This is exactly Frank Karsten's 2022 criterion (["A 2022 Update",
TCGplayer](https://www.tcgplayer.com/content/article/How-Many-Sources-Do-You-Need-to-Consistently-Cast-Your-Spells-A-2022-Update/dc23a7d2-0a16-4c0b-ad36-586fcca03ad8/)):
conditioning on hitting land drops separates colour screw from mana screw.
The only Karsten ingredient dropped is the London-mulligan simulation, which
keeps the model closed-form and deterministic in the browser.

**Validation (done 2026-08-05, Python `math.comb`):** at Karsten's 89+M%
thresholds this model reproduces his published 40-card/17-land column exactly
for 14 of 15 costs (C@T1: ours 10 vs his 9 — the one spot mulligans help; we
err strict), and his 60-card/25-land column on 5 of 6. Cross-check against an
independent mulligan simulation (teryror gist) agrees within ±1 everywhere.
Computing thresholds live from the deck's actual N and L beats quoting his
static table: rotisserie decks mid-build are rarely exactly 40/17.

**Sources-needed target:** `sourcesNeeded(N, L, k, t)` = smallest K with
P(cast) ≥ `(89 + t) / 100`, where `t` is the (already 6-capped) cast turn —
i.e. 90% for turn-1 costs rising to 95% at turn 6, matching Karsten's
"consistency should rise with mana value" (his M = our t for ordinary costs).
Searched over K = 0..L; if even K = L falls short, the target renders `L+`
(the deck cannot reach the criterion with its current land count).

## Display (Option C — requirement rows, user-approved)

One row per **colour × pip-count actually present in the deck's spells**,
evaluated at the earliest turn the deck wants it — the binding constraint,
since for fixed pips the required sources only fall as turns pass.

```
⚪ W  á T2    94%   11/9   ✓
⚪ WW á T3    82%   11/12  −1
🔵 U  á T1    89%   8/10   −2
```

- **Row derivation:** for each deck spell, parse the front face of
  `mana_cost` (`split(" // ")[0]`), count `{W}{U}{B}{R}{G}` pips per colour.
  Each cost with `k ≥ 1` pips of colour X contributes candidate
  `t = clamp(max(cmc, k), k, 6)`. Rows are the distinct (X, k) pairs, with
  `t = min` over that pair's candidates. Sort WUBRG, then k ascending.
- **Cells:** k pip icons (mana-font, existing classes) + `á T{t}` ·
  rounded percentage · `K/needed` · badge: ✓ when K ≥ needed, else −shortfall.
  Row classes `rd-mana-ok` / `rd-mana-short` for colour-coding.
- **Empty/edge cases:** no spells with coloured pips → panel hidden (as now).
  `L < t` or denominator 0 (e.g. no lands yet) → percentage renders `—` and
  needed renders `L+`. Speculative cards count as deck cards (they already do:
  boards derive from pool + speculative − sideboard). Basics count via
  `state.basics` as today.
- **Note string** (Icelandic copy, English MTG terms) states the assumptions:
  on the play, no mulligans, conditioned on hitting land drops each turn,
  fetch lands count for colours they can reach, tapped/untapped not
  distinguished, Karsten-2022 criterion for the "needed" target.

## Fetch-land colour fix (user-requested 2026-08-05)

The v1 `manaSources()` credits a fetch land only with the colours of the basic
*types* it names (Mountain → R), missing colours that ride along on fetchable
duals: a R/G fetch in a deck with Steam Vents (Island **Mountain**) and
Overgrown Tomb (Swamp **Forest**) can fetch into U and B too, so it is a
R/G/U/B source. New rule — for each basic type `T`, precompute
`reachColours[T]` = (colour of `T` if a basic `T` is in the deck) ∪ union of
`produced_mana` over non-fetch deck lands whose type line carries `T`; each
**typed** fetch land then counts as one source of every colour in
`⋃ reachColours[T]` over its `fetch_types` (union set — one credit per colour,
however many routes reach it). This matches Karsten's "full source for any
colour it might be able to fetch", extended to everything the fetched land
produces.

**Two fetch classes** (the pool has both: 10 typed fetches, plus Fabled
Passage and Prismatic Vista): a typed fetch ("search for a Plains or Island
card") can fetch nonbasic typed lands, but a basics-only fetch ("search for a
basic land card") cannot — v1 already overcounts here, crediting Fabled
Passage with R when the deck's only "Mountain" is Steam Vents. The cache's
`fetch_types` can't tell them apart (basics-only fetches list all five
types), so `scryfall.py` gains `fetch_basics_only: bool` set in the existing
"basic land" oracle-text branch; **CACHE_VERSION 3 → 4** (full rebuild via
`uv run --extra data python scripts/fetch_rotisserie.py`). Basics-only
fetches credit `BASIC_COLOURS[T]` only for types `T` with a basic `T`
actually in the deck.

## Simplifications (stated, deliberate)

- No mulligans (validated: ≤1 source difference vs Karsten, strict side).
- Turn-1 rows ignore that some sources enter tapped (cache has no ETB data);
  the pool is basics-heavy so the error is small.
- Adventures/MDFCs: front-face cost only. `{X}` = generic. The pool's one
  hybrid cost (Spectral Procession, `{2/W}×3`) counts as generic (undercounts
  its W hunger). Nonland mana producers are not sources.
- Turn capped at 6 for both probability and needed-target searches.
- Each land counts once per colour it can produce; cross-colour contention
  (the same duals doing double duty for a WW **and** a UU requirement) is not
  modelled — Karsten's own gold-card caveat. Fetch depletion (the fetched
  dual already drawn) likewise ignored, per Karsten's full-source convention.

## Implementation

- `app/static/js/rotisserie-deck.js`:
  - `manaSources()`: apply the fetch-land colour fix (signature and export
    unchanged). Remove `hitProbability()`.
  - New pure exports: `castProbability(deckSize, lands, sources, pips, turn)`,
    `sourcesNeeded(deckSize, lands, pips, turn)`, `pipRequirements(spellCards)`.
  - Binomials as float products (`r *= (n−i)/(i+1)`); values ≤ C(60,30) ≈ 1.2e17
    are fine in doubles (relative error ~1e-15, far below display precision).
  - `renderMana()` rewritten to the row spec above; recompute on every
    `render()` as today.
- `app/templates/rotisserie_deck.html`: bump script tag `?v=2` → `?v=3`.
- `app/strings.py`: replace `rotisserie_deck_mana_note`; add keys for the
  needed/shortfall labels; drop unused keys if orphaned.
- `scripts/rotisserie/scryfall.py`: add `fetch_basics_only` to flattened
  cards (see fetch-fix section), bump `CACHE_VERSION` to 4, run the fetch
  script to rebuild and republish `rotisserie_cards.json`. No other cache
  changes: v3 already ships `mana_cost` for all 544 non-lands (verified
  2026-08-05).

## Verification (before shipping)

1. Python oracle: an independent `math.comb` implementation of the formulas
   in this spec (recreated at verification time — the model is fully
   specified above). Displayed percentages and needed-counts must match
   exactly; raw probabilities within 1e-9.
2. Browser: dynamic-import the module in the preview, feed synthetic states
   (incl. adventures, 0-land deck, CCC-only colour), compare against oracle
   values; screenshot the rendered panel. `manaSources()` battery must cover
   the fetch fix: RG fetch + Steam Vents + Overgrown Tomb → fetch credits
   R, G, U and B; triome via one type credits all three colours; fetch with
   no reachable typed land credits nothing; Fabled Passage + Steam Vents +
   no basic Island/Mountain credits nothing (v1 wrongly gave R).
3. `uv run --extra dev --extra data pytest tests/ -q` (204 baseline as of
   2026-08-05) and `uv run --extra dev ruff check .` stay green.

## Out of scope

Per-spell castability list, mulligan simulation, untapped-source T1
distinction, nonland mana sources, hybrid-aware pip logic, on-the-draw toggle.
