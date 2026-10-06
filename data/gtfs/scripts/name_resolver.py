#!/usr/bin/env python3
from __future__ import annotations

import difflib
import json
import math
import re
import statistics
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from validate_gtfs import haversine_m

UA = {"User-Agent": "PathPilot-capstone/1.0 (student journey planner; low-rate, cached)"}
NOMINATIM = "https://nominatim.openstreetmap.org/search"
VIEWBOX = "18.25,-33.40,19.15,-34.45"
DELAY_S = 1.1
MAX_KMH = 90.0
MIN_SIMILARITY = 0.75
STRONG_SIMILARITY = 0.9
HEAD_MIN_NEIGHBOURS = 4
HEAD_SIMILARITY = 0.6
NEAR_IDENTICAL = 0.95
SAME_PLACE_KM = 1.5
CLUSTER_KM = 2.0
INFORMATIVE_KM = 30.0
TRIANGULATE_MIN = 3
OUTLIER_MIN_NEIGHBOURS = 4
FIT_MARGIN_KMH = 25.0
SIZE_DOMINANCE = 2
NAME_BAND = 0.15
PLACE_TYPES = {"suburb", "neighbourhood", "city", "town", "village", "hamlet", "quarter", "locality", "city_block",
               "administrative", "residential"}
ROAD_TYPES = {"primary", "secondary", "tertiary", "trunk", "unclassified", "service", "road", "living_street", "yes"}

ABBREV = {"HOSP": "HOSPITAL", "STN": "STATION", "VILL": "VILLAGE", "CNTRE": "CENTRE", "CTR": "CENTRE", "IND": "INDUSTRIA",
          "SCH": "SCHOOL", "GDNS": "GARDENS", "PK": "PARK", "HTS": "HEIGHTS", "SAP": "POLICE STATION", "UNIV": "UNIVERSITY"}
SYNONYM = {"MALL": "CENTRE"}
SKIP_WHEN_COMPARING = {"SHOPPING"}
DROP = {"TERM", "TERMINUS", "CBD"}
SPELLING = {"BLAAUWBERG": "BLOUBERG", "MELKBOS": "MELKBOSSTRAND"}
BRANDS = {"MEDICLINIC", "NETCARE", "LIFE"}


def tokens(text: str) -> list[str]:
    return re.sub(r"[^A-Za-z0-9 ]+", " ", text).upper().split()


def expand(name: str, normalise: bool = False) -> list[str]:
    t = re.sub(r"\bMEDI\s*-?\s*CLINIC\b", "MEDICLINIC", re.sub(r"\([^)]*\)", " ", name.upper()))
    out = []
    for w in tokens(t):
        for x in ABBREV.get(w, w).split():
            if normalise:
                if x in SKIP_WHEN_COMPARING:
                    continue
                x = SPELLING.get(x, SYNONYM.get(x, x))
            out.append(x)
    return out


def query_variants(name: str) -> list[str]:
    base = [w for w in expand(name) if w not in DROP]
    variants = [base]
    brand = [w for w in base if w in BRANDS]
    if brand:
        variants.append(brand + [w for w in base if w not in BRANDS])
    if any(w in SPELLING for w in base):
        variants.append([SPELLING.get(w, w) for w in base])
    if "CENTRE" in base:
        variants.append(["MALL" if w == "CENTRE" else w for w in base])
    out, seen = [], set()
    for v in variants:
        s = " ".join(v).title()
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def compare(query: str, candidate_name: str) -> tuple[float, str]:
    forms = [candidate_name, *re.findall(r"\(([^)]*)\)", candidate_name), re.sub(r"[()]", " ", candidate_name)]
    return max((_compare(query, f) for f in forms), key=lambda x: x[0])


def similarity(query: str, candidate_name: str) -> float:
    return compare(query, candidate_name)[0]


def _compare(query: str, candidate_name: str) -> tuple[float, str]:
    q, c = expand(query, True), expand(candidate_name, True)
    if not q or not c:
        return 0.0, "spelling"
    qs, cs = set(q), set(c)
    ratio = difflib.SequenceMatcher(None, " ".join(q), " ".join(c)).ratio()
    if qs <= cs:
        return max(ratio, 0.9 if len(cs - qs) <= 2 else 0.75), "full"
    if cs < qs and q[: len(c)] == c:
        return min(max(ratio, 0.6), 0.7), "head"
    if cs < qs:
        return min(max(ratio, 0.6), 0.7), "spelling"
    return (ratio if ratio >= NEAR_IDENTICAL else min(ratio, MIN_SIMILARITY - 0.01)), "spelling"


@dataclass
class Candidate:
    name: str
    lat: float
    lon: float
    source: str
    kind: str = ""
    similarity: float = 0.0
    ref: str = ""
    match: str = "full"
    neighbours_checked: int = 0
    neighbours_ok: int = 0
    worst_kmh: float = 0.0
    guide_km: float | None = None
    informative: int = 0

    @property
    def rank(self) -> int:
        if self.source in ("local:govt", "local:osm-transit") or self.kind in ("station", "stop", "bus_station", "bus_stop"):
            return 0
        if self.kind in ROAD_TYPES:
            return 3
        if self.kind in PLACE_TYPES or self.source.endswith("osm-place"):
            return 2
        return 1

    @property
    def approximate(self) -> bool:
        return self.rank >= 2


@dataclass
class Resolution:
    name: str
    status: str
    best: Candidate | None = None
    note: str = ""
    considered: list = field(default_factory=list)
    in_region: list = field(default_factory=list)
    prior: "Prior | None" = None


class GeocodeCache:
    def __init__(self, path: Path, network: bool = True):
        self.path, self.network, self.data, self.last = path, network, {}, 0.0
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    row = json.loads(line)
                    self.data[row["q"]] = row["results"]

    def search(self, query: str, box: str | None = None) -> list[dict]:
        key = query if box is None else f"{query} @{box}"
        if key in self.data:
            return self.data[key]
        if not self.network:
            return []
        wait = DELAY_S - (time.time() - self.last)
        if wait > 0:
            time.sleep(wait)
        params = dict(q=query + ", Cape Town", format="jsonv2", limit=5, viewbox=box or VIEWBOX, bounded=1, countrycodes="za")
        req = urllib.request.Request(f"{NOMINATIM}?{urllib.parse.urlencode(params)}", headers=UA)
        try:
            raw = json.load(urllib.request.urlopen(req, timeout=30))
        except Exception:
            self.last = time.time()
            return []
        self.last = time.time()
        results = [dict(name=r.get("name") or r["display_name"].split(",")[0], display=r["display_name"][:200],
                        lat=float(r["lat"]), lon=float(r["lon"]), type=r.get("type", ""), cls=r.get("category", r.get("class", "")),
                        ref=f"{r.get('osm_type', '')}/{r.get('osm_id', '')}") for r in raw]
        self.data[key] = results
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps({"q": key, "results": results}, ensure_ascii=False) + "\n")
        return results


def local_candidates(name: str, tables: dict) -> list[Candidate]:
    out = []
    q = set(expand(name))
    for source, table in tables.items():
        for entry in table.values():
            cs = set(expand(entry["name"]))
            if not cs:
                continue
            sim, kind = compare(name, entry["name"])
            if sim >= HEAD_SIMILARITY and (q <= cs or cs <= q or sim >= 0.85):
                out.append(Candidate(entry["name"], entry["lat"], entry["lon"], f"local:{source}", entry.get("kind", ""), sim,
                                     match=kind))
    return out


def geocoder_candidates(name: str, cache: GeocodeCache) -> list[Candidate]:
    out = []
    for q in query_variants(name):
        for r in cache.search(q):
            sim, kind = compare(name, r["name"])
            out.append(Candidate(r["name"], r["lat"], r["lon"], "nominatim", r.get("type", ""), sim, r.get("ref", ""), kind))
    return out


def neighbour_gaps(legs: list, placed: dict) -> dict[str, float]:
    gaps: dict[str, list[int]] = {}
    for n, gap in legs:
        if n in placed:
            gaps.setdefault(n, []).append(gap)
    return {n: statistics.median(g) for n, g in gaps.items()}


@dataclass
class Prior:
    lat: float
    lon: float
    radius_km: float
    neighbours: int


def speed_model(placed: dict, legs: dict) -> tuple[float, float]:
    logs = []
    for n, l in legs.items():
        if n in placed:
            for m, gap in neighbour_gaps(l, placed).items():
                d = haversine_m(*placed[n], *placed[m]) / 1000
                if d > 0.05:
                    logs.append(math.log(d / ((gap + 1) / 60)))
    if len(logs) < 20:
        return math.log(14.0), 0.5
    return statistics.fmean(logs), statistics.pstdev(logs) or 0.5


def expected_position(gaps: dict, placed: dict, model: tuple, step_deg: float = 0.01) -> Prior | None:
    if not gaps:
        return None
    mu, sd = model
    left, top, right, bottom = (float(v) for v in VIEWBOX.split(","))
    lats = [bottom + i * step_deg for i in range(int((top - bottom) / step_deg) + 1)]
    lons = [left + j * step_deg for j in range(int((right - left) / step_deg) + 1)]
    kx = 111.32 * math.cos(math.radians((top + bottom) / 2))
    nb = [(placed[n][0], placed[n][1], (g + 1) / 60) for n, g in gaps.items()]
    cells = []
    for la in lats:
        for lo in lons:
            ll = 0.0
            for pla, plo, hours in nb:
                d = max(math.hypot((la - pla) * 111.2, (lo - plo) * kx), 0.05)
                z = (math.log(d / hours) - mu) / sd
                ll += max(-0.5 * z * z, -8.0)
            cells.append((ll, la, lo))
    best = max(cells)
    weights = sorted((math.exp(ll - best[0]) for ll, _, _ in cells), reverse=True)
    total, acc, k = sum(weights), 0.0, 0
    while acc < total / 2:
        acc += weights[k]
        k += 1
    area = k * step_deg * 111.2 * step_deg * kx
    return Prior(best[1], best[2], math.sqrt(area / math.pi), len(gaps))


REGION_FACTOR = 1.5
REGION_MIN_KM = 2.0
REGION_MAX_KM = 12.0
REGION_MIN_SIMILARITY = 0.5


def region_box(prior: Prior) -> tuple[str, float]:
    r = min(max(prior.radius_km * REGION_FACTOR, REGION_MIN_KM), REGION_MAX_KM)
    dlat, dlon = r / 111.2, r / (111.32 * math.cos(math.radians(prior.lat)))
    return f"{prior.lon - dlon:.4f},{prior.lat + dlat:.4f},{prior.lon + dlon:.4f},{prior.lat - dlat:.4f}", r


def region_candidates(name: str, prior: Prior, tables: dict, cache: GeocodeCache) -> list[Candidate]:
    box, radius = region_box(prior)
    out = []
    q = set(expand(name))
    for source, table in tables.items():
        for e in table.values():
            d = haversine_m(prior.lat, prior.lon, e["lat"], e["lon"]) / 1000
            if d > radius:
                continue
            sim, kind = compare(name, e["name"])
            if sim >= REGION_MIN_SIMILARITY or (q & set(expand(e["name"]))):
                out.append(Candidate(e["name"], e["lat"], e["lon"], f"local:{source}", e.get("kind", ""), sim, match=kind, guide_km=d))
    if prior.radius_km <= REGION_MAX_KM:
        for q_ in dict.fromkeys(query_variants(name) + [w.title() for w in tokens(name) if len(w) >= 5][:1]):
            for r in cache.search(q_, box):
                d = haversine_m(prior.lat, prior.lon, r["lat"], r["lon"]) / 1000
                sim, kind = compare(name, r["name"])
                if d <= radius and sim >= REGION_MIN_SIMILARITY:
                    out.append(Candidate(r["name"], r["lat"], r["lon"], "nominatim-region", r.get("type", ""), sim, r.get("ref", ""), kind, guide_km=d))
    best: dict[tuple, Candidate] = {}
    for c in out:
        k = (round(c.lat, 3), round(c.lon, 3))
        if k not in best or c.similarity > best[k].similarity:
            best[k] = c
    return sorted(best.values(), key=lambda c: (-round(c.similarity, 1), c.guide_km))


def implied_kmh(c: Candidate, placed_pos: tuple, gap_min: float) -> float:
    return haversine_m(c.lat, c.lon, *placed_pos) / 1000 / ((gap_min + 1) / 60)


def accepts(c: Candidate) -> bool:
    n = c.neighbours_checked
    if not n or c.neighbours_ok != n or not (c.informative or n >= TRIANGULATE_MIN):
        return False
    if c.match == "full":
        return c.similarity >= STRONG_SIMILARITY or (c.similarity >= MIN_SIMILARITY and n >= 2)
    if c.match == "head":
        return n >= HEAD_MIN_NEIGHBOURS
    return c.similarity >= NEAR_IDENTICAL


def clusters_of(cands: list[Candidate]) -> list[list[Candidate]]:
    groups: list[list[Candidate]] = []
    for c in cands:
        near = [g for g in groups if any(haversine_m(c.lat, c.lon, m.lat, m.lon) / 1000 <= CLUSTER_KM for m in g)]
        merged = [c] + [m for g in near for m in g]
        groups = [g for g in groups if g not in near] + [merged]
    return groups


def medoid(members: list[Candidate]) -> Candidate:
    return min(members, key=lambda a: sum(haversine_m(a.lat, a.lon, b.lat, b.lon) for b in members))


def decide(name: str, candidates: list[Candidate], legs: list, placed: dict) -> Resolution:
    unique: dict[tuple, Candidate] = {}
    for c in candidates:
        key = (round(c.lat, 3), round(c.lon, 3))
        if key not in unique or c.similarity > unique[key].similarity:
            unique[key] = c
    cands = list(unique.values())
    if not cands:
        return Resolution(name, "none", note="no candidates")
    eligible = [c for c in cands if c.similarity >= HEAD_SIMILARITY]
    ranked = sorted(cands, key=lambda c: -c.similarity)
    if not eligible:
        return Resolution(name, "review", ranked[0], f"no candidate is named like it (best similarity {ranked[0].similarity:.2f})", ranked[:3])

    gaps = neighbour_gaps(legs, placed)
    speeds = {id(c): {n: implied_kmh(c, placed[n], g) for n, g in gaps.items()} for c in eligible}
    outliers = set()
    if len(eligible) >= 2 and len(gaps) >= OUTLIER_MIN_NEIGHBOURS:
        outliers = {n for n in gaps if all(speeds[id(c)][n] > MAX_KMH for c in eligible)}
    kept = [n for n in gaps if n not in outliers]
    for c in eligible:
        sp = [speeds[id(c)][n] for n in kept]
        c.neighbours_checked, c.neighbours_ok = len(sp), sum(v <= MAX_KMH for v in sp)
        c.worst_kmh = max(sp) if sp else 0.0
        c.informative = sum(1 for n in kept if MAX_KMH * (gaps[n] + 1) / 60 <= INFORMATIVE_KM)

    fits = [c for c in eligible if c.neighbours_checked and c.neighbours_ok == c.neighbours_checked]
    if not fits:
        best = max(eligible, key=lambda c: (c.neighbours_ok / c.neighbours_checked if c.neighbours_checked else -1, c.similarity))
        why = ("no placed neighbour to check against" if not best.neighbours_checked
               else f"best name match fails the timetable ({best.neighbours_ok}/{best.neighbours_checked} neighbours plausible)")
        return Resolution(name, "review", best, why, sorted(eligible, key=lambda c: -c.similarity)[:3])

    groups = clusters_of(fits)

    def worst(g):
        return statistics.median(c.worst_kmh for c in g)

    viable = [g for g in groups if any(accepts(c) for c in g)]
    if not viable:
        best = max(fits, key=lambda c: (c.similarity, c.neighbours_checked))
        need = HEAD_MIN_NEIGHBOURS if best.match == "head" else 2
        if not best.informative:
            why = (f"fits the timetable, but only {best.neighbours_checked} neighbour(s), none close enough in time to rule out "
                   f"a far-away namesake (needs one short leg or {TRIANGULATE_MIN}+ neighbours)")
        else:
            why = (f"fits the timetable, but the name evidence is too weak ({best.match} match, similarity {best.similarity:.2f}, "
                   f"{best.neighbours_checked} neighbours; needs {'a stronger name' if best.match == 'spelling' else str(need) + '+ neighbours'})")
        return Resolution(name, "review", best, why, sorted(fits, key=lambda c: -c.similarity)[:3])

    viable.sort(key=lambda g: (worst(g), -len(g)))
    top = viable[0]
    if len(groups) > 1 and max(c.neighbours_checked for c in top) < 2:
        return Resolution(name, "ambiguous", medoid(top), "several places fit and a single neighbour cannot tell them apart",
                          [medoid(g) for g in sorted(groups, key=lambda g: (worst(g), -len(g)))[:3]])
    for other in (g for g in groups if g is not top):
        margin = worst(other) - worst(top)
        if margin >= FIT_MARGIN_KMH or len(top) >= SIZE_DOMINANCE * len(other):
            continue
        return Resolution(name, "ambiguous", medoid(top), "several different places fit equally well",
                          [medoid(g) for g in sorted(groups, key=lambda g: (worst(g), -len(g)))[:3]])

    members = [c for c in top if accepts(c)]
    top_sim = max(c.similarity for c in members)
    contenders = [c for c in members if c.similarity >= top_sim - NAME_BAND]
    best_rank = min(c.rank for c in contenders)
    peers = [c for c in contenders if c.rank == best_rank]
    spread = max((haversine_m(a.lat, a.lon, b.lat, b.lon) for a in peers for b in peers), default=0.0) / 1000
    if spread > SAME_PLACE_KM:
        return Resolution(name, "ambiguous", medoid(peers), f"equally good candidates are {spread:.1f} km apart",
                          sorted(peers, key=lambda c: -c.similarity)[:3])
    best = medoid(peers)
    note = f"{best.neighbours_ok}/{best.neighbours_checked} neighbours plausible"
    if outliers:
        note += f"; ignored {len(outliers)} neighbour(s) implausible for every candidate"
    if len(groups) > 1:
        note += f"; chosen over {len(groups) - 1} other place(s) by timetable fit"
    if best.match == "head":
        note += "; head-of-name match (the timetable name is longer)"
    if best.neighbours_checked == 1:
        note += " (single neighbour: accepted on an exact-name match; worth a glance)"
    return Resolution(name, "auto", best, note, members[:3])


def resolve_all(names: list[str], legs: dict, placed: dict, tables: dict, cache: GeocodeCache) -> dict[str, Resolution]:
    placed = dict(placed)
    model = speed_model(placed, legs)
    cand = {n: local_candidates(n, tables) + geocoder_candidates(n, cache) for n in names}
    result: dict[str, Resolution] = {}
    pending = list(names)
    while True:
        progress = False
        for n in list(pending):
            res = decide(n, cand[n], legs.get(n, []), placed)
            result[n] = res
            if res.status == "auto":
                placed[n] = (res.best.lat, res.best.lon)
                pending.remove(n)
                progress = True
        if not progress:
            for n, res in result.items():
                res.prior = expected_position(neighbour_gaps(legs.get(n, []), placed), placed, model)
                if res.status != "auto" and res.prior:
                    res.in_region = region_candidates(n, res.prior, tables, cache)
                    if res.status == "none" and res.in_region:
                        res.status, res.best = "review", res.in_region[0]
                        res.note = "no candidate by name; suggestions are loosely-named features inside the timetable-only guide area"
            return result
