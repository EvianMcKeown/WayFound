#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import myciti_build as mb  # noqa: E402
import myciti_fetch as mf  # noqa: E402
import myciti_parse as mp  # noqa: E402
from repair_stops import read  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
PDF_URL = mf.BASE + "/docs/route-timetables/{}-timetable.pdf"
SECTIONS = {
    "MONDAYS TO FRIDAYS": "Monday", "SATURDAYS": "Saturday", "SUNDAYS": "Sunday",
    "SUNDAYS AND PUBLIC HOLIDAYS": "Sunday",
}


def feed(folder: Path):
    _, trips = read(folder / "trips.txt")
    _, cal = read(folder / "calendar.txt")
    _, st = read(folder / "stop_times.txt")
    trips = {t["trip_id"]: t for t in trips if t["trip_id"].startswith("mc_")}
    days = {c["service_id"]: {d for d in mp.DAYS if c[d.lower()] == "1"} for c in cal if c["service_id"].startswith("mc_")}
    calls = defaultdict(list)
    for r in st:
        if r["trip_id"] in trips:
            for t in dict.fromkeys((r["arrival_time"], r["departure_time"])):
                h, m, _ = t.split(":")
                calls[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"], int(h) * 60 + int(m)))
    return trips, days, {k: sorted(v) for k, v in calls.items()}


def conservation(folder: Path, raw: Path, res: dict) -> list[str]:
    trips, days, calls = feed(folder)
    skipped = Counter((str(tid), code) for _, tid, code, _ in res["skipped"])
    quarantined = {}
    reasons = folder / "quarantine" / "trips_defective_reasons.csv"
    if reasons.exists():
        _, rows = read(reasons)
        quarantined = {r["trip_id"]: r["reason"] for r in rows if r["trip_id"].startswith("mc_")}
    problems, seen, in_quarantine = [], 0, Counter()
    for path in sorted((raw / "routes").glob("*.json")):
        page = json.loads(path.read_text(encoding="utf-8"))
        for block in page["timetable"]:
            for t in block.get("trips") or []:
                for c in t.get("stops", []):
                    if not c.get("static_time"):
                        continue
                    seen += 1
                    tid = f"mc_s{c.get('service_id')}_{t['trip_id']}"
                    want = mp.minutes(c["static_time"]) % 1440
                    ok = (tid in trips and page["day"] in days.get(trips[tid]["service_id"], ())
                          and any(s == f"mc_{c['id']}" and m % 1440 == want for _, s, m in calls.get(tid, ())))
                    if not ok and tid in quarantined:
                        in_quarantine[quarantined[tid]] += 1
                    elif not ok and not skipped[(str(t["trip_id"]), c["id"])]:
                        problems.append(f"{path.name} trip {t['trip_id']} {c['id']} {c['static_time']}: not in the feed")
    print(f"conservation: {seen} scheduled calls read; in quarantined trips: {dict(in_quarantine)}; "
          f"skipped by the builder: {sum(skipped.values())}; missing without a reason: {len(problems)}")
    return problems


def rebuild(folder: Path, res: dict) -> list[str]:
    trips, _, calls = feed(folder)
    built = {t["trip_id"]: t for t in res["trips"]}
    built_calls = defaultdict(list)
    for r in res["stop_times"]:
        for t in dict.fromkeys((r["arrival_time"], r["departure_time"])):
            h, m, _ = t.split(":")
            built_calls[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"], int(h) * 60 + int(m)))
    problems = []
    kept = set(trips)
    gone = set(built) - kept
    for tid in kept:
        if tid not in built:
            problems.append(f"{tid}: in the feed but not in a fresh build")
        elif sorted(built_calls[tid]) != calls[tid] or built[tid]["route_id"] != trips[tid]["route_id"]:
            problems.append(f"{tid}: differs from a fresh build")
    print(f"rebuild: {len(kept)} trips in the feed, {len(built)} in a fresh build "
          f"({len(gone)} quarantined by clean_trips.py), {len(problems)} differences")
    return problems


def pdf_check(res: dict, raw: Path, count: int) -> list[str]:
    calls = defaultdict(list)
    for r in res["stop_times"]:
        calls[r["trip_id"]] += [t[:5] for t in dict.fromkeys((r["arrival_time"], r["departure_time"]))]
    by_route_day = defaultdict(Counter)
    for t in res["trips"]:
        route = t["route_id"][3:].split("-")[0]
        for d in res["service_days"][t["service_id"]]:
            by_route_day[(route, d)].update(f"{int(x[:2]) % 24:02d}:{x[3:]}" for x in calls[t["trip_id"]])
    routes = sorted({k[0] for k in by_route_day})
    step = max(1, len(routes) // max(count, 1))
    problems = []
    for route in routes[::step][:count]:
        pdf = raw / "pdf" / f"{route}.pdf"
        if not pdf.exists():
            pdf.parent.mkdir(parents=True, exist_ok=True)
            data, error = None, None
            for name in dict.fromkeys((route, route.lower())):
                try:
                    data = _get_bytes(PDF_URL.format(name))
                    break
                except Exception as e:  # noqa: BLE001 - a missing PDF is reported, not fatal
                    error = e
            if data is None:
                problems.append(f"{route}: PDF not available ({error})")
                continue
            pdf.write_bytes(data)
        text = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True).stdout
        sections = defaultdict(Counter)
        current = None
        for line in text.splitlines():
            head = line.strip().split("  ")[0].strip().upper()
            if head in SECTIONS:
                current = SECTIONS[head]
                continue
            if current:
                sections[current].update(re.findall(r"\b\d{2}:\d{2}\b", line))
        for day, printed in sorted(sections.items()):
            ours = by_route_day[(route, day)]
            extra, missing = printed - ours, ours - printed
            status = "match" if not extra and not missing else f"{sum(extra.values())} printed only, {sum(missing.values())} feed only"
            print(f"  pdf {route} {day}: {sum(printed.values())} times printed, {sum(ours.values())} on the site: {status}")
            if extra or missing:
                problems.append(f"{route} {day}: printed only {sorted(extra)[:4]}, site only {sorted(missing)[:4]}")
    return problems


def _get_bytes(url: str) -> bytes:
    import time
    import urllib.request
    time.sleep(mf.DELAY_S)
    with urllib.request.urlopen(urllib.request.Request(url, headers=mf.UA), timeout=60) as resp:
        return resp.read()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", nargs="?", type=Path, default=ROOT)
    ap.add_argument("--raw", type=Path, default=mp.RAW)
    ap.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    ap.add_argument("--pdf", type=int, default=0, help="also compare N route PDFs (downloaded once, cached)")
    args = ap.parse_args(argv)

    res = mb.build(args.raw, args.as_of)
    problems = conservation(args.folder, args.raw, res) + rebuild(args.folder, res)
    warnings = pdf_check(res, args.raw, args.pdf) if args.pdf else []
    for w in warnings:
        print("  WARN PDF differs from the site:", w)
    for p in problems[:20]:
        print("  FAIL", p)
    print("OK" if not problems else f"{len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
