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
    assert 'aria-label="Tengd forrit"' in r.text  # footer companion-apps nav


def test_footer_links_companion_apps_and_nav_pill_removed():
    # The two external companion apps live in the footer, not the top nav.
    r = client.get("/")
    assert r.status_code == 200
    assert 'href="https://standings.mtgkubbur.is"' in r.text  # public live standings
    assert 'href="https://skra.mtgkubbur.is"' in r.text  # gated host app
    # External links open in a new tab safely.
    assert 'rel="noopener"' in r.text
    # The old top-nav skrá pill has been removed in favour of the footer group.
    assert 'class="nav-skra"' not in r.text
