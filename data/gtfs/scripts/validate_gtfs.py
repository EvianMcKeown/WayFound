#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import re
import sys
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

ERROR, WARN = "ERROR", "WARN"

REQUIRED = {
    "agency.txt": ["agency_id", "agency_name", "agency_timezone"],
    "calendar.txt": ["service_id", "monday", "tuesday", "wednesday", "thursday",
                     "friday", "saturday", "sunday", "start_date", "end_date"],
    "routes.txt": ["route_id", "agency_id", "route_short_name"],
    "trips.txt": ["route_id", "service_id", "trip_id", "direction_id"],
    "stop_times.txt": ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
    "stops.txt": ["stop_id", "stop_name", "stop_lat", "stop_lon"],
}
OPTIONAL = {"calendar_dates.txt": ["service_id", "date", "exception_type"]}

READER_AGENCIES = {"metrorail": "rail", "MyCiti": "bus", "GABS": "bus"}

DEFAULT_BBOX = (-34.45, -33.45, 18.25, 19.15)
DEFAULT_MAX_SPEED = {"rail": 140.0, "bus": 100.0}

TIME_RE = re.compile(r"^\d{1,3}:[0-5]\d:[0-5]\d$")
PLACEHOLDERS = {"", "N/A", "NA", "VIA"}
ROUNDING_SLACK_MIN = 1


@dataclass
class Report:
    max_examples: int = 5
    counts: Counter = field(default_factory=Counter)
    severity: dict = field(default_factory=dict)
    examples: dict = field(default_factory=lambda: defaultdict(list))
    groups: dict = field(default_factory=lambda: defaultdict(Counter))

    def add(self, severity: str, code: str, message: str, group: str | None = None) -> None:
        self.counts[code] += 1
        if group is not None:
            self.groups[code][group] += 1
        self.severity[code] = severity
        if len(self.examples[code]) < self.max_examples:
            self.examples[code].append(message)

    def n(self, severity: str) -> int:
        return sum(c for k, c in self.counts.items() if self.severity[k] == severity)


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371000.0 * math.asin(math.sqrt(a))


def read_csv(path: Path, required: list[str], report: Report, optional: bool = False):
    if not path.exists():
        if not optional:
            report.add(ERROR, "missing-file", f"{path.name} not found")
        return []
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        missing = [c for c in required if c not in (reader.fieldnames or [])]
        if missing:
            report.add(ERROR, "missing-column", f"{path.name} lacks column(s): {', '.join(missing)}")
            return []
        return list(reader)


def parse_time(raw: str):
    raw = (raw or "").strip()
    if raw.upper() in PLACEHOLDERS:
        return None
    if not TIME_RE.match(raw):
        raise ValueError(raw)
    h, m, _ = map(int, raw.split(":"))
    return h * 60 + m


def parse_date(raw: str):
    return datetime.strptime(raw.strip(), "%Y%m%d").date()


def check_ids(rows, key, label, report):
    seen, out = set(), {}
    for r in rows:
        v = r[key]
        if v in seen:
            report.add(ERROR, f"duplicate-{label}-id", f"{label} id '{v}' appears more than once")
        seen.add(v)
        out[v] = r
    return out


def check_stops(stops, report, bbox, name_gap_km):
    coords, by_name = {}, defaultdict(list)
    lat_min, lat_max, lon_min, lon_max = bbox
    for sid, r in stops.items():
        try:
            lat, lon = float(r["stop_lat"]), float(r["stop_lon"])
        except ValueError:
            report.add(ERROR, "stop-bad-coordinate", f"{sid} ({r['stop_name']}): non-numeric lat/lon")
            continue
        in_box = lat_min <= lat <= lat_max and lon_min <= lon <= lon_max
        swapped_in_box = lat_min <= lon <= lat_max and lon_min <= lat <= lon_max
        if not in_box and swapped_in_box:
            report.add(ERROR, "stop-lat-lon-swapped",
                       f"{sid} ({r['stop_name']}): stop_lat={lat} stop_lon={lon} - columns look swapped")
            continue
        if not in_box:
            report.add(ERROR, "stop-outside-bbox",
                       f"{sid} ({r['stop_name']}): ({lat}, {lon}) is outside the Cape Town area")
            continue
        coords[sid] = (lat, lon)
        by_name[r["stop_name"].strip().lower()].append(sid)

    for name, ids in by_name.items():
        if len(ids) < 2:
            continue
        far = max(
            haversine_m(*coords[a], *coords[b]) for i, a in enumerate(ids) for b in ids[i + 1:]
        ) / 1000
        if far > name_gap_km:
            report.add(WARN, "same-name-far-apart",
                       f"'{name}' used by {len(ids)} stops up to {far:.1f} km apart ({', '.join(ids[:4])})")

    cell = defaultdict(list)
    for sid, (lat, lon) in coords.items():
        cell[(round(lat, 5), round(lon, 5))].append(sid)
    for (lat, lon), ids in cell.items():
        if len(ids) > 1:
            report.add(WARN, "stops-share-coordinate", f"{', '.join(ids[:5])} all at ({lat}, {lon})")
    return coords


def check_references(agencies, routes, trips, services, stops, stop_times, report):
    for rid, r in routes.items():
        if r["agency_id"] not in agencies:
            report.add(ERROR, "route-unknown-agency",
                       f"route {rid}: agency_id '{r['agency_id']}' is not in agency.txt")
        if r["agency_id"] not in READER_AGENCIES:
            report.add(ERROR, "route-agency-unsupported-by-reader",
                       f"route {rid}: agency_id '{r['agency_id']}' makes gtfs_reader raise "
                       f"(accepts {sorted(READER_AGENCIES)})")
    trips_with_times = {st["trip_id"] for st in stop_times}
    routes_with_trips = set()
    for tid, t in trips.items():
        routes_with_trips.add(t["route_id"])
        if t["route_id"] not in routes:
            report.add(ERROR, "trip-unknown-route", f"trip {tid}: route_id '{t['route_id']}' not in routes.txt")
        if t["service_id"] not in services:
            report.add(ERROR, "trip-unknown-service", f"trip {tid}: service_id '{t['service_id']}' not in calendar")
        if tid not in trips_with_times:
            report.add(WARN, "trip-without-stop-times", f"trip {tid} has no stop_times (reader skips it)")
    for rid in routes:
        if rid not in routes_with_trips:
            report.add(WARN, "route-without-trips", f"route {rid} has no trips")
    used = set()
    for st in stop_times:
        used.add(st["stop_id"])
        if st["trip_id"] not in trips:
            report.add(ERROR, "stop-time-unknown-trip", f"stop_time references unknown trip '{st['trip_id']}'")
        if st["stop_id"] not in stops:
            report.add(ERROR, "stop-time-unknown-stop",
                       f"trip {st['trip_id']}: unknown stop_id '{st['stop_id']}'")
    for sid in stops:
        if sid not in used:
            report.add(WARN, "stop-never-used", f"stop {sid} ({stops[sid]['stop_name']}) is in no trip")


def check_calendar(calendar_rows, calendar_dates, report, today):
    ends = []
    for r in calendar_rows:
        try:
            start, end = parse_date(r["start_date"]), parse_date(r["end_date"])
        except ValueError:
            report.add(ERROR, "calendar-bad-date", f"service {r['service_id']}: unparsable start/end date")
            continue
        ends.append(end)
        if end < start:
            report.add(ERROR, "calendar-end-before-start", f"service {r['service_id']}: {start} > {end}")
        days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        if not any(r[d] == "1" for d in days):
            report.add(WARN, "service-runs-no-days", f"service {r['service_id']} is active on no weekday")
    if ends and max(ends) < today:
        report.add(WARN, "feed-expired",
                   f"every service ended by {max(ends)} ({(today - max(ends)).days} days ago)")
    known = {r["service_id"] for r in calendar_rows}
    for r in calendar_dates:
        if r["service_id"] not in known:
            report.add(ERROR, "calendar-date-unknown-service", f"calendar_dates: unknown service '{r['service_id']}'")


def check_trips(stop_times, trips, routes, coords, report, max_speed):
    by_trip = defaultdict(list)
    for st in stop_times:
        by_trip[st["trip_id"]].append(st)

    for tid, rows in by_trip.items():
        trip = trips.get(tid)
        if trip is None:
            continue
        try:
            rows.sort(key=lambda r: int(r["stop_sequence"]))
        except ValueError:
            report.add(ERROR, "stop-sequence-not-integer", f"trip {tid}: non-integer stop_sequence")
            continue
        seqs = [int(r["stop_sequence"]) for r in rows]
        if len(set(seqs)) != len(seqs):
            report.add(ERROR, "duplicate-stop-sequence", f"trip {tid}: repeated stop_sequence")
        agency = routes.get(trip["route_id"], {}).get("agency_id", "")
        kind = READER_AGENCIES.get(agency, "bus")
        limit = max_speed[kind]

        last_t = last_stop = last_idx = None
        prev_id = None
        for i, r in enumerate(rows):
            if r["stop_id"] == prev_id:
                report.add(WARN, "consecutive-duplicate-stop", f"trip {tid}: stop {prev_id} repeated back-to-back")
            prev_id = r["stop_id"]
            try:
                t = parse_time(r["departure_time"])
                parse_time(r["arrival_time"])
            except ValueError as e:
                report.add(ERROR, "unparsable-time", f"trip {tid} seq {r['stop_sequence']}: '{e}'")
                continue
            if t is None:
                continue
            if last_t is not None:
                if t < last_t:
                    report.add(ERROR, "non-monotonic-time",
                               f"trip {tid} (route {trip['route_id']}) at {r['stop_id']}: {t} < previous {last_t}")
                a, b = coords.get(last_stop), coords.get(r["stop_id"])
                if a and b:
                    dist_km = haversine_m(*a, *b) / 1000
                    dt_min = (t - last_t) + ROUNDING_SLACK_MIN
                    speed = dist_km / (dt_min / 60)
                    if speed > limit:
                        report.add(ERROR, "impossible-speed",
                                   f"trip {tid} (route {trip['route_id']}): {last_stop} -> {r['stop_id']} "
                                   f"{dist_km:.1f} km in {t - last_t} min = {speed:.0f} km/h (limit {limit:.0f})",
                                   group=trip["route_id"])
            last_t, last_stop = t, r["stop_id"]


def check_water(stops, coords, report, tile_url, zoom=12, margin_deg=0.0015):
    try:
        import mapbox_vector_tile as mvt
        from shapely.geometry import Point, shape
        from shapely.ops import unary_union
    except ImportError:
        print("--water needs: pip install mapbox-vector-tile shapely", file=sys.stderr)
        sys.exit(2)

    ua = {"User-Agent": "WayFound-gtfs-validator/1.0"}
    fetch = lambda url: urllib.request.urlopen(urllib.request.Request(url, headers=ua), timeout=30).read()
    if not tile_url:
        tile_url = json.loads(fetch("https://tiles.openfreemap.org/planet"))["tiles"][0]

    n = 2 ** zoom

    def tile_of(lat, lon):
        x = int((lon + 180) / 360 * n)
        y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
        return x, y

    def to_lonlat(tx, ty, px, py, extent=4096):
        lon = (tx + px / extent) / n * 360 - 180
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + (1 - py / extent)) / n))))
        return lon, lat

    cache = {}

    def water_of(x, y):
        if (x, y) not in cache:
            url = tile_url.replace("{z}", str(zoom)).replace("{x}", str(x)).replace("{y}", str(y))
            data = fetch(url)
            try:
                data = gzip.decompress(data)
            except OSError:
                pass
            polys = []
            for f in mvt.decode(data).get("water", {}).get("features", []):
                g = f["geometry"]
                rings = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []
                for poly in rings:
                    polys.append(shape({"type": "Polygon",
                                        "coordinates": [[to_lonlat(x, y, px, py) for px, py in ring] for ring in poly]}).buffer(0))
            cache[(x, y)] = unary_union(polys).buffer(-margin_deg) if polys else None
        return cache[(x, y)]

    for sid, (lat, lon) in coords.items():
        try:
            w = water_of(*tile_of(lat, lon))
        except Exception as e:
            report.add(WARN, "water-check-failed", f"{sid}: could not fetch/decode tile ({e})")
            continue
        if w is not None and w.contains(Point(lon, lat)):
            report.add(ERROR, "stop-in-water", f"{sid} ({stops[sid]['stop_name']}): ({lat:.5f}, {lon:.5f})")


def validate(folder: Path, *, bbox=DEFAULT_BBOX, max_speed=None, water=False, tile_url=None,
             name_gap_km=3.0, max_examples=5, today=None) -> Report:
    report = Report(max_examples=max_examples)
    today = today or date.today()
    rows = {name: read_csv(folder / name, cols, report) for name, cols in REQUIRED.items()}
    rows["calendar_dates.txt"] = read_csv(folder / "calendar_dates.txt", OPTIONAL["calendar_dates.txt"], report, optional=True)
    if report.n(ERROR):
        return report

    agencies = check_ids(rows["agency.txt"], "agency_id", "agency", report)
    routes = check_ids(rows["routes.txt"], "route_id", "route", report)
    trips = check_ids(rows["trips.txt"], "trip_id", "trip", report)
    stops = check_ids(rows["stops.txt"], "stop_id", "stop", report)
    services = {r["service_id"]: r for r in rows["calendar.txt"]}
    services.update({r["service_id"]: r for r in rows["calendar_dates.txt"]})

    coords = check_stops(stops, report, bbox, name_gap_km)
    check_references(agencies, routes, trips, services, stops, rows["stop_times.txt"], report)
    check_calendar(rows["calendar.txt"], rows["calendar_dates.txt"], report, today)
    check_trips(rows["stop_times.txt"], trips, routes, coords, report, max_speed or DEFAULT_MAX_SPEED)
    if water:
        check_water(stops, coords, report, tile_url)
    return report


def main(argv=None) -> int:
    default_dir = Path(__file__).resolve().parents[1]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", nargs="?", type=Path, default=default_dir, help="GTFS folder (default: data/gtfs)")
    ap.add_argument("--water", action="store_true", help="flag stops located in water (network + extra deps)")
    ap.add_argument("--tile-url", help="vector tile URL template with {z}/{x}/{y} (default: OpenFreeMap)")
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("LAT_MIN", "LAT_MAX", "LON_MIN", "LON_MAX"),
                    default=DEFAULT_BBOX)
    ap.add_argument("--max-bus-kmh", type=float, default=DEFAULT_MAX_SPEED["bus"])
    ap.add_argument("--max-rail-kmh", type=float, default=DEFAULT_MAX_SPEED["rail"])
    ap.add_argument("--max-examples", type=int, default=5, help="examples shown per check")
    ap.add_argument("--strict", action="store_true", help="treat warnings as failures")
    ap.add_argument("--json", action="store_true", help="print JSON instead of text")
    args = ap.parse_args(argv)

    if not args.folder.is_dir():
        print(f"not a directory: {args.folder}", file=sys.stderr)
        return 2

    report = validate(args.folder, bbox=tuple(args.bbox), water=args.water, tile_url=args.tile_url,
                      max_speed={"bus": args.max_bus_kmh, "rail": args.max_rail_kmh},
                      max_examples=args.max_examples)

    if args.json:
        print(json.dumps({code: {"severity": report.severity[code], "count": n,
                                 "examples": report.examples[code],
                                 "by_route": dict(report.groups[code].most_common(20))}
                          for code, n in sorted(report.counts.items())}, indent=2))
    else:
        order = {ERROR: 0, WARN: 1}
        for code in sorted(report.counts, key=lambda c: (order[report.severity[c]], -report.counts[c])):
            print(f"[{report.severity[code]}] {code}: {report.counts[code]}")
            for ex in report.examples[code]:
                print(f"    {ex}")
            if report.counts[code] > len(report.examples[code]):
                print(f"    ... and {report.counts[code] - len(report.examples[code])} more")
            if report.groups[code]:
                top = ", ".join(f"{g} ({n})" for g, n in report.groups[code].most_common(5))
                print(f"    worst routes: {top} of {len(report.groups[code])} affected")
        print(f"\n{report.n(ERROR)} error(s), {report.n(WARN)} warning(s) in {args.folder}")

    return 1 if report.n(ERROR) or (args.strict and report.n(WARN)) else 0


if __name__ == "__main__":
    sys.exit(main())
