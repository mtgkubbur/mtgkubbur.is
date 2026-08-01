"""Gate job: compares the live digest against the committed one."""

import json
from pathlib import Path

from scripts import rotisserie_changed as gate


def test_committed_digest_reads_source_digest(tmp_path: Path):
    p = tmp_path / "rotisserie.json"
    p.write_text(json.dumps({"source_digest": "sha256:abc"}), encoding="utf-8")
    assert gate.committed_digest(p) == "sha256:abc"


def test_committed_digest_missing_file_is_none(tmp_path: Path):
    assert gate.committed_digest(tmp_path / "nope.json") is None


def test_committed_digest_malformed_file_is_none(tmp_path: Path):
    p = tmp_path / "rotisserie.json"
    p.write_text("{not json", encoding="utf-8")
    assert gate.committed_digest(p) is None


def test_decide():
    assert gate.decide("sha256:a", "sha256:b") is True
    assert gate.decide("sha256:a", None) is True  # first ever run must publish
    assert gate.decide("sha256:a", "sha256:a") is False


def test_emit_appends_github_output(tmp_path: Path):
    out = tmp_path / "gh_output"
    gate.emit(True, str(out))
    gate.emit(False, str(out))
    assert out.read_text(encoding="utf-8").splitlines() == ["changed=true", "changed=false"]


def test_emit_without_github_output_does_not_raise():
    gate.emit(True, None)
