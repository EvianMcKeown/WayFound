import { MODE_STYLE, hasApproximate } from "../lib/journey";
import { formatDuration, minsToClock, minsToDayClock } from "../lib/time";

function Stat({ label, value }) {
    return (
        <div>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="text-sm font-semibold text-slate-900">{value}</dd>
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
                <p className="text-sm font-medium text-slate-900">{title}</p>
                <p className="text-xs text-slate-600" title={detail}>{stopsLine}</p>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-slate-500">{minsToClock(leg.arrival)}</span>
        </li>
    );
}

export default function JourneyResults({ journey, onSave, saving }) {
    if (journey.status === "none") {
        return (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-medium">No public transport route found</p>
                <p className="mt-1 text-amber-800">
                    Try a different departure time, or a start and destination closer to a stop.
                </p>
            </div>
        );
    }

    const { legs, summary, arrival, departure, algorithm } = journey;
    return (
        <section aria-label="Journey result" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-baseline justify-between">
                <p className="text-lg font-semibold tracking-tight text-slate-900">
                    {minsToClock(departure)} → {minsToClock(arrival)}
                </p>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {algorithm}
                </span>
            </div>
            <p className="text-xs text-slate-500">Arrive {minsToDayClock(arrival)}</p>

            <dl className="my-3 grid grid-cols-3 gap-3 border-y border-slate-100 py-3">
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
                <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Stops marked <strong>area</strong> are places where the bus stops somewhere in a suburb or around a
                    landmark. The map shows the centre, so look for the bus nearby.
                </p>
            )}

            <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
                {saving ? "Saving…" : "Save this route"}
            </button>
        </section>
    );
}
