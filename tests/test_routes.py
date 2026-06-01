from fastapi.testclient import TestClient

from app import data
from app.main import app

client = TestClient(app)


def test_healthz_ok():
    r = client.get("/healthz")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_data_player_endpoint():
    slug = data.player_index()[0]["slug"]
    r = client.get(f"/data/players/{slug}")
    assert r.status_code == 200 and r.json()["slug"] == slug


def test_data_player_unknown_404():
    assert client.get("/data/players/zzz-nope").status_code == 404


def test_data_cube_endpoint():
    slug = data.cube_index()[0]["slug"]
    r = client.get(f"/data/cubes/{slug}")
    assert r.status_code == 200 and r.json()["slug"] == slug


def test_data_h2h_endpoint():
    r = client.get("/data/head_to_head")
    assert r.status_code == 200 and isinstance(r.json(), list)


def test_404_renders_chrome():
    r = client.get("/no-such-page")
    assert r.status_code == 404 and "MtG Kubbur" in r.text
