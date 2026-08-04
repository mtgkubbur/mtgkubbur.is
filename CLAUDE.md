# CLAUDE.md — mtgkubbur.is

FastAPI frontend for MtG Kubbur, replacing the Quarto site. Reads JSON published by
`cube_rankings` (committed under `data/kubbur/`).

**Data-directory ownership:** `cube_rankings` mirror-syncs `data/kubbur/` and
`data/kubbur-schemas/` with `rsync --delete` (its `fit.yml` and `republish.yml`).
Any file this repo commits into those directories (currently `rotisserie*`) must be
in the exclude list of both cube_rankings workflows, or the next nightly sync
deletes it (happened 2026-08-02; fixed in cube_rankings `b1f4293`).

## Commands

```bash
uv sync --extra dev
uv run uvicorn app.main:app --reload          # dev server :8000
uv run --extra dev --extra data pytest tests/ # tests
uv run --extra dev ruff check .               # lint
./scripts/build-css.sh                        # rebuild tailwind.css
uv run --extra data python scripts/validate_publish.py
```

## Architecture

- `app/main.py` — app, static mount, gzip, /healthz, 404, lifespan prewarm.
- `app/data.py` — per-request JSON loaders + indexes + tier maps (fail-soft).
- `app/strings.py` — single source of Icelandic UI copy (Jinja `S`, JS `window.STR`).
- `app/routes/*` — one module per page + `data_api.py` (shared `/data/*` endpoints).
- `app/templates/*` — `base.html` + one template per page; `{% block %}`s only in base.
- `app/static/js/` — `theme.js` (token palette reader + shared Plot options `basePlot`/`baseGridStyle`), per-page loaders, `charts/*` (Observable Plot ESM); `vendor/` is committed (no CDN).
- `app/static/css/` — `input.css` (tokens + @tailwind) → `tailwind.css`; `mtg.css` (components/chrome, not Tailwind-processed). Spectral display serif (page `<h1>` + subtitles, `--font-display`) is vendored at `app/static/fonts/spectral/`. Bump the `?v=N` query on any versioned asset tag (the CSS `<link>`s in `base.html`, and `rotisserie.js` in `rotisserie.html`) when shipping a change to that asset so returning browsers refetch — this is a hand-maintained convention, not automatic, and a missed bump on `rotisserie.js` was the one production regression on the rotisserie branch (stale JS served after a code deploy).
- `/rotisserie` (unlisted, noindex) — live status page for the Meta Memories rotisserie draft. `scripts/rotisserie/` (`parse.py`, `scryfall.py`) builds `data/kubbur/rotisserie.json` + `rotisserie_cards.json` from the draft-grid Google Sheet and the Scryfall card cache (which always includes the five basic lands for the deckbuilder); `.github/workflows/rotisserie.yml` polls the sheet every 30 minutes and only rebuilds/republishes when the parsed pick state actually changed. `app/static/js/rotisserie.js` renders player pools, the remaining-pool browser, and the pick log from one fetch of `/data/rotisserie`.
- `/rotisserie/deck` (unlisted, noindex) — deckbuilder on the same `/data/rotisserie` payload: mana-value columns with creature/non-creature piles, sideboard, basic-land steppers, and speculative picks from the remaining pool. All user state in localStorage (`rot-deck:<player>`); the deck is derived (live pool + speculative − sideboard), so new picks appear on reload. `app/static/js/rotisserie-deck.js` (versioned `?v=N` in `rotisserie_deck.html`, same bump convention as above); unlisted policy: public pages link to neither rotisserie page, the pair may interlink. Spec: `docs/superpowers/specs/2026-08-04-rotisserie-deckbuilder-design.md`.

## Conventions

- Two-tier serving: server shell + dropdowns, client fetches `/data/*` per entity.
- Dark mode = `[data-theme]` + CSS variables (NOT Tailwind `dark:`). Charts re-read tokens via `theme.js` on a MutationObserver.
- Icelandic-only v1; all copy in `app/strings.py` keyed by lang for a later `/en`.
- Privacy: render-only — the JSON is already opt-in filtered upstream. `calendar.host` is public.
- Vendored Plot 0.6.17 + Alpine 3.14.8 + Inter + mana-font; no npm runtime deps.
- Visual design (warm-parchment palette, Spectral display serif, rank medallions, legible win-rate bars, cleaner charts that keep their credible-interval bands): see `docs/superpowers/plans/2026-06-02-visual-refresh.md`.
