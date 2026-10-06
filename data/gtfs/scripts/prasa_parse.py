#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT.parent / "raw" / "prasa"
MANIFEST = ROOT / "sources" / "prasa_manifest.csv"

LINES = [
    (r"monte[-_ ]?vista|montevista", "monte-vista"),
    (r"pocket", "central-pocket"),
    (r"cape[-_ ]?flats|capeflats", "cape-flats"),
    (r"central", "central"),
    (r"northern", "northern"),
    (r"southern|southren|simon", "southern"),
]
TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$")
NO_CALL = {"", "..", "--", "-", "."}


@dataclass
class Train:
    number: str
    stops: list = field(default_factory=list)
    notes: list = field(default_factory=list)


@dataclass
class Sheet:
    file: str
    line: str | None
    direction: str | None
    day_group: str | None
    holiday: bool
    trains: list
    uploaded: date | None = None
    problems: list = field(default_factory=list)


def norm_space(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def split_ad(label: str):
    m = re.match(r"^(.*?)(?:\s+\(?([AD])\)?|\(([AD])\))$", norm_space(label))
    return (m.group(1), m.group(2) or m.group(3)) if m else (norm_space(label), None)


def cell_minutes(v):
    if isinstance(v, (time, datetime)):
        return v.hour * 60 + v.minute
    if isinstance(v, str):
        m = TIME_RE.match(v.strip())
        if m:
            return int(m.group(1)) * 60 + int(m.group(2))
    return None


def classify(text: str):
    low = text.lower()
    lines = {name for rx, name in LINES if re.search(rx, low)}
    if "central-pocket" in lines:
        lines -= {"central"}
    if "monte-vista" in lines:
        lines -= {"central", "northern"}
    directions = set()
    if "inbound" in low or re.search(r"\bup\b|-up\b", low):
        directions.add("inbound")
    if "outbound" in low or re.search(r"\bdown\b|-down\b", low):
        directions.add("outbound")
    days = set()
    if "saturday" in low:
        days.add("saturday")
    if "sunday" in low:
        days.add("sunday")
    if re.search(r"weekday|monday to friday|mon[- ]fri|monday-friday", low):
        days.add("weekday")
    return lines, directions, days, bool(re.search(r"public holiday|pph", low))


def parse_workbook(path: Path) -> Sheet:
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    title = " ".join(str(c) for r in rows[:3] for c in r[:3] if c)
    sheet_cls, name_cls = classify(title), classify(path.name)
    fields, problems = [], []
    for label, a, b in zip(("line", "direction", "day"), sheet_cls[:3], name_cls[:3]):
        if len(a) > 1 or (a and b and a != b) or (not a and len(b) > 1):
            problems.append(f"conflicting {label}: sheet {sorted(a)} vs filename {sorted(b)}")
            fields.append(None)
        else:
            fields.append(next(iter(a or b), None))
    line, direction, day = fields
    sheet = Sheet(path.name, line, direction, day, sheet_cls[3] or name_cls[3], [])
    sheet.problems += problems

    tr = next((i for i, r in enumerate(rows[:8]) if r[0] and re.search(r"train\s*no", str(r[0]), re.I)), None)
    if tr is None:
        sheet.problems.append("no TRAIN NO row")
        return sheet

    cols = [j for j, v in enumerate(rows[tr]) if j > 0 and v not in (None, "")]
    trains = {j: Train(str(rows[tr][j]).strip()) for j in cols}
    for r in rows[tr + 1:]:
        label = r[0]
        if label is None or not str(label).strip() or re.match(r"\s*platform", str(label), re.I):
            continue
        base, ad = split_ad(str(label))
        for j in cols:
            v = r[j] if j < len(r) else None
            t = cell_minutes(v)
            tn = trains[j]
            if t is None:
                if isinstance(v, str) and v.strip().lower() not in NO_CALL:
                    tn.notes.append((base, v.strip()))
                continue
            existing = next((k for k, s in enumerate(tn.stops) if s[0] == base), None)
            if existing is None:
                tn.stops.append([base, t, t])
            else:
                s = tn.stops[existing]
                if ad == "A":
                    s[1] = t
                else:
                    s[2] = t
                    if ad is None:
                        s[1] = min(s[1], t)
    for tn in trains.values():
        prev = None
        rolled = 0
        for s in tn.stops:
            for k in (1, 2):
                s[k] += rolled
                if prev is not None and s[k] < prev - 12 * 60:
                    rolled += 1440
                    s[k] += 1440
                prev = s[k]
        tn.stops = [tuple(s) for s in tn.stops]
        if len(tn.stops) < 2:
            sheet.problems.append(f"train {tn.number}: fewer than two calls")
    sheet.trains = [t for t in trains.values() if len(t.stops) >= 2]
    return sheet


def load_manifest():
    with open(MANIFEST, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def select(sheets: list[Sheet], as_of: date, max_age_days: int = 365):
    best, rejected = {}, []
    for s in sheets:
        if s.holiday:
            rejected.append((s, "public holiday service"))
        elif any(p.startswith("conflicting") for p in s.problems):
            rejected.append((s, "contradictory labels: " + "; ".join(p for p in s.problems if p.startswith("conflicting"))[:80]))
        elif None in (s.line, s.direction, s.day_group):
            rejected.append((s, f"unclassified (line={s.line}, dir={s.direction}, day={s.day_group})"))
        elif s.uploaded is None or s.uploaded > as_of:
            rejected.append((s, "dated after the as-of date"))
        elif (as_of - s.uploaded).days > max_age_days:
            rejected.append((s, f"older than {max_age_days} days"))
        elif not s.trains:
            rejected.append((s, "no usable trains"))
        else:
            key = (s.line, s.direction, s.day_group)
            cur = best.get(key)
            if cur is None or (s.uploaded, len(s.trains)) > (cur.uploaded, len(cur.trains)):
                if cur:
                    rejected.append((cur, "superseded"))
                best[key] = s
            else:
                rejected.append((s, "superseded"))
    return best, rejected


def load_sheets() -> list[Sheet]:
    out = []
    for m in load_manifest():
        sh = parse_workbook(RAW / m["file"])
        sh.uploaded = date.fromisoformat(m["uploaded"])
        out.append(sh)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    ap.add_argument("--max-age-days", type=int, default=365)
    args = ap.parse_args(argv)
    sheets = load_sheets()
    chosen, rejected = select(sheets, args.as_of, args.max_age_days)
    print(f"{len(sheets)} files parsed; as of {args.as_of}, max age {args.max_age_days} d")
    print("\nSELECTED")
    for (line, d, day), s in sorted(chosen.items()):
        print(f"  {line:15} {d:9} {day:9} {s.uploaded} {len(s.trains):3} trains  {s.file}")
    print("\nREJECTED")
    for s, why in sorted(rejected, key=lambda x: (x[1], x[0].file)):
        print(f"  {why:42} {s.uploaded} {s.file}")
    probs = [(s.file, p) for s in sheets for p in s.problems]
    print(f"\n{len(probs)} parse problems")
    for f, p in probs[:20]:
        print("  ", f, p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
