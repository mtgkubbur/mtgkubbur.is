# tests/test_assets.py — guards the design-token contract & font vendoring.
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "app" / "static" / "css" / "input.css"
SPECTRAL = ROOT / "app" / "static" / "fonts" / "spectral"


def test_no_cdn_anything_in_css():
    text = CSS.read_text(encoding="utf-8")
    assert "fonts.googleapis.com" not in text
    assert "@import" not in text  # everything is vendored


def test_spectral_fontface_declared():
    text = CSS.read_text(encoding="utf-8")
    assert 'font-family: "Spectral"' in text


def test_spectral_files_vendored():
    assert (SPECTRAL / "spectral-600.woff2").exists()
    assert (SPECTRAL / "spectral-500-italic.woff2").exists()


def test_warm_palette_tokens():
    text = CSS.read_text(encoding="utf-8")
    assert "--body-bg: #f7f4ee" in text
    assert "--surface-card: #fffefb" in text


def test_new_token_systems_present():
    text = CSS.read_text(encoding="utf-8")
    for tok in ("--font-display", "--foil", "--podium-gold", "--h1-size", "--ring-gold"):
        assert tok in text, f"missing token {tok}"
