# Rotisserie draft page — design

**Date:** 2026-08-01
**Status:** Approved, ready for implementation plan
**Scope:** An unlisted page on mtgkubbur.is showing the live state of the Meta Memories
rotisserie draft: whose turn it is, what each player has picked, and the pick history.

## Problem

Eight players are running a rotisserie draft of Diddi's Meta Memories cube in a Google
Sheet. A rotisserie draft picks from the entire cube one player at a time, so it runs for
weeks. The sheet is functional but hostile to reading: card names only, no images, no
per-player view, and a status block that is currently full of `#REF!` errors.

We want a page that answers two questions at a glance: *where is the draft* and *what does
each player have*.

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
Google Sheet ──hourly Action──> fetch_rotisserie.py ──> data/kubbur/rotisserie.json
                                        │                          │
Scryfall API ──on cache miss only──> build_card_cache.py ──> data/kubbur/rotisserie_cards.json
                                                                   │
                                        commit if changed ──> deploy.yml ──> Fly
```

### Pipeline — `.github/workflows/rotisserie.yml`

Hourly `schedule:` cron plus `workflow_dispatch:` for an on-demand refresh. Runs
`scripts/fetch_rotisserie.py`, then commits `data/kubbur/rotisserie*.json` **only if the
content changed**. The resulting push to `master` triggers the existing `deploy.yml`
(pytest → ruff → `validate_publish.py` → Fly).

An hourly commit cadence is in keeping with this repo, which already receives an automated
`data: sync published JSON from cube_rankings` commit every night.

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

The cache is regenerated **only when an unresolved card name appears**. In steady state the
hourly job makes zero Scryfall calls.

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
  "cube": "Meta Memories",
  "cube_size": 539,
  "rounds_total": 45,
  "picks_total": 360,
  "picks_made": 1,
  "current_round": 1,
  "next_player": "Örvar",
  "players": ["Binni", "Örvar", "Tommi", "Diddi", "Atli", "Óli", "Aron Ívars.", "Aron Freyr"],
  "pools": { "Binni": ["Ragavan, Nimble Pilferer"] },
  "log": [
    { "round": 1, "seq": 1, "player": "Binni",
      "card": "Ragavan, Nimble Pilferer", "first_seen": "2026-08-01T09:00:00Z" }
  ]
}
```

`pools` is keyed by every player, including those with no picks yet (empty array) — the
example above is elided. It holds card names only; the frontend joins against the card
cache. This keeps the two files independently regenerable and the payload small.

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
nor through the alias index; the same card appears in two players' pools; or a previously
observed pick has changed or disappeared. Picks are append-only in a rotisserie, so any
retraction signals either a sheet accident or a parser bug — both warrant a red build rather
than a silent overwrite of good data.

**Site stays fail-soft.** Per the existing `app/data.py` convention, a missing or malformed
`rotisserie.json` renders an empty state, never a 500. `/healthz` is unaffected — the
rotisserie page is not core.

## Testing

- **Parser unit tests** against committed CSV fixtures: today's real 1-pick state, and a
  synthetic mid-draft state exercising a full snake reversal, DFC front-face names, and the
  `#REF!` prefixes.
- **Cache resolution test**, offline against a fixture, asserting front-face aliasing and the
  face-image fallback for the 18 imageless cards.
- **Route test:** 200, `noindex` present, `/rotisserie` absent from the rendered nav.
- **Fail-loud tests:** malformed CSV and an unresolvable card name each exit non-zero.
- Existing `validate_publish.py` gate extended to cover the two new JSON files.

## Out of scope

- **Remaining-pool browser** (searching the ~180 undrafted cards). Considered and explicitly
  dropped from v1.
- Deck/sideboard splitting within a pool — rotisserie pools are not yet decks.
- Linking drafters to their mtgkubbur.is player pages; the sheet's names
  (`Aron Ívars.`, `Binni`) do not reliably match the rankings identities.
- English translation. Icelandic-only, consistent with the rest of the site.
