#!/usr/bin/env bash
set -euo pipefail
bin/tailwindcss -i app/static/css/input.css -o app/static/css/tailwind.css --minify "$@"
