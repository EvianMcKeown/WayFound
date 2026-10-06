import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import AppShell, { HEADER_HEIGHT_PX } from "../components/AppShell";
import JourneyResults from "../components/JourneyResults";
import MapView from "../components/MapView";
import PlaceSearch from "../components/PlaceSearch";
import { apiFetch } from "../lib/api";
import { useSession } from "../lib/auth";
import { buildLegs, summarise } from "../lib/journey";
import { readPlannerLink } from "../lib/plannerLink";
import { DAYS, nowAsPlannerInput } from "../lib/time";
import {
    alertClass,
    buttonClass,
    fieldClass,
    labelClass,
    panelClass,
    segmentClass,
    segmentGroupClass,
} from "../lib/ui";

const OVERLAY_QUERY = "(min-width: 1024px)";
const PANEL_WIDTH_PX = 384;

function useMediaQuery(query) {
    const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
        const mq = window.matchMedia(query);
        const onChange = () => setMatches(mq.matches);
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, [query]);
    return matches;
}

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
    const session = useSession();
    const optionsTouched = useRef(false);

    const [planning, setPlanning] = useState(false);
    const [journey, setJourney] = useState(null);
    const [message, setMessage] = useState(null);
    const [saving, setSaving] = useState(false);
    const [savedId, setSavedId] = useState(null);
    const planCtrl = useRef(null);
    const overlay = useMediaQuery(OVERLAY_QUERY);

    const legs = useMemo(() => journey?.legs ?? [], [journey]);

    const plan = async (from, to) => {
        planCtrl.current?.abort();
        const ctrl = new AbortController();
        planCtrl.current = ctrl;

        const [hh, mm] = time.split(":").map(Number);
        const departure = day * 1440 + hh * 60 + mm;

        const request = {
            origin: from,
            destination: to,
            day,
            time,
            minimize_walking: minimizeWalking,
            minimize_stops: minimizeStops,
            use_dijkstra: useDijkstra,
        };

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
                setJourney({ status: "none", request });
                return;
            }
            const built = buildLegs(pathObjs, from, to);
            setSavedId(null);
            setJourney({
                status: "ok",
                legs: built,
                departure,
                arrival: data.earliest_arrival,
                summary: summarise(built, departure, data.earliest_arrival),
                algorithm: data.algorithm_used,
                areaRadius: data.area_radius_m,
                request,
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

    useEffect(() => {
        if (!session) return;
        let cancelled = false;
        apiFetch("/api/preferences/", { auth: true })
            .then((p) => {
                if (cancelled || optionsTouched.current) return;
                setMinimizeWalking(Boolean(p.minimize_walking));
                setMinimizeStops(Boolean(p.minimize_stops));
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [session?.username]); // eslint-disable-line react-hooks/exhaustive-deps

    const setOption = (setter) => (e) => {
        optionsTouched.current = true;
        setter(e.target.checked);
    };

    const save = async () => {
        if (!session) {
            navigate("/login", { state: { from: location } });
            return;
        }
        setSaving(true);
        try {
            const { request } = journey;
            const saved = await apiFetch("/api/saved-routes/", {
                method: "POST",
                auth: true,
                body: {
                    start_location: request.origin.label,
                    end_location: request.destination.label,
                    origin_lat: request.origin.lat,
                    origin_lon: request.origin.lon,
                    dest_lat: request.destination.lat,
                    dest_lon: request.destination.lon,
                },
            });
            setSavedId(saved.id);
        } catch (err) {
            setMessage({ text: err.message, error: true });
        } finally {
            setSaving(false);
        }
    };

    const handledDeepLink = useRef(false);
    useEffect(() => {
        const link = readPlannerLink(params);
        if (!link || handledDeepLink.current) return;
        handledDeepLink.current = true;
        if (link.places) {
            const [a, b] = link.places;
            setOrigin(a);
            setDestination(b);
            plan(a, b);
            return;
        }
        (async () => {
            try {
                const top = async (q) => (await apiFetch(`/api/geocode/?q=${encodeURIComponent(q)}`))[0];
                const [a, b] = await Promise.all(link.text.map(top));
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
        <AppShell overlayHeader>
            <div className="relative flex min-h-0 flex-1 flex-col">
                <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto bg-mist-50 p-4 lg:absolute lg:left-0 lg:top-16 lg:z-10 lg:max-h-[calc(100%-4rem)] lg:w-[24rem] lg:bg-transparent lg:[direction:rtl] lg:[&>*]:[direction:ltr]">
                    <form onSubmit={onSubmit} className={`pointer-events-auto flex flex-col gap-3 rounded-2xl p-4 ${panelClass}`}>
                        <PlaceSearch label="From" placeholder="Address or place" value={origin} onChange={setOrigin} allowLocate />
                        <div className="-my-1 flex justify-center">
                            <button
                                type="button"
                                onClick={swap}
                                aria-label="Swap start and destination"
                                className={buttonClass("secondary", "icon")}
                            >
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
                                </svg>
                            </button>
                        </div>
                        <PlaceSearch label="To" placeholder="Address or place" value={destination} onChange={setDestination} />

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label htmlFor="day" className={labelClass}>Day</label>
                                <select id="day" className={fieldClass} value={day} onChange={(e) => setWhen((w) => ({ ...w, day: Number(e.target.value) }))}>
                                    {DAYS.map((d, i) => (
                                        <option key={d} value={i}>{d}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="time" className={labelClass}>Depart at</label>
                                <input id="time" type="time" required className={fieldClass} value={time} onChange={(e) => setWhen((w) => ({ ...w, time: e.target.value }))} />
                            </div>
                        </div>

                        <details className="group rounded-lg border border-mist-300/70 px-3 py-2">
                            <summary className="cursor-pointer text-sm font-medium text-mist-700">Options</summary>
                            <div className="mt-3 flex flex-col gap-2 text-sm text-mist-700">
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" className="accent-brand-700" checked={minimizeWalking} onChange={setOption(setMinimizeWalking)} />
                                    Minimise walking
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" className="accent-brand-700" checked={minimizeStops} onChange={setOption(setMinimizeStops)} />
                                    Fewer transfers
                                </label>
                                <fieldset className="mt-1">
                                    <legend className="mb-1 text-xs font-medium text-mist-600">Algorithm</legend>
                                    <div className={segmentGroupClass}>
                                        {[["RAPTOR", false], ["Dijkstra", true]].map(([name, value]) => (
                                            <button
                                                key={name}
                                                type="button"
                                                aria-pressed={useDijkstra === value}
                                                onClick={() => setUseDijkstra(value)}
                                                className={segmentClass(useDijkstra === value)}
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
                            className={buttonClass()}
                        >
                            {planning ? "Finding routes…" : "Find route"}
                        </button>
                    </form>

                    {message && (
                        <p
                            role="status"
                            className={`pointer-events-auto ${alertClass(message.error)}`}
                        >
                            {message.text}
                        </p>
                    )}

                    {journey && (
                        <JourneyResults
                            journey={journey}
                            onSave={save}
                            saving={saving}
                            saved={savedId != null}
                            signedIn={Boolean(session)}
                        />
                    )}
                </aside>

                <div className="min-h-[50vh] flex-1 lg:absolute lg:inset-0 lg:min-h-0">
                    <MapView
                        origin={origin}
                        destination={destination}
                        legs={legs}
                        areaRadius={journey?.areaRadius}
                        insetLeft={overlay ? PANEL_WIDTH_PX : 0}
                        insetTop={overlay ? HEADER_HEIGHT_PX : 0}
                    />
                </div>
            </div>
        </AppShell>
    );
}
