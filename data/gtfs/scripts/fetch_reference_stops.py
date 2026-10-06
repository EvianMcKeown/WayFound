#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from validate_gtfs import haversine_m  # noqa: E402

BASE = "https://gis.westerncape.gov.za/server2/rest/services/SpatialDataWarehouse/Transportation/MapServer"
OUT = Path(__file__).resolve().parents[1] / "reference"
AMBIGUOUS_M = 300


def norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def fetch_layer(layer: int) -> list[dict]:
    feats, offset = [], 0
    while True:
        url = (f"{BASE}/{layer}/query?where=1%3D1&outFields=*&outSR=4326"
               f"&resultOffset={offset}&resultRecordCount=1000&f=json")
        req = urllib.request.Request(url, headers={"User-Agent": "PathPilot-capstone/1.0"})
        page = json.load(urllib.request.urlopen(req, timeout=60))
        feats += page.get("features", [])
        if not page.get("exceededTransferLimit"):
            return feats
        offset += len(page["features"])


OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
OSM_QUERY = """[out:json][timeout:180];
(node["highway"="bus_stop"]["name"](-34.45,18.25,-33.40,19.15);
 node["public_transport"~"platform|stop_position|station"]["name"](-34.45,18.25,-33.40,19.15);
 node["amenity"="bus_station"]["name"](-34.45,18.25,-33.40,19.15);
 way["amenity"="bus_station"]["name"](-34.45,18.25,-33.40,19.15);
 node["railway"~"station|halt"]["name"](-34.45,18.25,-33.40,19.15););
out center tags;"""


PLACES_QUERY = """[out:json][timeout:120];
(node["place"~"suburb|neighbourhood|town|village|hamlet|locality|quarter"]["name"](-34.45,18.25,-33.40,19.15);
 node["amenity"="bus_station"]["name"](-34.45,18.25,-33.40,19.15);
 way["amenity"="bus_station"]["name"](-34.45,18.25,-33.40,19.15);
 node["shop"="mall"]["name"](-34.45,18.25,-33.40,19.15);
 way["shop"="mall"]["name"](-34.45,18.25,-33.40,19.15);
 node["railway"~"station|halt"]["name"](-34.45,18.25,-33.40,19.15);
 node["amenity"~"hospital|police|university|college|marketplace|townhall"]["name"](-34.45,18.25,-33.40,19.15);
 way["amenity"~"hospital|university|college"]["name"](-34.45,18.25,-33.40,19.15););
out center tags;"""


def fetch_osm(cache: Path | None, query: str | None = None) -> list[dict]:
    if cache and cache.exists():
        return json.loads(cache.read_text())["elements"]
    last = None
    for _ in range(3):
        for url in OVERPASS_MIRRORS:
            try:
                req = urllib.request.Request(
                    url, data=urllib.parse.urlencode({"data": query or OSM_QUERY}).encode(),
                    headers={"User-Agent": "PathPilot-capstone/1.0"})
                data = json.load(urllib.request.urlopen(req, timeout=200))
                if cache:
                    cache.write_text(json.dumps(data))
                return data["elements"]
            except Exception as e:
                last = f"{url}: {e}"
                print("overpass failed:", last, file=sys.stderr)
        time.sleep(20)
    raise SystemExit(f"Overpass unavailable ({last})")


def write_osm_csv(elements: list[dict], path: Path) -> None:
    groups = defaultdict(list)
    for e in elements:
        tags = e["tags"]
        lat = e.get("lat") or e["center"]["lat"]
        lon = e.get("lon") or e["center"]["lon"]
        owner = (tags.get("operator", "") + " " + tags.get("network", "")).lower()
        if any(k in owner for k in ("metrorail", "prasa", "golden arrow")):
            continue
        tagged = "myciti" in owner
        groups[norm(tags["name"])].append((tags["name"], lat, lon, tagged))
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["name", "lat", "lon", "records", "spread_m", "ambiguous", "myciti_tagged"])
        for key in sorted(groups):
            pts = groups[key]
            tagged = [p for p in pts if p[3]]
            use = tagged or pts
            lat = statistics.median(p[1] for p in use)
            lon = statistics.median(p[2] for p in use)
            spread = max(haversine_m(lat, lon, p[1], p[2]) for p in use)
            w.writerow([use[0][0], f"{lat:.6f}", f"{lon:.6f}", len(use), round(spread),
                        int(spread > AMBIGUOUS_M), int(bool(tagged))])


def write_osm_rail_csv(elements: list[dict], path: Path) -> None:
    groups = defaultdict(list)
    for e in elements:
        tags = e["tags"]
        if tags.get("railway") in ("station", "halt"):
            lat = e.get("lat") or e["center"]["lat"]
            lon = e.get("lon") or e["center"]["lon"]
            groups[norm(tags["name"])].append((tags["name"], lat, lon))
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["name", "lat", "lon", "records", "spread_m", "ambiguous"])
        for key in sorted(groups):
            pts = groups[key]
            lat = statistics.median(p[1] for p in pts)
            lon = statistics.median(p[2] for p in pts)
            spread = max(haversine_m(lat, lon, p[1], p[2]) for p in pts)
            w.writerow([pts[0][0], f"{lat:.6f}", f"{lon:.6f}", len(pts), round(spread), int(spread > AMBIGUOUS_M)])


def write_osm_named_transit_csv(elements: list[dict], path: Path) -> None:
    groups = defaultdict(list)
    for e in elements:
        tags = e["tags"]
        if tags.get("highway") == "bus_stop" or tags.get("public_transport") or tags.get("amenity") == "bus_station":
            lat = e.get("lat") or e["center"]["lat"]
            lon = e.get("lon") or e["center"]["lon"]
            groups[norm(tags["name"])].append((tags["name"], lat, lon))
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["name", "lat", "lon", "records", "spread_m", "ambiguous"])
        for key in sorted(groups):
            pts = groups[key]
            lat = statistics.median(p[1] for p in pts)
            lon = statistics.median(p[2] for p in pts)
            spread = max(haversine_m(lat, lon, p[1], p[2]) for p in pts)
            w.writerow([pts[0][0], f"{lat:.6f}", f"{lon:.6f}", len(pts), round(spread), int(spread > AMBIGUOUS_M)])


def write_osm_places_csv(elements: list[dict], path: Path) -> None:
    groups = defaultdict(list)
    for e in elements:
        tags = e["tags"]
        lat = e.get("lat") or e["center"]["lat"]
        lon = e.get("lon") or e["center"]["lon"]
        kind = "place" if "place" in tags else "landmark"
        groups[norm(tags["name"])].append((tags["name"], lat, lon, kind))
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["name", "lat", "lon", "records", "spread_m", "ambiguous", "kind"])
        for key in sorted(groups):
            pts = groups[key]
            lat = statistics.median(p[1] for p in pts)
            lon = statistics.median(p[2] for p in pts)
            spread = max(haversine_m(lat, lon, p[1], p[2]) for p in pts)
            kinds = {p[3] for p in pts}
            w.writerow([pts[0][0], f"{lat:.6f}", f"{lon:.6f}", len(pts), round(spread), int(spread > AMBIGUOUS_M),
                        "landmark" if "landmark" in kinds else "place"])


def write_gabs_stations_csv(path: Path) -> None:
    feats, offset = [], 0
    while True:
        url = (f"{BASE}/6/query?where=CLASSIFICA%3D%27Station%27&outFields=BUSSTOPNO%2CBUSSTOPDES&outSR=4326"
               f"&resultOffset={offset}&resultRecordCount=1000&f=json")
        req = urllib.request.Request(url, headers={"User-Agent": "PathPilot-capstone/1.0"})
        page = json.load(urllib.request.urlopen(req, timeout=60))
        feats += page.get("features", [])
        if not page.get("exceededTransferLimit"):
            break
        offset += len(page["features"])
    groups = defaultdict(list)
    for f in feats:
        a = f["attributes"]
        groups[(a["BUSSTOPNO"], a["BUSSTOPDES"])].append((f["geometry"]["y"], f["geometry"]["x"]))
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["station_id", "name", "lat", "lon", "records", "spread_m", "ambiguous"])
        for (sid, name), pts in sorted(groups.items()):
            lat = statistics.median(p[0] for p in pts)
            lon = statistics.median(p[1] for p in pts)
            spread = max(haversine_m(lat, lon, p[0], p[1]) for p in pts)
            w.writerow([sid, name, f"{lat:.6f}", f"{lon:.6f}", len(pts), round(spread), int(spread > AMBIGUOUS_M)])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--osm", action="store_true", help="also build osm_stops.csv from Overpass")
    ap.add_argument("--osm-cache", type=Path, help="JSON file to read/write the raw Overpass response")
    ap.add_argument("--osm-places-cache", type=Path, help="same, for the places/landmarks query (osm_places.csv)")
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)

    groups = defaultdict(list)
    for f in fetch_layer(10):
        name = (f["attributes"].get("NAME") or "").strip()
        if name and f.get("geometry"):
            groups[norm(name)].append((name, f["geometry"]["y"], f["geometry"]["x"]))
    with open(OUT / "wc_dtpw_myciti_stops.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["name", "lat", "lon", "records", "spread_m", "ambiguous"])
        for key in sorted(groups):
            pts = groups[key]
            lat = statistics.median(p[1] for p in pts)
            lon = statistics.median(p[2] for p in pts)
            spread = max(haversine_m(lat, lon, p[1], p[2]) for p in pts)
            w.writerow([pts[0][0], f"{lat:.6f}", f"{lon:.6f}", len(pts), round(spread),
                        int(spread > AMBIGUOUS_M)])

    if args.osm:
        elements = fetch_osm(args.osm_cache)
        write_osm_csv(elements, OUT / "osm_stops.csv")
        write_osm_rail_csv(elements, OUT / "osm_rail_stations.csv")
        write_osm_named_transit_csv(elements, OUT / "osm_named_transit.csv")
        write_osm_places_csv(fetch_osm(args.osm_places_cache, PLACES_QUERY), OUT / "osm_places.csv")

    write_gabs_stations_csv(OUT / "wc_dtpw_gabs_stations.csv")

    stations = fetch_layer(3)
    with open(OUT / "wc_dtpw_metrorail_stations.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["name", "station_id", "lat", "lon"])
        for f in sorted(stations, key=lambda f: f["attributes"]["StationNAm"]):
            a = f["attributes"]
            w.writerow([a["StationNAm"], a["StationID"], f"{f['geometry']['y']:.6f}", f"{f['geometry']['x']:.6f}"])

    (OUT / "README.md").write_text(
        f"""# Reference stop positions

Fetched {date.today()} by `scripts/fetch_reference_stops.py` from the Western Cape DTPW spatial
warehouse (data by DTPW, City of Cape Town, PRASA; layers dated ~May 2023). Geometry only.
Licence not yet verified: confirm before publishing these files.

- `wc_dtpw_myciti_stops.csv`: one row per station name (median of its bay/shelter records).
  `ambiguous=1` means records are > {AMBIGUOUS_M} m apart; do not use.
- `wc_dtpw_metrorail_stations.csv`: Metrorail stations.
- `osm_stops.csv` (only with `--osm`): OpenStreetMap named transit stops, (c) OpenStreetMap
  contributors, ODbL (attribution and share-alike apply to derived databases). `myciti_tagged=1` means
  the position comes from MyCiTi-tagged elements only.
- `osm_rail_stations.csv` (only with `--osm`): OSM railway stations/halts of any operator (used for Metrorail).
- `osm_named_transit.csv` (only with `--osm`): every named OSM transit stop of any operator (used for Golden Arrow).
- `osm_places.csv` (only with `--osm`): suburbs, hospitals, malls, bus stations; `kind=place` is a centroid (approximate).
- `wc_dtpw_gabs_stations.csv`: the 30 named Golden Arrow stations (`GABS001`..`GABS030`) of the government layer.
- `manual_stop_positions.csv` (optional, hand-maintained): `stop_id,lat,lon,source` overrides
  applied by `scripts/repair_stops.py`.
"""
    )
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
