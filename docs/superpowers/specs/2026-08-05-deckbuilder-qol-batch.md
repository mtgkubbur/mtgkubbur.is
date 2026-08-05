# Deckbuilder QoL batch — design notes

**Date:** 2026-08-05
**Status:** Shipped
**Parent:** 2026-08-04-rotisserie-deckbuilder-design.md, 2026-08-05-mana-odds-karsten-redesign.md

Batch implementing the QoL review (vault: `Architecture/Rotisserie Deckbuilder QoL Review.md`)
plus two user-requested features. Usage context: players build on desktop over several days,
then meet to play — so desktop convenience and getting the finished deck to game night beat
touch polish.

## Features

| Feature | Design decision |
| ------- | --------------- |
| Manual MV filing | `state.cmc_overrides[name] = bucket 0–7`. Set by dropping on another column's pile or via a popover column picker; cleared when set to the card's natural bucket. Feeds the mana panel: an overridden card's pip requirement uses its effective (filed) MV as the earliest turn — Shriekmaw filed at 2 asks for {B} on turn 2. Lands excluded. Pruned in reconcile like `pile_overrides`. |
| Multicolour mana rows | One row per distinct coloured-cost signature spanning ≥2 colours (`{R}{G}`, `{R}{R}{G}`), earliest turn per signature. Exact model in `castProbabilityJoint`: lands classed by which required colours they can produce (per-land sets from `landColourSets`, shared with the mono counts), multivariate hypergeometric over classes, payability by Hall's condition (each land taps once — duals never double-count), conditioned on ≥turn lands seen like the mono rows. Verified against an independent Python backtracking-matching oracle: 165/165 exact. No "needed" count exists for joint rows (multidimensional); they show % + ✓/! at the same 89+turn% target. |
| Hover card preview | `img_normal` floating preview after 100 ms, `(pointer: fine)` only, delegated `mouseover`; hidden on drag/popover/lightbox/scroll. |
| Share links | Whole state → JSON → UTF-8 base64url in `#share=`. Viewer renders read-only (`body.rd-readonly`, mutations guarded, no localStorage writes) with the deck derived from the LIVE pool + shared state — same semantics as the owner's reload. Zero backend, honours the v1 no-server-writes decision. ~1.7 KB URLs typical. |
| Sample hand | Fisher–Yates over deck incl. basics; deal 7 / draw / mulligan (deals one fewer, casual style) / new hand. Modal, Esc/backdrop closes. |
| Undo | Snapshot stack (cap 20) pushed by every mutation entry point BEFORE mutating; Ctrl/Cmd+Z (not while typing) + topbar button. Cleared on player switch. Reset is undoable. |
| Targets | `45 / 40` colouring (green at exactly 40, red over) + `Lands: N (gott: 16–18)`. Informational only, never enforcement. |
| Basics entry | `<input type=number>` + steppers (bulk entry beats 17 clicks). |
| Mana panel collapse | Panel is a `<details>`; default open once building has started (basics/sideboard/spec non-empty), closed on untouched pools (whole-pool odds are noise); user toggle preserved across re-renders. |
| Column headers | `label · count` left-grouped chip — space-between made one column's count collide visually with the neighbour's label ("9 3"). |
| Mobile columns | Subgrid levelling off under 640 px (flex column) — shared row heights turned short columns into blank screens on phones. |
| A11y | Popover: `role=menu`, focus moves in on open and restores to opener, ArrowUp/Down cycle. Tiles get `aria-label` + `aria-haspopup`. |

## Bug fixed in passing

Sideboard cards stretched +164 px tall from the 2nd card on (user-reported): `.rd-side-stack`
also carries `.rd-stack`, so the pile-overlap rule's negative top margin applied inside a
stretch-aligned flex row — and a negative margin on a stretched flex item GROWS its used
height. Overlap rules now scoped to `.rd-col .rd-stack`; sideboard gets `align-items: flex-start`.

## State compatibility

`STATE_VERSION` stays 1: `cmc_overrides` is additive with a `{}` default in `reviveState`
(shared by loadState / undo / share decode); old stored states revive cleanly.

## Verification

- 209 pytest + ruff clean; new mount-point IDs added to `test_rotisserie_deck_page.py`.
- Joint-model oracle: 165 randomised + edge cases (duals, triomes, mono delegation,
  infeasible turns) — zero mismatches vs brute-force enumeration with backtracking matching.
- Browser pass: overrides (popover + mana-turn shift), undo, share round-trip incl. exit,
  sample hand, hover preview, basics input, mobile flow, dark mode.

Asset bumps: `rotisserie-deck.js?v=4`, `mtg.css?v=9`.
