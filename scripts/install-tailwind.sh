#!/usr/bin/env bash
set -euo pipefail
VERSION="v3.4.17"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) ASSET="tailwindcss-macos-arm64" ;;
  Darwin-x86_64) ASSET="tailwindcss-macos-x64" ;;
  Linux-x86_64) ASSET="tailwindcss-linux-x64" ;;
  Linux-aarch64) ASSET="tailwindcss-linux-arm64" ;;
  *) echo "Unsupported platform" >&2; exit 1 ;;
esac
mkdir -p bin
curl -sL -o bin/tailwindcss \
  "https://github.com/tailwindlabs/tailwindcss/releases/download/${VERSION}/${ASSET}"
chmod +x bin/tailwindcss
echo "Installed $(bin/tailwindcss --help | head -1)"
