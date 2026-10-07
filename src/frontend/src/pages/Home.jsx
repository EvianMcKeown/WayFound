import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import AppShell, { HEADER_HEIGHT_PX } from "../components/AppShell";
import BottomSheet from "../components/BottomSheet";
import JourneyResults, { NoRouteCard, TripHeadline, TripLegs, TripModes, TripReport, TripSave, TripStats } from "../components/JourneyResults";
import MapView from "../components/MapView";
import RouteOptions, { CompareToggle } from "../components/RouteOptions";
import PlaceSearch from "../components/PlaceSearch";
import { apiFetch } from "../lib/api";
import { useSession } from "../lib/auth";
import { buildLegs, buildOption, summarise } from "../lib/journey";
import { readPlannerLink } from "../lib/plannerLink";
import { DAYS, nowAsPlannerInput } from "../lib/time";
import { Alert, Button, Checkbox, Field, Panel, Segmented } from "../components/ui";
import { ChevronIcon, CloseIcon, EditIcon, LocateIcon, SearchIcon, SwapIcon } from "../components/icons";

const OVERLAY_QUERY = "(min-width: 1024px)";
const PANEL_WIDTH_PX = 384;
const NO_ALTS = [];
const ALTERNATIVES = 5;
const ALGORITHMS = [
    { label: "RAPTOR", value: false },
    { label: "Dijkstra", value: true },
];

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

function SwapButton({ onSwap }) {
    const [turns, setTurns] = useState(0);
    return (
        <Button
            variant="secondary"
            size="icon"
            onClick={() => {
                setTurns((t) => t + 1);
                onSwap();
            }}
            aria-label="Swap start and destination"
            className="shrink-0"
        >
            <SwapIcon turns={turns} />
        </Button>
    );
}

function SearchForm({ title, onClose, origin, destination, setOrigin, setDestination, swap, day, time, setWhen, options, planning, onSubmit }) {
    const suffix = title ? "-sheet" : "";
    return (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
            {title && (
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold tracking-tight text-mist-900">{title}</h2>
                    <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close search">
                        <CloseIcon />
                    </Button>
                </div>
            )}
            <PlaceSearch label="From" placeholder="Address or place" value={origin} onChange={setOrigin} allowLocate />
            <PlaceSearch
                label="To"
                placeholder="Address or place"
                value={destination}
                onChange={setDestination}
                trailing={<SwapButton onSwap={swap} />}
            />

            <div className="grid grid-cols-2 gap-3">
                <Field id={`day${suffix}`} label="Day" as="select" value={day} onChange={(e) => setWhen((w) => ({ ...w, day: Number(e.target.value) }))}>
                    {DAYS.map((d, i) => (
                        <option key={d} value={i}>{d}</option>
                    ))}
                </Field>
                <Field id={`time${suffix}`} label="Depart at" type="time" required value={time} onChange={(e) => setWhen((w) => ({ ...w, time: e.target.value }))} />
            </div>

            <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-sm font-medium text-mist-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/40 [&::-webkit-details-marker]:hidden">
                    Options
                    <ChevronIcon className="h-4 w-4 text-mist-600 group-open:rotate-180" />
                </summary>
                <div className="mt-3 flex flex-col gap-2 text-sm text-mist-700">
                    <Checkbox label="Minimise walking" checked={options.minimizeWalking} onChange={options.onWalking} />
                    <Checkbox label="Fewer transfers" checked={options.minimizeStops} onChange={options.onStops} />
                    <Segmented legend="Algorithm" className="mt-1" options={ALGORITHMS} value={options.useDijkstra} onChange={options.setUseDijkstra} />
                </div>
            </details>

            <Button type="submit" disabled={planning}>
                {planning ? "Finding routes…" : "Find route"}
            </Button>
        </form>
    );
}

function SearchSummary({ origin, destination, day, time, onEdit }) {
    return (
        <div className="flex items-center gap-2 px-4 pb-1">
            <button type="button" onClick={onEdit} className="min-w-0 flex-1 rounded-lg py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/40">
                <span className="block truncate text-sm font-medium text-mist-900">
                    {origin?.label ?? "Start"} → {destination?.label ?? "Destination"}
                </span>
                <span className="block text-xs text-mist-700">{DAYS[day]} · depart {time}</span>
            </button>
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Change journey">
                <EditIcon />
            </Button>
        </div>
    );
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
    const altCtrl = useRef(null);
    const lastPlan = useRef(null);
    const [compareOpen, setCompareOpen] = useState(false);
    const [alts, setAlts] = useState({ status: "idle", items: [] });
    const [activeIndex, setActiveIndex] = useState(0);
    const [hover, setHover] = useState(null);
    const overlay = useMediaQuery(OVERLAY_QUERY);

    const [searchOpen, setSearchOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [tripExpanded, setTripExpanded] = useState(false);
    const [sheetHeight, setSheetHeight] = useState(0);

    const active = useMemo(() => {
        if (journey?.status !== "ok") return journey;
        const item = alts.status === "ready" ? alts.items[activeIndex] : null;
        return item ? { ...journey, ...item } : journey;
    }, [journey, alts, activeIndex]);
    const legs = useMemo(() => active?.legs ?? [], [active]);
    const altRoutes = useMemo(
        () =>
            compareOpen && alts.status === "ready"
                ? alts.items.map((item, index) => ({ index, legs: item.legs })).filter((r) => r.index !== activeIndex)
                : NO_ALTS,
        [compareOpen, alts, activeIndex]
    );

    const plan = async (from, to, { alt = null } = {}) => {
        planCtrl.current?.abort();
        altCtrl.current?.abort();
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

        const body = {
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
        };
        lastPlan.current = { from, to, departure, body };
        setCompareOpen(false);
        setAlts({ status: "idle", items: [] });
        setActiveIndex(0);
        setHover(null);

        setPlanning(true);
        setMessage(null);
        setEditing(false);
        setSearchOpen(false);
        setTripExpanded(false);
        try {
            const data = await apiFetch("/api/plan/", {
                method: "POST",
                signal: ctrl.signal,
                body: alt && !useDijkstra ? { ...body, alternatives: ALTERNATIVES } : body,
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
            if (alt && data.journeys) {
                const items = data.journeys.map((j) => buildOption(j, from, to, departure));
                const at = items.findIndex((o) => o.signature === alt);
                setAlts({ status: "ready", items });
                if (at >= 0) setActiveIndex(at);
                else setMessage({ text: "The route you saved is not available at this time, so this is the best one.", error: false });
            }
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

    const loadAlternatives = async () => {
        const last = lastPlan.current;
        if (!last) return;
        altCtrl.current?.abort();
        const ctrl = new AbortController();
        altCtrl.current = ctrl;
        setAlts({ status: "loading", items: [] });
        try {
            const data = await apiFetch("/api/plan/", {
                method: "POST",
                signal: ctrl.signal,
                body: { ...last.body, alternatives: ALTERNATIVES },
            });
            const items = (data.journeys ?? []).map((j) => buildOption(j, last.from, last.to, last.departure));
            setAlts({ status: "ready", items });
        } catch (err) {
            if (err.name === "AbortError") return;
            setAlts({ status: "error", items: [] });
        }
    };

    const selectOption = (i) => {
        if (i === activeIndex) return;
        setActiveIndex(i);
        setSavedId(null);
    };

    const swap = () => {
        setOrigin(destination);
        setDestination(origin);
        setJourney(null);
        setEditing(false);
        setSearchOpen(true);
    };

    const [locating, setLocating] = useState(false);
    const locateMe = () => {
        setLocating(true);
        navigator.geolocation?.getCurrentPosition(
            (pos) => {
                setLocating(false);
                setOrigin({ label: "My location", lat: pos.coords.latitude, lon: pos.coords.longitude });
            },
            () => {
                setLocating(false);
                setMessage({ text: "Could not get your location.", error: true });
            },
            { timeout: 8000 }
        );
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
            const { request } = active;
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
                    route_signature: active.rank > 0 ? active.signature : "",
                },
            });
            setSavedId(saved.id);
        } catch (err) {
            setMessage({ text: err.message, error: true });
        } finally {
            setSaving(false);
        }
    };

    useEffect(() => {
        const link = readPlannerLink(params);
        if (!link) return;
        let cancelled = false;
        if (link.places) {
            const [a, b] = link.places;
            setOrigin(a);
            setDestination(b);
            plan(a, b, { alt: link.alt });
        } else {
            (async () => {
                try {
                    const top = async (q) => (await apiFetch(`/api/geocode/?q=${encodeURIComponent(q)}`))[0];
                    const [a, b] = await Promise.all(link.text.map(top));
                    if (cancelled) return;
                    if (!a || !b) throw new Error("Could not find one of the saved locations.");
                    setOrigin(a);
                    setDestination(b);
                    plan(a, b, { alt: link.alt });
                } catch (err) {
                    if (!cancelled) setMessage({ text: err.message, error: true });
                }
            })();
        }
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(
        () => () => {
            planCtrl.current?.abort();
            altCtrl.current?.abort();
        },
        []
    );

    const searchProps = {
        origin, destination, setOrigin, setDestination, swap, day, time, setWhen, planning, onSubmit,
        options: {
            minimizeWalking,
            minimizeStops,
            useDijkstra,
            setUseDijkstra,
            onWalking: setOption(setMinimizeWalking),
            onStops: setOption(setMinimizeStops),
        },
    };
    const supportsCompare = journey?.status === "ok" && !journey.request.use_dijkstra;
    const toggleDesktop = () => {
        if (!compareOpen && (alts.status === "idle" || alts.status === "error")) loadAlternatives();
        setCompareOpen((o) => !o);
        setHover(null);
    };
    const compare = (open, onToggle) => ({
        supported: supportsCompare,
        open,
        onToggle,
        status: alts.status === "idle" ? "loading" : alts.status,
        items: alts.items,
        activeIndex,
        onSelect: selectOption,
        onHover: setHover,
        onRetry: loadAlternatives,
    });
    const alert = message && (
        <Alert tone={message.error ? "error" : "success"} role="status" className="pointer-events-auto">
            {message.text}
        </Alert>
    );

    if (overlay) {
        return (
            <AppShell overlayHeader>
                <div className="relative flex min-h-0 flex-1 flex-col">
                    <aside className="absolute left-0 top-16 z-10 flex max-h-[calc(100%-4rem)] w-[24rem] shrink-0 flex-col gap-4 overflow-y-auto bg-transparent p-4 [direction:rtl] [&>*]:[direction:ltr]">
                        <Panel tone="glass" className="pointer-events-auto p-4">
                            <SearchForm {...searchProps} />
                        </Panel>
                        {alert}
                        {journey && (
                            <JourneyResults journey={active} onSave={save} saving={saving} saved={savedId != null} signedIn={Boolean(session)} compare={compare(compareOpen, toggleDesktop)} />
                        )}
                    </aside>
                    <div className="absolute inset-0">
                        <MapView
                            origin={origin}
                            destination={destination}
                            legs={legs}
                            altRoutes={altRoutes}
                            highlight={compareOpen ? hover : null}
                            areaRadius={journey?.areaRadius}
                            insetLeft={PANEL_WIDTH_PX}
                            insetTop={HEADER_HEIGHT_PX}
                        />
                    </div>
                </div>
            </AppShell>
        );
    }

    const hasTrip = journey != null;
    const tripOk = journey?.status === "ok";
    const showForm = hasTrip ? editing : searchOpen;
    const summary = <SearchSummary origin={origin} destination={destination} day={day} time={time} onEdit={() => setEditing(true)} />;

    const toggleMobile = () => {
        if (compareOpen && tripExpanded) {
            setCompareOpen(false);
        } else {
            if (!compareOpen && (alts.status === "idle" || alts.status === "error")) loadAlternatives();
            setCompareOpen(true);
            setTripExpanded(true);
        }
        setHover(null);
    };

    const chooseOnSheet = (i) => {
        selectOption(i);
        setTripExpanded(false);
    };

    const pull = !showForm && !tripOk ? () => (hasTrip ? setEditing(true) : setSearchOpen(true)) : undefined;

    const dismiss = showForm ? () => (hasTrip ? setEditing(false) : setSearchOpen(false)) : undefined;

    let pinned = null;
    let peek;
    let more = null;
    if (showForm) {
        peek = (
            <div className="flex flex-col gap-3 px-4 pb-6 pt-1">
                <SearchForm
                    {...searchProps}
                    title={hasTrip ? "Change journey" : "Plan a journey"}
                    onClose={() => (hasTrip ? setEditing(false) : setSearchOpen(false))}
                />
                {alert}
                {tripOk && (
                    <button
                        type="button"
                        onClick={() => setEditing(false)}
                        aria-label="Show the trip again"
                        className="flex items-center gap-2 rounded-lg bg-mist-100 px-3 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/40"
                    >
                        <span className="text-base font-semibold text-mist-900">{Math.round(active.summary.duration)} min</span>
                        <span className="flex-1 text-sm text-mist-700">trip found · tap to show</span>
                        <ChevronIcon open className="h-4 w-4 text-mist-600" />
                    </button>
                )}
            </div>
        );
    } else if (!hasTrip) {
        peek = (
            <div className="flex flex-col gap-3 px-4 pb-6 pt-1">
                {alert}
                <button
                    type="button"
                    onClick={() => setSearchOpen(true)}
                    className="flex items-center gap-2 h-11 rounded-xl border border-mist-300 bg-white px-3 text-left text-base text-mist-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/40"
                >
                    <SearchIcon className="h-5 w-5 text-mist-700" />
                    Where to?
                </button>
            </div>
        );
    } else if (!tripOk) {
        pinned = summary;
        peek = (
            <div className="flex flex-col gap-3 px-4 pb-6">
                {alert}
                <NoRouteCard journey={journey} />
            </div>
        );
    } else {
        pinned = summary;
        peek = (
            <div className="flex flex-col gap-3 px-4 pb-6">
                {alert}
                <TripHeadline journey={active} />
                <TripModes journey={active} />
                {supportsCompare && (
                    <CompareToggle open={compareOpen && tripExpanded} onToggle={toggleMobile} chosen={activeIndex > 0 ? activeIndex : null} />
                )}
                <div className="flex gap-2">
                    <TripSave onSave={save} saving={saving} saved={savedId != null} signedIn={Boolean(session)} className="flex-1" />
                    <Button onClick={() => setTripExpanded((x) => !x)} aria-expanded={tripExpanded}>
                        {tripExpanded ? "Less" : "Steps"}
                    </Button>
                </div>
            </div>
        );
        more = (
            <div className="flex flex-col gap-3 px-4 pb-6">
                {compareOpen && supportsCompare && <RouteOptions {...compare(true, toggleMobile)} onSelect={chooseOnSheet} />}
                <TripStats journey={active} />
                <TripLegs journey={active} />
                <TripReport journey={active} />
            </div>
        );
    }

    const showLocate = !showForm && !tripExpanded;

    return (
        <AppShell>
            <div className="relative min-h-0 flex-1 overflow-hidden">
                <div className="absolute inset-0">
                    <MapView
                        origin={origin}
                        destination={destination}
                        legs={legs}
                        altRoutes={altRoutes}
                        highlight={compareOpen ? hover : null}
                        areaRadius={journey?.areaRadius}
                        insetBottom={Math.min(sheetHeight, 560)}
                    />
                </div>
                {showLocate && "geolocation" in navigator && (
                    <div className="absolute right-4 z-10 transition-[bottom] duration-[250ms] ease-out" style={{ bottom: sheetHeight + 12 }}>
                        <Button variant="secondary" size="icon" onClick={locateMe} aria-label="Use my location">
                            <LocateIcon busy={locating} />
                        </Button>
                    </div>
                )}
                <BottomSheet
                    label="Journey planner"
                    expanded={more != null && tripExpanded}
                    onExpandedChange={setTripExpanded}
                    onHeightChange={setSheetHeight}
                    onPull={pull}
                    onDismiss={dismiss}
                    pinned={pinned}
                    peek={peek}
                    more={more}
                />
            </div>
        </AppShell>
    );
}
