# mtgkubbur.is

FastAPI + Jinja2 + Tailwind + Observable Plot app for the MtG Kubbur cube-draft
rankings. Renders slim JSON published by `cube_rankings` (committed under
`data/kubbur/`); no DB, no R/Stan, no Google Sheets at runtime.

## Develop

```bash
uv sync --extra dev                       # install
./scripts/install-tailwind.sh             # one-time: Tailwind standalone binary -> bin/
./scripts/build-css.sh                    # build app/static/css/tailwind.css
uv run uvicorn app.main:app --reload      # http://127.0.0.1:8000
uv run --extra dev --extra data pytest tests/
uv run --extra dev ruff check .
```

For live CSS edits: `./scripts/build-css.sh --watch`.

## Data

`data/kubbur/*.json` is produced by `cube_rankings` (`data/publish/`) and pushed here by CI
(Plan C). Schemas in `data/kubbur-schemas/` gate every push (`scripts/validate_publish.py`).

## Deploy

Fly.io app `mtgkubbur-is` (region `ams`). Push to `master` → GitHub Actions runs the
test/lint/schema gate → `flyctl deploy`. Requires repo secret `FLY_API_TOKEN`.
