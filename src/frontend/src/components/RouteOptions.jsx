import { useRef } from "react";
import ModeBadge from "./ModeBadge";
import { CheckIcon, ChevronIcon } from "./icons";
import { Alert, Button } from "./ui";
import { formatDuration, minsToClock } from "../lib/time";

function Skeleton() {
    return (
        <div aria-hidden="true" className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
                <div key={i} className="loading-skeleton h-24 rounded-xl" />
            ))}
        </div>
    );
}

function Label({ children, strong }) {
    return (
        <span
            className={`rounded-full px-2 py-0.5 text-2xs font-medium ${
                strong ? "bg-brand-100 text-brand-800" : "bg-mist-100 text-mist-700"
            }`}
        >
            {children}
        </span>
    );
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function OptionCard({ option, index, slower, selected, onSelect, onHover, buttonRef, onKeyDown }) {
    const { summary, labels, departure, arrival, legs } = option;
    return (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            ref={buttonRef}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(index)}
            onKeyDown={onKeyDown}
            onMouseEnter={() => onHover(index)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(index)}
            onBlur={() => onHover(null)}
            className={`ico-rise group flex w-full flex-col gap-1.5 rounded-xl border p-3 text-left tabular-nums transition-[border-color,background-color,box-shadow] duration-(--duration-base) ease-out-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/40 ${
                selected ? "border-brand-700 bg-brand-50 shadow-sm ring-1 ring-brand-700" : "border-mist-200 bg-white hover:border-mist-400"
            }`}
            style={{ "--i": index }}
        >
            <span className="flex items-center justify-between gap-2">
                <span className="text-lg font-semibold leading-tight text-mist-900">{formatDuration(summary.duration)}</span>
                {selected ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-brand-800">
                        <CheckIcon /> In use
                    </span>
                ) : (
                    slower > 0 && <span className="text-xs font-medium text-mist-700">+{slower} min</span>
                )}
            </span>
            <span className="text-xs text-mist-700">
                {minsToClock(departure)} → {minsToClock(arrival)}
            </span>
            <span className="flex flex-wrap items-center gap-x-1 gap-y-1" aria-label="Modes of transport">
                {legs.map((leg, i) => (
                    <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span aria-hidden="true" className="h-0.5 w-2 rounded bg-mist-300" />}
                        <ModeBadge kind={leg.kind} className="h-5 w-5" />
                    </span>
                ))}
            </span>
            <span className="text-xs text-mist-700">
                {plural(summary.transfers, "transfer")} · {summary.walkMinutes} min walking
            </span>
            {labels.length > 0 && (
                <span className="flex flex-wrap gap-1">
                    {labels.map((l) => (
                        <Label key={l} strong={l === "Fastest"}>
                            {l}
                        </Label>
                    ))}
                </span>
            )}
        </button>
    );
}

export default function RouteOptions({ status, items, activeIndex, onSelect, onHover, onRetry }) {
    const refs = useRef([]);

    if (status === "loading") return <Skeleton />;
    if (status === "error") {
        return (
            <Alert tone="error" role="status" className="flex items-center justify-between gap-2">
                <span>Could not load the other routes.</span>
                <Button variant="ghost" size="sm" onClick={onRetry}>
                    Try again
                </Button>
            </Alert>
        );
    }
    if (items.length <= 1) {
        return <p className="rounded-xl bg-mist-100 px-3 py-2.5 text-sm text-mist-700">There are no other sensible routes for this trip.</p>;
    }

    const move = (to) => {
        const i = (to + items.length) % items.length;
        onSelect(i);
        refs.current[i]?.focus();
    };
    const onKeyDown = (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowRight") move(activeIndex + 1);
        else if (e.key === "ArrowUp" || e.key === "ArrowLeft") move(activeIndex - 1);
        else return;
        e.preventDefault();
    };

    return (
        <div role="radiogroup" aria-label="Route options" className="flex flex-col gap-2">
            {items.map((option, i) => (
                <OptionCard
                    key={option.signature}
                    option={option}
                    index={i}
                    slower={option.arrival - items[0].arrival}
                    selected={i === activeIndex}
                    onSelect={onSelect}
                    onHover={onHover}
                    buttonRef={(el) => (refs.current[i] = el)}
                    onKeyDown={onKeyDown}
                />
            ))}
        </div>
    );
}

export function CompareToggle({ open, onToggle, chosen, className = "" }) {
    return (
        <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={open} className={`w-full !justify-between ${className}`}>
            <span>{open ? "Hide other routes" : chosen != null ? `Route ${chosen + 1} in use · compare` : "Compare routes"}</span>
            <ChevronIcon open={open} />
        </Button>
    );
}
