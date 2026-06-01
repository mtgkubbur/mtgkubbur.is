from fastapi.testclient import TestClient

from app.main import app
from app.routes import rankings

client = TestClient(app)


# ---- delta_cell (pure) -----------------------------------------------------
def test_delta_cell_none_is_na():
    c = rankings.delta_cell(None)
    assert c == {"kind": "na", "text": "–"}


def test_delta_cell_zero_is_em_dash():
    c = rankings.delta_cell(0)
    assert c == {"kind": "zero", "text": "—"}


def test_delta_cell_positive():
    c = rankings.delta_cell(6)
    assert c == {"kind": "up", "text": "+6"}


def test_delta_cell_negative_keeps_sign():
    c = rankings.delta_cell(-3)
    assert c == {"kind": "down", "text": "-3"}


# ---- winrate_bar_colour (pure) ---------------------------------------------
def test_winrate_bar_colour_clamps_low():
    # <= 35 % clamps to t=0 → pure red rgb(231,76,60)
    assert rankings.winrate_bar_colour(20) == "rgb(231, 76, 60)"
    assert rankings.winrate_bar_colour(35) == "rgb(231, 76, 60)"


def test_winrate_bar_colour_clamps_high():
    # >= 65 % clamps to t=1 → pure green rgb(46,204,113)
    assert rankings.winrate_bar_colour(65) == "rgb(46, 204, 113)"
    assert rankings.winrate_bar_colour(100) == "rgb(46, 204, 113)"


def test_winrate_bar_colour_midpoint():
    # 50 % → t=0.5 → channel-wise midpoint, rounded
    assert rankings.winrate_bar_colour(50) == "rgb(138, 140, 86)"


# ---- build_tier_views (pure) -----------------------------------------------
def _fake_rankings():
    return [
        # qualified overall (rank 2), qualified High (High_rank 1)
        {
            "player": "Bravo", "wins": 60, "losses": 40, "total": 100,
            "score_median": 1550, "prev_score_median": 1540, "rank": 2, "prev_rank": 3,
            "High_rank": 1, "High_wins": 30, "High_losses": 10, "High_total": 40,
            "High_elo_median": 1560, "High_prev_elo": 1555, "High_prev_rank": 1,
        },
        # qualified overall (rank 1), NOT qualified High (High_rank None)
        {
            "player": "Alpha", "wins": 80, "losses": 20, "total": 100,
            "score_median": 1600, "prev_score_median": 1600, "rank": 1, "prev_rank": 2,
            "High_rank": None, "High_wins": None, "High_losses": None, "High_total": None,
            "High_elo_median": 1500, "High_prev_elo": None, "High_prev_rank": None,
        },
        # NOT qualified overall (rank None) — must be excluded from Allt
        {
            "player": "Zulu", "wins": 10, "losses": 40, "total": 50,
            "score_median": 1400, "prev_score_median": None, "rank": None, "prev_rank": None,
            "High_rank": None, "High_wins": None, "High_losses": None, "High_total": None,
            "High_elo_median": 1480, "High_prev_elo": None, "High_prev_rank": None,
        },
    ]


def test_build_tier_views_keys():
    views = rankings.build_tier_views(_fake_rankings())
    assert set(views) == {"Allt", "High", "Medium", "Low", "Other"}


def test_allt_excludes_null_rank_and_sorts_by_rank():
    views = rankings.build_tier_views(_fake_rankings())
    allt = views["Allt"]
    assert [r["player"] for r in allt] == ["Alpha", "Bravo"]  # rank 1 then 2; Zulu excluded
    assert all(r["nr"] is not None for r in allt)


def test_allt_row_fields_and_pct():
    views = rankings.build_tier_views(_fake_rankings())
    alpha = views["Allt"][0]
    assert alpha["nr"] == 1
    assert alpha["player"] == "Alpha"
    assert alpha["wins"] == 80 and alpha["losses"] == 20
    assert alpha["pct"] == 80  # round(80/100*100)
    assert alpha["elo"] == 1600 and alpha["prev_elo"] == 1600
    assert alpha["nr_prev"] == 2
    assert alpha["podium"] == 1
    assert alpha["score_delta"] == 0          # 1600 - 1600
    assert alpha["rank_delta"] == 1            # nr_prev(2) - nr(1)


def test_allt_podium_classes():
    views = rankings.build_tier_views(_fake_rankings())
    podiums = [r["podium"] for r in views["Allt"]]
    assert podiums == [1, 2]  # only two qualified rows; ranks 1 and 2


def test_per_tier_excludes_null_tier_rank_and_computes_deltas():
    views = rankings.build_tier_views(_fake_rankings())
    high = views["High"]
    # only Bravo has High_rank not None
    assert [r["player"] for r in high] == ["Bravo"]
    b = high[0]
    assert b["nr"] == 1
    assert b["wins"] == 30 and b["losses"] == 10
    assert b["pct"] == 75               # round(30/40*100)
    assert b["elo"] == 1560 and b["prev_elo"] == 1555
    assert b["nr_prev"] == 1
    assert b["score_delta"] == 5        # 1560 - 1555
    assert b["rank_delta"] == 0         # 1 - 1
    assert b["podium"] == 1


def test_per_tier_handles_missing_prev():
    # a tier row whose prev elo/rank are None → deltas None
    rows = [{
        "player": "Solo", "wins": 5, "losses": 5, "total": 10,
        "score_median": 1500, "prev_score_median": None, "rank": 1, "prev_rank": None,
        "Medium_rank": 1, "Medium_wins": 5, "Medium_losses": 5, "Medium_total": 10,
        "Medium_elo_median": 1500, "Medium_prev_elo": None, "Medium_prev_rank": None,
    }]
    med = rankings.build_tier_views(rows)["Medium"][0]
    assert med["score_delta"] is None and med["rank_delta"] is None
    assert med["prev_elo"] is None and med["nr_prev"] is None


# ---- route smoke -----------------------------------------------------------
def test_index_returns_200():
    r = client.get("/")
    assert r.status_code == 200


def test_index_contains_top_player_and_chrome():
    r = client.get("/")
    # Örvar is rank 1 in the real snapshot; the cube filter label + an active panel exist
    assert "Örvar" in r.text
    assert "Kubbaflokkur:" in r.text
    assert 'data-cube="Other"' in r.text
    assert "cube-table-panel active" in r.text


def test_index_no_unqualified_player_in_allt_section():
    # Einar has rank null in the real snapshot → must NOT appear as a "N. Einar" row
    r = client.get("/")
    assert ". Einar<" not in r.text and ". Einar " not in r.text
