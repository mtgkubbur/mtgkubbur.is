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
