import json
import sys
from datetime import date
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[2] / "data" / "gtfs" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import myciti_build as mb  # noqa: E402
import myciti_fetch as mf  # noqa: E402
import myciti_parse as mp  # noqa: E402


def call(code, static, service=546, live="00:00"):
    return {"id": code, "name": code.title(), "service_id": service, "static_time": static, "time": live,
            "time_colour": "#919191", "delay": "Live", "delay_colour": "#006600", "is_station": False}


def page(route, day, blocks):
    return {"route": route, "day": day, "fetched_at": "2026-10-08T19:00:00+00:00",
            "directions": [{"direction_id": "0", "trip_headsign": f"{route} Out"},
                           {"direction_id": "1", "trip_headsign": f"{route} Back"}],
            "timetable": [{"route": route, "direction": d, "day": day, "trips": trips} for d, trips in blocks]}


def write_raw(tmp: Path, pages, stops=("CIVIC", "ADLEY", "GRDNS", "WXFRD")):
    (tmp / "routes").mkdir(parents=True)
    stops_json = [{"id": c, "name": c.title(), "latitude": -33.92 - i / 1000, "longitude": 18.42, "station": False,
                   "extended": {"extra": {"gtfs_stop_id": c}}} for i, c in enumerate(stops)]
    (tmp / "map.json").write_text(json.dumps({"map_stops": stops_json, "map_routes": [], "map_shapes": []}))
    for p in pages:
        (tmp / "routes" / f"{p['route']}_{p['day']}.json").write_text(json.dumps(p))


def test_js_var_reads_the_sites_spacing_and_stops_at_the_end_of_the_value():
    html = 'x <script> var page_url = "u"; var timetable  =\n[{"a": [1, 2]}]; var other = 3;</script>'
    assert mf.js_var(html, "timetable") == [{"a": [1, 2]}]
    assert mf.js_var(html, "missing") is None


def test_live_estimates_are_dropped_so_refetching_an_unchanged_timetable_is_identical():
    t1 = [{"trips": [{"trip_id": 1, "start_timestamp": 5, "stops": [call("CIVIC", "06:00", live="06:03")]}]}]
    t2 = [{"trips": [{"trip_id": 1, "start_timestamp": 9, "stops": [call("CIVIC", "06:00", live="06:07")]}]}]
    assert mf.without_live(t1) == mf.without_live(t2)
    assert mf.without_live(t1)[0]["trips"][0]["stops"][0]["static_time"] == "06:00"


def test_a_trip_spanning_midnight_moves_its_early_morning_times_to_the_next_day():
    assert mp.past_midnight([23 * 60 + 50, 23 * 60 + 58, 5]) == [1430, 1438, 1445]
    assert mp.past_midnight([600, 590, 620]) == [600, 590, 620]


def test_calls_follow_time_order_with_the_route_sequence_breaking_ties():
    listed = [("CAPEL", 729), ("EXNER", 731), ("HRZLA", 730), ("WXFRD", 732)]
    sequence = ["CAPEL", "HRZLA", "EXNER", "WXFRD"]
    assert mp.travel_order(listed, sequence) == [("CAPEL", 729), ("HRZLA", 730), ("EXNER", 731), ("WXFRD", 732)]
    assert mp.travel_order([("EXNER", 730), ("HRZLA", 730)], sequence) == [("HRZLA", 730), ("EXNER", 730)]
    loop = [("CIVIC", 600), ("ADLEY", 605), ("CIVIC", 630)]
    assert mp.travel_order(loop, ["CIVIC", "ADLEY", "CIVIC"]) == loop


def test_a_service_runs_on_the_days_whose_pages_list_it(tmp_path):
    weekday = [(0, [{"trip_id": 7, "stops": [call("CIVIC", "06:00"), call("WXFRD", "06:20")]}])]
    sunday = [(0, [{"trip_id": 9, "stops": [call("CIVIC", "08:00", 838), call("WXFRD", "08:20", 838)]}])]
    write_raw(tmp_path, [page("101", d, weekday) for d in mp.DAYS[:5]] + [page("101", "Sunday", sunday)])
    trips, skipped, reordered = mp.load_trips(tmp_path)
    assert skipped == [] and reordered == 0
    by_service = {t.service: t for t in trips}
    assert by_service["546"].days == set(mp.DAYS[:5])
    assert by_service["838"].days == {"Sunday"}


def test_build_splits_stopping_patterns_into_routes_and_reports_unknown_stops(tmp_path):
    trips = [
        {"trip_id": 1, "stops": [call("CIVIC", "06:00"), call("ADLEY", "06:05"), call("WXFRD", "06:20")]},
        {"trip_id": 2, "stops": [call("CIVIC", "07:00"), call("ADLEY", "07:05"), call("WXFRD", "07:20")]},
        {"trip_id": 3, "stops": [call("CIVIC", "08:00"), call("WXFRD", "08:15")]},
        {"trip_id": 4, "stops": [call("CIVIC", "09:00"), call("NOWHERE", "09:10"), call("ADLEY", "09:15")]},
    ]
    write_raw(tmp_path, [page("101", "Monday", [(0, trips)])])
    res = mb.build(tmp_path, date(2026, 10, 8))
    routes = {t["trip_id"]: t["route_id"] for t in res["trips"]}
    assert routes["mc_s546_1"] == routes["mc_s546_2"] == "mc_101-0"
    assert routes["mc_s546_3"] == "mc_101-0_2"
    assert {r["route_short_name"] for r in res["routes"].values()} == {"101-0"}
    assert ("101 0", "4", "NOWHERE", "stop not on the map") in res["skipped"]
    seq = [s["stop_id"] for s in res["stop_times"] if s["trip_id"] == "mc_s546_4"]
    assert seq == ["mc_CIVIC", "mc_ADLEY"]


def test_a_trip_after_midnight_gets_times_past_24_hours(tmp_path):
    trips = [{"trip_id": 5, "stops": [call("CIVIC", "23:50"), call("WXFRD", "00:10")]}]
    write_raw(tmp_path, [page("101", "Friday", [(1, trips)])])
    res = mb.build(tmp_path, date(2026, 10, 8))
    assert [s["arrival_time"] for s in res["stop_times"]] == ["23:50:00", "24:10:00"]
    assert res["trips"][0]["direction_id"] == "1"
    assert res["trips"][0]["trip_headsign"] == "101 Back"


def test_a_day_without_service_is_empty_not_an_error(tmp_path):
    no_service = {"route": "108", "day": "Saturday", "fetched_at": "x", "directions": [],
                  "timetable": [{"trips": None}, {"trips": None}]}
    write_raw(tmp_path, [no_service])
    trips, skipped, reordered = mp.load_trips(tmp_path)
    assert trips == [] and skipped == []


def test_a_one_direction_route_sent_as_an_object_is_read(tmp_path):
    one_way = page("213", "Monday", [(1, [{"trip_id": 3, "stops": [call("CIVIC", "06:00"), call("WXFRD", "06:20")]}])])
    one_way["timetable"] = {"1": one_way["timetable"][0]}
    write_raw(tmp_path, [one_way])
    trips, _, _ = mp.load_trips(tmp_path)
    assert [(t.route, t.direction) for t in trips] == [("213", 1)]


def test_a_wait_at_a_stop_is_one_call_with_arrival_and_departure(tmp_path):
    trips = [{"trip_id": 6, "stops": [call("CIVIC", "06:10"), call("WXFRD", "06:19"), call("WXFRD", "06:24")]}]
    write_raw(tmp_path, [page("101", "Sunday", [(1, trips)])])
    res = mb.build(tmp_path, date(2026, 10, 8))
    last = res["stop_times"][-1]
    assert (last["stop_id"], last["arrival_time"], last["departure_time"]) == ("mc_WXFRD", "06:19:00", "06:24:00")
    assert len(res["stop_times"]) == 2
