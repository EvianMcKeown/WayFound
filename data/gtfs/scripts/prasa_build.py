#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
import string
import sys
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import prasa_parse as pp  # noqa: E402
from repair_stops import read, write  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
LINE_NAME = {
    "central": "Central", "northern": "Northern", "southern": "Southern", "cape-flats": "Cape Flats",
    "monte-vista": "Monte Vista", "central-pocket": "Central",
}
LINE_CODE = {"central": "C", "northern": "N", "southern": "S", "cape-flats": "F", "monte-vista": "M", "central-pocket": "P"}
DAY_SERVICE = {"weekday": "mr_wd", "saturday": "mr_sat"}
DAY_CODE = {"weekday": "wd", "saturday": "sat"}
BELLVILLE = "bellville"
MERGE_TOLERANCE_MIN = 5


def sq(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def pretty(name: str) -> str:
    return string.capwords(name.lower()) if name.isupper() else name


def fmt(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}:00"


def is_via(train) -> bool:
    return any(re.search(r"via|monte|vista", n[1], re.I) for n in train.notes)


def merge_monte_vista(chosen, log):
    out = {k: list(v.trains) for k, v in chosen.items()}
    for (line, direction, day), sheet in chosen.items():
        if line != "northern":
            continue
        mv_key = ("monte-vista", direction, day)
        if mv_key not in chosen:
            continue
        mv = {t.number: t for t in out[mv_key]}
        used, merged_trains = set(), []
        for t in out[(line, direction, day)]:
            leg = mv.get(t.number)
            ib = next((i for i, s in enumerate(t.stops) if sq(s[0]) == BELLVILLE), None)
            if not (is_via(t) and leg and ib is not None):
                merged_trains.append(t)
                continue
            if direction == "inbound" and sq(leg.stops[0][0]) == BELLVILLE:
                b = (t.stops[ib][0], t.stops[ib][1], leg.stops[0][2])
                stops = t.stops[:ib] + [b] + leg.stops[1:]
                direct_arrival = t.stops[-1][1]
            elif direction == "outbound" and sq(leg.stops[-1][0]) == BELLVILLE:
                b = (t.stops[ib][0], leg.stops[-1][1], t.stops[ib][2])
                stops = leg.stops[:-1] + [b] + t.stops[ib + 1:]
                direct_arrival = None
            else:
                merged_trains.append(t)
                log["merge_skipped"].append(f"{direction} {day} {t.number}: Monte Vista leg does not touch Bellville")
                continue
            times = [x for s in stops for x in (s[1], s[2])]
            if times != sorted(times):
                merged_trains.append(t)
                log["merge_skipped"].append(f"{direction} {day} {t.number}: merged times not monotonic")
                continue
            if direct_arrival is not None and abs(direct_arrival - stops[-1][1]) > MERGE_TOLERANCE_MIN:
                log["merge_time_mismatch"].append(
                    f"{day} {t.number}: Northern says arrive {pp_time(direct_arrival)}, Monte Vista says "
                    f"{pp_time(stops[-1][1])}; not merged")
                merged_trains.append(t)
                continue
            t2 = type(t)(t.number, stops, t.notes)
            merged_trains.append(t2)
            used.add(t.number)
            log["merged"] += 1
        out[(line, direction, day)] = merged_trains
        out[mv_key] = [t for t in out[mv_key] if t.number not in used]
    return out


def pp_time(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def load_reference(folder: Path):
    def table(name, key="name"):
        path = folder / "reference" / name
        if not path.exists():
            return {}
        with open(path, newline="", encoding="utf-8") as f:
            return {sq(r[key]): r for r in csv.DictReader(f) if r.get("ambiguous", "0") == "0"}
    manual = {}
    mp = folder / "reference" / "manual_stations.csv"
    if mp.exists():
        with open(mp, newline="", encoding="utf-8") as f:
            manual = {sq(r["name"]): r for r in csv.DictReader(f)}
    return table("wc_dtpw_metrorail_stations.csv"), table("osm_rail_stations.csv"), manual


def resolve_stations(labels, existing, gov, osm, manual):
    by_key, out = {}, {}
    for label in sorted(labels):
        k = sq(label)
        if k not in by_key:
            by_key[k] = None
            if k in existing:
                r = existing[k]
                by_key[k] = dict(id=r["stop_id"], name=r["stop_name"], lat=float(r["stop_lat"]),
                                 lon=float(r["stop_lon"]), source="existing")
            else:
                for src, table in (("govt", gov), ("osm", osm), ("manual", manual)):
                    if k in table:
                        r = table[k]
                        by_key[k] = dict(id="mr_" + re.sub(r"[^A-Z0-9]+", "_", label.upper()).strip("_"),
                                         name=pretty(label), lat=float(r["lat"]), lon=float(r["lon"]), source=src)
                        break
        out[label] = by_key[k]
    ids = Counter(v["id"] for v in by_key.values() if v)
    assert all(n == 1 for n in ids.values()), [i for i, n in ids.items() if n > 1]
    return out


def build(folder: Path, as_of: date, max_age_days: int):
    log = defaultdict(list)
    log["merged"] = 0
    sheets = pp.load_sheets()
    chosen, rejected = pp.select(sheets, as_of, max_age_days)
    trains_by_key = merge_monte_vista(chosen, log)

    _, stops_rows = read(folder / "stops.txt")
    existing = {sq(r["stop_name"]): r for r in stops_rows if r["stop_id"].startswith("mr_")}
    labels = {s[0] for ts in trains_by_key.values() for t in ts for s in t.stops}
    gov, osm, manual = load_reference(folder)
    stations = resolve_stations(labels, existing, gov, osm, manual)
    unresolved = sorted(l for l, v in stations.items() if v is None)

    routes, trips, stop_times = {}, [], []
    pattern_ids = defaultdict(dict)
    trip_ids, source_trains, dropped_trains = set(), 0, []
    for (line, direction, day), trains in sorted(trains_by_key.items()):
        for t in trains:
            source_trains += 1
            calls = [(stations[s[0]], s[1], s[2]) for s in t.stops if stations[s[0]]]
            if len(calls) < 2:
                dropped_trains.append(f"{line} {direction} {day} {t.number}")
                continue
            times = [x for c in calls for x in (c[1], c[2])]
            if times != sorted(times):
                dropped_trains.append(f"{line} {direction} {day} {t.number} (times not increasing in source)")
                continue
            ids = tuple(c[0]["id"] for c in calls)
            if len(set(ids)) != len(ids):
                dropped_trains.append(f"{line} {direction} {day} {t.number} (repeats a station)")
                continue
            did = 1 if direction == "inbound" else 0
            pid = pattern_ids[(line, did)].setdefault(ids, len(pattern_ids[(line, did)]) + 1)
            route_id = f"mr_{LINE_CODE[line]}{did}-{pid}"
            first, last = calls[0][0]["name"], calls[-1][0]["name"]
            routes.setdefault(route_id, dict(route_id=route_id, agency_id="metrorail",
                                             route_short_name=f"{LINE_NAME[line]}: {first} - {last}"))
            tid = f"mr_{LINE_CODE[line]}{did}_{DAY_CODE[day]}_{t.number}"
            n = 1
            while tid in trip_ids:
                n += 1
                tid = f"mr_{LINE_CODE[line]}{did}_{DAY_CODE[day]}_{t.number}_{n}"
            trip_ids.add(tid)
            trips.append(dict(route_id=route_id, service_id=DAY_SERVICE[day], trip_id=tid,
                              trip_headsign=last, direction_id=str(did)))
            for seq, (st, arr, dep) in enumerate(calls, 1):
                stop_times.append(dict(trip_id=tid, arrival_time=fmt(arr), departure_time=fmt(dep),
                                       stop_id=st["id"], stop_sequence=str(seq)))
    return dict(chosen=chosen, rejected=rejected, stations=stations, unresolved=unresolved, routes=routes,
                trips=trips, stop_times=stop_times, source_trains=source_trains, dropped=dropped_trains, log=log,
                as_of=as_of)


def apply(folder: Path, res: dict):
    as_of = res["as_of"]
    used_stops = {st["stop_id"] for st in res["stop_times"]}

    def swap(name, new_rows, key="trip_id", prefix_cols=()):
        fields, rows = read(folder / name)
        keep = [r for r in rows if not r[key].startswith("mr_")]
        write(folder / name, fields, keep + [{f: r.get(f, "") for f in fields} for r in new_rows])

    swap("routes.txt", list(res["routes"].values()), key="route_id")
    swap("trips.txt", res["trips"])
    swap("stop_times.txt", res["stop_times"])

    cal = []
    end = (as_of + timedelta(days=183)).strftime("%Y%m%d")
    used_services = {t["service_id"] for t in res["trips"]}
    for sid in sorted(used_services):
        days = ["1", "1", "1", "1", "1", "0", "0"] if sid == "mr_wd" else ["0", "0", "0", "0", "0", "1", "0"]
        cal.append(dict(zip(["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
                            [sid] + days), start_date=as_of.strftime("%Y%m%d"), end_date=end))
    swap("calendar.txt", cal, key="service_id")
    fields, rows = read(folder / "calendar_dates.txt")
    write(folder / "calendar_dates.txt", fields, [r for r in rows if not r["service_id"].startswith("mr_")])

    fields, rows = read(folder / "stops.txt")
    old = {r["stop_id"] for r in rows}
    keep, seen_ids = [], set()
    for r in rows:
        if r["stop_id"] in seen_ids or (r["stop_id"].startswith("mr_") and r["stop_id"] not in used_stops):
            continue
        seen_ids.add(r["stop_id"])
        keep.append(r)
    new, seen = [], set()
    for st in res["stations"].values():
        if st and st["id"] in used_stops and st["id"] not in old and st["id"] not in seen:
            seen.add(st["id"])
            new.append(dict(stop_id=st["id"], stop_name=st["name"], stop_lat=f"{st['lat']:.6f}", stop_lon=f"{st['lon']:.6f}"))
    write(folder / "stops.txt", fields, keep + new)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", nargs="?", type=Path, default=ROOT)
    ap.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    ap.add_argument("--max-age-days", type=int, default=365)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args(argv)

    res = build(args.folder, args.as_of, args.max_age_days)
    src = Counter(v["source"] for v in res["stations"].values() if v)
    print(f"as of {args.as_of}: {len(res['chosen'])} timetable files selected")
    print(f"stations: {len(res['stations'])} labels, placed {dict(src)}, unresolved {res['unresolved']}")
    print(f"merged Northern/Monte Vista through-trains: {res['log']['merged']}")
    for k in ("merge_skipped", "merge_time_mismatch"):
        if res["log"][k]:
            print(f"  {k}: {len(res['log'][k])}", *res["log"][k][:5], sep="\n    ")
    print(f"trains in source (after merge): {res['source_trains']} -> trips built: {len(res['trips'])}, "
          f"dropped: {len(res['dropped'])}")
    for d in res["dropped"][:8]:
        print("    dropped:", d)
    by_day = Counter(t["service_id"] for t in res["trips"])
    print(f"routes: {len(res['routes'])}; stop_times: {len(res['stop_times'])}; trips by service: {dict(by_day)}")
    if args.apply:
        apply(args.folder, res)
        print("written.")
    else:
        print("dry run: nothing written (use --apply)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
