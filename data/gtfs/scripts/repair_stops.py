#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import difflib
import re
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from validate_gtfs import DEFAULT_BBOX, haversine_m, parse_time  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
COMPASS = {"north", "south", "east", "west", "central", "upper", "lower"}
NEIGHBOUR_MAX_M = 4000
FUZZY_CUTOFF = 0.85

AGENCIES = [
    ("GABS", "Golden Arrow Bus Services", "http://www.gabs.co.za", "Africa/Johannesburg"),
    ("MyCiti", "MyCiTi Bus", "http://www.myciti.org.za", "Africa/Johannesburg"),
    ("metrorail", "Metrorail Western Cape (PRASA)", "http://www.metrorail.co.za", "Africa/Johannesburg"),
]


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def squash(s: str) -> str:
    return norm(s).replace(" ", "")


def read(path: Path):
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return reader.fieldnames, list(reader)


def write(path: Path, fields, rows):
    eol = "\r\n" if path.exists() and b"\r\n" in path.read_bytes()[:4096] else "\n"
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator=eol)
        w.writeheader()
        w.writerows(rows)


def in_box(lat, lon, bbox=DEFAULT_BBOX):
    return bbox[0] <= lat <= bbox[1] and bbox[2] <= lon <= bbox[3]


def fix_swapped(stops):
    n = 0
    for r in stops:
        lat, lon = float(r["stop_lat"]), float(r["stop_lon"])
        if not in_box(lat, lon) and in_box(lon, lat):
            r["stop_lat"], r["stop_lon"] = r["stop_lon"], r["stop_lat"]
            n += 1
    return n


def load_reference(ref_dir: Path):
    pos = {}
    with open(ref_dir / "wc_dtpw_myciti_stops.csv", newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["ambiguous"] == "0":
                pos[norm(r["name"])] = (float(r["lat"]), float(r["lon"]))
    osm = {}
    op = ref_dir / "osm_stops.csv"
    if op.exists():
        with open(op, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["ambiguous"] == "0":
                    osm[norm(r["name"])] = (float(r["lat"]), float(r["lon"]))
    manual = {}
    mp = ref_dir / "manual_stop_positions.csv"
    if mp.exists():
        with open(mp, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                manual[r["stop_id"]] = (float(r["lat"]), float(r["lon"]), r.get("source", ""))
    return pos, osm, manual


def neighbours(stop_times):
    by_trip = defaultdict(list)
    for r in stop_times:
        if r["trip_id"].startswith("mc_"):
            by_trip[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"]))
    nb = defaultdict(set)
    for rows in by_trip.values():
        rows.sort()
        for (_, a), (_, b) in zip(rows, rows[1:]):
            if a != b:
                nb[a].add(b)
                nb[b].add(a)
    return nb


def timetable_legs(stop_times):
    by_trip = defaultdict(list)
    for r in stop_times:
        if r["trip_id"].startswith("mc_"):
            by_trip[r["trip_id"]].append(r)
    for rows in by_trip.values():
        rows.sort(key=lambda r: int(r["stop_sequence"]))
        last = None
        for r in rows:
            try:
                t = parse_time(r["departure_time"])
            except ValueError:
                continue
            if t is None:
                continue
            if last and last[0] != r["stop_id"]:
                yield last[0], r["stop_id"], t - last[1]
            last = (r["stop_id"], t)


def demote_inconsistent(placed, tier, stop_times, max_kmh=100.0):
    legs = Counter()
    for a, b, mins in timetable_legs(stop_times):
        if a in placed and b in placed and tier[a] != 0 and tier[b] != 0:
            km = haversine_m(*placed[a], *placed[b]) / 1000
            if mins < 0 or km / ((mins + 1) / 60) > max_kmh:
                legs[(a, b)] += 1
    demoted = []
    while legs:
        score = Counter()
        for (a, b), n in legs.items():
            score[a] += n
            score[b] += n
        top = score.most_common(1)[0][1]
        worst = [s for s, n in score.items() if n == top]
        for s in worst:
            demoted.append(s)
            del placed[s], tier[s]
        legs = Counter({k: n for k, n in legs.items() if k[0] not in worst and k[1] not in worst})
    return demoted


def reposition_mycity(stops, stop_times, ref_dir):
    pos, osm, manual = load_reference(ref_dir)
    squashed = {}
    for k in pos:
        squashed.setdefault(squash(k), k)

    mc = {r["stop_id"]: r for r in stops if r["stop_id"].startswith("mc_")}
    placed, tier = {}, {}
    for sid, r in mc.items():
        if sid in manual:
            placed[sid], tier[sid] = manual[sid][:2], 0
        elif norm(r["stop_name"]) in pos:
            placed[sid], tier[sid] = pos[norm(r["stop_name"])], 1
        elif squash(r["stop_name"]) in squashed:
            placed[sid], tier[sid] = pos[squashed[squash(r["stop_name"])]], 2
        elif norm(r["stop_name"]) in osm:
            placed[sid], tier[sid] = osm[norm(r["stop_name"])], 3

    nb = neighbours(stop_times)
    fuzzy_log = []
    for sid, r in mc.items():
        if sid in placed:
            continue
        name = norm(r["stop_name"])
        near = [placed[x] for x in nb[sid] if x in placed]
        if not near:
            continue
        best = None
        for cand in difflib.get_close_matches(name, list(pos), n=3, cutoff=FUZZY_CUTOFF):
            if (set(name.split()) ^ set(cand.split())) & COMPASS:
                continue
            dist = statistics.median(haversine_m(*pos[cand], *q) for q in near)
            if dist <= NEIGHBOUR_MAX_M and (best is None or dist < best[1]):
                best = (cand, dist)
        if best:
            placed[sid], tier[sid] = pos[best[0]], 4
            fuzzy_log.append((r["stop_name"], best[0], round(best[1])))

    demoted = demote_inconsistent(placed, tier, stop_times)
    moved = 0
    for sid, (lat, lon) in placed.items():
        r = mc[sid]
        if (f"{float(r['stop_lat']):.6f}", f"{float(r['stop_lon']):.6f}") != (f"{lat:.6f}", f"{lon:.6f}"):
            moved += 1
        r["stop_lat"], r["stop_lon"] = f"{lat:.6f}", f"{lon:.6f}"
    unplaced = [sid for sid in mc if sid not in placed]
    return Counter(tier.values()), moved, fuzzy_log, unplaced, demoted


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", nargs="?", type=Path, default=ROOT)
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    ap.add_argument("--quarantine-unplaced", action="store_true")
    args = ap.parse_args(argv)
    gtfs, ref_dir = args.folder, args.folder / "reference"
    if not (ref_dir / "wc_dtpw_myciti_stops.csv").exists():
        print("reference data missing: run data/gtfs/scripts/fetch_reference_stops.py first", file=sys.stderr)
        return 2

    stop_fields, stops = read(gtfs / "stops.txt")
    st_fields, stop_times = read(gtfs / "stop_times.txt")

    swapped = fix_swapped(stops)
    tiers, moved, fuzzy_log, unplaced, demoted = reposition_mycity(stops, stop_times, ref_dir)
    print(f"un-swapped lat/lon: {swapped} stops")
    print(f"MyCiTi stops repositioned: {moved} changed; tiers {dict(sorted(tiers.items()))}; unplaced {len(unplaced)}")
    for a, b, d in fuzzy_log:
        print(f"    fuzzy: {a!r} -> {b!r} ({d} m from neighbours)")
    if demoted:
        by_id = {r["stop_id"]: r["stop_name"] for r in stops}
        print("    demoted (timetable legs impossible at the matched position):",
              ", ".join(by_id[s] for s in demoted))
    if unplaced:
        names = [next(r["stop_name"] for r in stops if r["stop_id"] == s) for s in unplaced]
        print("    unplaced:", ", ".join(names[:15]) + (" ..." if len(names) > 15 else ""))

    if args.quarantine_unplaced and unplaced:
        gone = set(unplaced)
        q = gtfs / "quarantine"
        if args.apply:
            q.mkdir(exist_ok=True)
            write(q / "stops_mycity_unplaced.txt", stop_fields, [r for r in stops if r["stop_id"] in gone])
            write(q / "stop_times_mycity_unplaced.txt", st_fields, [r for r in stop_times if r["stop_id"] in gone])
        stops = [r for r in stops if r["stop_id"] not in gone]
        removed = len(stop_times)
        stop_times = [r for r in stop_times if r["stop_id"] not in gone]
        print(f"quarantine: {len(gone)} stops, {removed - len(stop_times)} stop_times rows")

    _, routes = read(gtfs / "routes.txt")
    wanted = {r["agency_id"] for r in routes}
    unknown = wanted - {a[0] for a in AGENCIES}
    if unknown:
        print(f"WARNING: routes use agency ids with no canonical entry: {sorted(unknown)}")

    if args.apply:
        write(gtfs / "stops.txt", stop_fields, stops)
        if args.quarantine_unplaced:
            write(gtfs / "stop_times.txt", st_fields, stop_times)
        write(gtfs / "agency.txt", ["agency_id", "agency_name", "agency_url", "agency_timezone"],
              [dict(zip(["agency_id", "agency_name", "agency_url", "agency_timezone"], a)) for a in AGENCIES])
        print("written.")
    else:
        print("dry run: nothing written (use --apply)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
