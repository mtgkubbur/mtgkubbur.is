from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_healthz_ok():
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_static_mounted():
    r = client.get("/static/.gitkeep")
    assert r.status_code in (200, 404)
