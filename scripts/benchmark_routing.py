import argparse
import csv
import io
import json
import random
import shutil
import signal
import statistics
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
GTFS = str(ROOT / "data" / "gtfs") + "/"

SLOTS = [
    ("Mon 07:30", 0, 450),
    ("Mon 12:00", 0, 720),
    ("Mon 17:30", 0, 1050),
    ("Wed 21:00", 2, 1260),
    ("Sat 10:00", 5, 600),
    ("Sun 14:00", 6, 840),
]


def make_queries(count: int, seed: int, min_distance: float = 2000) -> List[Dict[str, Any]]:
    sys.path.insert(0, str(ROOT))
    from algorithm_prototype.raptor import helper_functions as hf

    with open(GTFS + "stops.txt", newline="", encoding="utf-8-sig") as f:
        stops = [(float(r["stop_lat"]), float(r["stop_lon"])) for r in csv.DictReader(f) if r["stop_lat"]]

    rng = random.Random(seed)
    queries = []
    while len(queries) < count:
        a, b = rng.choice(stops), rng.choice(stops)
        a = (a[0] + rng.uniform(-0.001, 0.001), a[1] + rng.uniform(-0.001, 0.001))
        b = (b[0] + rng.uniform(-0.001, 0.001), b[1] + rng.uniform(-0.001, 0.001))
        distance = hf.haversine(a[0], a[1], b[0], b[1])
        if distance < min_distance:
            continue
        label, day, minute = rng.choice(SLOTS)
        queries.append(
            {
                "label": label,
                "from": a,
                "to": b,
                "departure": day * 1440 + minute,
                "straight_m": round(distance),
            }
        )
    return queries


def find_baseline() -> str:
    removed = subprocess.run(
        ["git", "-C", str(ROOT), "log", "-1", "--diff-filter=D", "--format=%H", "--", "algorithm_prototype/dijkstra.py"],
        check=True,
        stdout=subprocess.PIPE,
        text=True,
    ).stdout.strip()
    if not removed:
        raise RuntimeError("no commit in this history removed algorithm_prototype/dijkstra.py")
    return removed + "^"


def export_baseline(ref: str, dest: Path) -> Path:
    archive = subprocess.run(
        ["git", "-C", str(ROOT), "archive", ref, "algorithm_prototype", "src/backend/api"],
        check=True,
        stdout=subprocess.PIPE,
    ).stdout
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(dest, filter="data")
    return dest


def make_fair_copy(baseline: Path, dest: Path) -> Path:
    shutil.copytree(baseline, dest)
    path = dest / "algorithm_prototype" / "dijkstra.py"
    source = path.read_text()

    changes = [
        ("import sys\n", "import sys\nimport heapq\nimport itertools\n"),
        (
            "    while unvisited:\n"
            "        # Find unvisited node with minimum distance (standard Dijkstra approach)\n"
            "        current_node = min(unvisited.keys(), key=lambda n: unvisited[n])\n"
            "        current_cost = unvisited[current_node]\n",
            "    heap = [(departure_time, 0, start_node)]\n"
            "    counter = itertools.count(1)\n"
            "    while heap:\n"
            "        current_cost, _, current_node = heapq.heappop(heap)\n"
            "        if current_node in visited or unvisited.get(current_node) != current_cost:\n"
            "            continue\n",
        ),
        (
            "        for to_stop_id, walk_time in transfer_map.get(current_node.stop_id, []):",
            "        walk_options = [] if states[current_node].mode == 'transfer' else transfer_map.get(current_node.stop_id, [])\n"
            "        for to_stop_id, walk_time in walk_options:",
        ),
        (
            "                unvisited[new_node] = new_cost\n",
            "                unvisited[new_node] = new_cost\n"
            "                heapq.heappush(heap, (new_cost, next(counter), new_node))\n",
        ),
        (
            "                        unvisited[trip_node] = new_cost\n",
            "                        unvisited[trip_node] = new_cost\n"
            "                        heapq.heappush(heap, (new_cost, next(counter), trip_node))\n",
        ),
    ]
    for old, new in changes:
        if old not in source:
            raise RuntimeError(f"baseline dijkstra.py has changed, cannot find: {old[:60]!r}")
        source = source.replace(old, new, 1)
    path.write_text(source)
    return dest


class Slow(Exception):
    pass


def run_worker(root: Path, mode: str, queries: List[Dict[str, Any]], timeout: float) -> Dict[str, Any]:
    sys.path[:0] = [str(root), str(root / "src" / "backend")]
    from django.conf import settings

    settings.configure(GTFS_FOLDER=GTFS)
    import api.raptor_engine as engine_module

    spent = {"search": 0.0, "prepare": 0.0}

    def timed(name: str, key: str) -> None:
        function = getattr(engine_module, name, None)
        if function is None:
            return

        def wrapper(*args, **kwargs):
            start = time.perf_counter()
            try:
                return function(*args, **kwargs)
            finally:
                spent[key] += time.perf_counter() - start

        setattr(engine_module, name, wrapper)

    timed("raptor_algo", "search")
    timed("dijkstra_algo", "search")
    timed("prepare_network", "prepare")

    def give_up(signum, frame):
        raise Slow()

    signal.signal(signal.SIGALRM, give_up)

    start = time.perf_counter()
    engine = engine_module.RaptorEngine(GTFS)
    engine.load()
    load_seconds = time.perf_counter() - start

    options = {"use_dijkstra": True} if mode == "dijkstra" else {}

    def plan(q: Dict[str, Any]) -> Dict[str, Any]:
        return engine.plan(q["from"][0], q["from"][1], q["to"][0], q["to"][1], q["departure"], **options)

    for q in queries[:3]:
        try:
            signal.setitimer(signal.ITIMER_REAL, timeout)
            plan(q)
        except Slow:
            pass
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)

    records = []
    for i, q in enumerate(queries):
        spent["search"] = spent["prepare"] = 0.0
        record: Dict[str, Any] = {"label": q["label"], "straight_m": q["straight_m"]}
        start = time.perf_counter()
        try:
            signal.setitimer(signal.ITIMER_REAL, timeout)
            out = plan(q)
            record["total"] = time.perf_counter() - start
            record["arrival"] = out.get("earliest_arrival")
        except Slow:
            record["total"] = time.perf_counter() - start
            record["timeout"] = True
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
        record["search"] = spent["search"]
        record["prepare"] = spent["prepare"]
        records.append(record)
        if (i + 1) % 10 == 0:
            print(f"  {mode}: {i + 1}/{len(queries)} journeys", file=sys.stderr, flush=True)

    return {"load_seconds": load_seconds, "records": records}


def percentile(values: List[float], q: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def summarise(results: Dict[str, Dict[str, Any]]) -> None:
    print(f"\n{'variant':18} {'journeys':>8} {'timeouts':>8} {'median ms':>10} {'p95 ms':>9} {'max ms':>9} {'search ms':>10} {'prepare ms':>10}")
    for name, data in results.items():
        done = [r for r in data["records"] if not r.get("timeout")]
        totals = [r["total"] * 1000 for r in done]
        print(
            f"{name:18} {len(data['records']):8d} {len(data['records']) - len(done):8d} "
            f"{statistics.median(totals):10.1f} {percentile(totals, 0.95):9.1f} {max(totals):9.1f} "
            f"{statistics.median([r['search'] * 1000 for r in done]):10.1f} "
            f"{statistics.median([r['prepare'] * 1000 for r in done]):10.1f}"
        )

    print()
    pairs = [
        ("dijkstra_as_was", "raptor_current"),
        ("dijkstra_fair", "raptor_current"),
        ("raptor_baseline", "raptor_current"),
    ]
    for slow, fast in pairs:
        if slow not in results or fast not in results:
            continue
        ratios, same, compared = [], 0, 0
        for a, b in zip(results[slow]["records"], results[fast]["records"]):
            if a.get("timeout") or b.get("timeout"):
                continue
            ratios.append(a["total"] / b["total"])
            compared += 1
            same += a.get("arrival") == b.get("arrival")
        print(
            f"{slow} vs {fast}: {statistics.median(ratios):.1f}x slower (median per journey), "
            f"same arrival {same}/{compared}"
        )


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="Time the journey planner against the old Dijkstra planner.")
    parser.add_argument("--queries", type=int, default=120, help="journeys to time")
    parser.add_argument("--seed", type=int, default=20261009, help="seed for picking the journeys")
    parser.add_argument("--baseline-ref", help="commit holding the old Dijkstra (default: the one before it was removed)")
    parser.add_argument("--dijkstra-queries", type=int, default=40, help="journeys for the slow, unchanged Dijkstra")
    parser.add_argument("--timeout", type=float, default=60, help="seconds before one journey is given up")
    parser.add_argument("--skip-dijkstra", action="store_true", help="time only the current planner")
    parser.add_argument("--output", help="write the raw results here as JSON")
    parser.add_argument("--worker", help=argparse.SUPPRESS)
    parser.add_argument("--root", help=argparse.SUPPRESS)
    parser.add_argument("--queries-file", help=argparse.SUPPRESS)
    parser.add_argument("--result-file", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    if args.worker:
        queries = json.loads(Path(args.queries_file).read_text())[: args.queries]
        result = run_worker(Path(args.root), args.worker, queries, args.timeout)
        Path(args.result_file).write_text(json.dumps(result))
        return

    queries = make_queries(args.queries, args.seed)
    print(f"{len(queries)} journeys, seed {args.seed}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        queries_file = tmp_path / "queries.json"
        queries_file.write_text(json.dumps(queries))

        variants: List[Tuple[str, Path, str, int]] = []
        if not args.skip_dijkstra:
            baseline = export_baseline(args.baseline_ref or find_baseline(), tmp_path / "baseline")
            fair = make_fair_copy(baseline, tmp_path / "fair")
            variants += [
                ("dijkstra_as_was", baseline, "dijkstra", args.dijkstra_queries),
                ("dijkstra_fair", fair, "dijkstra", args.queries),
                ("raptor_baseline", baseline, "raptor", args.queries),
            ]
        variants.append(("raptor_current", ROOT, "raptor", args.queries))

        results = {}
        for name, folder, mode, count in variants:
            print(f"timing {name} ({count} journeys)", file=sys.stderr, flush=True)
            result_file = tmp_path / f"{name}.json"
            subprocess.run(
                [
                    sys.executable, str(Path(__file__).resolve()),
                    "--worker", mode,
                    "--root", str(folder),
                    "--queries-file", str(queries_file),
                    "--result-file", str(result_file),
                    "--timeout", str(args.timeout),
                    "--queries", str(count),
                ],
                check=True,
            )
            data = json.loads(result_file.read_text())
            data["records"] = data["records"][:count]
            results[name] = data

    summarise(results)
    if args.output:
        Path(args.output).write_text(json.dumps(results))


if __name__ == "__main__":
    main()
