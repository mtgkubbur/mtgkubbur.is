from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_methods_route_ok():
    resp = client.get("/methods")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]


def test_methods_has_title_and_subtitle():
    html = client.get("/methods").text
    assert "<h1" in html
    assert "Statistical Methods" in html
    assert (
        "Time-Varying Bradley-Terry Model with Attendance-Based "
        "Mean Reversion and Cube Effects" in html
    )


def test_methods_has_all_ten_section_headings():
    html = client.get("/methods").text
    for heading in [
        "Overview",
        "The Bradley-Terry Model",
        "Temporal Dynamics: Ornstein-Uhlenbeck Process",
        "Attendance-Based Mean Reversion",
        "Half-Life Interpretation",
        "Cube Effects",
        "Prior Distributions",
        "Uncertainty Propagation",
        "Identifiability",
        "Inference",
        "Model Comparison",
        "Limitations and Future Directions",
    ]:
        assert heading in html, heading


def test_methods_loads_mathjax_and_has_latex():
    html = client.get("/methods").text
    assert "tex-chtml" in html  # MathJax 3 CHTML bundle (TeX in, CHTML out)
    assert "MathJax" in html
    # display + inline LaTeX present (raw, MathJax renders client-side)
    assert "\\text{logit}^{-1}" in html
    assert "\\phi_{\\text{present}}" in html


def test_methods_mathjax_is_vendored_not_cdn():
    # Convention: all runtime assets are vendored under /static, no CDN.
    html = client.get("/methods").text
    assert "/static/js/vendor/mathjax-3.2.2/es5/tex-chtml.js" in html
    assert "jsdelivr" not in html
    assert "cdn." not in html


def test_methods_has_both_tables():
    html = client.get("/methods").text
    # cube-categories table
    assert "Vintage Cube, Bolti Vintage Cube, Nerva's Cube" in html
    assert "Miscellaneous cubes" in html
    # priors table
    assert "Exponential(1)" in html
    assert "Concentrated near 1 (weak reversion)" in html


def test_methods_score_scale_is_elo_1500_not_0_100():
    html = client.get("/methods").text
    # NEW ELO-1500 presentation
    assert "Score Scale (ELO)" in html
    assert "1500" in html
    assert "bt_to_elo" in html
    # OLD 0-100 normalisation must be GONE
    assert "Score Scale (0-100)" not in html
    assert "\\times 100" not in html
