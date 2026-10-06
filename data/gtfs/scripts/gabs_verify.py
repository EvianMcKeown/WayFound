#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import gabs_build as gb  # noqa: E402
import gabs_parse as gp  # noqa: E402
from repair_stops import read  # noqa: E402

CELL = re.compile(r"\d{1,2}:\d{2}[a-z]*")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    args = ap.parse_args(argv)
    failures = 0

    bad, files = 0, sorted(gp.RAW.glob("*.pdf"))
    total_raw = total_parsed = 0
    for f in files:
        raw = 0
        for line in gp.pdf_text(f).splitlines():
            s = line.strip()
            if s.startswith("|") and not s.startswith("|-"):
                raw += sum(1 for c in s.strip("|").split("|")[1:] if CELL.fullmatch(c.strip()))
        tts = gp.parse_pdf(f)
        parsed = sum(1 for t in tts for tr in t.trips for _, m in tr.stops if m is not None) + sum(t.skipped_times for t in tts)
        total_raw += raw
        total_parsed += parsed
        if raw != parsed:
            bad += 1
            if bad <= 5:
                print(f"  A mismatch {f.name}: {raw} time cells in the text, {parsed} accounted for")
    print(f"A  conservation: {len(files)} PDFs, {total_raw} time cells in the text vs {total_parsed} parsed or skipped; "
          f"{bad} PDFs differ")
    failures += bool(bad)

    res = gb.build(gb.ROOT, args.as_of)
    _, trips = read(gb.ROOT / "trips.txt")
    _, st = read(gb.ROOT / "stop_times.txt")
    have = {t["trip_id"] for t in trips if t["trip_id"].startswith("ga_")}
    want = {t["trip_id"] for t in res["trips"]}
    quarantined = set()
    qpath = gb.ROOT / "quarantine" / "trips_defective_reasons.csv"
    if qpath.exists():
        quarantined = {r["trip_id"] for r in csv.DictReader(open(qpath, newline="", encoding="utf-8"))}
    missing = want - have - quarantined
    extra = have - want
    rows_have = Counter(r["trip_id"] for r in st if r["trip_id"].startswith("ga_"))
    rows_want = Counter(r["trip_id"] for r in res["stop_times"] if r["trip_id"] in have)
    ok = not missing and not extra and rows_have == rows_want
    print(f"B  freshness: {len(have)} trips in data/gtfs, {len(want)} rebuilt, {len(want & quarantined)} of those "
          f"quarantined by clean_trips -> {'consistent' if ok else 'DIFFERENT (rerun gabs_build.py --apply)'}")
    failures += not ok

    by = Counter(t["service_id"] for t in trips if t["trip_id"].startswith("ga_"))
    names = {"1111100": "Mon-Fri", "1111000": "Mon-Thu", "0000100": "Fri", "0000010": "Sat", "0000001": "Sun", "0111000": "Tue-Thu"}
    print("C  coverage:", {names.get(k[4:], k[4:]): v for k, v in by.most_common()})
    src = Counter(v["source"] for v in res["ids"].values())
    print("   stop positions by source:", dict(src), "| approximate:", sum(1 for v in res["ids"].values() if v.get("approx")))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
