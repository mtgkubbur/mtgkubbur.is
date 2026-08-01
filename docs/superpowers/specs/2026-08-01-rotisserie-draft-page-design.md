# Rotisserie draft page — design

**Date:** 2026-08-01
**Status:** Approved, ready for implementation plan
**Scope:** An unlisted page on mtgkubbur.is showing the live state of the Meta Memories
rotisserie draft: whose turn it is, what each player has picked, what is still available,
and the pick history.

## Problem

Eight players are running a rotisserie draft of Diddi's Meta Memories cube in a Google
Sheet. A rotisserie draft picks from the entire cube one player at a time, so it runs for
weeks. The sheet is functional but hostile to reading: card names only, no images, no
per-player view, and a status block that is currently full of `#REF!` errors.

We want a page that answers three questions at a glance: *where is the draft*, *what does
each player have*, and *what is still on the table*.

## Source data

Google Sheet `1UlGvtJ1Lqzm6XodeSNr5vkvicIsqJAPwwjyRXAqR4XQ`. **Verified anonymously
readable** via the legacy Visualization endpoint, so no service account, no `GCP_SA_JSON`
on Fly, no OAuth:

```
https://docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&gid=<gid>
```

Two tabs matter, and neither is sufficient alone.

### Draft grid — `gid=1822506900`

45 data rows × 8 player columns = 360 picks. Verified structure:

| Col | Contents |
| --- | --- |
| 0 | Round number, `1`–`45` |
| 1 | Snake arrow, `→` / `↪` (row start) |
| 2–9 | One column per player, cell = picked card name or empty |
| 10 | Snake arrow, `↩` / `✪` (row end) |
| 13–14 | "Draft Status" label/value block — **currently `#REF!`, do not consume** |

Header row player names arrive prefixed with the broken formula, e.g.
`"#REF! Örvar"`, and the first is additionally prefixed with the sheet title
(`"Rotisserie Draft - Meta memories #REF! Binni"`). Both prefixes must be stripped.

Players, in column order: Binni, Örvar, Tommi, Diddi, Atli, Óli, Aron Ívars., Aron Freyr.

State as of 2026-08-01: **1 pick made** — Binni took Ragavan, Nimble Pilferer in round 1.

### Cube list — `gid=0`

540 rows, 539 unique card names (`Explore` appears twice — two different printings in the
cube). Columns: `✓ | Card | Type | Color | View | Picked By`. The `Type`, `Color` and
`Picked By` columns are formula-driven and mostly blank; we use this tab **only** as the
authoritative list of card names to resolve against Scryfall, not as a source of card
metadata.

## Architecture

Preserves the site's existing stance: **the server calls neither Google Sheets nor the
Scryfall API at runtime.** The app keeps reading committed JSON, exactly as it does for
rankings. The one runtime third-party dependency is the visitor's browser loading card art
from `cards.scryfall.io`; see *Layout* for why that exception is acceptable.

```
two-hourly cron
      │
      v
┌─ job 1: check ──────────────────────────────────────────────┐
│  Google Sheet ──> parse.py  (stdlib only, ~15s)             │
│  digest(pick state) == rotisserie.json:source_digest ?      │
└─────────────────────────┬───────────────────────────────────┘
                          │ differs  ->  changed=true
┌─ job 2: sync ───────────v───────────────────────────────────┐
│  fetch_rotisserie.py  ──────────>  rotisserie.json          │
│  build_card_cache.py  ──────────>  rotisserie_cards.json    │
│      ^ Scryfall API, only on an unresolved card name        │
│  validate  ──>  commit + push  ──>  flyctl deploy  ──>  Fly │
│      ^ own deploy: a GITHUB_TOKEN push cannot fire deploy.yml│
└─────────────────────────────────────────────────────────────┘
```

### Pipeline — `.github/workflows/rotisserie.yml`

Two-hourly `schedule:` cron plus `workflow_dispatch:` for an on-demand refresh. Split into
two jobs so the common case — nobody has picked — costs almost nothing.

**Job 1, `check` (gate).** Checkout, then `python3 scripts/rotisserie_changed.py`. Fetches
both CSVs, parses them, and compares a digest of the *normalised pick state* against
`source_digest` in the committed `rotisserie.json`. Emits `changed=true|false` as a job
output. Runs in roughly fifteen seconds.

The gate parses rather than hashing raw bytes, and imports the same
`scripts/rotisserie/parse.py` module the publish job uses, so there is one parser, not two.
That module is deliberately **stdlib-only** (`csv`, `hashlib`, `urllib`) — the gate therefore
needs no `setup-uv`, no `uv sync`, and no dependency resolution at all.

**Job 2, `sync`.** `needs: check`, guarded by
`if: needs.check.outputs.changed == 'true'`. Runs the full `scripts/fetch_rotisserie.py`,
refreshes the card cache if any name is unresolved, writes both JSON files, validates them,
then commits, pushes, and deploys — in that order, so a validation failure produces a red
build and no commit.

**This job must run its own deploy; it cannot rely on `deploy.yml`.** GitHub does not trigger
workflows from pushes made with the default `GITHUB_TOKEN`, a deliberate guard against
recursive runs. Relying on the push to fire `deploy.yml` would produce green builds that
never reach Fly — a silent staleness bug. The existing nightly sync escapes this only because
it is *cross-repo*: `cube_rankings/.github/workflows/fit.yml` pushes into this repo with
`secrets.MTGKUBBUR_PUSH_TOKEN`, a PAT, which does trigger workflows. That does not transfer to
a workflow pushing to its own repo.

The job therefore runs the same gates `deploy.yml` runs (pytest → ruff → `validate_publish.py`
→ `flyctl deploy --remote-only`) using the `FLY_API_TOKEN` secret already present in this
repo. No new secret is required. Making `deploy.yml` a reusable `workflow_call` was considered
and rejected: a called workflow inherits the caller's `github.sha`, so its `actions/checkout`
would retrieve the tree from before the data commit and deploy stale JSON.

Why hash the parsed state rather than the response bytes: the CSV was verified byte-stable
across repeated requests for unchanged data, so raw hashing would *work* — but it is brittle
against Google altering CSV quoting, and against the sheet's `#REF!` cells flickering as
Diddi repairs the status block. Neither changes who picked what. Digesting the normalised
pick state means the gate fires on real picks and stays quiet for cosmetic churn.

Conditional requests are not an option: the endpoint returns no `ETag` and no
`Last-Modified`, and sets `cache-control: no-cache, no-store, must-revalidate`. The gate must
download to compare — but at roughly 4 KB for the draft grid, that is free.

Net effect: on a two-hourly cron, the overwhelming majority of runs end at job 1 with no
commit, no CI run, and no Fly deploy. Only a genuine pick costs a deploy.

Accepted trade-offs, both benign at this cadence:

- GitHub's cron is best-effort and can be delayed 15–30 minutes under load. A draft where a
  single pick takes days does not notice.
- GitHub disables cron workflows after 60 days of repo inactivity. The nightly rankings sync
  already keeps this repo active.

### Card cache — `scripts/build_card_cache.py`

Builds `data/kubbur/rotisserie_cards.json` from the 539 cube names. Three resolution
behaviours, all verified against the live API:

1. **Batch.** `POST /cards/collection`, 75 identifiers per request, 8 requests total.
2. **Front-face aliasing.** 26 cards are stored in the sheet by front-face name but returned
   by Scryfall under the full name — `Brazen Borrower` → `Brazen Borrower // Petty Theft`.
   Build an alias index from every `card_faces[].name` and from the pre-`//` segment of each
   full name. 539 cards yield 564 aliases.
3. **Per-card retry.** `Unholy Annex // Ritual Chamber` (a `split`-layout Room) returns
   `not_found` from the batch endpoint but resolves from `GET /cards/named?exact=`. Any
   `not_found` from step 1 is retried individually — `exact` first, then `fuzzy`.

Layouts present in this cube: `normal` 506, `transform` 16, `adventure` 8, `class` 3,
`saga` 2, `modal_dfc` 2, `leveler` 1.

**18 cards have no top-level `image_uris`** — all `transform`/`modal_dfc`. Their images live
under `card_faces[n].image_uris`. The builder resolves this at build time so the frontend
never has to branch: every cached card gets a flat `img_small` / `img_normal`.

Requests send a descriptive `User-Agent` and `Accept: application/json`, and sleep between
batches, per Scryfall's API guidelines.

The cache is regenerated **only when an unresolved card name appears**. Combined with the
gate job, steady state means zero Scryfall calls and zero commits — a run that finds no new
pick never reaches this script at all.

### Data contract

`data/kubbur/rotisserie_cards.json` — keyed by the name as written in the sheet:

```json
{
  "Brazen Borrower": {
    "name": "Brazen Borrower // Petty Theft",
    "mana_cost": "{1}{U}{U}",
    "cmc": 3,
    "type_line": "Creature — Faerie Rogue // Instant — Adventure",
    "colors": ["U"],
    "color_identity": ["U"],
    "rarity": "mythic",
    "layout": "adventure",
    "img_small": "https://cards.scryfall.io/small/...",
    "img_normal": "https://cards.scryfall.io/normal/...",
    "scryfall_uri": "https://scryfall.com/card/..."
  }
}
```

`data/kubbur/rotisserie.json`:

```json
{
  "generated_at": "2026-08-01T09:00:00Z",
  "source_digest": "sha256:0c4b80d8452633ef...",
  "cube": "Meta Memories",
  "cube_size": 539,
  "rounds_total": 45,
  "picks_total": 360,
  "picks_made": 1,
  "current_round": 1,
  "next_player": "Örvar",
  "players": ["Binni", "Örvar", "Tommi", "Diddi", "Atli", "Óli", "Aron Ívars.", "Aron Freyr"],
  "pools": { "Binni": ["Ragavan, Nimble Pilferer"] },
  "remaining": ["Champion of the Parish", "Esper Sentinel", "..."],
  "log": [
    { "round": 1, "seq": 1, "player": "Binni",
      "card": "Ragavan, Nimble Pilferer", "first_seen": "2026-08-01T09:00:00Z" }
  ]
}
```

`pools` is keyed by every player, including those with no picks yet (empty array) — the
example above is elided. It holds card names only; the frontend joins against the card
cache. This keeps the two files independently regenerable and the payload small.

`remaining` is the cube list minus every pooled card, written out explicitly rather than
left for the frontend to diff. It costs about 12 KB uncompressed at draft start (538 names,
far less after gzip, which the app already applies) and means the pool browser needs no
set arithmetic in the browser. `source_digest` is what the gate job compares against.

### Route and page

- `app/routes/rotisserie.py` — `GET /rotisserie`, registered in `app/main.py`.
- **Unlisted:** absent from the nav in `base.html`, and the template sets
  `<meta name="robots" content="noindex">`. No authentication. This discloses nothing new —
  the source sheet is already world-readable — so auth would be theatre. Cloudflare Access
  is not an option regardless: the apex is grey-clouded straight to Fly.
- Follows the established two-tier pattern: the route renders a shell, and
  `app/static/js/rotisserie.js` fetches `GET /data/rotisserie` (added to
  `app/routes/data_api.py`) and renders client-side.
- All copy lives in `app/strings.py` keyed by lang, per existing convention.
- New CSS goes in `app/static/css/mtg.css`; bump the `?v=N` on the CSS links in `base.html`.

### Layout

**Status header.** Round *n* of 45 · picks *x* of 360 · next up: *player*. Derived from the
grid, never from the sheet's broken status cells.

**Player pools.** One section per drafter, Cube Cobra idiom: cards stacked in overlapping
vertical columns grouped White / Blue / Black / Red / Green / Multicolour / Colourless /
Land, sorted by CMC then name. `img_small` (~10 KB) with `loading="lazy"`; click or tap
opens `img_normal` in a lightbox. Each section carries a mana-curve and colour summary.

**Remaining pool.** A collapsed section, headed with the live count, expanding to a
filterable grid of every undrafted card. Filters: colour, card type, CMC, and a name search,
combined with AND. Alpine is already vendored, so filtering is client-side over the
`remaining` array with no additional fetch.

Collapsed by default because the section holds 538 cards on day one and only shrinks to
about 180 by the end — an expanded wall of images would dominate the page precisely when it
is least informative. Same `img_small` + `loading="lazy"` treatment as the pools, so an
unexpanded section costs nothing.

This was originally cut from v1 and added back because the data turned out to be free: the
parser already holds both the cube list and every pool, and the card cache already covers
the whole cube rather than just picked cards. The remaining work is UI only.

**Pick log.** Reverse-chronological: round, player, card.

Card images hotlink `cards.scryfall.io`. This is a deliberate, approved exception to the
repo's no-CDN rule, which exists to prevent third-party JS execution and font-privacy leaks
— card art carries neither risk, hotlinking is Scryfall's supported pattern, and vendoring
539 images would add ~5 MB to git and go stale on reprints.

## Known limitations

These are recorded rather than papered over, and the UI must not imply more precision than
the data supports.

**No timestamps exist in the sheet.** We cannot truthfully say how long a player has been
sitting on a pick. The pipeline records when the job *first observed* each pick
(`first_seen`) and the UI labels it as observation, not action — "síðasta val séð" — accurate
to within the poll interval.

**Pool contents are exact; pick order is derived.** Ownership comes straight from the grid
and is always correct. The chronological log infers snake order from the `↪`/`↩` arrows
(odd rounds left-to-right, even rounds right-to-left). The sheet has a `Double Picks After:`
setting, currently `#REF!`; if it is switched on, the log's ordering assumption needs
revisiting. The galleries remain correct either way. The log is therefore presented as
derived ordering, and this assumption gets an explicit test.

## Error handling

**Pipeline fails loudly.** The sheet is visibly mid-rebuild, so silent corruption is the real
risk. `fetch_rotisserie.py` validates and exits non-zero — turning the Action red rather than
publishing a broken page — when: no player columns parse; a player name is empty after prefix
stripping; the player set changes unexpectedly; a picked card name resolves neither directly
nor through the alias index; a card is drafted more times than the cube contains copies of it;
or a previously observed pick has changed or disappeared. Picks are append-only in a
rotisserie, so any retraction signals either a sheet accident or a parser bug — both warrant a
red build rather than a silent overwrite of good data.

The copy-count check is deliberately a multiset comparison rather than "no card appears in two
pools", because the cube list genuinely contains 540 rows for 539 distinct names: `Explore`
is listed twice. That is most likely a duplicated row in the sheet rather than two legitimate
copies, but either way the correct invariant is *drafted count ≤ cube count per name*, and
`remaining` is a multiset difference. The builder logs a warning listing any duplicated names
so the ambiguity stays visible instead of being silently absorbed.

**Site stays fail-soft.** Per the existing `app/data.py` convention, a missing or malformed
`rotisserie.json` renders an empty state, never a 500. `/healthz` is unaffected — the
rotisserie page is not core.

## Testing

- **Parser unit tests** against committed CSV fixtures: today's real 1-pick state, and a
  synthetic mid-draft state exercising a full snake reversal, DFC front-face names, and the
  `#REF!` prefixes.
- **Cache resolution test**, offline against a fixture, asserting front-face aliasing and the
  face-image fallback for the 18 imageless cards.
- **Gate tests:** identical source yields `changed=false`; a new pick yields `changed=true`;
  and `#REF!` churn in the status cells with no pick change yields `changed=false` — the
  specific brittleness that motivated digesting parsed state instead of raw bytes.
- **Remaining-pool test:** `remaining` plus every pool exactly reconstitutes the cube list,
  with no card in both.
- **Route test:** 200, `noindex` present, `/rotisserie` absent from the rendered nav.
- **Fail-loud tests:** malformed CSV and an unresolvable card name each exit non-zero.
- Existing `validate_publish.py` gate extended to cover the two new JSON files.

## Out of scope

- Deck/sideboard splitting within a pool — rotisserie pools are not yet decks.
- Linking drafters to their mtgkubbur.is player pages; the sheet's names
  (`Aron Ívars.`, `Binni`) do not reliably match the rankings identities.
- English translation. Icelandic-only, consistent with the rest of the site.
