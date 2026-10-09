#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT.parent / "raw" / "myciti"
DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


@dataclass(frozen=True)
class Stop:
    code: str
    name: str
    lat: float
    lon: float
    station: bool


@dataclass
class Trip:
    route: str
    direction: int
    service: str
    source_id: str
    headsign: str
    calls: list
    days: set = field(default_factory=set)


def minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")[:2]
    return int(h) * 60 + int(m)


def past_midnight(times: list[int]) -> list[int]:
    if times and max(times) - min(times) > 12 * 60:
        return [t + 24 * 60 if t < 12 * 60 else t for t in times]
    return list(times)


def travel_order(calls: list, sequence: list) -> list:
    seen, ranked = Counter(), []
    for i, (code, m) in enumerate(calls):
        positions = [k for k, c in enumerate(sequence) if c == code]
        k = positions[min(seen[code], len(positions) - 1)] if positions else len(sequence)
        seen[code] += 1
        ranked.append((m, k, i, code))
    return [(code, m) for m, _, _, code in sorted(ranked)]


def load_stops(raw: Path = RAW) -> dict[str, Stop]:
    data = json.loads((raw / "map.json").read_text(encoding="utf-8"))
    out = {}
    for s in data["map_stops"]:
        code = (s.get("extended") or {}).get("extra", {}).get("gtfs_stop_id") or s["id"]
        out[code] = Stop(code=code, name=s["name"].strip().rstrip("_").strip(), lat=float(s["latitude"]), lon=float(s["longitude"]),
                         station=bool(s.get("station")))
    return out


def load_route_meta(raw: Path = RAW) -> dict[str, dict]:
    data = json.loads((raw / "map.json").read_text(encoding="utf-8"))
    return {r["id"]: r for r in data["map_routes"]}


def load_trips(raw: Path = RAW):
    sequences = {(r["id"], int(d["direction_id"])): d["stops"] for r in load_route_meta(raw).values()
                 for d in r.get("directions", [])}
    trips: dict[tuple[str, str], Trip] = {}
    skipped, reordered = [], 0
    for path in sorted((raw / "routes").glob("*.json")):
        page = json.loads(path.read_text(encoding="utf-8"))
        route, day = page["route"], page["day"]
        heads = {int(d["direction_id"]): d["trip_headsign"] for d in (page.get("directions") or [])}
        blocks = page["timetable"]
        for block in blocks.values() if isinstance(blocks, dict) else blocks:
            if not block.get("trips"):
                continue
            direction = int(block["direction"])
            for t in block["trips"]:
                tid = str(t["trip_id"])
                calls, services = [], set()
                for c in t.get("stops", []):
                    if not c.get("static_time"):
                        skipped.append((path.name, tid, c.get("id", ""), "no scheduled time"))
                        continue
                    calls.append((c["id"], minutes(c["static_time"])))
                    services.add(str(c.get("service_id")))
                if len(services) != 1:
                    for code, _ in calls:
                        skipped.append((path.name, tid, code, f"trip has {len(services)} service ids"))
                    continue
                times = past_midnight([m for _, m in calls])
                listed = [(code, m) for (code, _), m in zip(calls, times)]
                calls = travel_order(listed, sequences.get((route, direction), []))
                reordered += calls != listed
                key = (services.pop(), tid)
                if key in trips:
                    known = trips[key]
                    if (known.route, known.direction, known.calls) != (route, direction, calls):
                        for code, _ in calls:
                            skipped.append((path.name, tid, code, "same trip id differs between days"))
                        continue
                    known.days.add(day)
                else:
                    trips[key] = Trip(route=route, direction=direction, service=key[0], source_id=tid,
                                      headsign=heads.get(direction, ""), calls=calls, days={day})
    return list(trips.values()), skipped, reordered


def main() -> int:
    stops = load_stops()
    trips, skipped, reordered = load_trips()
    services = defaultdict(set)
    for t in trips:
        services[t.service] |= t.days
    print(f"{len(stops)} stops, {len(trips)} distinct trips, {len(services)} services")
    by_days = Counter(tuple(d for d in DAYS if d in days) for days in services.values())
    for days, n in by_days.most_common():
        print(f"  {n:3d} services on {', '.join(days)}")
    unknown = Counter(code for t in trips for code, _ in t.calls if code not in stops)
    print(f"calls at stops missing from the map: {sum(unknown.values())} ({len(unknown)} stops) {dict(unknown.most_common(5))}")
    print(f"calls skipped: {len(skipped)} {dict(Counter(r for *_, r in skipped))}")
    print(f"source trips listed out of travel order (put in time order): {reordered}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
