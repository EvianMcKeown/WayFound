#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT.parent / "raw" / "myciti"
MANIFEST = ROOT / "sources" / "myciti_manifest.csv"
BASE = "https://www.myciti.org.za"
MAP_URL = BASE + "/en/routes-stops/route-stop-station-map/"
ROUTE_URL = BASE + "/en/timetables/route-timetables/?"
UA = {"User-Agent": "WayFound/1.0 (Cape Town journey planner; low-rate, cached)"}
DELAY_S = 1.0
DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
LIVE_FIELDS = ("time", "time_colour", "delay", "delay_colour")


def js_var(page: str, name: str):
    m = re.search(r"\bvar " + re.escape(name) + r"\s*=\s*", page)
    if not m:
        return None
    return json.JSONDecoder().raw_decode(page, m.end())[0]


def without_live(timetable: list) -> list:
    for block in timetable:
        for trip in block.get("trips") or []:
            trip.pop("start_timestamp", None)
            for call in trip.get("stops", []):
                for k in LIVE_FIELDS:
                    call.pop(k, None)
    return timetable


_last = 0.0


def get(url: str) -> str:
    global _last
    wait = DELAY_S - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read().decode("utf-8", "replace")
    finally:
        _last = time.monotonic()


def save(path: Path, data) -> str:
    text = json.dumps(data, ensure_ascii=False, sort_keys=True, indent=1)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fetch_map(refresh: bool) -> tuple[dict, dict]:
    path = RAW / "map.json"
    if path.exists() and not refresh:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data, dict(url=MAP_URL, file="map.json", fetched_at=data["fetched_at"], sha256=sha(path), trips="")
    page = get(MAP_URL)
    data = {name: js_var(page, name) for name in ("map_stops", "map_routes", "map_shapes")}
    missing = [k for k, v in data.items() if v is None]
    if missing:
        raise SystemExit(f"map page no longer embeds {missing}: the site changed, the parser needs updating")
    data["fetched_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    digest = save(path, data)
    return data, dict(url=MAP_URL, file="map.json", fetched_at=data["fetched_at"], sha256=digest, trips="")


def fetch_route(route: str, day: str, refresh: bool) -> dict:
    url = ROUTE_URL + urllib.parse.urlencode({"route": route, "day": day})
    rel = f"routes/{route}_{day}.json"
    path = RAW / rel
    if path.exists() and not refresh:
        data = json.loads(path.read_text(encoding="utf-8"))
    else:
        page = get(url)
        timetable = js_var(page, "timetable")
        if timetable is None:
            raise SystemExit(f"{url}: no embedded timetable; the site changed, the parser needs updating")
        if isinstance(timetable, dict):
            timetable = list(timetable.values())
        for block in timetable:
            block["trips"] = block.get("trips") or []
        days = {b.get("day") for b in timetable if b["trips"]}
        if days and days != {day}:
            raise SystemExit(f"{url}: asked for {day}, got {sorted(days)}")
        data = dict(route=route, day=day, directions=js_var(page, "directions"), timetable=without_live(timetable),
                    fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))
        save(path, data)
    trips = sum(len(b.get("trips") or []) for b in data["timetable"])
    return dict(url=url, file=rel, fetched_at=data["fetched_at"], sha256=sha(path), trips=trips)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh", action="store_true", help="fetch again even if a file is cached")
    ap.add_argument("--routes", help="comma-separated route ids (default: every route on the map page)")
    ap.add_argument("--days", help="comma-separated weekday names (default: all seven)")
    args = ap.parse_args(argv)

    data, map_row = fetch_map(args.refresh)
    routes = [r["id"] for r in data["map_routes"]]
    if args.routes:
        wanted = args.routes.split(",")
        unknown = sorted(set(wanted) - set(routes))
        if unknown:
            raise SystemExit(f"not on the map page: {unknown}")
        routes = wanted
    days = args.days.split(",") if args.days else list(DAYS)
    bad = sorted(set(days) - set(DAYS))
    if bad:
        raise SystemExit(f"not weekday names: {bad}")
    print(f"map: {len(data['map_stops'])} stops, {len(data['map_routes'])} routes, {len(data['map_shapes'])} shapes")

    rows = [map_row]
    total = len(routes) * len(days)
    for i, route in enumerate(routes, 1):
        for day in days:
            rows.append(fetch_route(route, day, args.refresh))
        trips = sum(r["trips"] for r in rows[-len(days):])
        print(f"[{i * len(days)}/{total}] {route}: {trips} trips over {len(days)} days", flush=True)

    if MANIFEST.exists():
        with open(MANIFEST, newline="", encoding="utf-8") as f:
            old = {r["file"]: r for r in csv.DictReader(f)}
        new = {r["file"]: r for r in rows}
        rows = list({**old, **new}.values())
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    with open(MANIFEST, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["url", "file", "fetched_at", "sha256", "trips"], lineterminator="\n")
        w.writeheader()
        w.writerows(sorted(rows, key=lambda r: r["file"]))
    print(f"manifest: {MANIFEST.relative_to(ROOT.parent.parent)} ({len(rows)} files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
