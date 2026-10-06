import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import JourneyResults from "../components/JourneyResults";
import MapView from "../components/MapView";
import PlaceSearch from "../components/PlaceSearch";
import { apiFetch, getToken } from "../lib/api";
import { buildLegs, summarise } from "../lib/journey";
import { DAYS, nowAsPlannerInput } from "../lib/time";

const fieldClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20";

export default function Home() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const location = useLocation();
    const [origin, setOrigin] = useState(null);
    const [destination, setDestination] = useState(null);
    const [{ day, time }, setWhen] = useState(nowAsPlannerInput);
    const [minimizeWalking, setMinimizeWalking] = useState(false);
    const [minimizeStops, setMinimizeStops] = useState(false);
    const [useDijkstra, setUseDijkstra] = useState(false);

    const [planning, setPlanning] = useState(false);
    const [journey, setJourney] = useState(null);
    const [message, setMessage] = useState(null);
    const [saving, setSaving] = useState(false);
    const planCtrl = useRef(null);

    const legs = useMemo(() => journey?.legs ?? [], [journey]);

    const plan = async (from, to) => {
        planCtrl.current?.abort();
        const ctrl = new AbortController();
        planCtrl.current = ctrl;

        const [hh, mm] = time.split(":").map(Number);
        const departure = day * 1440 + hh * 60 + mm;

        setPlanning(true);
        setMessage(null);
        try {
            const data = await apiFetch("/api/plan/", {
                method: "POST",
                signal: ctrl.signal,
                body: {
                    source_lat: from.lat,
                    source_lon: from.lon,
                    target_lat: to.lat,
                    target_lon: to.lon,
                    day,
                    time,
                    max_rounds: 5,
                    minimize_walking: minimizeWalking,
                    minimize_stops: minimizeStops,
                    use_dijkstra: useDijkstra,
                },
            });
            const pathObjs = data.path_objs || [];
            if (data.earliest_arrival == null || pathObjs.length === 0) {
                setJourney({ status: "none" });
                return;
            }
            const built = buildLegs(pathObjs, from, to);
            setJourney({
                status: "ok",
                legs: built,
                departure,
                arrival: data.earliest_arrival,
                summary: summarise(built, departure, data.earliest_arrival),
                algorithm: data.algorithm_used,
                areaRadius: data.area_radius_m,
            });
        } catch (err) {
            if (err.name === "AbortError") return;
            setJourney(null);
            setMessage({ text: err.message || "Could not reach the journey planner.", error: true });
        } finally {
            if (planCtrl.current === ctrl) setPlanning(false);
        }
    };

    const onSubmit = (e) => {
        e.preventDefault();
        if (!origin || !destination) {
            setMessage({ text: "Choose both a start and a destination from the suggestions.", error: true });
            return;
        }
        plan(origin, destination);
    };

    const swap = () => {
        setOrigin(destination);
        setDestination(origin);
        setJourney(null);
    };

    const save = async () => {
        if (!getToken()) {
            navigate("/login", { state: { from: location } });
            return;
        }
        setSaving(true);
        try {
            await apiFetch("/api/saved-routes/", {
                method: "POST",
                auth: true,
                body: { start_location: origin.label, end_location: destination.label },
            });
            setMessage({ text: "Route saved.", error: false });
        } catch (err) {
            setMessage({ text: err.message, error: true });
        } finally {
            setSaving(false);
        }
    };

    const handledDeepLink = useRef(false);
    useEffect(() => {
        const from = params.get("from");
        const to = params.get("to");
        if (!from || !to || handledDeepLink.current) return;
        handledDeepLink.current = true;
        (async () => {
            try {
                const top = async (q) => (await apiFetch(`/api/geocode/?q=${encodeURIComponent(q)}`))[0];
                const [a, b] = await Promise.all([top(from), top(to)]);
                if (!a || !b) throw new Error("Could not find one of the saved locations.");
                setOrigin(a);
                setDestination(b);
                plan(a, b);
            } catch (err) {
                setMessage({ text: err.message, error: true });
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => () => planCtrl.current?.abort(), []);

    return (
        <AppShell>
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-slate-200 bg-slate-50 p-4 lg:w-[24rem] lg:border-r">
                    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <PlaceSearch label="From" placeholder="Address or place" value={origin} onChange={setOrigin} allowLocate />
                        <div className="-my-1 flex justify-center">
                            <button
                                type="button"
                                onClick={swap}
                                aria-label="Swap start and destination"
                                className="rounded-full border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
                            >
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
                                </svg>
                            </button>
                        </div>
                        <PlaceSearch label="To" placeholder="Address or place" value={destination} onChange={setDestination} />

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label htmlFor="day" className="mb-1 block text-xs font-medium text-slate-600">Day</label>
                                <select id="day" className={fieldClass} value={day} onChange={(e) => setWhen((w) => ({ ...w, day: Number(e.target.value) }))}>
                                    {DAYS.map((d, i) => (
                                        <option key={d} value={i}>{d}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="time" className="mb-1 block text-xs font-medium text-slate-600">Depart at</label>
                                <input id="time" type="time" required className={fieldClass} value={time} onChange={(e) => setWhen((w) => ({ ...w, time: e.target.value }))} />
                            </div>
                        </div>

                        <details className="group rounded-lg border border-slate-200 px-3 py-2">
                            <summary className="cursor-pointer text-sm font-medium text-slate-700">Options</summary>
                            <div className="mt-3 flex flex-col gap-2 text-sm text-slate-700">
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" className="accent-blue-600" checked={minimizeWalking} onChange={(e) => setMinimizeWalking(e.target.checked)} />
                                    Minimise walking
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" className="accent-blue-600" checked={minimizeStops} onChange={(e) => setMinimizeStops(e.target.checked)} />
                                    Fewer transfers
                                </label>
                                <fieldset className="mt-1">
                                    <legend className="mb-1 text-xs font-medium text-slate-600">Algorithm</legend>
                                    <div className="inline-flex rounded-lg border border-slate-300 p-0.5">
                                        {[["RAPTOR", false], ["Dijkstra", true]].map(([name, value]) => (
                                            <button
                                                key={name}
                                                type="button"
                                                aria-pressed={useDijkstra === value}
                                                onClick={() => setUseDijkstra(value)}
                                                className={`rounded-md px-3 py-1 text-xs font-medium ${
                                                    useDijkstra === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                                                }`}
                                            >
                                                {name}
                                            </button>
                                        ))}
                                    </div>
                                </fieldset>
                            </div>
                        </details>

                        <button
                            type="submit"
                            disabled={planning}
                            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600/40 disabled:opacity-60"
                        >
                            {planning ? "Finding routes…" : "Find route"}
                        </button>
                    </form>

                    {message && (
                        <p
                            role="status"
                            className={`rounded-lg border px-3 py-2 text-sm ${
                                message.error
                                    ? "border-red-200 bg-red-50 text-red-800"
                                    : "border-emerald-200 bg-emerald-50 text-emerald-800"
                            }`}
                        >
                            {message.text}
                        </p>
                    )}

                    {journey && <JourneyResults journey={journey} onSave={save} saving={saving} signedIn={Boolean(getToken())} />}
                </aside>

                <div className="min-h-[50vh] flex-1 lg:min-h-0">
                    <MapView origin={origin} destination={destination} legs={legs} areaRadius={journey?.areaRadius} />
                </div>
            </div>
        </AppShell>
    );
}
