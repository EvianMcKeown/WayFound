from __future__ import annotations

import csv
import math
import threading
from pathlib import Path
from typing import Any, List, Dict, Tuple, Optional, FrozenSet
import heapq
import time
from datetime import datetime, timedelta

from django.conf import settings

from algorithm_prototype.gtfs_reader import GTFSReader, INF
from algorithm_prototype.raptor import (
    helper_functions as hf,
    raptor_algo,
    prepare_network,
    reconstruct_path_objs,
    Stop,
    Route,
    Trip,
    Transfer,
    MAX_WALK_DIST,
    MIN_TRANSFER_TIME,
    WALKING_SPEED,
    AREA_RADIUS_M,
    AREA_WALK_ALLOWANCE_M,
)


def to_mins(day: int, time_str: str) -> int:
    """
    Convert an optional day (0=Mon..6=Sun) and a time string "HH:MM" or "HH:MM:SS"
    into absolute minutes since Monday 00:00. If day is None, returns minutes
    since midnight (0..1439).

    Raises ValueError on invalid input.
    """
    if not isinstance(time_str, str):
        raise ValueError("time_str must be a string like 'HH:MM' or 'HH:MM:SS'.")

    parts = time_str.strip().split(":")
    if len(parts) < 2:
        raise ValueError("time_str must be in 'HH:MM' or 'HH:MM:SS' format.")

    try:
        hh = int(parts[0])
        mm = int(parts[1])
    except ValueError as e:
        raise ValueError("time_str contains non-integer components.") from e

    if not (0 <= mm < 60):
        raise ValueError("Minutes must be in the range 0..59.")

    # seconds are optional; ignored if present
    total = hh * 60 + mm

    if day is None:
        return total

    if not isinstance(day, int) or not (0 <= day <= 6):
        raise ValueError("day must be an integer in the range 0..6 (Mon..Sun).")

    return day * 24 * 60 + total


def find_closest_stop(
    lat: float, lon: float, stops: Dict[str, Stop]
) -> Tuple[str, float]:
    """
    Find the closest stop to (lat, lon) using a divide and conquer closest pair algorithm.

    Args:
        lat: Target latitude
        lon: Target longitude
        stops: Dictionary of {stop_id: Stop} where Stop has .lat and .lon

    Returns:
        Tuple of (stop_id, distance_meters)
    """
    if not stops:
        raise ValueError("No stops provided")

    # Helper: haversine distance in meters

    # Convert stops to points for processing
    points = [(stop_id, stop.lat, stop.lon) for stop_id, stop in stops.items()]

    # Sort by latitude for divide and conquer
    points_sorted = sorted(points, key=lambda x: x[1])

    def closest_pair_recursive(
        points_list: List[Tuple[str, float, float]],
    ) -> Tuple[str, float]:
        n = len(points_list)

        # Base case: brute force for small lists
        if n <= 10:
            min_dist = float("inf")
            min_stop_id = None
            for stop_id, stop_lat, stop_lon in points_list:
                dist = hf.haversine(lat, lon, stop_lat, stop_lon)
                if dist < min_dist:
                    min_dist = dist
                    min_stop_id = stop_id
            return min_stop_id, min_dist

        # Divide
        mid = n // 2
        left_points = points_list[:mid]
        right_points = points_list[mid:]

        # Conquer
        left_stop_id, left_dist = closest_pair_recursive(left_points)
        right_stop_id, right_dist = closest_pair_recursive(right_points)

        # Combine - return the closer of the two
        if left_dist <= right_dist:
            return left_stop_id, left_dist
        else:
            return right_stop_id, right_dist

    return closest_pair_recursive(points_sorted)


MODE_NAMES = {0: "MyCiTi", 1: "Golden Arrow", 2: "Metrorail"}
MODE_PREFIX = {0: "mc", 1: "ga", 2: "mr"}


def line_of(route: Route) -> Tuple[str, str]:
    prefix = MODE_PREFIX.get(route.mode, "x")
    name = (route.name or route.id).strip()
    if route.mode == 0:
        base = name.rsplit("-", 1)[0] if "-" in name else name
        return f"{prefix}:{base}", base
    if route.mode == 2:
        base = name.split(":", 1)[0].strip() if ":" in name else name
        return f"{prefix}:{base.lower()}", base
    parts = [p.strip() for p in name.split(" - ")]
    if len(parts) == 2 and all(parts):
        a, b = sorted(parts, key=str.lower)
        return f"{prefix}:{a.lower()}~{b.lower()}", f"{a} \u2194 {b}"
    return f"{prefix}:{name.lower()}", name


VIRTUAL_START = "virtual_start"
VIRTUAL_END = "virtual_end"


def _walk_minutes(distance_m: float) -> int:
    return max(MIN_TRANSFER_TIME, math.ceil(distance_m / WALKING_SPEED))


def _access_transfers(
    place: Stop, stops: Dict[str, Stop], radius_m: float, outbound: bool
) -> List[Transfer]:
    walks: List[Tuple[float, Stop]] = []
    nearest: Optional[Tuple[float, Stop]] = None
    for st in stops.values():
        d = hf.haversine(place.lat, place.lon, st.lat, st.lon)
        if st.approximate:
            d += AREA_WALK_ALLOWANCE_M
        if nearest is None or d < nearest[0]:
            nearest = (d, st)
        if d <= radius_m:
            walks.append((d, st))
    if nearest and not any(st.id == nearest[1].id for _, st in walks):
        walks.append(nearest)
    return [
        Transfer(place, st, _walk_minutes(d)) if outbound else Transfer(st, place, _walk_minutes(d))
        for d, st in walks
    ]


def _serialize_stop(s: Stop) -> Dict[str, Any]:
    return {
        "id": s.id,
        "name": getattr(s, "name", ""),
        "lat": s.lat,
        "lon": s.lon,
        "mode": s.mode,
        "approximate": bool(getattr(s, "approximate", False)),
    }


def approximate_stop_ids(gtfs_folder: str) -> set:
    path = Path(gtfs_folder) / "sources" / "stop_provenance.csv"
    if not path.exists():
        return set()
    with open(path, newline="", encoding="utf-8") as f:
        return {r["stop_id"] for r in csv.DictReader(f) if r.get("approximate") == "1"}


def _serialize_route(r: Route) -> Dict[str, Any]:
    return {"id": r.id, "name": getattr(r, "name", ""), "mode": r.mode}


def _serialize_trip(t: Trip) -> Dict[str, Any]:
    return {"id": t.id}


def _towards(route: Route, trip: Optional[Trip]) -> Optional[str]:
    if not route.stops:
        return None
    last = len(route.stops) - 1
    if trip is not None:
        times = trip.departure_times
        while last > 0 and (last >= len(times) or times[last] == INF):
            last -= 1
    return getattr(route.stops[last], "name", None) or None


def _path_objs_to_json_safe(steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for step in steps:
        s = {
            # common
            "mode": step.get("mode"),
            "arrival_time": step.get("arrival_time"),
            "stop_id": step.get("stop_id"),
            "from_stop_id": step.get("from_stop_id"),
            "route_id": step.get("route_id"),
            "trip_id": step.get("trip_id"),
            "transfer_time": step.get("transfer_time"),
            # indices (to help UI debugging)
            "board_pos": step.get("board_pos"),
            "disembark_pos": step.get("disembark_pos"),
        }
        # include objects when available
        if "stop_object" in step and step["stop_object"]:
            s["stop"] = _serialize_stop(step["stop_object"])
        if "from_stop_object" in step and step["from_stop_object"]:
            s["from_stop"] = _serialize_stop(step["from_stop_object"])
        if "route_object" in step and step["route_object"]:
            s["route"] = _serialize_route(step["route_object"])
        if "trip_object" in step and step["trip_object"]:
            s["trip"] = _serialize_trip(step["trip_object"])
        if step.get("route_object"):
            s["towards"] = _towards(step["route_object"], step.get("trip_object"))
        route_obj, bp, dp = (
            step.get("route_object"),
            step.get("board_pos"),
            step.get("disembark_pos"),
        )
        if route_obj and isinstance(bp, int) and isinstance(dp, int) and bp <= dp:
            ride = route_obj.stops[bp : dp + 1]
            s["shape"] = [[st.lon, st.lat] for st in ride]
            s["stops_along"] = [
                {
                    "name": getattr(st, "name", ""),
                    "lat": st.lat,
                    "lon": st.lon,
                    "approximate": bool(getattr(st, "approximate", False)),
                }
                for st in ride
            ]
        if "board_stop_object" in step and step["board_stop_object"]:
            s["board_stop"] = _serialize_stop(step["board_stop_object"])
        if "disembark_stop_object" in step and step["disembark_stop_object"]:
            s["disembark_stop"] = _serialize_stop(step["disembark_stop_object"])
        out.append(s)
    return out


class RaptorEngine:
    def __init__(self, gtfs_folder: Optional[str] = None):
        self._lock = threading.RLock()
        self._loaded = False
        self._gtfs_folder = gtfs_folder or getattr(settings, "GTFS_FOLDER", None)
        self.stops: Dict[str, Stop] = {}
        self.routes: Dict[str, Route] = {}
        self.transfers: List[Transfer] = []
        self.transfer_map: Dict[Tuple[str, str], Transfer] = {}
        self.last_max_walk_distance: int = MAX_WALK_DIST
        self._transfer_cache: Dict[int, Tuple[List[Transfer], Dict]] = {}
        self.lines: Dict[str, Dict[str, Any]] = {}
        self.route_line: Dict[str, str] = {}
        self.mode_routes: Dict[int, set] = {}

    def _index_lines(self) -> None:
        self.lines, self.route_line, self.mode_routes = {}, {}, {}
        for rid, route in self.routes.items():
            key, label = line_of(route)
            line = self.lines.setdefault(
                key, {"key": key, "label": label, "mode": route.mode, "operator": MODE_NAMES.get(route.mode, "?"), "routes": set()}
            )
            line["routes"].add(rid)
            self.route_line[rid] = key
            self.mode_routes.setdefault(route.mode, set()).add(rid)

    def search_lines(self, query: str = "", mode: Optional[int] = None, keys: Optional[List[str]] = None, limit: int = 50) -> List[Dict[str, Any]]:
        if not self._loaded:
            self.load()
        out = []
        if keys is not None:
            out = [self.lines[k] for k in keys if k in self.lines]
        else:
            words = query.lower().split()
            for line in self.lines.values():
                if mode is not None and line["mode"] != mode:
                    continue
                label = line["label"].lower()
                if all(w in label for w in words):
                    out.append(line)
            out.sort(key=lambda l: (l["mode"], l["label"].lower()))
        return [
            {"key": l["key"], "label": l["label"], "mode": l["mode"], "operator": l["operator"], "directions": len(l["routes"])}
            for l in out[:limit]
        ]

    def resolve_exclusions(self, modes=(), lines=()) -> Tuple[frozenset, List[str]]:
        banned: set = set()
        for m in modes:
            banned |= self.mode_routes.get(m, set())
        unknown = []
        for key in lines:
            line = self.lines.get(key)
            if line is None:
                unknown.append(key)
            else:
                banned |= line["routes"]
        return frozenset(banned), unknown

    def line_info(self, route_id: Optional[str]) -> Optional[Dict[str, Any]]:
        key = self.route_line.get(route_id) if route_id else None
        line = self.lines.get(key) if key else None
        if not line:
            return None
        return {"key": line["key"], "label": line["label"], "mode": line["mode"], "operator": line["operator"]}

    def _transfers_for(self, max_walk_dist: int) -> Tuple[List[Transfer], Dict]:
        with self._lock:
            if max_walk_dist == self.last_max_walk_distance:
                return self.transfers, self.transfer_map
            if max_walk_dist not in self._transfer_cache:
                transfers = hf.create_transfers(self.stops, max_walk_dist)
                self._transfer_cache[max_walk_dist] = (
                    transfers,
                    hf.create_transfer_map(transfers),
                )
            return self._transfer_cache[max_walk_dist]

    def load(self, custom_max_walk_dist: Optional[int] = None) -> None:
        with self._lock:
            if self._loaded:
                return
            reader = GTFSReader(gtfs_folder=self._gtfs_folder)
            self.stops = reader.stops
            for stop_id in approximate_stop_ids(self._gtfs_folder):
                if stop_id in self.stops:
                    self.stops[stop_id].approximate = True
            self.routes = reader.routes
            self._index_lines()
            # build walk transfers (if non-default max_walk_distance is used, transfers need to be
            # created in the planner call)
            if custom_max_walk_dist is not None:
                self.last_max_walk_distance = custom_max_walk_dist
            else:
                self.last_max_walk_distance = MAX_WALK_DIST
            self.transfers = hf.create_transfers(
                self.stops, self.last_max_walk_distance
            )
            self.transfer_map = hf.create_transfer_map(self.transfers)
            self._loaded = True

    def plan(
        self,
        source_lat: float,
        source_lon: float,
        target_lat: float,
        target_lon: float,
        departure_minutes: int,
        max_rounds: int = 5,
        custom_max_walk_dist: Optional[int] = None,
        debug: bool = False,
        minimize_walking: bool = False,
        minimize_stops: bool = False,
        alternatives: int = 1,
        exclude_modes: Tuple[int, ...] = (),
        exclude_lines: Tuple[str, ...] = (),
    ) -> Dict[str, Any]:
        if not self._loaded:
            self.load(custom_max_walk_dist=custom_max_walk_dist)

        walk_dist = custom_max_walk_dist or self.last_max_walk_distance
        if minimize_walking:
            walk_dist = 200
        transfers, transfer_map = self._transfers_for(walk_dist)

        source_lat, source_lon = float(source_lat), float(source_lon)
        target_lat, target_lon = float(target_lat), float(target_lon)
        if not self.stops:
            return {
                "error": "No stops loaded",
                "result": {},
                "path": [],
                "path_objs": [],
            }

        origin = Stop(id=VIRTUAL_START, name="Starting Location", lat=source_lat, lon=source_lon, mode=0)
        destination = Stop(id=VIRTUAL_END, name="Destination", lat=target_lat, lon=target_lon, mode=0)
        access = _access_transfers(origin, self.stops, walk_dist, outbound=True)
        egress = _access_transfers(destination, self.stops, walk_dist, outbound=False)
        extra = access + egress
        direct_m = hf.haversine(source_lat, source_lon, target_lat, target_lon)
        if direct_m <= walk_dist:
            extra.append(Transfer(origin, destination, _walk_minutes(direct_m)))

        search_stops = dict(self.stops)
        search_stops[VIRTUAL_START] = origin
        search_stops[VIRTUAL_END] = destination
        search_transfers = transfers + extra
        search_transfer_map = dict(transfer_map)
        search_transfer_map.update(hf.create_transfer_map(extra))

        if minimize_stops:
            # minimize number of transfers by setting max_rounds to a low value
            max_rounds = 3

        prepared = prepare_network(search_stops, self.routes, search_transfers)

        excluded, unknown_lines = self.resolve_exclusions(exclude_modes, exclude_lines)

        def run(banned: FrozenSet[str] = frozenset(), latest_arrival: int = INF, ignore_exclusions: bool = False):
            kwargs: Dict[str, Any] = dict(
                stops=search_stops,
                routes=self.routes,
                transfers=search_transfers,
                source_id=VIRTUAL_START,
                target_id=VIRTUAL_END,
                departure_time=departure_minutes,
                max_rounds=max_rounds,
                debug=debug,
                prepared=prepared,
                banned_routes=set(banned) | (set() if ignore_exclusions else excluded),
                latest_arrival=latest_arrival,
            )
            result, path = raptor_algo(**kwargs)
            arrival = result.get(VIRTUAL_END, INF)
            return result, ([] if arrival == INF else (path or []))

        def package(result: Dict[str, int], path: List[Dict[str, Any]]) -> Dict[str, Any]:
            earliest_arrival = result.get(VIRTUAL_END, INF)
            path_objs = reconstruct_path_objs(
                path=path,
                stops_dict=search_stops,
                routes_dict=self.routes,
                transfers_dict=search_transfer_map,
            )
            rides = [step for step in path if step.get("mode") == "trip"]

            def used_stop(stop_id, lat, lon):
                if stop_id is None:
                    return None
                st = self.stops[stop_id]
                return {"id": stop_id, "distance_m": hf.haversine(lat, lon, st.lat, st.lon)}

            steps = _path_objs_to_json_safe(path_objs)
            for step in steps:
                if step.get("mode") == "trip":
                    step["line"] = self.line_info(step.get("route_id"))
            return {
                "earliest_arrival": earliest_arrival if earliest_arrival != INF else None,
                "source_stop": used_stop(rides[0]["from_stop_id"] if rides else None, source_lat, source_lon),
                "target_stop": used_stop(rides[-1]["stop_id"] if rides else None, target_lat, target_lon),
                "result": {k: v for k, v in result.items() if k not in (VIRTUAL_START, VIRTUAL_END)},
                "path": path,
                "path_objs": steps,
                "area_radius_m": AREA_RADIUS_M,
            }

        result, path = run()
        out = package(result, path)
        out["exclusions"] = {
            "modes": sorted(set(exclude_modes)),
            "lines": [k for k in exclude_lines if k not in unknown_lines],
            "unknown_lines": unknown_lines,
            "routes_banned": len(excluded),
        }
        if not path and excluded:
            free_result, free_path = run(ignore_exclusions=True)
            if free_path:
                out["blocked_by_exclusions"] = True
                out["blocked_by"] = self._blockers(free_path, exclude_modes, exclude_lines)

        if alternatives > 1 and path:
            found = self._alternatives(run, (result, path), departure_minutes, alternatives)
            out["journeys"] = [
                {**package(r, p), **meta} for r, p, meta in found
            ]
        return out

    def _blockers(self, path: List[Dict[str, Any]], exclude_modes, exclude_lines) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        seen = set()
        for step in path:
            if step.get("mode") != "trip":
                continue
            info = self.line_info(step.get("route_id"))
            if not info:
                continue
            if info["mode"] in exclude_modes and ("mode", info["mode"]) not in seen:
                seen.add(("mode", info["mode"]))
                out.append({"type": "mode", "mode": info["mode"], "label": info["operator"]})
            if info["key"] in exclude_lines and ("line", info["key"]) not in seen:
                seen.add(("line", info["key"]))
                out.append({"type": "line", "key": info["key"], "label": f"{info['operator']} {info['label']}"})
        return out

    def _alternatives(self, run, best, departure_minutes: int, count: int, max_runs: int = 14, budget_s: float = 6.0):
        start = time.monotonic()
        result0, path0 = best
        arrival0 = result0[VIRTUAL_END]
        slack = max(30, 0.5 * (arrival0 - departure_minutes))

        def signature(path):
            rides = [f"{s['from_stop_id']}>{s['stop_id']}" for s in path if s.get("mode") == "trip"]
            return "|".join(rides) or "walk"

        found = {signature(path0): (arrival0, result0, path0)}
        tried = {frozenset()}
        queue: List[Tuple[int, int, FrozenSet[str], List[Dict[str, Any]]]] = []
        tick = 0
        heapq.heappush(queue, (arrival0, tick, frozenset(), path0))
        runs = 0
        while queue and runs < max_runs and time.monotonic() - start < budget_s:
            _, _, banned, path = heapq.heappop(queue)
            for step in path:
                if step.get("mode") != "trip":
                    continue
                ban = banned | {step["route_id"]}
                if ban in tried:
                    continue
                tried.add(ban)
                runs += 1
                result, alt = run(ban, arrival0 + slack)
                if not alt:
                    continue
                arrival = result[VIRTUAL_END]
                sig = signature(alt)
                if sig in found or arrival > arrival0 + slack:
                    continue
                found[sig] = (arrival, result, alt)
                tick += 1
                heapq.heappush(queue, (arrival, tick, ban, alt))
                if runs >= max_runs:
                    break

        def stats(path):
            rides = [s for s in path if s.get("mode") == "trip"]
            walking = sum(s.get("transfer_time") or 0 for s in path if s.get("mode") == "transfer")
            return max(len(rides) - 1, 0), walking

        ranked = []
        for sig, (arrival, result, path) in found.items():
            transfers, walking = stats(path)
            ranked.append((arrival, transfers, walking, sig, result, path))
        ranked.sort(key=lambda r: (r[0], r[1], r[2], r[3]))
        ranked = ranked[:count]

        fewest = min(r[1] for r in ranked)
        least = min(r[2] for r in ranked)
        out = []
        for i, (arrival, transfers, walking, sig, result, path) in enumerate(ranked):
            labels = []
            if i == 0:
                labels.append("Fastest")
            if len(ranked) > 1 and transfers == fewest and fewest < max(r[1] for r in ranked) and not any(
                "Fewest transfers" in o[2]["labels"] for o in out
            ):
                labels.append("Fewest transfers")
            if len(ranked) > 1 and walking == least and least < max(r[2] for r in ranked) and not any(
                "Least walking" in o[2]["labels"] for o in out
            ):
                labels.append("Least walking")
            out.append(
                (
                    result,
                    path,
                    {
                        "rank": i,
                        "signature": sig,
                        "summary": {"duration": arrival - departure_minutes, "transfers": transfers, "walking": walking},
                        "labels": labels,
                    },
                )
            )
        return out


# Singleton with lazy load (pre-warmed in AppConfig.ready)
_engine: Optional[RaptorEngine] = None
_engine_lock = threading.RLock()
# The two-phase logic separates object construction from data loading.
# Construction happens when _engine is None; loading is guarded by
# the _engine._loaded flag so expensive GTFS reading and transfer building
# occur once. Using threading.RLock makes the accessor safe under concurrent access.


def get_engine() -> RaptorEngine:
    global _engine
    with _engine_lock:
        if _engine is None:
            _engine = RaptorEngine(getattr(settings, "GTFS_FOLDER", None))
        if not _engine._loaded:
            _engine.load()
        return _engine
