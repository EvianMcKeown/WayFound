import importlib.util
import sys
from datetime import date
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "data" / "gtfs" / "scripts" / "validate_gtfs.py"
spec = importlib.util.spec_from_file_location("validate_gtfs", SCRIPT)
vg = importlib.util.module_from_spec(spec)
sys.modules["validate_gtfs"] = vg
spec.loader.exec_module(vg)

TODAY = date(2025, 6, 1)


def write_feed(folder: Path, *, stops, stop_times, agency="GABS", calendar_end="20251231"):
    def w(name, header, rows):
        (folder / name).write_text("\n".join([header] + [",".join(map(str, r)) for r in rows]) + "\n")

    w("agency.txt", "agency_id,agency_name,agency_url,agency_timezone",
      [("GABS", "Golden Arrow", "http://x", "Africa/Johannesburg")])
    w("calendar.txt", "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
      [("s1", 1, 1, 1, 1, 1, 0, 0, "20250101", calendar_end)])
    w("routes.txt", "route_id,agency_id,route_short_name", [("r1", agency, "1")])
    w("trips.txt", "route_id,service_id,trip_id,trip_headsign,direction_id", [("r1", "s1", "t1", "X", 0)])
    w("stops.txt", "stop_id,stop_name,stop_lat,stop_lon", stops)
    w("stop_times.txt", "trip_id,arrival_time,departure_time,stop_id,stop_sequence", stop_times)


GOOD_STOPS = [("A", "Alpha", -33.92, 18.42), ("B", "Beta", -33.93, 18.43)]
GOOD_TIMES = [("t1", "08:00:00", "08:00:00", "A", 1), ("t1", "08:10:00", "08:10:00", "B", 2)]


def codes(folder, **kw):
    return vg.validate(folder, today=TODAY, **kw).counts


def test_clean_feed_has_no_errors(tmp_path):
    write_feed(tmp_path, stops=GOOD_STOPS, stop_times=GOOD_TIMES)
    report = vg.validate(tmp_path, today=TODAY)
    assert report.n(vg.ERROR) == 0, dict(report.counts)


def test_swapped_and_out_of_area_coordinates(tmp_path):
    stops = GOOD_STOPS + [("C", "Swapped", 18.42, -33.92), ("D", "Far", 51.5, -0.12)]
    times = GOOD_TIMES + [("t1", "08:20:00", "08:20:00", "C", 3), ("t1", "08:30:00", "08:30:00", "D", 4)]
    write_feed(tmp_path, stops=stops, stop_times=times)
    c = codes(tmp_path)
    assert c["stop-lat-lon-swapped"] == 1
    assert c["stop-outside-bbox"] == 1


def test_impossible_speed_and_rounding_slack(tmp_path):
    far = [("A", "Alpha", -33.92, 18.42), ("B", "Beta", -34.20, 18.80)]
    write_feed(tmp_path, stops=far,
               stop_times=[("t1", "08:00:00", "08:00:00", "A", 1), ("t1", "08:05:00", "08:05:00", "B", 2)])
    assert codes(tmp_path)["impossible-speed"] == 1

    near = [("A", "Alpha", -33.920, 18.420), ("B", "Beta", -33.928, 18.424)]
    write_feed(tmp_path, stops=near,
               stop_times=[("t1", "08:00:00", "08:00:00", "A", 1), ("t1", "08:00:00", "08:00:00", "B", 2)])
    assert "impossible-speed" not in codes(tmp_path)


def test_reference_and_time_problems(tmp_path):
    times = [("t1", "08:00:00", "08:00:00", "A", 1), ("t1", "09:00:00", "09:00:00", "B", 2),
             ("t1", "08:30:00", "08:30:00", "A", 3), ("t1", "bogus", "bogus", "A", 4),
             ("t1", "N/A", "N/A", "ZZZ", 5), ("ghost", "08:00:00", "08:00:00", "A", 1)]
    write_feed(tmp_path, stops=GOOD_STOPS, stop_times=times, agency="metrorail")
    c = codes(tmp_path)
    assert c["non-monotonic-time"] == 1
    assert c["unparsable-time"] == 1
    assert c["stop-time-unknown-stop"] == 1
    assert c["stop-time-unknown-trip"] == 1
    assert c["route-unknown-agency"] == 1


def test_expired_feed_is_a_warning(tmp_path):
    write_feed(tmp_path, stops=GOOD_STOPS, stop_times=GOOD_TIMES, calendar_end="20240101")
    report = vg.validate(tmp_path, today=TODAY)
    assert report.severity["feed-expired"] == vg.WARN


def test_missing_required_column_stops_early(tmp_path):
    write_feed(tmp_path, stops=GOOD_STOPS, stop_times=GOOD_TIMES)
    (tmp_path / "stops.txt").write_text("stop_id,stop_name\nA,Alpha\n")
    c = codes(tmp_path)
    assert c["missing-column"] == 1
    assert "impossible-speed" not in c
