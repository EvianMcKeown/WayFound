import argparse
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "frontend" / "public" / "backdrop"

BBOX = (-34.06, 18.34, -33.84, 18.68)
WIDTH = 3200

ROAD_CLASSES = {
    "motorway": 6.4,
    "trunk": 5.2,
    "primary": 4.0,
    "secondary": 3.0,
    "tertiary": 2.2,
    "unclassified": 1.4,
    "residential": 1.4,
    "living_street": 1.4,
    "road": 1.4,
    "service": 0.9,
}
LINKS = {f"{c}_link": c for c in ("motorway", "trunk", "primary", "secondary", "tertiary")}
TRIP = {
    "source_lat": -33.978, "source_lon": 18.57, "target_lat": -33.9025, "target_lon": 18.4207,
    "day": 1, "time": "08:00", "max_rounds": 5, "minimize_walking": False, "minimize_stops": False,
    "use_dijkstra": False, "exclude_modes": [], "exclude_lines": [],
}


def fetch_roads():
    s, w, n, e = BBOX
    classes = "|".join([*ROAD_CLASSES, *LINKS])
    query = (
        f'[out:json][timeout:180];way["highway"~"^({classes})$"]["service"!~"^(driveway|parking_aisle|drive-through)$"]'
        f'["area"!="yes"]({s},{w},{n},{e});out geom qt;'
    )
    req = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=urllib.parse.urlencode({"data": query}).encode(),
        headers={"User-Agent": "WayFound-backdrop/1.0 (student project)"},
    )
    with urllib.request.urlopen(req, timeout=360) as r:
        return json.load(r)


def fetch_route():
    req = urllib.request.Request(
        "http://127.0.0.1:8000/api/plan/", data=json.dumps(TRIP).encode(), headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


s, w, n, e = BBOX
KX = math.cos(math.radians((s + n) / 2))
SCALE = WIDTH / ((e - w) * KX)
HEIGHT = round((n - s) * SCALE)


def project(lon, lat):
    return ((lon - w) * KX * SCALE, (n - lat) * SCALE)


def segment_distance(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    t = 0.0 if length2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(points, tol):
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        far, index = -1.0, None
        for i in range(first + 1, last):
            d = segment_distance(points[i], points[first], points[last])
            if d > far:
                far, index = d, i
        if index is not None and far > tol:
            keep[index] = True
            stack += [(first, index), (index, last)]
    return [p for p, k in zip(points, keep) if k]


def path_data(lines):
    out = []
    for line in lines:
        pts = [(round(x), round(y)) for x, y in line]
        pts = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
        if len(pts) < 2:
            continue
        steps = "".join(f"{x - px} {y - py}".replace(" -", "-") + " " for (px, py), (x, y) in zip(pts, pts[1:]))
        out.append(f"M{pts[0][0]} {pts[0][1]}l{steps.strip()}")
    return "".join(out)


def join_lines(lines):
    lines = [list(l) for l in lines if len(l) > 1]
    key = lambda p: (round(p[0]), round(p[1]))
    ends = {}
    for i, l in enumerate(lines):
        ends.setdefault(key(l[0]), []).append(i)
        ends.setdefault(key(l[-1]), []).append(i)
    used, out = set(), []
    for i, l in enumerate(lines):
        if i in used:
            continue
        used.add(i)
        chain = l
        for forward in (True, False):
            while True:
                tip = key(chain[-1] if forward else chain[0])
                nxt = next((j for j in ends.get(tip, []) if j not in used), None)
                if nxt is None:
                    break
                used.add(nxt)
                seg = lines[nxt]
                if forward:
                    chain = chain + (seg[1:] if key(seg[0]) == tip else seg[::-1][1:])
                else:
                    chain = (seg[:-1] if key(seg[-1]) == tip else seg[::-1][:-1]) + chain
        out.append(chain)
    return out


def svg(body, note):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" preserveAspectRatio="xMidYMid slice">\n'
        f"<!-- {note} Made by scripts/backdrop/make_backdrop.py; used as a CSS mask, so the colour is the page's. -->\n"
        f"{body}\n</svg>\n"
    )


def roads_svg(data):
    by_class = {k: [] for k in ROAD_CLASSES}
    for el in data["elements"]:
        cls = el.get("tags", {}).get("highway")
        cls = LINKS.get(cls, cls)
        if cls in by_class and el.get("geometry"):
            pts = [project(p["lon"], p["lat"]) for p in el["geometry"]]
            by_class[cls].append(pts)
    by_class = {cls: [simplify(l, 0.75) for l in join_lines(lines)] for cls, lines in by_class.items()}
    body = "\n".join(
        f'<path d="{path_data(lines)}" fill="none" stroke="#000" stroke-width="{ROAD_CLASSES[cls]}" '
        f'stroke-linecap="round" stroke-linejoin="round"/>'
        for cls, lines in reversed(list(by_class.items()))
        if lines
    )
    return svg(body, "The road network of central Cape Town. Data (c) OpenStreetMap contributors, ODbL.")


def route_svg(data):
    rides, walks, stops = [], [], []

    def at(stop):
        return project(stop["lon"], stop["lat"]) if stop and stop.get("lat") is not None else None

    for step in data["path_objs"]:
        if step["mode"] == "trip":
            pts = [project(lon, lat) for lon, lat in step.get("shape") or []]
            if len(pts) < 2:
                pts = [p for p in (at(step.get("from_stop")), at(step.get("stop"))) if p]
            rides.append(pts)
            stops += [at(x) for x in step.get("stops_along") or []]
            stops += [pts[0], pts[-1]]
        elif step["mode"] == "transfer":
            pts = [p for p in (at(step.get("from_stop")), at(step.get("stop"))) if p]
            if len(pts) == 2:
                walks.append(pts)
    dots = "".join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="9"/>' for x, y in dict.fromkeys(p for p in stops if p))
    body = (
        f'<path d="{path_data(rides)}" fill="none" stroke="#000" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>\n'
        f'<path d="{path_data(walks)}" fill="none" stroke="#000" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 14"/>\n'
        f"<g>{dots}</g>"
    )
    return svg(body, "A WayFound trip: Gugulethu to the V&amp;A Waterfront by Golden Arrow, Metrorail and MyCiTi.")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--roads", help="a saved Overpass response (JSON) instead of fetching")
    ap.add_argument("--route", help="a saved /api/plan/ response (JSON) instead of asking the local backend")
    args = ap.parse_args()
    roads = json.loads(Path(args.roads).read_text(encoding="utf-8")) if args.roads else fetch_roads()
    route = json.loads(Path(args.route).read_text(encoding="utf-8")) if args.route else fetch_route()
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in (("roads.svg", roads_svg(roads)), ("route.svg", route_svg(route))):
        (OUT / name).write_text(text, encoding="utf-8")
        print(f"wrote {OUT / name} ({len(text.encode()) // 1024} KB)")


if __name__ == "__main__":
    main()
