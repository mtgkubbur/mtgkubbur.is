# CLAUDE.md — mtgkubbur.is

FastAPI frontend for MtG Kubbur, replacing the Quarto site. Reads JSON published by
`cube_rankings` (committed under `data/kubbur/`).

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
- `app/static/css/` — `input.css` (tokens + @tailwind) → `tailwind.css`; `mtg.css` (components/chrome, not Tailwind-processed). Spectral display serif (page `<h1>` + subtitles, `--font-display`) is vendored at `app/static/fonts/spectral/`. Bump the `?v=N` query on the CSS `<link>`s in `base.html` when shipping a visual change so returning browsers refetch.

## Conventions

- Two-tier serving: server shell + dropdowns, client fetches `/data/*` per entity.
- Dark mode = `[data-theme]` + CSS variables (NOT Tailwind `dark:`). Charts re-read tokens via `theme.js` on a MutationObserver.
- Icelandic-only v1; all copy in `app/strings.py` keyed by lang for a later `/en`.
- Privacy: render-only — the JSON is already opt-in filtered upstream. `calendar.host` is public.
- Vendored Plot 0.6.17 + Alpine 3.14.8 + Inter + mana-font; no npm runtime deps.
- Visual design (warm-parchment palette, Spectral display serif, rank medallions, legible win-rate bars, cleaner charts that keep their credible-interval bands): see `docs/superpowers/plans/2026-06-02-visual-refresh.md`.
