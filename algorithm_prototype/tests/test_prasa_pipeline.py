import importlib.util
import sys
from datetime import date, time
from pathlib import Path

import pytest

openpyxl = pytest.importorskip("openpyxl")

SCRIPTS = Path(__file__).resolve().parents[2] / "data" / "gtfs" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import prasa_build as pb  # noqa: E402
import prasa_parse as pp  # noqa: E402


def make_sheet(path, title, day, trains, stations):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws["A1"], ws["A2"] = title, day
    ws.append(["TRAIN NO"] + trains)
    for label, cells in stations:
        ws.append([label] + cells)
    wb.save(path)
    return path


def test_parse_pairs_notes_platform_rows_and_midnight(tmp_path):
    p = make_sheet(
        tmp_path / "Southern-Line-Outbound-Weekday.xlsx", "Southern Line Outbound", "Weekday", ["100", "200"],
        [
            ("CAPE TOWN", [time(23, 40), "..", ]),
            ("MOWBRAY", ["23:50:00", time(5, 0)]),
            ("FISH HOEK (A)", [time(0, 20), "EXPRESS"]),
            ("PLATFORM", [3, 4]),
            ("FISH HOEK (D)", [time(0, 25), None]),
            ("SIMONSTOWN", [time(0, 40), time(5, 40)]),
        ],
    )
    sheet = pp.parse_workbook(p)
    assert (sheet.line, sheet.direction, sheet.day_group, sheet.holiday) == ("southern", "outbound", "weekday", False)
    t100, t200 = sheet.trains
    assert [s[0] for s in t100.stops] == ["CAPE TOWN", "MOWBRAY", "FISH HOEK", "SIMONSTOWN"]
    assert t100.stops[2] == ("FISH HOEK", 24 * 60 + 20, 24 * 60 + 25)
    assert t100.stops[3][1] == 24 * 60 + 40
    assert [s[0] for s in t200.stops] == ["MOWBRAY", "SIMONSTOWN"]
    assert ("FISH HOEK", "EXPRESS") in t200.notes


def test_conflicting_labels_are_rejected(tmp_path):
    p = make_sheet(tmp_path / "Capeflats-outbound-Weekday.xlsx", "CAPEFLATS Outbound Weekday", "Saturday",
                   ["1"], [("A", [time(5, 0)]), ("B", [time(5, 10)])])
    sheet = pp.parse_workbook(p)
    sheet.uploaded = date(2026, 4, 1)
    chosen, rejected = pp.select([sheet], date(2026, 10, 6))
    assert not chosen
    assert "contradictory" in rejected[0][1]


def _sheet(line, direction, day, uploaded, n=1, holiday=False, name="x.xlsx"):
    trains = [pp.Train(str(i), [("A", 300, 300), ("B", 310, 310)]) for i in range(n)]
    return pp.Sheet(name, line, direction, day, holiday, trains, uploaded)


def test_selection_newest_wins_old_and_holiday_rejected():
    old = _sheet("central", "inbound", "weekday", date(2026, 1, 1), name="old")
    new = _sheet("central", "inbound", "weekday", date(2026, 6, 1), name="new")
    ancient = _sheet("central", "inbound", "saturday", date(2024, 1, 1), name="ancient")
    pph = _sheet("central", "inbound", "weekday", date(2026, 9, 1), holiday=True, name="pph")
    future = _sheet("central", "inbound", "weekday", date(2026, 12, 1), name="future")
    chosen, rejected = pp.select([old, new, ancient, pph, future], date(2026, 10, 6))
    assert chosen[("central", "inbound", "weekday")].file == "new"
    assert ("central", "inbound", "saturday") not in chosen
    reasons = {s.file: why for s, why in rejected}
    assert reasons["pph"] == "public holiday service"
    assert "after the as-of" in reasons["future"]
    assert reasons["old"] == "superseded"


def test_station_spelling_variants_share_one_stop():
    gov = {pb.sq("ST JAMES"): {"name": "ST JAMES", "lat": "-34.1", "lon": "18.4"}}
    out = pb.resolve_stations({"ST JAMES", "ST. JAMES", "NOWHERE"}, {}, gov, {}, {})
    assert out["ST JAMES"]["id"] == out["ST. JAMES"]["id"] == "mr_ST_JAMES"
    assert out["NOWHERE"] is None


def _mv_chosen(direction):
    if direction == "inbound":
        north = pp.Train("3200", [("STRAND", 300, 300), ("BELLVILLE", 330, 331), ("CAPE TOWN", 350, 350)],
                         notes=[("TYGERBERG", "Via MV")])
        mv = pp.Train("3200", [("BELLVILLE", 331, 333), ("MONTE VISTA", 340, 341), ("CAPE TOWN", 355, 355)])
    else:
        north = pp.Train("2301", [("CAPE TOWN", 300, 300), ("BELLVILLE", 340, 342), ("KUILS RIVER", 350, 350)],
                         notes=[("WOODSTOCK", "via")])
        mv = pp.Train("2301", [("CAPE TOWN", 300, 300), ("MONTE VISTA", 315, 316), ("BELLVILLE", 338, 339)])
    other = pp.Train("9999", [("BELLVILLE", 400, 400), ("CAPE TOWN", 430, 430)])
    return {
        ("northern", direction, "weekday"): pp.Sheet(
            "n", "northern", direction, "weekday", False, [north], date(2026, 6, 1)),
        ("monte-vista", direction, "weekday"): pp.Sheet(
            "m", "monte-vista", direction, "weekday", False, [mv, other], date(2026, 6, 1)),
    }


def test_northern_via_monte_vista_trains_merge_into_one_trip():
    from collections import defaultdict
    log = defaultdict(list)
    log["merged"] = 0
    out = pb.merge_monte_vista(_mv_chosen("inbound"), log)
    (merged,) = out[("northern", "inbound", "weekday")]
    assert [s[0] for s in merged.stops] == ["STRAND", "BELLVILLE", "MONTE VISTA", "CAPE TOWN"]
    assert merged.stops[1] == ("BELLVILLE", 330, 333)
    assert [t.number for t in out[("monte-vista", "inbound", "weekday")]] == ["9999"]

    log = defaultdict(list)
    log["merged"] = 0
    out = pb.merge_monte_vista(_mv_chosen("outbound"), log)
    (merged,) = out[("northern", "outbound", "weekday")]
    assert [s[0] for s in merged.stops] == ["CAPE TOWN", "MONTE VISTA", "BELLVILLE", "KUILS RIVER"]
    assert merged.stops[2] == ("BELLVILLE", 338, 342)


def test_through_train_with_disagreeing_arrival_is_not_merged():
    from collections import defaultdict
    chosen = _mv_chosen("inbound")
    mv = chosen[("monte-vista", "inbound", "weekday")].trains[0]
    mv.stops[-1] = ("CAPE TOWN", 415, 415)
    log = defaultdict(list)
    log["merged"] = 0
    out = pb.merge_monte_vista(chosen, log)
    assert log["merged"] == 0 and log["merge_time_mismatch"]
    assert {t.number for t in out[("monte-vista", "inbound", "weekday")]} == {"3200", "9999"}
