# Rotisserie deckbuilder — design

**Date:** 2026-08-04
**Status:** Approved (user, 2026-08-04)
**Parent:** 2026-08-01-rotisserie-draft-page-design.md

## Purpose

Let a draft participant build their deck on the site: load their pool, see it
as mana-value columns with creatures and non-creatures in separate piles, cut
cards to a sideboard, add basic lands, and pull still-available cards into the
build to plan future picks ("speculation").

## Decisions (user-confirmed)

| Question    | Decision |
| ----------- | -------- |
| Persistence | Browser-local (localStorage), keyed per player. No backend writes. |
| Location    | Separate subpage `/rotisserie/deck`, linked from `/rotisserie`. |
| Touch       | Desktop-first drag-and-drop; tap/click opens an action popover as the fallback. |
| Drag impl   | Native HTML5 DnD, hand-rolled vanilla JS. No new dependencies. |

## Page & data

- `/rotisserie/deck` — unlisted, `noindex`, same conventions as the parent
  page. Own template (`rotisserie_deck.html`) and JS (`rotisserie-deck.js`).
- Reads the existing `/data/rotisserie` payload; no new endpoints.
- **Data change:** the card cache build (`scripts/fetch_rotisserie.py`) always
  includes the five basic lands, so basics render with real images. Schema and
  tests updated accordingly. No new files in `data/kubbur/` (no rsync-exclude
  changes needed in cube_rankings).

## Layout

- **Top bar:** player select (persisted last choice), counts (deck total,
  creatures, lands incl. basics), export, reset.
- **Deck area:** eight fixed MV columns (0–6, 7+). Each column has a creature
  stack above and a non-creature stack below. A trailing **Lands** column
  holds drafted nonbasic lands plus five basic-land steppers (− count +).
- **Sideboard:** full-width curve-sorted strip below the deck.
- **Available browser:** collapsible section at the bottom reusing the
  remaining-pool filter set (search, colour, MV, type). Clicking a card adds
  it to the deck as *speculative* (dashed border + badge).

## Interactions

- A card's MV column is always derived from its mana value; users never file
  cards into columns by hand.
- Drag moves: deck ↔ sideboard; creature pile ↔ non-creature pile (stored as
  a per-name override, e.g. filing Fable of the Mirror-Breaker as a creature);
  dragging a speculative card out of the deck removes it.
- Click/tap opens an action popover with the same moves plus "enlarge"
  (lightbox). Plain click cannot open the lightbox here since it is the tap
  fallback for moves.
- Basics adjust via steppers in the Lands column.

## State

localStorage key `rot-deck:<player>`, JSON:

```json
{
  "version": 1,
  "sideboard": {"Card Name": 1},
  "pile_overrides": {"Card Name": "creature"},
  "basics": {"Plains": 0, "Island": 0, "Swamp": 0, "Mountain": 0, "Forest": 0},
  "speculative": ["Card Name"],
  "lost": ["Card Name"],
  "pool_counts": {"Card Name": 1},
  "updated_at": "ISO"
}
```

- The deck is **derived**: live pool + speculative − sideboard. New picks
  appear automatically in the deck on reload.
- Same-name duplicates (a pool can hold two Explores) are handled as counts
  everywhere — including reconciliation, which is count-based per copy, never
  name-presence-based (post-review fix: a presence check silently ate
  speculation on the second copy of a duplicated name).
- Reconciliation per speculative copy, in order: pool **growth** since the
  last reconcile (`pool_counts` snapshot) absorbs it (became real — growth,
  not raw pool count, so an owned copy never eats a deliberate "one real +
  one spec" holding); a copy still in the remaining pool justifies keeping
  it; otherwise it moves to `lost` and stays visible, marked, until
  dismissed. `pool_counts: null` (pre-upgrade state) means no growth.
- Corrupt/unknown-version state is discarded wholesale (fresh build), never
  partially applied.

## Export

Copy-to-clipboard plain text: deck lines (`4 Plains`, `1 Lightning Bolt`, …),
blank line, `Sideboard:` section, then a one-line `Spec:` annotation naming
the speculative cards (they are already counted in the deck/sideboard lines,
so they are not listed as extra `1 Name` rows). Doubles as the cross-device
escape hatch.

## Testing & i18n

- All copy Icelandic in `app/strings.py` (keyed for a later `/en`).
- Server-side pytest: route serves 200 + noindex; cards payload includes the
  five basics; schema stays valid.
- JS state/grouping logic kept in small pure functions; interactive behaviour
  verified in the preview browser before completion.

## Out of scope (v1)

Server-side saves, shareable links, touch drag, manual reordering within a
pile, format-legality checks.
