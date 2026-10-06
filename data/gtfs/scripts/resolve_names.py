#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import gabs_build as gb  # noqa: E402
import name_resolver as nr  # noqa: E402
from validate_gtfs import haversine_m  # noqa: E402

ROOT = gb.ROOT
REF = ROOT / "reference"
COLUMNS = ["timing_point", "status", "lat", "lon", "matched_name", "source", "kind", "similarity",
           "neighbours_checked", "neighbours_ok", "approximate", "osm_ref", "note", "timetable_lat", "timetable_lon",
           "timetable_radius_km"]


timetable_legs = gb.timetable_legs


def local_tables(refs: dict) -> dict:
    def conv(table, kind_of):
        return {k: dict(name=v["name"], lat=v["lat"], lon=v["lon"], kind=kind_of(v)) for k, v in table.items()}
    return {"govt": conv(refs["govt"], lambda v: "station"),
            "osm-transit": conv(refs["osm-transit"], lambda v: "stop"),
            "osm-place": conv(refs["osm-places"], lambda v: "suburb" if v["source"] == "osm-place" else "landmark")}


def row(res: nr.Resolution) -> list:
    b, p = res.best, res.prior
    guide = [f"{p.lat:.4f}", f"{p.lon:.4f}", f"{p.radius_km:.1f}"] if p else ["", "", ""]
    if b is None:
        return [res.name, res.status, "", "", "", "", "", "", "", "", "", "", res.note, *guide]
    return [res.name, res.status, f"{b.lat:.6f}", f"{b.lon:.6f}", b.name, b.source, b.kind, f"{b.similarity:.2f}",
            b.neighbours_checked, b.neighbours_ok, int(b.approximate), b.ref, res.note, *guide]


def write_review(path: Path, names, results, calls) -> None:
    if path.exists() and any(r.get("approved", "").strip() == "1" for r in csv.DictReader(open(path, newline="", encoding="utf-8"))):
        path = path.with_name("gabs_review.new.csv")
    rows = []
    for n in sorted((n for n in names if results[n].status != "auto"), key=lambda n: -calls[n]):
        r = results[n]
        cands = list(r.considered or ([r.best] if r.best else []))
        seen = {(round(c.lat, 3), round(c.lon, 3)) for c in cands}
        cands += [c for c in r.in_region[:2] if (round(c.lat, 3), round(c.lon, 3)) not in seen]
        p = r.prior
        guide = [f"{p.lat:.4f}", f"{p.lon:.4f}", f"{p.radius_km:.1f}"] if p else ["", "", ""]
        if not cands:
            rows.append([n, calls[n], r.status, "", "", "", "", "", "", "", "", r.note, *guide, "", ""])
        for c in cands[:5]:
            gk = "" if c.guide_km is None else f"{c.guide_km:.1f}"
            rows.append([n, calls[n], r.status, c.name, c.source, c.kind, f"{c.lat:.6f}", f"{c.lon:.6f}", f"{c.similarity:.2f}",
                         c.neighbours_ok, c.neighbours_checked, r.note, *guide, gk, ""])
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["timing_point", "timed_calls", "status", "candidate", "source", "kind", "lat", "lon", "name_similarity",
                    "neighbours_ok", "neighbours_checked", "why_not_automatic", "timetable_lat", "timetable_lon",
                    "timetable_radius_km", "km_from_guide", "approved"])
        w.writerows(rows)
    print(f"review list: {path} ({len({r[0] for r in rows})} names)")


def load_decisions():
    gold, rejected = {}, defaultdict(list)
    for fname, batch in (("gabs_alias_candidates.csv", "A"), ("gabs_review.csv", "B")):
        path = REF / fname
        if not path.exists():
            continue
        with open(path, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                flag = r["approved"].strip()
                if not r.get("lat"):
                    continue
                if flag == "1":
                    gold[r["timing_point"]] = (float(r["lat"]), float(r["lon"]), r["candidate"], batch)
                elif flag == "0":
                    rejected[r["timing_point"]].append((float(r["lat"]), float(r["lon"]), r["candidate"]))
    return gold, rejected


def benchmark(gold, rejected, results, tolerance_km=1.5) -> None:
    print(f"\nBENCHMARK against {len(gold)} human decisions (tolerance {tolerance_km} km)")
    tally, guide_km = defaultdict(Counter), []
    for n, (lat, lon, label, batch) in gold.items():
        r = results.get(n)
        if r is None or r.best is None:
            outcome, line = "review", f"{r.status if r else 'not unplaced'}: {r.note if r else ''}"
        else:
            km = haversine_m(lat, lon, r.best.lat, r.best.lon) / 1000
            if r.status == "auto":
                outcome = "agree" if km <= tolerance_km else "WRONG"
            else:
                outcome = "review"
            line = f"auto: {r.best.name[:24]:24} {km:5.1f} km  [{r.status}] {r.note[:70]}"
        if r is not None and r.prior:
            guide_km.append(haversine_m(lat, lon, r.prior.lat, r.prior.lon) / 1000)
        tally[batch][outcome] += 1
        print(f"  [{batch}] {n:22} human: {label[:22]:22} {outcome:7} {line}")
    for n, rows in rejected.items():
        r = results.get(n)
        if r and r.status == "auto" and r.best:
            for lat, lon, label in rows:
                if haversine_m(lat, lon, r.best.lat, r.best.lon) / 1000 <= tolerance_km:
                    tally["rejected"]["CHOSE A REJECTED CANDIDATE"] += 1
                    print(f"  REJECTED candidate chosen for {n}: {label}")
    for batch in sorted(tally):
        print(f"  batch {batch}: {dict(tally[batch])}")
    total = Counter()
    for t in tally.values():
        total.update(t)
    if guide_km:
        guide_km.sort()
        print(f"  timetable-only position guide: median error {guide_km[len(guide_km) // 2]:.1f} km, "
              f"{sum(k <= 5 for k in guide_km)}/{len(guide_km)} within 5 km of the human decision")
    print(f"  overall: {total['agree']} agree, {total['review']} left for review, {total['WRONG'] + total['CHOSE A REJECTED CANDIDATE']} confidently wrong")


def audit(as_of) -> None:
    res = gb.build(ROOT, as_of)
    out = REF / "gabs_placement_audit.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["timing_point", "source", "neighbours_implausible", "neighbours"])
        w.writerows([n, src, b, t] for n, src, b, t in res["demoted"])
    placed = sum(1 for v in res["stations"].values() if v)
    print(f"audit: {placed} placed names, {len(res['demoted'])} withdrawn for contradicting the timetable -> {out}")
    for n, src, b, t in res["demoted"]:
        print(f"  {n:26} {src:13} {b}/{t} neighbours implausible")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    ap.add_argument("--benchmark", action="store_true", help="ignore human approvals while resolving, then compare")
    ap.add_argument("--offline", action="store_true", help="cache only, no network")
    ap.add_argument("--audit", action="store_true", help="check every CURRENT placement (human or automatic) against the timetable")
    ap.add_argument("--limit", type=int, help="resolve only the N most-used names")
    args = ap.parse_args(argv)

    if args.audit:
        audit(args.as_of)
        return 0
    gold, rejected = load_decisions()
    res = gb.build(ROOT, args.as_of, use_auto=False, use_manual=not args.benchmark)

    names = [n for n, _, _ in res["unplaced"]][: args.limit]
    placed = {n: (v["lat"], v["lon"]) for n, v in res["stations"].items() if v}
    cache = nr.GeocodeCache(REF / "geocode_cache.jsonl", network=not args.offline)
    results = nr.resolve_all(names, timetable_legs(res["chosen"]), placed, local_tables(res["refs"]), cache)

    out = REF / ("gabs_auto_aliases.benchmark.csv" if args.benchmark else "gabs_auto_aliases.csv")
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(COLUMNS)
        w.writerows(row(results[n]) for n in names)
    if not args.benchmark:
        write_review(REF / "gabs_review.csv", names, results, {n: c for n, c, _ in res["unplaced"]})
    by = Counter(r.status for r in results.values())
    calls = {n: c for n, c, _ in res["unplaced"]}
    share = {s: sum(calls[n] for n, r in results.items() if r.status == s) for s in by}
    total = sum(calls.values())
    print(f"{len(names)} unplaced names -> {dict(by)}; timed calls by status: "
          f"{ {s: f'{c / total:.0%}' for s, c in share.items()} }")
    print(f"written: {out}")

    if args.benchmark:
        benchmark(gold, rejected, results)
    return 0


if __name__ == "__main__":
    sys.exit(main())
