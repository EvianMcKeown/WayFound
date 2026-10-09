#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import sys
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import myciti_parse as mp  # noqa: E402
from repair_stops import read, write  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
AGENCY = "MyCiti"
VALID_DAYS = 183


def fmt(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}:00"


def merge_waits(calls: list) -> list:
    out = []
    for code, m in calls:
        if out and out[-1][0] == code:
            out[-1] = (code, out[-1][1], m)
        else:
            out.append((code, m, m))
    return out


def build(raw: Path, as_of: date) -> dict:
    stops = mp.load_stops(raw)
    trips, skipped, reordered = mp.load_trips(raw)
    skipped = list(skipped)

    used_trips = []
    for t in trips:
        calls = []
        for code, m in t.calls:
            if code in stops:
                calls.append((code, m))
            else:
                skipped.append((f"{t.route} {t.direction}", t.source_id, code, "stop not on the map"))
        calls = merge_waits(calls)
        if len(calls) < 2:
            for code, *_ in calls:
                skipped.append((f"{t.route} {t.direction}", t.source_id, code, "fewer than two placed stops"))
            continue
        used_trips.append((t, calls))

    patterns = defaultdict(Counter)
    for t, calls in used_trips:
        patterns[(t.route, t.direction)][tuple(c[0] for c in calls)] += 1
    route_of = {}
    routes = {}
    for (route, d), counter in sorted(patterns.items()):
        for n, (pattern, _) in enumerate(counter.most_common(), 1):
            rid = f"mc_{route}-{d}" if n == 1 else f"mc_{route}-{d}_{n}"
            route_of[(route, d, pattern)] = rid
            routes[rid] = dict(route_id=rid, agency_id=AGENCY, route_short_name=f"{route}-{d}")

    out_trips, stop_times = [], []
    for t, calls in sorted(used_trips, key=lambda x: (x[0].route, x[0].direction, x[1][0][1], x[0].source_id)):
        rid = route_of[(t.route, t.direction, tuple(c[0] for c in calls))]
        tid = f"mc_s{t.service}_{t.source_id}"
        out_trips.append(dict(route_id=rid, service_id=f"mc_s{t.service}", trip_id=tid,
                              trip_headsign=t.headsign or stops[calls[-1][0]].name, direction_id=str(t.direction)))
        for seq, (code, arr, dep) in enumerate(calls, 1):
            stop_times.append(dict(trip_id=tid, arrival_time=fmt(arr), departure_time=fmt(dep),
                                   stop_id=f"mc_{code}", stop_sequence=str(seq)))

    service_days = defaultdict(set)
    for t, _ in used_trips:
        service_days[f"mc_s{t.service}"] |= t.days
    used_codes = sorted({c[0] for _, calls in used_trips for c in calls})
    loops = sum(1 for _, calls in used_trips if len({c[0] for c in calls}) < len(calls))
    return dict(loops=loops, reordered=reordered, stops=stops, used_codes=used_codes, routes=routes, trips=out_trips, stop_times=stop_times,
                service_days=service_days, skipped=skipped, as_of=as_of, source_trips=len(trips))


def apply(folder: Path, res: dict):
    def swap(name, new_rows, key):
        fields, rows = read(folder / name)
        keep = [r for r in rows if not r[key].startswith("mc_")]
        write(folder / name, fields, keep + [{f: r.get(f, "") for f in fields} for r in new_rows])

    swap("routes.txt", list(res["routes"].values()), "route_id")
    swap("trips.txt", res["trips"], "trip_id")
    swap("stop_times.txt", res["stop_times"], "trip_id")

    start = res["as_of"].strftime("%Y%m%d")
    end = (res["as_of"] + timedelta(days=VALID_DAYS)).strftime("%Y%m%d")
    cal = []
    for sid, days in sorted(res["service_days"].items()):
        flags = {d.lower(): "1" if d in days else "0" for d in mp.DAYS}
        cal.append(dict(service_id=sid, **flags, start_date=start, end_date=end))
    swap("calendar.txt", cal, "service_id")
    fields, rows = read(folder / "calendar_dates.txt")
    write(folder / "calendar_dates.txt", fields, [r for r in rows if not r["service_id"].startswith("mc_")])

    stops = res["stops"]
    swap("stops.txt", [dict(stop_id=f"mc_{c}", stop_name=stops[c].name, stop_lat=f"{stops[c].lat:.6f}",
                            stop_lon=f"{stops[c].lon:.6f}") for c in res["used_codes"]], "stop_id")

    prov = folder / "sources" / "stop_provenance.csv"
    with open(prov, newline="", encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if not r["stop_id"].startswith("mc_")]
    rows += [dict(stop_id=f"mc_{c}", source="myciti", approximate="0", name=stops[c].name) for c in res["used_codes"]]
    with open(prov, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["stop_id", "source", "approximate", "name"], lineterminator="\n")
        w.writeheader()
        w.writerows(rows)

    q = folder / "quarantine"
    for name in ("stops_mycity_unplaced.txt", "stop_times_mycity_unplaced.txt"):
        (q / name).unlink(missing_ok=True)
    for name, key in (("trips_defective.txt", "trip_id"), ("stop_times_defective.txt", "trip_id"),
                      ("routes_defective.txt", "route_id"), ("trips_defective_reasons.csv", "trip_id")):
        if (q / name).exists():
            fields, rows = read(q / name)
            write(q / name, fields, [r for r in rows if not r[key].startswith("mc_")])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", nargs="?", type=Path, default=ROOT)
    ap.add_argument("--raw", type=Path, default=mp.RAW)
    ap.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args(argv)

    res = build(args.raw, args.as_of)
    print(f"as of {res['as_of']}: {len(res['stops'])} stops on the map, {len(res['used_codes'])} used")
    print(f"source trips: {res['source_trips']} -> built: {len(res['trips'])}; routes (patterns): {len(res['routes'])}")
    print(f"stop_times: {len(res['stop_times'])}")
    for sid, days in sorted(res["service_days"].items()):
        n = sum(1 for t in res["trips"] if t["service_id"] == sid)
        print(f"  {sid}: {n} trips on {', '.join(d[:3] for d in mp.DAYS if d in days)}")
    reasons = Counter(r for *_, r in res["skipped"])
    print(f"calls left out: {len(res['skipped'])} {dict(reasons)}")
    missing = Counter(code for *_, code, r in res["skipped"] if r == "stop not on the map")
    if missing:
        print("  stops not on the map:", dict(missing.most_common(10)))
    print(f"trips calling at a stop twice (loops): {res['loops']}")
    print(f"trips the site lists out of travel order (put in time order): {res['reordered']}")
    if args.apply:
        apply(args.folder, res)
        print("written.")
    else:
        print("dry run: nothing written (use --apply)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
