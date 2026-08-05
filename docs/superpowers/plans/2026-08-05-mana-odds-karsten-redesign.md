# Mana Odds Karsten Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/rotisserie/deck` mana panel's P(≥1 source) grid with Karsten-2022 conditional castability rows (probability + have/need sources per colour × pip-count), including the fetch-land colour fix.

**Architecture:** Pure exported maths in `rotisserie-deck.js` (conditional bivariate hypergeometric, float binomials); pip requirements derived client-side from cached `mana_cost`; a new `fetch_basics_only` flag flows from `scryfall.py` (cache v4) so typed fetches credit fetchable-dual colours while basics-only fetches credit only deck basics. Spec: `docs/superpowers/specs/2026-08-05-mana-odds-karsten-redesign.md`.

**Tech Stack:** FastAPI/Jinja app, vanilla ES-module JS (no test runner — browser-verified), pytest + ruff via `uv`, Scryfall card cache.

## Global Constraints

- Working dir: `/Users/brynjolfurjonsson/MagicTheGathering/mtgkubbur.is`. Always `git -C` (parent-tree hook blocks bare git). `git -C … pull --ff-only` before starting and before pushing (30-min rotisserie sync cron pushes data commits; if push bounces, rebase onto sync commits and re-run the fetch script).
- Push auto-deploys to Fly — do NOT push until Task 5.
- Tests: `uv run --extra dev --extra data pytest tests/ -q` (baseline 204 passed, 2026-08-05). Lint: `uv run --extra dev ruff check .`. Always `uv run`, never bare python for project code.
- UI copy lives in `app/strings.py` (`is` dict only); MTG terms stay English (Mana odds, sources, turn, play, fetch), surrounding copy Icelandic.
- Versioned-asset convention: bump `?v=` on `rotisserie-deck.js` in `app/templates/rotisserie_deck.html` (2 → 3) in the same change as the JS edit.
- Turn cap: 6. Consistency threshold: `(89 + min(turn, 6)) / 100`. On the play: cards seen by turn t = `7 + (t − 1)`.
- JS maths functions must stay pure and exported (`manaSources`, `castProbability`, `sourcesNeeded`, `pipRequirements`); `hitProbability` and `TURNS` are removed.

---

### Task 1: `fetch_basics_only` cache flag (scryfall.py, TDD)

**Files:**
- Modify: `scripts/rotisserie/scryfall.py` (flatten_card, ~lines 107–137; `CACHE_VERSION` line 29)
- Modify: `data/kubbur-schemas/rotisserie_cards.schema.json` (add property, NOT required yet)
- Test: `tests/test_rotisserie_cards.py`

**Interfaces:**
- Produces: every flattened card dict gains `"fetch_basics_only": bool` (True only for fetch lands whose oracle mentions basic-ness, e.g. Fabled Passage; False for typed fetches like Flooded Strand and for all non-fetch cards). `scryfall.CACHE_VERSION == 4`.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_rotisserie_cards.py` (reuse the existing Flooded Strand / Fabled Passage literals already in that file as models):

```python
def test_flatten_typed_fetch_is_not_basics_only():
    """Flooded Strand can fetch any Plains/Island CARD, duals included."""
    fetch = {
        "name": "Flooded Strand",
        "type_line": "Land",
        "oracle_text": (
            "{T}, Pay 1 life, Sacrifice Flooded Strand: Search your library "
            "for a Plains or Island card, put it onto the battlefield, then shuffle."
        ),
        "image_uris": {"small": "s", "normal": "n"},
    }
    assert scryfall.flatten_card(fetch)["fetch_basics_only"] is False


def test_flatten_generic_basic_fetcher_is_basics_only():
    passage = {
        "name": "Fabled Passage",
        "type_line": "Land",
        "oracle_text": (
            "{T}, Sacrifice Fabled Passage: Search your library for a basic land card, "
            "put it onto the battlefield tapped, then shuffle."
        ),
        "image_uris": {"small": "s", "normal": "n"},
    }
    out = scryfall.flatten_card(passage)
    assert out["fetch_basics_only"] is True
    assert out["fetch_types"] == ["Plains", "Island", "Swamp", "Mountain", "Forest"]


def test_flatten_typed_basic_fetcher_is_basics_only():
    """Panorama-style: names types AND restricts to basics — both facts must survive."""
    panorama = {
        "name": "Bant Panorama",
        "type_line": "Land",
        "oracle_text": (
            "{1}, {T}, Sacrifice Bant Panorama: Search your library for a basic "
            "Plains, Island, or Forest card, put it onto the battlefield tapped, then shuffle."
        ),
        "image_uris": {"small": "s", "normal": "n"},
    }
    out = scryfall.flatten_card(panorama)
    assert out["fetch_types"] == ["Plains", "Island", "Forest"]
    assert out["fetch_basics_only"] is True


def test_flatten_nonbasic_wording_does_not_trip_basics_only():
    r"""\bbasic\b must not match inside 'nonbasic'."""
    weirdo = {
        "name": "Ruin Grinder Test Land",
        "type_line": "Land",
        "oracle_text": "Search your library for a nonbasic Mountain card and exile it.",
        "image_uris": {"small": "s", "normal": "n"},
    }
    assert scryfall.flatten_card(weirdo)["fetch_basics_only"] is False


def test_flatten_non_fetch_card_defaults_basics_only_false():
    assert scryfall.flatten_card(SAMPLE["Lightning Bolt"])["fetch_basics_only"] is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run --extra dev --extra data pytest tests/test_rotisserie_cards.py -q`
Expected: 5 new tests FAIL with `KeyError: 'fetch_basics_only'`; existing tests pass.

- [ ] **Step 3: Implement** in `scripts/rotisserie/scryfall.py`:
  - Add `import re` to the imports if not present.
  - Change line 29 to `CACHE_VERSION = 4  # bump whenever flatten_card's output shape changes`.
  - Replace the fetch block (currently lines 116–120) with:

```python
    fetch_types: list[str] = []
    fetch_basics_only = False
    if "search your library" in oracle.lower() and "Land" in card.get("type_line", ""):
        fetch_types = [t for t in BASIC_TYPES if t in oracle]
        if not fetch_types and "basic land" in oracle.lower():
            fetch_types = list(BASIC_TYPES)
        # Fabled Passage / Panoramas fetch only BASIC cards; Flooded Strand
        # fetches any Plains/Island card, typed duals included. \b keeps
        # "nonbasic" from matching.
        fetch_basics_only = bool(fetch_types) and bool(
            re.search(r"\bbasic\b", oracle, re.IGNORECASE)
        )
```

  - Add `"fetch_basics_only": fetch_basics_only,` to the returned dict directly after `"fetch_types": fetch_types,`.
  - In `data/kubbur-schemas/rotisserie_cards.schema.json`, add to the card-object `properties` (do NOT add to `required` yet — the published JSON is still v3 until Task 2 and the schema test validates it on every run):

```json
   "fetch_basics_only": {
    "type": "boolean"
   },
```

- [ ] **Step 4: Run the full suite + lint**

Run: `uv run --extra dev --extra data pytest tests/ -q && uv run --extra dev ruff check .`
Expected: 209 passed, ruff clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/brynjolfurjonsson/MagicTheGathering/mtgkubbur.is add scripts/rotisserie/scryfall.py data/kubbur-schemas/rotisserie_cards.schema.json tests/test_rotisserie_cards.py
git -C /Users/brynjolfurjonsson/MagicTheGathering/mtgkubbur.is commit -m "feat: distinguish basics-only fetches in card cache (v4)

Typed fetches (Flooded Strand) can fetch nonbasic typed duals; basics-only
fetches (Fabled Passage, Panoramas) cannot. The deckbuilder's mana maths
needs the distinction to count fetch colour sources correctly."
```

---

### Task 2: Rebuild and publish the v4 cache

**Files:**
- Regenerate: `data/kubbur/rotisserie_cards.json` (and possibly `data/kubbur/rotisserie.json`)
- Modify: `data/kubbur-schemas/rotisserie_cards.schema.json` (now add `fetch_basics_only` to `required`)

**Interfaces:**
- Consumes: Task 1's `CACHE_VERSION = 4` (stale marker forces full rebuild).
- Produces: published cache where every card carries `fetch_basics_only`; the deckbuilder JS (Task 3) reads it via `/data/rotisserie`.

- [ ] **Step 1: Sync then rebuild** (GOOGLE_MAIL auth is always available — just run it; full Scryfall rebuild takes a few minutes)

```bash
git -C /Users/brynjolfurjonsson/MagicTheGathering/mtgkubbur.is pull --ff-only
cd /Users/brynjolfurjonsson/MagicTheGathering/mtgkubbur.is && uv run --extra data python scripts/fetch_rotisserie.py
```

- [ ] **Step 2: Sanity-check the rebuilt cache** (Python, not grep — machine convention):

```bash
cd /Users/brynjolfurjonsson/MagicTheGathering/mtgkubbur.is && uv run python - <<'EOF'
import json
data = json.load(open("data/kubbur/rotisserie_cards.json", encoding="utf-8"))
assert data["__cache_meta__"]["version"] == 4, data["__cache_meta__"]
cards = {k: v for k, v in data.items() if not k.startswith("__")}
fetches = {n: c for n, c in cards.items() if c.get("fetch_types")}
basics_only = sorted(n for n, c in fetches.items() if c["fetch_basics_only"])
typed = sorted(n for n, c in fetches.items() if not c["fetch_basics_only"])
assert basics_only == ["Fabled Passage", "Prismatic Vista"], basics_only
assert len(typed) == 10 and "Flooded Strand" in typed, typed
assert all("fetch_basics_only" in c for c in cards.values())
print(f"OK: {len(cards)} cards, {len(typed)} typed fetches, {len(basics_only)} basics-only")
EOF
```

Expected: `OK: 544 cards, 10 typed fetches, 2 basics-only` (544 counted on 2026-08-05, basics included; the count may drift with cube edits — the assertions are what matter).

- [ ] **Step 3: Tighten the schema** — in `rotisserie_cards.schema.json`, add `"fetch_basics_only"` to the card-object `required` array (after `"fetch_types"`).

- [ ] **Step 4: Full suite** — `uv run --extra dev --extra data pytest tests/ -q`
Expected: 209 passed (schema test now validates the rebuilt payload against the tightened schema).

- [ ] **Step 5: Commit** (data commits must land immediately — the sync cron also writes these files)

```bash
git -C /Users/brynjolfurjonsson/MagicTheGathering/mtgkubbur.is add data/kubbur/rotisserie_cards.json data/kubbur/rotisserie.json data/kubbur-schemas/rotisserie_cards.schema.json
git -C /Users/brynjolfurjonsson/MagicTheGathering/mtgkubbur.is commit -m "data: rebuild card cache at v4 with fetch_basics_only"
```

---

### Task 3: JS maths + panel rewrite + strings + CSS + version bump

**Files:**
- Modify: `app/static/js/rotisserie-deck.js` (mana section, lines 346–439)
- Modify: `app/strings.py` (lines 164–170)
- Modify: `app/static/css/mtg.css` (after line 1485)
- Modify: `app/templates/rotisserie_deck.html` (script tag, `?v=2` → `?v=3`)

**Interfaces:**
- Consumes: `card.fetch_basics_only`, `card.mana_cost`, `card.cmc` from the v4 cache; `boards.counts.total` / `boards.counts.lands` from `deriveBoards()`.
- Produces (pure exports, used by Task 4's verification):
  - `manaSources(landCards, basicsCounts) -> {W,U,B,R,G: int}` (signature unchanged, fetch fix inside)
  - `castProbability(deckSize, lands, sources, pips, turn) -> number` (0 when the conditioning event is impossible)
  - `sourcesNeeded(deckSize, lands, pips, turn) -> int | null` (null = unreachable at this land count)
  - `pipRequirements(spellCards) -> {W,U,B,R,G: {pipCount: earliestTurn}}`

- [ ] **Step 1: Replace the mana-odds section** of `rotisserie-deck.js` (everything from the `// ── Mana odds ──` comment through the end of `renderMana`, lines 346–439) with:

```js
// ── Mana odds ──
const BASIC_COLOURS = { Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G" };
const WUBRG = ["W", "U", "B", "R", "G"];
const MAX_TURN = 6;

// Colour sources among the deck's lands (drafted lands + basics), exported
// pure for console testing. A TYPED fetch (Flooded Strand) counts as one
// source of every colour reachable through its fetchable types — including
// the off-type colours of typed duals (fetching Steam Vents via "Mountain"
// also yields U). A basics-only fetch (Fabled Passage) counts only colours
// of basics actually in the deck. basicsCounts is a plain {Plains: n, ...}.
export function manaSources(landCards, basicsCounts) {
  const counts = Object.fromEntries(WUBRG.map((c) => [c, 0]));
  for (const [basic, n] of Object.entries(basicsCounts)) {
    const colour = BASIC_COLOURS[basic];
    if (colour) counts[colour] += Math.max(0, n);
  }

  const producers = landCards.filter((c) => !(c?.fetch_types || []).length);
  for (const card of producers) {
    for (const colour of card?.produced_mana || []) {
      if (colour in counts) counts[colour] += 1;
    }
  }

  // Per basic type: every colour a fetched land of that type could produce.
  const reachColours = {};
  for (const [type, colour] of Object.entries(BASIC_COLOURS)) {
    const set = new Set();
    if ((basicsCounts[type] || 0) > 0) set.add(colour);
    for (const card of producers) {
      if ((card?.type_line || "").includes(type)) {
        for (const c of card?.produced_mana || []) {
          if (c in counts) set.add(c);
        }
      }
    }
    reachColours[type] = set;
  }

  for (const card of landCards) {
    const fetchable = card?.fetch_types || [];
    if (!fetchable.length) continue;
    const colours = new Set();
    for (const type of fetchable) {
      if (card.fetch_basics_only) {
        if ((basicsCounts[type] || 0) > 0) colours.add(BASIC_COLOURS[type]);
      } else {
        for (const c of reachColours[type]) colours.add(c);
      }
    }
    for (const c of colours) counts[c] += 1;
  }
  return counts;
}

// Float binomial: exact integers up to C(60,30) ≈ 1.2e17 are represented
// with ~1e-15 relative error in doubles — far below display precision.
function comb(n, k) {
  if (k < 0 || k > n) return 0;
  const m = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < m; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

// Karsten-2022 castability: P(≥pips colour sources among cards seen by
// `turn` on the play | ≥turn lands seen). Sources are a subset of lands.
// Returns 0 when the conditioning event is impossible (e.g. lands < turn).
export function castProbability(deckSize, lands, sources, pips, turn) {
  const N = Math.floor(deckSize);
  if (N <= 0 || pips <= 0 || turn < pips) return 0;
  const L = Math.min(Math.floor(lands), N);
  const K = Math.min(Math.floor(sources), L);
  const n = Math.min(7 + turn - 1, N);
  let den = 0;
  for (let j = turn; j <= Math.min(L, n); j++) den += comb(L, j) * comb(N - L, n - j);
  if (den <= 0) return 0;
  let num = 0;
  for (let s = pips; s <= Math.min(K, n); s++) {
    for (let l = Math.max(0, turn - s); l <= Math.min(L - K, n - s); l++) {
      num += comb(K, s) * comb(L - K, l) * comb(N - L, n - s - l);
    }
  }
  return num / den;
}

// Smallest source count reaching Karsten's 89+turn % consistency target
// (turn is already capped at MAX_TURN by pipRequirements), or null when
// even all-lands-of-this-colour falls short.
export function sourcesNeeded(deckSize, lands, pips, turn) {
  const threshold = (89 + Math.min(turn, MAX_TURN)) / 100;
  for (let K = pips; K <= lands; K++) {
    if (castProbability(deckSize, lands, K, pips, turn) >= threshold) return K;
  }
  return null;
}

// The deck's actual colour requirements: for each colour, each distinct
// same-colour pip count k among spell costs, at the earliest turn the deck
// wants it — t = clamp(max(cmc, k), ·, MAX_TURN). Front face only for
// adventures/MDFCs; hybrid and {X} symbols are not pure pips and don't
// count (stated simplification in the panel note).
export function pipRequirements(spellCards) {
  const reqs = Object.fromEntries(WUBRG.map((c) => [c, {}]));
  for (const card of spellCards) {
    const cost = String(card?.mana_cost || "").split(" // ")[0];
    const cmc = Math.floor(card?.cmc ?? 0);
    const pipCounts = {};
    for (const m of cost.matchAll(/\{([WUBRG])\}/g)) {
      pipCounts[m[1]] = (pipCounts[m[1]] || 0) + 1;
    }
    for (const [colour, k] of Object.entries(pipCounts)) {
      const t = Math.min(Math.max(cmc, k), MAX_TURN);
      const cur = reqs[colour][k];
      reqs[colour][k] = cur === undefined ? t : Math.min(cur, t);
    }
  }
  return reqs;
}

function renderMana(boards) {
  const landCards = boards.lands.map((e) => e.card);
  const sources = manaSources(landCards, state.basics);
  const spellCards = boards.columns
    .flatMap((c) => [...c.creatures, ...c.noncreatures])
    .map((e) => e.card);
  const reqs = pipRequirements(spellCards);

  const rows = [];
  for (const colour of WUBRG) {
    const ks = Object.keys(reqs[colour]).map(Number).sort((a, b) => a - b);
    for (const k of ks) rows.push({ colour, pips: k, turn: reqs[colour][k] });
  }
  if (!rows.length) {
    els.mana.hidden = true;
    return;
  }

  const N = boards.counts.total;
  const L = boards.counts.lands;
  const pipFor = Object.fromEntries(COLOUR_GROUPS.map((g) => [g.key, g.pip]));
  const body = rows
    .map(({ colour, pips, turn }) => {
      const have = sources[colour];
      const needed = sourcesNeeded(N, L, pips, turn);
      const feasible = N > 0 && L >= turn;
      const p = castProbability(N, L, have, pips, turn);
      const pct = feasible ? `${Math.round(p * 100)}%` : "—";
      const neededLabel = needed === null ? `${L}+` : String(needed);
      const ok = needed !== null && have >= needed;
      const badge = ok ? "✓" : needed === null ? "!" : `−${needed - have}`;
      const icons = `<i class="ms ${pipFor[colour]}" aria-hidden="true"></i>`.repeat(pips);
      return `<tr class="${ok ? "rd-mana-ok" : "rd-mana-short"}">
          <td>${icons} <span class="rd-mana-k">${esc(S.rotisserie_deck_mana_turn_prefix)}${turn}</span></td>
          <td>${pct}</td>
          <td>${have}/${neededLabel} ${esc(S.rotisserie_deck_sources)}</td>
          <td class="rd-mana-badge">${badge}</td>
        </tr>`;
    })
    .join("");

  els.mana.hidden = false;
  els.mana.innerHTML = `
    <div class="rd-mana-head">
      <span class="rd-mana-title">${esc(S.rotisserie_deck_mana_title)}</span>
      <span class="rd-mana-note">${esc(S.rotisserie_deck_mana_note)}</span>
    </div>
    <table><tbody>${body}</tbody></table>`;
}
```

(Note: `BASIC_COLOURS`/`WUBRG` keep their original definitions and position; `hitProbability` and `const TURNS = [1, 2, 3, 4];` are gone.)

- [ ] **Step 2: Strings** — in `app/strings.py` replace lines 164–170 (`rotisserie_deck_mana_title` through `rotisserie_deck_sources`) with:

```python
        "rotisserie_deck_mana_title": "Mana odds",
        "rotisserie_deck_mana_note": (
            "Líkur á að geta borgað lituð tákn á réttum turn (á play, engin "
            "mulligan), gefið að þú hittir land drops. ✓ = nægar sources fyrir "
            "90–95% öryggi (Karsten 2022). Fetch-lönd telja liti sem þau geta sótt."
        ),
        "rotisserie_deck_mana_turn_prefix": "á T",
        "rotisserie_deck_sources": "sources",
```

(`rotisserie_deck_turn` is removed — verify it has no other users first: scan `app/` for `rotisserie_deck_turn` with Python, expect hits only in `strings.py` and the old JS.)

- [ ] **Step 3: CSS** — append to the `.rd-mana` block in `app/static/css/mtg.css` (after line 1485):

```css
.rd-mana .rd-mana-badge { text-align: center; font-weight: 600; }
.rd-mana .rd-mana-ok .rd-mana-badge { color: var(--win); }
.rd-mana .rd-mana-short .rd-mana-badge { color: var(--loss); }
.rd-mana td .ms { font-size: 0.7rem; margin-right: 0.1rem; }
```

- [ ] **Step 4: Version bump** — in `app/templates/rotisserie_deck.html` change
`<script type="module" src="/static/js/rotisserie-deck.js?v=2"></script>` to `?v=3`.

- [ ] **Step 5: Suite + lint** — `uv run --extra dev --extra data pytest tests/ -q && uv run --extra dev ruff check .`
Expected: 209 passed (strings tests don't reference the removed key), ruff clean.

- [ ] **Step 6: Commit (do not push)**

```bash
git -C /Users/brynjolfurjonsson/MagicTheGathering/mtgkubbur.is add app/static/js/rotisserie-deck.js app/strings.py app/static/css/mtg.css app/templates/rotisserie_deck.html
git -C /Users/brynjolfurjonsson/MagicTheGathering/mtgkubbur.is commit -m "feat: Karsten-style mana odds panel (conditional castability + fetch colour fix)

Per-colour requirement rows derived from the deck's actual pip costs:
conditional bivariate hypergeometric (Karsten 2022 criterion, on the play,
no mulligans), have/need sources at the 89+turn% target, typed fetches
crediting fetchable-dual colours. Spec:
docs/superpowers/specs/2026-08-05-mana-odds-karsten-redesign.md"
```

---

### Task 4: Verify against the Python oracle in the browser

**Files:**
- Create: scratchpad `mana_oracle.py` (full code below; the spec fully defines the model, so the oracle is recreated at verification time)
- No repo changes unless a defect is found (fix → amend Task 3's commit).

**Interfaces:**
- Consumes: Task 3's exports via `await import("/static/js/rotisserie-deck.js?v=3")` on the running dev server's `/rotisserie/deck` page.

- [ ] **Step 1: Generate oracle values** — write and run in the session scratchpad:

```python
"""mana_oracle.py — independent math.comb implementation of the spec model."""
import json
from math import comb

def cast_probability(N, L, K, k, t):
    if N <= 0 or k <= 0 or t < k:
        return 0.0
    L = min(L, N); K = min(K, L)
    n = min(7 + t - 1, N)
    den = sum(comb(L, j) * comb(N - L, n - j) for j in range(t, min(L, n) + 1))
    if den == 0:
        return 0.0
    num = 0
    for s in range(k, min(K, n) + 1):
        for l in range(max(0, t - s), min(L - K, n - s) + 1):
            num += comb(K, s) * comb(L - K, l) * comb(N - L, n - s - l)
    return num / den

def sources_needed(N, L, k, t):
    thr = (89 + min(t, 6)) / 100
    for K in range(k, L + 1):
        if cast_probability(N, L, K, k, t) >= thr:
            return K
    return None

cases = []
for N, L in [(40, 17), (40, 16), (41, 18), (43, 17), (23, 8), (7, 3)]:
    for k in (1, 2, 3):
        for t in range(k, 7):
            for K in (0, 3, 6, 9, 12, min(15, L), L):
                cases.append({
                    "N": N, "L": L, "K": K, "k": k, "t": t,
                    "p": cast_probability(N, L, K, k, t),
                    "needed": sources_needed(N, L, k, t),
                })
print(json.dumps(cases))
```

Save stdout to `battery.json` in the scratchpad. Sanity anchors (must hold before proceeding): with N=40, L=17 the smallest K meeting the threshold reproduces the spec's validated table — needed(k=1,t=1)=10, needed(k=2,t=2)=14, needed(k=3,t=3)=16, needed(k=2,t=4)=11, needed(k=3,t=4)=14.

- [ ] **Step 2: Start the dev server + open the page** — use the Browser pane (`preview_start` with the launch-config name from `.claude/launch.json` — read that file for the exact name; parent CLAUDE.md says the mtgkubbur.is entry runs `uv run uvicorn app.main:app --reload` on :8000), then navigate to `http://localhost:8000/rotisserie/deck`.

- [ ] **Step 3: Battery comparison in the page console** (javascript_tool; paste the JSON from Step 1 in place of `<BATTERY_JSON>`):

```js
const mod = await import("/static/js/rotisserie-deck.js?v=3");
const battery = JSON.parse(`<BATTERY_JSON>`);
let worst = 0, mismatches = [];
for (const c of battery) {
  const p = mod.castProbability(c.N, c.L, c.K, c.k, c.t);
  const needed = mod.sourcesNeeded(c.N, c.L, c.k, c.t);
  worst = Math.max(worst, Math.abs(p - c.p));
  if (Math.round(p * 100) !== Math.round(c.p * 100)) mismatches.push({ ...c, js_p: p });
  if (needed !== c.needed) mismatches.push({ ...c, js_needed: needed });
}
JSON.stringify({ cases: battery.length, worstAbsDiff: worst, mismatches });
```

Expected: `mismatches: []`, `worstAbsDiff < 1e-9`.

- [ ] **Step 4: `manaSources` fetch battery** (same console session):

```js
const strand = { fetch_types: ["Mountain", "Forest"], fetch_basics_only: false, type_line: "Land", produced_mana: [] };
const passage = { fetch_types: ["Plains", "Island", "Swamp", "Mountain", "Forest"], fetch_basics_only: true, type_line: "Land", produced_mana: [] };
const vents = { fetch_types: [], type_line: "Land — Island Mountain", produced_mana: ["R", "U"] };
const tomb = { fetch_types: [], type_line: "Land — Swamp Forest", produced_mana: ["B", "G"] };
const noBasics = { Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 };
JSON.stringify([
  // RG fetch + duals: fetch reaches R,G,U,B → expect W0 U2 B2 R2 G2
  mod.manaSources([strand, vents, tomb], noBasics),
  // basics-only fetch + duals, no basics: fetch credits nothing → W0 U1 B1 R1 G1
  mod.manaSources([passage, vents, tomb], noBasics),
  // basics-only fetch + one basic Forest → fetch credits G only → G2 (basic+fetch)
  mod.manaSources([passage], { ...noBasics, Forest: 1 }),
  // typed fetch with nothing reachable → all zero
  mod.manaSources([strand], noBasics),
]);
```

Expected: `[{W:0,U:2,B:2,R:2,G:2}, {W:0,U:1,B:1,R:1,G:1}, {W:0,U:0,B:0,R:0,G:2}, {W:0,U:0,B:0,R:0,G:0}]`.

- [ ] **Step 5: `pipRequirements` battery**:

```js
JSON.stringify(mod.pipRequirements([
  { mana_cost: "{1}{W}{W}", cmc: 3 },            // W: {2: 3}
  { mana_cost: "{W}", cmc: 1 },                  // W: {1: 1}
  { mana_cost: "{2}{R} // {1}{R}", cmc: 3 },     // adventure: front face → R: {1: 3}
  { mana_cost: "{X}{U}{U}", cmc: 2 },            // X generic → U: {2: 2}
  { mana_cost: "{B}{B}{B}{B}{B}{B}{B}", cmc: 7 },// turn cap → B: {7: 6}
  { mana_cost: "{2/W}{2/W}{2/W}", cmc: 6 },      // hybrid → no pure pips
]));
```

Expected: `{"W":{"1":1,"2":3},"U":{"2":2},"B":{"7":6},"R":{"1":3},"G":{}}`.

- [ ] **Step 6: Visual check** — with a real player selected, `read_page`/screenshot the panel: rows sorted WUBRG then pips ascending, badge column coloured, note string present. Then set every basic stepper to 0 for a colour-light state and confirm `—` / `L+` cells render (no NaN). Check `read_console_messages` for errors. Screenshot for the user.

- [ ] **Step 7: If any check fails** — diagnose in source, fix, re-run from Step 3, and `git commit --amend` Task 3's commit (it is unpushed).

---

### Task 5: Ship and verify live

**Files:**
- Modify: `CLAUDE.md` (the `/rotisserie/deck` bullet)

- [ ] **Step 1: Document** — in `CLAUDE.md`, extend the `/rotisserie/deck` bullet's final sentence to reference both specs:

```
Spec: `docs/superpowers/specs/2026-08-04-rotisserie-deckbuilder-design.md`; mana panel: `docs/superpowers/specs/2026-08-05-mana-odds-karsten-redesign.md` (Karsten-2022 conditional castability, cache v4 `fetch_basics_only`).
```

```bash
git -C /Users/brynjolfurjonsson/MagicTheGathering/mtgkubbur.is add CLAUDE.md
git -C /Users/brynjolfurjonsson/MagicTheGathering/mtgkubbur.is commit -m "docs: note Karsten mana panel spec in CLAUDE.md"
```

- [ ] **Step 2: Push** (re-check for cron commits first; if the pull rebases data files, re-run the Task 2 sanity check before pushing)

```bash
git -C /Users/brynjolfurjonsson/MagicTheGathering/mtgkubbur.is fetch && git -C /Users/brynjolfurjonsson/MagicTheGathering/mtgkubbur.is log @{u}..HEAD --oneline
git -C /Users/brynjolfurjonsson/MagicTheGathering/mtgkubbur.is pull --ff-only
git -C /Users/brynjolfurjonsson/MagicTheGathering/mtgkubbur.is push
```

- [ ] **Step 3: Live verification** (Fly deploy takes ~1–2 min): browse https://mtgkubbur.is/rotisserie/deck, hard-reload, confirm the page loads `rotisserie-deck.js?v=3`, the panel renders requirement rows, and the served `/data/rotisserie` payload's cards carry `fetch_basics_only`. Screenshot as proof.

---

## Self-review notes

- Spec coverage: model → Task 3 Step 1; display Option C → Task 3 Step 1 (renderMana); fetch fix incl. basics-only → Tasks 1–3; cache v4 rebuild → Task 2; note string → Task 3 Step 2; verification battery incl. all four fetch scenarios + oracle parity → Task 4; version bump → Task 3 Step 4; docs → Task 5.
- Type consistency: `castProbability(deckSize, lands, sources, pips, turn)` used identically in Tasks 3–4; `pipRequirements` returns plain objects (JSON-stringifiable for the console battery); `sourcesNeeded` null ↔ oracle `None` ↔ JSON `null`.
- Known intentional deviations: no JS unit-test runner exists in this repo — browser + oracle verification is the established convention (per project handoff).
