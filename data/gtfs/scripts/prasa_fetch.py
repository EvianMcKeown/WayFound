#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT.parent / "raw" / "prasa"
MANIFEST = ROOT / "sources" / "prasa_manifest.csv"
API = "https://www.prasa.com/admin/wp-json/wp/v2/media"
UA = {"User-Agent": "PathPilot-capstone/1.0 (student journey planner; low-rate, cached)"}
DELAY_S = 1.0

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
LINE_WORDS = re.compile(r"central|northern|southern|southren|cape[-_ ]?flats|capeflats|monte[-_ ]?vista|montevista|simons", re.I)
EXCLUDE = re.compile(
    r"rugby|marathon|springbok|all-?blacks|summer|festival|concert|easter|christmas|pph|public[-_ ]?holiday|"
    r"durban|winkel|johannesburg|germiston|pretoria|randfontein|naledi|kwesine|midway|hercules|saulsville|"
    r"koedoespoort|eastern|gauteng|kzn|mashu|bridge|berea",
    re.I,
)


def get(url: str) -> bytes:
    time.sleep(DELAY_S)
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90).read()


def list_media() -> list[dict]:
    items, page = [], 1
    while True:
        url = f"{API}?mime_type={XLSX_MIME}&per_page=100&page={page}&orderby=date&order=desc"
        try:
            batch = json.loads(get(url))
        except urllib.error.HTTPError as e:
            if e.code == 400:
                break
            raise
        if not batch:
            break
        items += batch
        page += 1
    return items


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="list what would be fetched, download nothing")
    args = ap.parse_args(argv)

    media = list_media()
    chosen = []
    for m in media:
        name = m["source_url"].rsplit("/", 1)[-1]
        if LINE_WORDS.search(name) and not EXCLUDE.search(name):
            chosen.append((m["id"], m["date"][:10], name, m["source_url"]))
    print(f"{len(media)} spreadsheets listed, {len(chosen)} regular Western Cape candidates")
    if args.dry_run:
        for c in chosen:
            print("  ", c[1], c[2])
        return 0

    RAW.mkdir(parents=True, exist_ok=True)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for media_id, date, name, url in sorted(chosen, key=lambda c: (c[1], c[2])):
        path = RAW / f"{media_id}_{name}"
        if not path.exists():
            path.write_bytes(get(url))
            print("downloaded", path.name)
        rows.append([media_id, date, path.name, url, hashlib.sha256(path.read_bytes()).hexdigest()[:16], path.stat().st_size])
    with open(MANIFEST, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["media_id", "uploaded", "file", "url", "sha256_16", "bytes"])
        w.writerows(rows)
    print(f"manifest: {MANIFEST} ({len(rows)} files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
