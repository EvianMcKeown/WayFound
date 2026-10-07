import { Link } from "react-router-dom";
import { MODE_STYLE, hasApproximate } from "../lib/journey";
import { Button, Panel, TextLink } from "./ui";
import ModeBadge from "./ModeBadge";
import { BookmarkIcon } from "./icons";
import { formatDuration, minsToClock, minsToDayClock } from "../lib/time";

function Stat({ label, value }) {
    return (
        <div>
            <dt className="text-xs text-mist-600">{label}</dt>
            <dd className="text-sm font-semibold text-mist-900">{value}</dd>
        </div>
    );
}

function AreaTag() {
    return (
        <span
            className="ml-1 rounded bg-amber-100 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-amber-800"
            title="The bus stops in this area; the position shown is its centre"
        >
            area
        </span>
    );
}

function Place({ name, approx }) {
    return (
        <>
            {name}
            {approx && <AreaTag />}
        </>
    );
}

function LegRow({ leg, last, index = 0 }) {
    const style = MODE_STYLE[leg.kind];
    const title = leg.kind === "walk" ? `Walk ${leg.minutes} min` : `${style.label} ${leg.routeName}`;
    const detail =
        leg.kind === "walk"
            ? `${leg.fromName} → ${leg.toName}`
            : `${leg.fromName} → ${leg.toName}${leg.stops != null ? ` · ${leg.stops} stops` : ""}`;

    return (
        <li className="ico-rise relative flex gap-3 pb-4" style={{ "--i": index }}>
            {!last && (
                <span
                    aria-hidden="true"
                    className={`absolute left-[11px] top-7 h-[calc(100%-1.75rem)] w-0.5 ${leg.kind === "walk" ? "ico-march-line" : ""}`}
                    style={
                        leg.kind === "walk"
                            ? { backgroundImage: `repeating-linear-gradient(to bottom, ${style.color} 0 6px, transparent 6px 12px)` }
                            : { background: style.color }
                    }
                />
            )}
            <ModeBadge kind={leg.kind} className="relative h-6 w-6" />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-mist-900">{title}</p>
                <p className="text-xs text-mist-700" title={detail}>
                    <Place name={leg.fromName} approx={leg.fromApprox} /> → <Place name={leg.toName} approx={leg.toApprox} />
                    {leg.kind !== "walk" && leg.stops != null ? ` · ${leg.stops} stops` : ""}
                </p>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-mist-600">{minsToClock(leg.arrival)}</span>
        </li>
    );
}

function reportContext(journey) {
    return {
        source: "journey",
        request: journey.request,
        algorithm: journey.algorithm,
        departure: journey.departure,
        arrival: journey.arrival,
        legs: journey.legs.map(({ kind, routeName, routeId, tripId, fromName, toName, arrival, minutes }) => ({
            kind, routeName, routeId, tripId, fromName, toName, arrival, minutes,
        })),
    };
}

export function TripHeadline({ journey }) {
    const { summary, arrival, departure, algorithm } = journey;
    return (
        <div>
            <div className="flex items-center justify-between gap-2">
                <p className="text-3xl font-bold tracking-tight text-mist-900">{formatDuration(summary.duration)}</p>
                <span className="rounded-full bg-mist-100 px-2 py-0.5 text-xs font-medium text-mist-700">{algorithm}</span>
            </div>
            <p className="text-sm text-mist-700">
                {minsToClock(departure)} → {minsToClock(arrival)} · arrive {minsToDayClock(arrival)}
            </p>
        </div>
    );
}

export function TripModes({ journey }) {
    const { legs, summary } = journey;
    const transfers = `${summary.transfers} ${summary.transfers === 1 ? "transfer" : "transfers"}`;
    return (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1" aria-label="Modes of transport">
            {legs.map((leg, i) => (
                <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && <span aria-hidden="true" className="h-0.5 w-3 rounded bg-mist-300" />}
                    <ModeBadge kind={leg.kind} />
                </span>
            ))}
            <span className="ml-1 text-xs text-mist-700">
                {transfers} · {summary.walkMinutes} min walking
            </span>
        </div>
    );
}

export function TripStats({ journey }) {
    const { summary } = journey;
    return (
        <dl className="grid grid-cols-2 gap-3 border-y border-mist-200 py-3">
            <Stat label="Transfers" value={summary.transfers} />
            <Stat label="Walking" value={`${summary.walkMinutes} min`} />
        </dl>
    );
}

export function TripLegs({ journey }) {
    const { legs } = journey;
    return (
        <>
            <ol>
                {legs.map((leg, i) => (
                    <LegRow key={i} leg={leg} last={i === legs.length - 1} index={i} />
                ))}
            </ol>
            {hasApproximate(legs) && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Stops marked <strong>area</strong> are places where the bus stops somewhere in a suburb or around a
                    landmark. The map shows the centre, so look for the bus nearby.
                </p>
            )}
        </>
    );
}

export function TripSave({ onSave, saving, saved, signedIn, className = "" }) {
    return (
        <div className={className}>
            <Button variant="secondary" onClick={onSave} disabled={saving || saved} className="w-full">
                <BookmarkIcon on={saved} className="h-4 w-4" />
                {saved ? "Saved" : saving ? "Saving…" : signedIn ? "Save this route" : "Sign in to save this route"}
            </Button>
            {saved && (
                <p className="mt-2 text-center text-xs text-mist-700">
                    In your <TextLink to="/savedroutes">saved routes</TextLink>.
                </p>
            )}
        </div>
    );
}

export function TripReport({ journey }) {
    return (
        <p className="text-center text-xs text-mist-600">
            Something wrong with this journey?{" "}
            <TextLink to="/report" state={{ context: reportContext(journey) }} className="whitespace-nowrap">
                Report an issue
            </TextLink>
        </p>
    );
}

export function NoRouteCard({ journey, className = "" }) {
    return (
        <div className={`rounded-2xl border border-amber-200 bg-amber-50/85 p-4 text-sm text-amber-800 shadow-lg backdrop-blur-md ${className}`}>
            <p className="font-medium">No public transport route found</p>
            <p className="mt-1 text-amber-800">Try a different departure time, or a start and destination closer to a stop.</p>
            <p className="mt-2 text-xs">
                Expected a route here?{" "}
                <Link
                    to="/report"
                    state={{ context: { source: "no_route", request: journey.request }, category: "missing" }}
                    className="font-medium underline hover:no-underline"
                >
                    Report it
                </Link>
            </p>
        </div>
    );
}

export default function JourneyResults({ journey, onSave, saving, saved, signedIn }) {
    if (journey.status === "none") return <NoRouteCard journey={journey} className="pointer-events-auto" />;
    return (
        <Panel as="section" tone="glass" aria-label="Journey result" className="pointer-events-auto flex flex-col gap-3 p-4">
            <TripHeadline journey={journey} />
            <TripStats journey={journey} />
            <TripLegs journey={journey} />
            <TripSave onSave={onSave} saving={saving} saved={saved} signedIn={signedIn} />
            <TripReport journey={journey} />
        </Panel>
    );
}
