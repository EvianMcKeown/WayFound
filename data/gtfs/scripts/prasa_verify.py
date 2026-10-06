#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).parent))
import prasa_build as pb  # noqa: E402
import prasa_parse as pp  # noqa: E402
from repair_stops import read  # noqa: E402


def raw_times_by_train(path: Path):
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    tr = next(i for i, r in enumerate(rows[:8]) if r[0] and re.search(r"train\s*no", str(r[0]), re.I))
    out = {}
    for j, num in enumerate(rows[tr]):
        if j == 0 or num in (None, ""):
            continue
        times = set()
        for r in rows[tr + 1:]:
            if r[0] and not re.match(r"\s*platform", str(r[0]), re.I) and j < len(r):
                m = pp.cell_minutes(r[j])
                if m is not None:
                    times.add(m % 1440)
        out.setdefault(str(num).strip(), []).append(times)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    args = ap.parse_args(argv)
    failures = 0

    chosen, _ = pp.select(pp.load_sheets(), args.as_of)
    checked = bad = 0
    for key, sheet in sorted(chosen.items()):
        raw = raw_times_by_train(pp.RAW / next(m["file"] for m in pp.load_manifest() if m["file"] == sheet.file))
        for t in sheet.trains:
            checked += 1
            parsed = {x % 1440 for s in t.stops for x in (s[1], s[2])}
            candidates = raw.get(t.number, [])
            if parsed in candidates:
                candidates.remove(parsed)
            else:
                bad += 1
                if bad <= 5:
                    print(f"  A mismatch {key} train {t.number}: no raw column with the same times")
    print(f"A  independent parse: {checked} trains checked, {bad} mismatches")
    failures += bool(bad)

    res = pb.build(pb.ROOT, args.as_of, 365)
    _, trips = read(pb.ROOT / "trips.txt")
    _, st = read(pb.ROOT / "stop_times.txt")
    have_trips = {t["trip_id"] for t in trips if t["trip_id"].startswith("mr_")}
    want_trips = {t["trip_id"] for t in res["trips"]}
    have_rows = {(r["trip_id"], r["stop_sequence"], r["stop_id"], r["arrival_time"], r["departure_time"])
                 for r in st if r["trip_id"].startswith("mr_")}
    want_rows = {(r["trip_id"], r["stop_sequence"], r["stop_id"], r["arrival_time"], r["departure_time"])
                 for r in res["stop_times"]}
    ok = have_trips == want_trips and have_rows == want_rows
    print(f"B  freshness: {len(have_trips)} trips / {len(have_rows)} stop_times in data/gtfs vs "
          f"{len(want_trips)} / {len(want_rows)} rebuilt -> {'identical' if ok else 'DIFFERENT (rerun prasa_build.py --apply)'}")
    failures += not ok

    by = defaultdict(list)
    first_dep = {}
    for r in sorted(st, key=lambda r: (r["trip_id"], int(r["stop_sequence"]))):
        if r["trip_id"].startswith("mr_") and r["trip_id"] not in first_dep:
            first_dep[r["trip_id"]] = r["departure_time"][:5]
    for t in trips:
        if t["trip_id"].startswith("mr_"):
            by[(t["route_id"].split("-")[0][3], t["service_id"], t["direction_id"])].append(first_dep[t["trip_id"]])
    names = {"C": "Central", "N": "Northern", "S": "Southern", "F": "Cape Flats", "M": "Monte Vista", "P": "Central pocket"}
    print("C  coverage (trips, first and last departure):")
    for (code, svc, did), times in sorted(by.items()):
        print(f"   {names[code]:15} {svc:7} {'inbound ' if did == '1' else 'outbound'} {len(times):3} trips  {min(times)} - {max(times)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
