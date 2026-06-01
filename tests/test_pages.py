from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

PAGES = {
    "/": "ELO-stigaröðun",
    "/throun": "Þróun og tölfræði einstakra leikmanna",
    "/einvigi": "Beinn samanburður milli tveggja leikmanna",
    "/kubbar": "Tölfræði og saga einstakra kubba",
    "/dagatal": "Dagskrá kubbakvölda",
    "/methods": "Statistical Methods",
}


def test_all_pages_200_and_chrome():
    for url, marker in PAGES.items():
        r = client.get(url)
        assert r.status_code == 200, url
        assert "MtG Kubbur" in r.text, url
        assert marker in r.text, f"{url} missing '{marker}'"


def test_nav_landmarks_have_distinct_aria_labels():
    # WCAG 2.4.1: the navbar and footer <nav> landmarks must be
    # distinguishable from each other, here via aria-label.
    r = client.get("/")
    assert r.status_code == 200
    assert 'aria-label="Aðalvalmynd"' in r.text  # primary navbar (base.html)
    assert 'aria-label="Síðufótur"' in r.text  # footer nav (footer.html)
