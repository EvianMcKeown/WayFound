#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import http.cookiejar
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT.parent / "raw" / "gabs"
MANIFEST = ROOT / "sources" / "gabs_manifest.csv"
BASE = "https://www.gabs.co.za/"
UA = {"User-Agent": "WayFound/1.0 (Cape Town journey planner; low-rate, cached)"}
DELAY_S = 1.0
PDF_RE = re.compile(r"Pdf/(\w+)/(.+)_from_(\d{8})_to_(\d{8})_(\d{6})\.pdf")


def listings() -> list[dict]:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def fetch(data=None):
        time.sleep(DELAY_S)
        body = urllib.parse.urlencode(data).encode() if data else None
        req = urllib.request.Request(BASE + "Timetable.aspx", data=body, headers=UA)
        return opener.open(req, timeout=60).read().decode("utf8", "ignore")

    page = fetch()
    state = {k: re.search(rf'id="{k}" value="([^"]*)"', page).group(1)
             for k in ("__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION")}
    letters = re.findall(r'id="([A-Z])" onclick="LoadingScreen\(\);__doPostBack', page)
    out = []
    for letter in letters:
        html = fetch({**state, "__EVENTTARGET": letter, "__EVENTARGUMENT": ""})
        for path in sorted(set(re.findall(r"Pdf/\w+/[^'\"]+\.pdf", html))):
            m = PDF_RE.match(path)
            if m:
                out.append(dict(path=path, name=m.group(2), valid_from=m.group(3), valid_to=m.group(4), number=m.group(5)))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list-only", action="store_true", help="enumerate and write the manifest, download nothing")
    ap.add_argument("--limit", type=int, help="download at most N PDFs (for testing)")
    args = ap.parse_args(argv)

    entries = listings()
    by_version = defaultdict(list)
    for e in entries:
        by_version[(e["number"], e["valid_from"])].append(e)
    print(f"{len(entries)} listings -> {len(by_version)} timetable versions "
          f"({len({n for n, _ in by_version})} timetable numbers)")

    RAW.mkdir(parents=True, exist_ok=True)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    rows, done = [], 0
    for (number, valid_from), group in sorted(by_version.items()):
        rep = group[0]
        path = RAW / f"{number}_{valid_from}.pdf"
        sha = ""
        if not args.list_only and not path.exists() and (args.limit is None or done < args.limit):
            time.sleep(DELAY_S)
            path.write_bytes(urllib.request.urlopen(urllib.request.Request(BASE + rep["path"], headers=UA), timeout=90).read())
            done += 1
            if done % 25 == 0:
                print(f"  downloaded {done}", flush=True)
        if path.exists():
            sha = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
        rows.append([number, valid_from, rep["valid_to"], rep["path"], len(group), sha])
    with open(MANIFEST, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["number", "valid_from", "valid_to", "url_path", "listings", "sha256_16"])
        w.writerows(rows)
    print(f"manifest: {MANIFEST} ({len(rows)} versions), downloaded {done} new PDFs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
