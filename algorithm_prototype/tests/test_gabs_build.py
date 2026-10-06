import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[2] / "data" / "gtfs" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import gabs_build as gb  # noqa: E402


def test_variants_expand_abbreviations_and_drop_suffix_tokens():
    assert "tygerberghospital" in gb.variants("TYGERBERG HOSP")
    v = gb.variants("MELTON ROSE STN")
    assert "meltonrose" in v and "meltonrosestation" in v
    assert gb.variants("Ocean View (Gemini Road)")[0] == "oceanview"


def _pos(name, lat, source):
    return dict(id=None, name=name, lat=lat, lon=18.0, source=source)


def test_lookup_prefers_manual_then_govt_then_osm():
    refs = {
        "manual": {"siteC".lower(): _pos("Site C (manual)", -34.0, "manual")},
        "govt": {"bellville": _pos("Bellville", -33.9, "govt"), "sitec": _pos("Site C (govt)", -34.1, "govt")},
        "osm-transit": {"bellville": _pos("Bellville", -33.91, "osm-transit"), "parow": _pos("Parow", -33.89, "osm-transit")},
        "osm-places": {"parow": _pos("Parow", -33.88, "osm-place"), "harare": _pos("Harare", -34.04, "osm-place")},
        "geocoded": {"harare": _pos("Harare (geocoded)", -34.05, "geocoded"), "fisantkraal": _pos("Fisantkraal", -33.8, "geocoded")},
    }
    assert gb.lookup("SITE C", refs)[1] == "manual"
    assert gb.lookup("BELLVILLE", refs)[1] == "govt"
    assert gb.lookup("PAROW", refs)[1] == "osm-transit"
    assert gb.lookup("HARARE", refs)[1] == "osm-places"
    assert gb.lookup("FISANTKRAAL", refs)[1] == "geocoded"
    assert gb.lookup("N2 FREEWAY", refs) == (None, None)


def test_via_times_are_interpolated_by_distance_not_by_stop_count():
    coords = {"A": (0.0, 0.0), "B": (0.0, 0.075), "C": (0.0, 0.1)}
    out = gb.interpolate([("A", 600), ("B", None), ("C", 700)], coords)
    assert out == [("A", 600), ("B", 675), ("C", 700)]


def test_untimed_ends_are_dropped_and_zero_length_segments_do_not_divide_by_zero():
    coords = {"X": (0.0, 0.0), "A": (0.0, 0.0), "B": (0.0, 0.0), "C": (0.0, 0.05)}
    out = gb.interpolate([("X", None), ("A", 600), ("B", None), ("C", 620)], coords)
    assert out[0] == ("A", 600)
    assert dict(out)["B"] == 600


def _st(lat, lon, source="osm-place"):
    return dict(id="x", name="x", lat=lat, lon=lon, source=source, approx=False)


def test_a_placement_that_contradicts_the_timetable_is_withdrawn_but_human_decisions_are_not():
    stations = {"A": _st(-34.0, 18.50, "govt"), "B": _st(-34.0, 18.51, "govt"), "C": _st(-34.01, 18.50, "govt"),
                "X": _st(-34.0, 18.95)}
    legs = {"X": [("A", 10), ("B", 10), ("C", 10)], "A": [("X", 10)], "B": [("X", 10)], "C": [("X", 10)]}
    assert gb.inconsistent_placements(stations, legs) == [("X", 3, 3)]
    stations["X"]["source"] = "manual"
    assert gb.inconsistent_placements(stations, legs) == []


def test_one_odd_trip_cannot_condemn_a_stop():
    stations = {"A": _st(-34.0, 18.50, "govt"), "B": _st(-34.0, 18.51, "govt"), "X": _st(-34.0, 18.52)}
    legs = {"X": [("A", 8)] * 10 + [("A", 0)] + [("B", 6)] * 3}
    assert gb.inconsistent_placements(stations, legs) == []
