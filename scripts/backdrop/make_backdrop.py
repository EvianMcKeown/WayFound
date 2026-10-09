import argparse
import json
import math
import struct
import urllib.parse
import urllib.request
import zlib
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

DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
DEM_ZOOM = 12
CONTOUR_STEP = 50
INDEX_STEP = 250
CONTOUR_WIDTH, INDEX_WIDTH = 0.7, 1.3
MIN_CONTOUR = 30


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
        headers={"User-Agent": "WayFound-backdrop/1.0"},
    )
    with urllib.request.urlopen(req, timeout=360) as r:
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
        f"<!-- {note} -->\n"
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
    return svg(body, "Data (c) OpenStreetMap contributors, ODbL.")


def read_png(data):
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos, idat, palette = 8, [], None
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos : pos + 8])
        body = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
        elif kind == b"PLTE":
            palette = [tuple(body[i : i + 3]) for i in range(0, len(body), 3)]
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            break
    assert depth == 8 and interlace == 0 and ctype in (2, 3, 6), f"unsupported PNG ({depth=}, {ctype=}, {interlace=})"
    bpp = {2: 3, 3: 1, 6: 4}[ctype]
    stride = width * bpp
    raw = zlib.decompress(b"".join(idat))
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(height):
        f, line = raw[i], bytearray(raw[i + 1 : i + 1 + stride])
        i += 1 + stride
        if f == 1:
            for k in range(bpp, stride):
                line[k] = (line[k] + line[k - bpp]) & 255
        elif f == 2:
            for k in range(stride):
                line[k] = (line[k] + prev[k]) & 255
        elif f == 3:
            for k in range(stride):
                line[k] = (line[k] + ((line[k - bpp] if k >= bpp else 0) + prev[k]) // 2) & 255
        elif f == 4:
            for k in range(stride):
                a = line[k - bpp] if k >= bpp else 0
                b, c = prev[k], (prev[k - bpp] if k >= bpp else 0)
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[k] = (line[k] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    if ctype == 3:
        return [[palette[v] for v in row] for row in rows]
    return [[tuple(row[k : k + 3]) for k in range(0, stride, bpp)] for row in rows]


def tile_pixel(lon, lat):
    size = 256 * 2**DEM_ZOOM
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2
    return ((lon + 180) / 360 * size, y * size)


def pixel_lonlat(x, y):
    size = 256 * 2**DEM_ZOOM
    return (x / size * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / size)))))


def fetch_tile(x, y, cache):
    path = cache / f"{DEM_ZOOM}-{x}-{y}.png" if cache else None
    if path and path.exists():
        return path.read_bytes()
    req = urllib.request.Request(DEM_URL.format(z=DEM_ZOOM, x=x, y=y), headers={"User-Agent": "WayFound-backdrop/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    if path:
        path.write_bytes(data)
    return data


def elevation_grid(cache):
    margin = 4
    x0, y0 = tile_pixel(w, n)
    x1, y1 = tile_pixel(e, s)
    gx0, gy0 = math.floor(x0) - margin, math.floor(y0) - margin
    gx1, gy1 = math.ceil(x1) + margin, math.ceil(y1) + margin
    tiles = {}
    for ty in range(gy0 // 256, gy1 // 256 + 1):
        for tx in range(gx0 // 256, gx1 // 256 + 1):
            tiles[tx, ty] = read_png(fetch_tile(tx, ty, cache))
    grid = []
    for gy in range(gy0, gy1 + 1):
        row = []
        for gx in range(gx0, gx1 + 1):
            r, g, b = tiles[gx // 256, gy // 256][gy % 256][gx % 256]
            row.append(r * 256 + g + b / 256 - 32768)
        grid.append(row)
    return grid, gx0, gy0


def smooth(grid, passes=3):
    for _ in range(passes):
        grid = [[(r[max(c - 1, 0)] + r[c] + r[min(c + 1, len(r) - 1)]) / 3 for c in range(len(r))] for r in grid]
        h = len(grid)
        grid = [
            [(grid[max(i - 1, 0)][c] + grid[i][c] + grid[min(i + 1, h - 1)][c]) / 3 for c in range(len(grid[i]))]
            for i in range(h)
        ]
    return grid


def contour_lines(grid):
    h, wd = len(grid), len(grid[0])
    by_level = {}
    for r in range(h - 1):
        top, bottom = grid[r], grid[r + 1]
        for c in range(wd - 1):
            v = (top[c], top[c + 1], bottom[c + 1], bottom[c])
            lo, hi = min(v), max(v)
            for k in range(max(1, math.ceil(lo / CONTOUR_STEP)), math.ceil(hi / CONTOUR_STEP)):
                by_level.setdefault(k * CONTOUR_STEP, []).append((r, c))
    out = {}
    for level, cells in sorted(by_level.items()):
        adj = {}

        def link(a, b):
            adj.setdefault(a, []).append(b)
            adj.setdefault(b, []).append(a)

        for r, c in cells:
            tl, tr, br, bl = grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]
            up = (tl > level, tr > level, br > level, bl > level)
            t, b = 2 * (r * wd + c), 2 * ((r + 1) * wd + c)
            l, rt = t + 1, 2 * (r * wd + c + 1) + 1
            sides = {0: (t, l), 1: (t, rt), 2: (b, rt), 3: (b, l)}
            crossed = [e for e, (p, q) in ((t, (0, 1)), (rt, (1, 2)), (b, (3, 2)), (l, (0, 3))) if up[p] != up[q]]
            if len(crossed) == 2:
                link(*crossed)
            else:
                centre_up = (tl + tr + br + bl) / 4 > level
                for corner in range(4):
                    if up[corner] != centre_up:
                        link(*sides[corner])

        def at(edge):
            cell, vertical = divmod(edge, 2)
            r, c = divmod(cell, wd)
            r2, c2 = (r + 1, c) if vertical else (r, c + 1)
            va, vb = grid[r][c], grid[r2][c2]
            t = (level - va) / (vb - va)
            return (c + t * (c2 - c), r + t * (r2 - r))

        seen, lines = set(), []
        for start in [k for k, v in adj.items() if len(v) == 1] + list(adj):
            if start in seen:
                continue
            chain, cur = [start], start
            seen.add(start)
            while (nxt := next((k for k in adj[cur] if k not in seen), None)) is not None:
                chain.append(nxt)
                seen.add(nxt)
                cur = nxt
            if len(chain) > 2 and start in adj[cur]:
                chain.append(start)
            lines.append([at(k) for k in chain])
        out[level] = lines
    return out


def contours_svg(cache):
    grid, gx0, gy0 = elevation_grid(cache)
    lines = contour_lines(smooth(grid))
    regular, index = [], []
    for level, polylines in lines.items():
        for line in polylines:
            pts = [project(*pixel_lonlat(gx0 + c + 0.5, gy0 + r + 0.5)) for c, r in line]
            length = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
            if pts[0] == pts[-1] and length < MIN_CONTOUR:
                continue
            (index if level % INDEX_STEP == 0 else regular).append(simplify(pts, 0.5))
    body = "\n".join(
        f'<path d="{path_data(group)}" fill="none" stroke="#000" stroke-width="{width}" stroke-linejoin="round"/>'
        for group, width in ((regular, CONTOUR_WIDTH), (index, INDEX_WIDTH))
        if group
    )
    return svg(
        body,
        "Elevation: SRTM (NASA/USGS), via the Mapzen terrain tiles.",
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--roads", help="a saved Overpass response (JSON) instead of fetching")
    ap.add_argument("--tiles", help="a folder to cache the terrain tiles in (read from it when they're there)")
    args = ap.parse_args()
    cache = Path(args.tiles) if args.tiles else None
    if cache:
        cache.mkdir(parents=True, exist_ok=True)
    roads = json.loads(Path(args.roads).read_text(encoding="utf-8")) if args.roads else fetch_roads()
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in (("contours.svg", contours_svg(cache)), ("roads.svg", roads_svg(roads))):
        (OUT / name).write_text(text, encoding="utf-8")
        print(f"wrote {OUT / name} ({len(text.encode()) // 1024} KB)")


if __name__ == "__main__":
    main()
