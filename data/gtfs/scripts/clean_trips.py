#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from repair_stops import read, write  # noqa: E402
from validate_gtfs import DEFAULT_MAX_SPEED, READER_AGENCIES, ROUNDING_SLACK_MIN, haversine_m, parse_time  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def classify(trip, rows, routes, coords):
    if not rows:
        return "no_stop_times"
    try:
        rows.sort(key=lambda r: int(r["stop_sequence"]))
    except ValueError:
        return "bad_time"
    seqs = [int(r["stop_sequence"]) for r in rows]
    if len(set(seqs)) != len(seqs):
        return "duplicate_sequence"
    timed = []
    for r in rows:
        try:
            t = parse_time(r["departure_time"])
        except ValueError:
            return "bad_time"
        if t is not None:
            timed.append((r["stop_id"], t))
    if len(timed) < 2:
        return "few_timed_stops"
    kind = READER_AGENCIES.get(routes[trip["route_id"]]["agency_id"], "bus")
    limit = DEFAULT_MAX_SPEED[kind]
    for (a, ta), (b, tb) in zip(timed, timed[1:]):
        if tb < ta:
            return "bad_time"
        if a in coords and b in coords:
            km = haversine_m(*coords[a], *coords[b]) / 1000
            if km / ((tb - ta + ROUNDING_SLACK_MIN) / 60) > limit:
                return "impossible_speed"
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", nargs="?", type=Path, default=ROOT)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args(argv)
    g = args.folder

    trip_f, trips = read(g / "trips.txt")
    st_f, stop_times = read(g / "stop_times.txt")
    route_f, routes = read(g / "routes.txt")
    _, stops = read(g / "stops.txt")
    route_by_id = {r["route_id"]: r for r in routes}
    coords = {r["stop_id"]: (float(r["stop_lat"]), float(r["stop_lon"])) for r in stops}

    by_trip = defaultdict(list)
    for r in stop_times:
        by_trip[r["trip_id"]].append(r)

    reasons = {}
    for t in trips:
        why = classify(t, by_trip.get(t["trip_id"]), route_by_id, coords)
        if why:
            reasons[t["trip_id"]] = why
    known = {t["trip_id"] for t in trips}
    for tid in by_trip:
        if tid not in known:
            reasons[tid] = "not_in_trips"

    keep_trips = [t for t in trips if t["trip_id"] not in reasons]
    live_routes = {t["route_id"] for t in keep_trips}
    keep_routes = [r for r in routes if r["route_id"] in live_routes]
    dead_routes = [r for r in routes if r["route_id"] not in live_routes]

    by_prefix = defaultdict(Counter)
    for tid, why in reasons.items():
        by_prefix[tid.split("_")[0]][why] += 1
    print(f"trips: {len(trips)} -> {len(keep_trips)} kept, {len(reasons)} quarantined")
    for p, c in sorted(by_prefix.items()):
        print(f"  {p}: {dict(c)}")
    print(f"routes: {len(routes)} -> {len(keep_routes)} kept, {len(dead_routes)} left without trips")

    if args.apply:
        q = g / "quarantine"
        q.mkdir(exist_ok=True)

        def merged(name, fields, rows, key):
            path = q / name
            old = read(path)[1] if path.exists() else []
            have = {r[key] for r in rows}
            write(path, fields, [r for r in old if r[key] not in have] + rows)

        merged("trips_defective.txt", trip_f, [t for t in trips if t["trip_id"] in reasons], "trip_id")
        write_rows = [r for r in stop_times if r["trip_id"] in reasons]
        path = q / "stop_times_defective.txt"
        old_rows = read(path)[1] if path.exists() else []
        replaced = {r["trip_id"] for r in write_rows}
        write(path, st_f, [r for r in old_rows if r["trip_id"] not in replaced] + write_rows)
        merged("routes_defective.txt", route_f, dead_routes, "route_id")
        rpath = q / "trips_defective_reasons.csv"
        prior = dict(csv.reader(open(rpath, newline="", encoding="utf-8")) ) if rpath.exists() else {}
        prior.pop("trip_id", None)
        prior.update(reasons)
        with open(rpath, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["trip_id", "reason"])
            w.writerows(sorted(prior.items()))
        write(g / "trips.txt", trip_f, keep_trips)
        write(g / "stop_times.txt", st_f, [r for r in stop_times if r["trip_id"] not in reasons])
        write(g / "routes.txt", route_f, keep_routes)
        print("written.")
    else:
        print("dry run: nothing written (use --apply)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
