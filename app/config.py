"""Application configuration — all settings from environment variables."""

import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
KUBBUR_DIR = DATA_DIR / "kubbur"
TEMPLATES_DIR = ROOT_DIR / "app" / "templates"
STATIC_DIR = ROOT_DIR / "app" / "static"

SITE_URL: str = os.getenv("SITE_URL", "https://mtgkubbur.is").rstrip("/")
FLY_APP_NAME: str | None = os.getenv("FLY_APP_NAME") or None
FLY_RELEASE_VERSION: str | None = os.getenv("FLY_RELEASE_VERSION") or None
