#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT.parent / "raw" / "gabs"
MANIFEST = ROOT / "sources" / "gabs_manifest.csv"

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
TIME_CELL = re.compile(r"^(\d{1,2}):(\d{2})([a-z]*)$")
HEADER = re.compile(r"^(?P<days>.*?)\s+EFFECTIVE DATE:\s*(?P<eff>\d{4}/\d{2}/\d{2})\s+TIMETABLE NUMBER:\s*(?P<num>\d{4}\s*\d{2})")
DAY_HEADING = re.compile(r"^(MONDAYS?|TUESDAYS?|WEDNESDAYS?|THURSDAYS?|FRIDAYS?|SATURDAYS?|SUNDAYS?|PUBLIC HOLIDAYS?)\b[A-Z ,&-]*$")


@dataclass
class Trip:
    stops: list
    days: frozenset
    letter: str = ""


@dataclass
class Timetable:
    number: str
    title: str
    effective: date
    file: str
    trips: list = field(default_factory=list)
    problems: list = field(default_factory=list)
    no_service: set = field(default_factory=set)
    skipped_times: int = 0


def norm_space(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def days_in(text: str) -> frozenset:
    low = text.lower()
    names = [d for d in WEEKDAYS if re.search(d[:3] + r"\w*", low)]
    idx = sorted(WEEKDAYS.index(d) for d in names)
    m = re.search(r"(mon|tue|wed|thu|fri|sat|sun)\w*\s+to\s+(mon|tue|wed|thu|fri|sat|sun)\w*", low)
    if m:
        a = [d[:3] for d in WEEKDAYS].index(m.group(1))
        b = [d[:3] for d in WEEKDAYS].index(m.group(2))
        return frozenset(range(a, b + 1)) if a <= b else frozenset(idx)
    return frozenset(idx)


PDFTOTEXT = os.environ.get("PDFTOTEXT", "pdftotext")
_checked = False


def pdf_text(path: Path) -> str:
    global _checked
    if not _checked:
        version = subprocess.run([PDFTOTEXT, "-v"], capture_output=True, text=True)
        if "xpdf" in (version.stdout + version.stderr).lower():
            raise SystemExit(f"{PDFTOTEXT} is xpdf's pdftotext; the parser needs poppler's (set PDFTOTEXT to it)")
        _checked = True
    return subprocess.run([PDFTOTEXT, "-layout", str(path), "-"], capture_output=True, text=True, check=True).stdout


def filename_header(file: str):
    m = re.match(r"(\d{4})(\d{2})_(\d{4})(\d{2})(\d{2})", file)
    return (f"{m[1]} {m[2]}", date(int(m[3]), int(m[4]), int(m[5]))) if m else None


def parse_page(text: str, file: str, fallback=None):
    lines = [l.rstrip() for l in text.splitlines()]
    nonblank = [l for l in lines if l.strip()]
    if len(nonblank) < 2:
        return None
    m = None
    for l in nonblank[:4]:
        m = HEADER.match(l.strip())
        if m:
            break
    if m:
        y, mo, d = map(int, m["eff"].split("/"))
        tt = Timetable(norm_space(m["num"]), norm_space(nonblank[0]), date(y, mo, d), file)
        section = days_in(m["days"])
        if "NO SERVICE" in m["days"].upper():
            tt.no_service |= set(section)
            section = frozenset()
    elif fallback:
        tt = Timetable(fallback[0], norm_space(nonblank[0]), fallback[1], file)
        tt.problems.append("header clipped in the PDF: number and date taken from the file name")
        section = frozenset()
    else:
        return None

    legend = {}
    in_legend = False
    block, blocks = [], []

    def flush(day_set):
        if block:
            blocks.append((day_set, list(block)))
            block.clear()

    for l in lines:
        s = l.strip()
        if s.upper().startswith("ABBREVIATIONS"):
            flush(section)
            in_legend = True
            continue
        if in_legend:
            lm = re.match(r"^([a-z])\s+-\s+(.+)$", s)
            if lm:
                legend[lm.group(1)] = days_in(lm.group(2))
            continue
        if s.startswith("|"):
            if s.startswith("|-"):
                flush(section)
            else:
                block.append([c.strip() for c in s.strip("|").split("|")])
            continue
        flush(section)
        if DAY_HEADING.match(s):
            sec = days_in(s)
            if "NO SERVICE" in s.upper():
                tt.no_service |= set(sec)
                section = frozenset()
            else:
                section = sec
    flush(section)

    for day_set, rows in blocks:
        if not day_set:
            tt.skipped_times += sum(1 for r in rows for c in r[1:] if TIME_CELL.match(c))
            continue
        ncols = max(len(r) for r in rows) - 1
        for j in range(1, ncols + 1):
            stops, letters = [], set()
            for r in rows:
                cell = r[j] if j < len(r) else "--"
                label = norm_space(r[0])
                if cell in ("", "--", "-"):
                    continue
                if cell.lower() == "via":
                    stops.append((label, None))
                    continue
                tm = TIME_CELL.match(cell)
                if not tm:
                    tt.problems.append(f"unrecognised cell {cell!r} at {label}")
                    continue
                stops.append((label, int(tm.group(1)) * 60 + int(tm.group(2))))
                letters |= set(tm.group(3))
            timed = [s for s in stops if s[1] is not None]
            if len(timed) < 2:
                if timed:
                    tt.problems.append("column with a single time skipped")
                    tt.skipped_times += len(timed)
                continue
            days = day_set
            for ch in sorted(letters):
                if ch in legend:
                    days = days & legend[ch]
                else:
                    tt.problems.append(f"suffix {ch!r} not in the legend")
            if not days:
                tt.problems.append(f"letters {sorted(letters)} select no day within the section")
                tt.skipped_times += len(timed)
                continue
            prev, roll = None, 0
            fixed = []
            for label, t in stops:
                if t is not None:
                    t += roll
                    if prev is not None and t < prev - 12 * 60:
                        roll += 1440
                        t += 1440
                    prev = t
                fixed.append((label, t))
            tt.trips.append(Trip(fixed, frozenset(days), "".join(sorted(letters))))
    return tt


def has_header(page_text: str) -> bool:
    nonblank = [l.strip() for l in page_text.splitlines() if l.strip()]
    return any(HEADER.match(l) for l in nonblank[:4])


def parse_pdf(path: Path):
    groups = []
    for page in pdf_text(path).split("\f"):
        if has_header(page) or not groups:
            groups.append(page)
        else:
            groups[-1] += "\n" + page
    fallback = filename_header(path.name)
    return [t for t in (parse_page(g, path.name, fallback if i == 0 else None) for i, g in enumerate(groups)) if t]


def select(timetables, as_of: date):
    best, skipped = {}, []
    for t in sorted(timetables, key=lambda t: (t.number, t.effective)):
        if t.effective > as_of:
            skipped.append((t, f"effective {t.effective}, after {as_of}"))
            continue
        old = best.get(t.number)
        if old:
            skipped.append((old, "superseded"))
        best[t.number] = t
    return best, skipped


def load_all(limit=None):
    out, failures = [], []
    files = sorted(RAW.glob("*.pdf"))[:limit]
    for f in files:
        try:
            out += parse_pdf(f)
        except Exception as e:
            failures.append((f.name, str(e)))
    return out, failures, len(files)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    ap.add_argument("--limit", type=int)
    args = ap.parse_args(argv)
    tts, failures, nfiles = load_all(args.limit)
    uniq = {}
    for t in tts:
        uniq.setdefault((t.number, t.effective), []).append(t)
    conflicts = [k for k, v in uniq.items() if len({len(x.trips) for x in v}) > 1]
    flat = [v[0] for v in uniq.values()]
    chosen, skipped = select(flat, args.as_of)
    print(f"{nfiles} PDFs, {len(failures)} unreadable, {len(tts)} timetable pages -> {len(flat)} distinct "
          f"(number, effective date); {len(conflicts)} duplicates disagree")
    print(f"as of {args.as_of}: {len(chosen)} timetables selected; skipped: "
          f"{Counter(why.split(',')[0].split(' ')[0] if why != 'superseded' else why for _, why in skipped)}")
    trips = sum(len(t.trips) for t in chosen.values())
    probs = Counter(p.split(' at ')[0].split(' (')[0][:40] for t in chosen.values() for p in t.problems)
    print(f"trips: {trips}; parse problems: {sum(probs.values())} {dict(probs.most_common(6))}")
    pts = Counter(s[0] for t in chosen.values() for tr in t.trips for s in tr.stops)
    print(f"distinct timing-point names: {len(pts)}")
    for f, e in failures[:5]:
        print("  unreadable:", f, e)
    return 0


if __name__ == "__main__":
    sys.exit(main())
