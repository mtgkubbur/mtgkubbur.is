"""Structural guards on the rotisserie workflow.

These encode two silent failure modes: a gate that never gates, and a push that
never deploys because GITHUB_TOKEN cannot trigger deploy.yml.
"""

from pathlib import Path

WF = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "rotisserie.yml"


def test_workflow_exists():
    assert WF.exists()


def test_runs_on_demand_only():
    """The draft is over: polling was retired 2026-08-10, manual sync kept.

    The cron assertion is inverted rather than deleted so a re-enabled
    schedule is a deliberate edit here, not an accidental revert.
    """
    text = WF.read_text(encoding="utf-8")
    assert "workflow_dispatch" in text
    active_lines = [ln for ln in text.splitlines() if not ln.lstrip().startswith("#")]
    assert not any("cron:" in ln for ln in active_lines)


def test_sync_job_is_gated_on_the_check_output():
    text = WF.read_text(encoding="utf-8")
    assert "needs: check" in text
    assert "needs.check.outputs.changed == 'true'" in text


def test_gate_job_installs_no_dependencies():
    """The gate's whole point is being cheap; setup-uv would defeat it."""
    text = WF.read_text(encoding="utf-8")
    gate = text.split("check:", 1)[1].split("sync:", 1)[0]
    assert "setup-uv" not in gate
    assert "uv sync" not in gate
    assert "python3 scripts/rotisserie_changed.py" in gate


def test_sync_job_deploys_itself():
    """A GITHUB_TOKEN push cannot trigger deploy.yml, so this job must deploy."""
    text = WF.read_text(encoding="utf-8")
    assert "flyctl deploy" in text
    assert "FLY_API_TOKEN" in text


def test_validation_precedes_the_commit():
    text = WF.read_text(encoding="utf-8")
    assert text.index("validate_publish.py") < text.index("git commit")
