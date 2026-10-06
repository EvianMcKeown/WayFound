#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import difflib
import re
import statistics
import string
import sys
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import gabs_parse as gp  # noqa: E402
import name_resolver as nr  # noqa: E402
from repair_stops import read, write  # noqa: E402
from validate_gtfs import haversine_m  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
EXPAND = {"STN": "STATION", "HOSP": "HOSPITAL", "VILL": "VILLAGE", "CNTRE": "CENTRE", "CTR": "CENTRE",
          "IND": "INDUSTRIA", "MEDI": "MEDICLINIC", "SAP": "POLICE STATION"}
DROP_TOKENS = {"TERM", "TERMINUS", "STN", "SAP", "IND", "CBD"}
ROADISH = re.compile(r"\b(RD|ROAD|FREEWAY|DRV|DRIVE|AVE|AVENUE|STR|STREET|ROUTE|BLVD|HIGHWAY|LANE|BEND|WAY)\b|^[NMR]\d+\b", re.I)
SOURCE_ORDER = ["manual", "govt", "osm-transit", "osm-landmark", "osm-place"]


def sq(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def variants(name: str) -> list[str]:
    toks = re.sub(r"\([^)]*\)", "", name).upper().split()
    cands = [" ".join(toks), " ".join(EXPAND.get(t, t) for t in toks),
             " ".join(t for t in toks if t not in DROP_TOKENS),
             " ".join(EXPAND.get(t, t) for t in toks if t not in DROP_TOKENS)]
    seen, out = set(), []
    for c in cands:
        k = sq(c)
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out


def pretty(name: str) -> str:
    return string.capwords(name.lower()) if name.isupper() else name


def fmt(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}:00"


def load_reference(folder: Path, use_auto: bool = True, use_manual: bool = True):
    ref = folder / "reference"

    def table(name, key="name", source="", kind_col=None):
        path = ref / name
        out = {}
        if path.exists():
            with open(path, newline="", encoding="utf-8") as f:
                for r in csv.DictReader(f):
                    if r.get("ambiguous", "0") != "0":
                        continue
                    src = source or (("osm-landmark" if r.get(kind_col) == "landmark" else "osm-place") if kind_col else "")
                    out.setdefault(sq(r[key]), dict(id=r.get("station_id"), name=r[key], lat=float(r["lat"]),
                                                    lon=float(r["lon"]), source=src))
        return out

    manual = {}
    for fname, key_col in (("manual_gabs_stops.csv", "name"), ("gabs_alias_candidates.csv", "timing_point"),
                           ("gabs_review.csv", "timing_point"), ("gabs_review.new.csv", "timing_point")):
        mp = ref / fname
        if use_manual and mp.exists():
            with open(mp, newline="", encoding="utf-8") as f:
                for r in csv.DictReader(f):
                    if r.get("approved", "").strip() == "1" and r.get("lat"):
                        manual[sq(r[key_col])] = dict(id=None, name=r.get("candidate") or r[key_col],
                                                      lat=float(r["lat"]), lon=float(r["lon"]), source="manual")
    geocoded = {}
    ap = ref / "gabs_auto_aliases.csv"
    if use_auto and ap.exists():
        with open(ap, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["status"] == "auto":
                    geocoded[sq(r["timing_point"])] = dict(id=None, name=r["matched_name"], lat=float(r["lat"]),
                                                           lon=float(r["lon"]), source="geocoded",
                                                           approx=r["approximate"] == "1")
    return {"manual": manual, "geocoded": geocoded, "govt": table("wc_dtpw_gabs_stations.csv", source="govt"),
            "osm-transit": table("osm_named_transit.csv", source="osm-transit"),
            "osm-places": table("osm_places.csv", kind_col="kind")}


def lookup(name: str, refs: dict):
    vs = variants(name)
    for tier, table in (("manual", refs["manual"]), ("govt", refs["govt"]), ("osm-transit", refs["osm-transit"]),
                        ("osm-places", refs["osm-places"]), ("geocoded", refs["geocoded"])):
        for v in vs:
            if v in table:
                return table[v], tier
    return None, None


def collect(as_of: date):
    tts, failures, _ = gp.load_all()
    uniq = {}
    for t in tts:
        uniq.setdefault((t.number, t.effective), t)
    chosen, _ = gp.select(list(uniq.values()), as_of)
    return chosen, failures


def interpolate(stops, coords):
    timed = [i for i, s in enumerate(stops) if s[1] is not None]
    out = []
    for a, b in zip(timed, timed[1:]):
        seg = stops[a:b + 1]
        pos = [coords[s[0]] for s in seg]
        cum = [0.0]
        for p, q in zip(pos, pos[1:]):
            cum.append(cum[-1] + haversine_m(*p, *q))
        total = cum[-1]
        for k, (sid, t) in enumerate(seg[:-1]):
            if t is None:
                frac = cum[k] / total if total else 0.0
                t = round(seg[0][1] + (seg[-1][1] - seg[0][1]) * frac)
            out.append((sid, t))
    out.append((stops[timed[-1]][0], stops[timed[-1]][1]))
    return out


def timetable_legs(chosen) -> dict:
    legs = defaultdict(list)
    for t in chosen.values():
        for tr in t.trips:
            timed = [(i, l, m) for i, (l, m) in enumerate(tr.stops) if m is not None]
            timed.sort(key=lambda x: (x[2], x[0]))
            for (_, a, ta), (_, b, tb) in zip(timed, timed[1:]):
                if a != b:
                    legs[a].append((b, tb - ta))
                    legs[b].append((a, tb - ta))
    return legs


def inconsistent_placements(stations: dict, legs: dict, min_bad: int = 2, min_fraction: float = 0.3) -> list:
    pos = {n: (v["lat"], v["lon"]) for n, v in stations.items() if v}
    out = []
    for n, v in stations.items():
        if not v or v["source"] == "manual":
            continue
        gaps = nr.neighbour_gaps(legs.get(n, []), {m: p for m, p in pos.items() if m != n})
        bad = sum(1 for m, g in gaps.items()
                  if haversine_m(*pos[n], *pos[m]) / 1000 / ((g + 1) / 60) > nr.MAX_KMH)
        if bad >= min_bad and bad / len(gaps) >= min_fraction:
            out.append((n, bad, len(gaps)))
    return out


def build(folder: Path, as_of: date, use_auto: bool = True, use_manual: bool = True):
    chosen, failures = collect(as_of)
    refs = load_reference(folder, use_auto, use_manual)
    _, stop_rows = read(folder / "stops.txt")
    old_govt_ids = {sq(r["stop_name"]): r["stop_id"] for r in stop_rows if r["stop_id"].startswith("GABS")}

    timed, via = Counter(), Counter()
    for t in chosen.values():
        for tr in t.trips:
            for label, minute in tr.stops:
                (timed if minute is not None else via)[label] += 1

    stations, unplaced = {}, []
    taken = set()
    for name in sorted(set(timed) | set(via)):
        pos, tier = lookup(name, refs)
        if pos is None:
            stations[name] = None
            if name in timed:
                unplaced.append((name, timed[name], via.get(name, 0)))
            continue
        k = sq(pos["name"])
        if tier == "govt":
            sid = pos["id"]
        else:
            sid = "ga_" + re.sub(r"[^A-Z0-9]+", "_", pos["name"].upper()).strip("_")
        source = {"osm-places": pos["source"]}.get(tier, pos["source"]) if tier == "osm-places" else tier
        stations[name] = dict(id=sid, name=pretty(pos["name"]) if tier != "govt" else pos["name"], lat=pos["lat"],
                              lon=pos["lon"], source=source, approx=bool(pos.get("approx")) or tier == "osm-places" and source == "osm-place")
    legs = timetable_legs(chosen)
    demoted = []
    for _ in range(5):
        bad = inconsistent_placements(stations, legs)
        if not bad:
            break
        for n, nbad, ntot in bad:
            demoted.append((n, stations[n]["source"], nbad, ntot))
            stations[n] = None
            if n in timed:
                unplaced.append((n, timed[n], via.get(n, 0)))
    ids = {}
    for v in stations.values():
        if v:
            ids.setdefault(v["id"], v)
    coords = {i: (v["lat"], v["lon"]) for i, v in ids.items()}

    routes, trips, stop_times, patterns = {}, [], [], {}
    trip_count = Counter()
    dropped, notes = Counter(), Counter()
    for t in sorted(chosen.values(), key=lambda t: t.number):
        for tr in t.trips:
            raw_stops = tr.stops
            raw_times = [m for _, m in raw_stops if m is not None]
            if raw_times != sorted(raw_times):
                order = sorted((x for x in enumerate(raw_stops) if x[1][1] is not None), key=lambda x: (x[1][1], x[0]))
                raw_stops = [x[1] for x in order]
                notes["reordered by time (kept)"] += 1
            calls = []
            for label, minute in raw_stops:
                st = stations.get(label)
                if st is None:
                    continue
                calls.append((st["id"], minute))
            merged = []
            for sid, m in calls:
                if merged and merged[-1][0] == sid:
                    if merged[-1][1] is None:
                        merged[-1] = (sid, m)
                    continue
                merged.append((sid, m))
            if len([c for c in merged if c[1] is not None]) < 2:
                dropped["fewer than two timed stops placed"] += 1
                continue
            if len({c[0] for c in merged}) != len(merged):
                dropped["a stop repeats within the trip"] += 1
                continue
            full = interpolate(merged, coords)
            times = [x[1] for x in full]
            if times != sorted(times):
                dropped["times not increasing"] += 1
                continue
            seq = tuple(x[0] for x in full)
            idx = patterns.setdefault(seq, len(patterns) + 1)
            route_id = f"ga_R{idx}"
            first, last = ids[seq[0]]["name"], ids[seq[-1]]["name"]
            routes.setdefault(route_id, dict(route_id=route_id, agency_id="GABS", route_short_name=f"{first} - {last}"))
            day_code = "".join("1" if d in tr.days else "0" for d in range(7))
            n = trip_count[t.number] = trip_count[t.number] + 1
            tid = f"ga_{t.number.replace(' ', '')}_{n}"
            trips.append(dict(route_id=route_id, service_id=f"ga_d{day_code}", trip_id=tid, trip_headsign=last, direction_id="0"))
            for k, (sid, m) in enumerate(full, 1):
                stop_times.append(dict(trip_id=tid, arrival_time=fmt(m), departure_time=fmt(m), stop_id=sid, stop_sequence=str(k)))
    return dict(chosen=chosen, failures=failures, stations=stations, ids=ids, unplaced=sorted(unplaced, key=lambda x: -x[1]),
                routes=routes, trips=trips, stop_times=stop_times, dropped=dropped, notes=notes, timed=timed, via=via, as_of=as_of,
                old_govt_ids=old_govt_ids, refs=refs, demoted=demoted)


def propose(folder: Path, res: dict, limit: int = 45):
    refs = res["refs"]
    pool = []
    for tier, table in (("govt", refs["govt"]), ("osm-transit", refs["osm-transit"]), ("osm-places", refs["osm-places"])):
        for k, v in table.items():
            pool.append((k, v, tier))
    nb = defaultdict(list)
    for t in res["chosen"].values():
        for tr in t.trips:
            ls = [(l, m) for l, m in tr.stops if m is not None]
            for (a, _), (b, _) in zip(ls, ls[1:]):
                nb[a].append(b)
                nb[b].append(a)
    out = []
    for name, calls, via in res["unplaced"][:limit]:
        near = [res["stations"][n] for n in nb[name] if res["stations"].get(n)]
        near_pts = [(n["lat"], n["lon"]) for n in near]
        q = sq(name)
        scored = []
        for k, v, tier in pool:
            r = difflib.SequenceMatcher(None, q, k).ratio()
            if q in k or k in q:
                r = max(r, 0.8)
            if r >= 0.6:
                scored.append((r, v, tier))
        scored.sort(key=lambda x: -x[0])
        for r, v, tier in scored[:3]:
            dist = (statistics.median(haversine_m(v["lat"], v["lon"], *p) for p in near_pts) / 1000) if near_pts else ""
            out.append([name, calls, v["name"], tier, f"{v['lat']:.6f}", f"{v['lon']:.6f}", f"{r:.2f}",
                        f"{dist:.1f}" if dist != "" else "", len(near_pts), ""])
        if not scored:
            out.append([name, calls, "", "", "", "", "", "", len(near_pts), ""])
    path = folder / "reference" / "gabs_alias_candidates.csv"
    if path.exists() and any(r.get("approved", "").strip() == "1" for r in csv.DictReader(open(path, newline="", encoding="utf-8"))):
        path = path.with_name("gabs_alias_candidates.new.csv")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["timing_point", "timed_calls", "candidate", "source", "lat", "lon", "name_similarity",
                    "median_km_to_neighbouring_stops", "neighbours_used", "approved"])
        w.writerows(out)
    return path


def apply(folder: Path, res: dict):
    as_of = res["as_of"]
    used = {r["stop_id"] for r in res["stop_times"]}

    def swap(name, new_rows, key, prefixes):
        fields, rows = read(folder / name)
        keep = [r for r in rows if not r[key].startswith(prefixes)]
        write(folder / name, fields, keep + [{f: r.get(f, "") for f in fields} for r in new_rows])

    swap("routes.txt", list(res["routes"].values()), "route_id", ("ga_",))
    swap("trips.txt", res["trips"], "trip_id", ("ga_",))
    swap("stop_times.txt", res["stop_times"], "trip_id", ("ga_",))
    end = (as_of + timedelta(days=183)).strftime("%Y%m%d")
    cal = []
    for sid in sorted({t["service_id"] for t in res["trips"]}):
        bits = sid[4:]
        cal.append(dict(zip(["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
                            [sid] + list(bits)), start_date=as_of.strftime("%Y%m%d"), end_date=end))
    swap("calendar.txt", cal, "service_id", ("ga_",))
    fields, rows = read(folder / "calendar_dates.txt")
    write(folder / "calendar_dates.txt", fields, [r for r in rows if not r["service_id"].startswith("ga_")])

    fields, rows = read(folder / "stops.txt")
    keep, seen = [], set()
    for r in rows:
        gabs = r["stop_id"].startswith(("GABS", "ga_"))
        if r["stop_id"] in seen or (gabs and r["stop_id"] not in used):
            continue
        seen.add(r["stop_id"])
        keep.append(r)
    new = [dict(stop_id=i, stop_name=v["name"], stop_lat=f"{v['lat']:.6f}", stop_lon=f"{v['lon']:.6f}")
           for i, v in sorted(res["ids"].items()) if i in used and i not in seen]
    write(folder / "stops.txt", fields, keep + new)

    prov_path = folder / "sources" / "stop_provenance.csv"
    prev = []
    if prov_path.exists():
        with open(prov_path, newline="", encoding="utf-8") as f:
            prev = [r for r in csv.DictReader(f) if not r["stop_id"].startswith(("GABS", "ga_"))]
    rows = prev + [dict(stop_id=i, source=v["source"], approximate="1" if v.get("approx") else "0", name=v["name"])
                   for i, v in sorted(res["ids"].items()) if i in used]
    with open(prov_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["stop_id", "source", "approximate", "name"])
        w.writeheader()
        w.writerows(rows)

    q = folder / "quarantine"
    q.mkdir(exist_ok=True)
    with open(q / "gabs_unplaced_names.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["timing_point", "timed_calls", "via_calls"])
        w.writerows(res["unplaced"])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", nargs="?", type=Path, default=ROOT)
    ap.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--propose", action="store_true", help="write reference/gabs_alias_candidates.csv")
    args = ap.parse_args(argv)

    res = build(args.folder, args.as_of)
    src = Counter(v["source"] for v in res["ids"].values())
    total_timed = sum(res["timed"].values())
    placed_calls = sum(c for n, c in res["timed"].items() if res["stations"].get(n))
    print(f"as of {args.as_of}: {len(res['chosen'])} timetables, {sum(len(t.trips) for t in res['chosen'].values())} source trips")
    print(f"stops placed: {len(res['ids'])} {dict(src)}; timed calls placed {placed_calls}/{total_timed} "
          f"({placed_calls / total_timed:.0%}); unplaced timed names: {len(res['unplaced'])}")
    print("  most-used unplaced:", ", ".join(f"{n}({c})" for n, c, _ in res["unplaced"][:12]))
    print(f"trips built: {len(res['trips'])}; routes: {len(res['routes'])}; stop_times: {len(res['stop_times'])}; "
          f"dropped trips: {dict(res['dropped'])}; {dict(res['notes'])}")
    print(f"services: {dict(Counter(t['service_id'] for t in res['trips']).most_common(6))}")
    if res["demoted"]:
        print("withdrawn (position contradicts the timetable): "
              + ", ".join(f"{n} [{src}, {b}/{t} neighbours implausible]" for n, src, b, t in res["demoted"]))
    if args.propose:
        print("candidates written:", propose(args.folder, res))
    if args.apply:
        apply(args.folder, res)
        print("written.")
    else:
        print("dry run: nothing written (use --apply)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
