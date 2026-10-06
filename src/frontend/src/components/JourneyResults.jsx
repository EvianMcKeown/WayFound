import { Link } from "react-router-dom";
import { MODE_STYLE, hasApproximate } from "../lib/journey";
import { buttonClass, linkClass, panelClass } from "../lib/ui";
import { formatDuration, minsToClock, minsToDayClock } from "../lib/time";

function Stat({ label, value }) {
    return (
        <div>
            <dt className="text-xs text-mist-500">{label}</dt>
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

function LegRow({ leg, last }) {
    const style = MODE_STYLE[leg.kind];
    const title =
        leg.kind === "walk"
            ? `Walk ${leg.minutes} min`
            : `${style.label} ${leg.routeName}`;
    const detail =
        leg.kind === "walk"
            ? `${leg.fromName} → ${leg.toName}`
            : `${leg.fromName} → ${leg.toName}${leg.stops != null ? ` · ${leg.stops} stops` : ""}`;
    const stopsLine = (
        <>
            <Place name={leg.fromName} approx={leg.fromApprox} /> → <Place name={leg.toName} approx={leg.toApprox} />
            {leg.kind !== "walk" && leg.stops != null ? ` · ${leg.stops} stops` : ""}
        </>
    );

    return (
        <li className="relative flex gap-3 pb-4">
            {!last && (
                <span
                    aria-hidden="true"
                    className="absolute left-[7px] top-4 h-full w-0.5"
                    style={{ background: style.color, opacity: leg.kind === "walk" ? 0.35 : 1 }}
                />
            )}
            <span
                aria-hidden="true"
                className="relative mt-1 h-4 w-4 shrink-0 rounded-full border-2 border-white shadow"
                style={{ background: style.color }}
            />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-mist-900">{title}</p>
                <p className="text-xs text-mist-600" title={detail}>{stopsLine}</p>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-mist-500">{minsToClock(leg.arrival)}</span>
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

export default function JourneyResults({ journey, onSave, saving, saved, signedIn }) {
    if (journey.status === "none") {
        return (
            <div className="pointer-events-auto rounded-2xl border border-amber-200 bg-amber-50/85 p-4 text-sm text-amber-800 shadow-lg backdrop-blur-md">
                <p className="font-medium">No public transport route found</p>
                <p className="mt-1 text-amber-800">
                    Try a different departure time, or a start and destination closer to a stop.
                </p>
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

    const { legs, summary, arrival, departure, algorithm } = journey;
    return (
        <section aria-label="Journey result" className={`pointer-events-auto rounded-2xl p-4 ${panelClass}`}>
            <div className="flex items-baseline justify-between">
                <p className="text-lg font-semibold tracking-tight text-mist-900">
                    {minsToClock(departure)} → {minsToClock(arrival)}
                </p>
                <span className="rounded-full bg-mist-100 px-2 py-0.5 text-xs font-medium text-mist-600">
                    {algorithm}
                </span>
            </div>
            <p className="text-xs text-mist-500">Arrive {minsToDayClock(arrival)}</p>

            <dl className="my-3 grid grid-cols-3 gap-3 border-y border-mist-100 py-3">
                <Stat label="Duration" value={formatDuration(summary.duration)} />
                <Stat label="Transfers" value={summary.transfers} />
                <Stat label="Walking" value={`${summary.walkMinutes} min`} />
            </dl>

            <ol>
                {legs.map((leg, i) => (
                    <LegRow key={i} leg={leg} last={i === legs.length - 1} />
                ))}
            </ol>

            {hasApproximate(legs) && (
                <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Stops marked <strong>area</strong> are places where the bus stops somewhere in a suburb or around a
                    landmark. The map shows the centre, so look for the bus nearby.
                </p>
            )}

            <button
                type="button"
                onClick={onSave}
                disabled={saving || saved}
                className={`${buttonClass("secondary")} mt-1 w-full`}
            >
                {saved ? "Saved ✓" : saving ? "Saving…" : signedIn ? "Save this route" : "Sign in to save this route"}
            </button>
            {saved && (
                <p className="mt-2 text-center text-xs text-mist-600">
                    In your <Link to="/savedroutes" className={linkClass}>saved routes</Link>.
                </p>
            )}

            <p className="mt-3 text-center text-xs text-mist-500">
                Something wrong with this journey?{" "}
                <Link to="/report" state={{ context: reportContext(journey) }} className={linkClass}>
                    Report an issue
                </Link>
            </p>
        </section>
    );
}
