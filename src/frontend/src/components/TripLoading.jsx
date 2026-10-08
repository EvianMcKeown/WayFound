import { useLayoutEffect, useRef, useState } from "react";
import { panelClass } from "../lib/ui";

export function Spinner({ className = "h-4 w-4" }) {
    return <span aria-hidden="true" className={`loading-spinner inline-block shrink-0 rounded-full border-2 border-current border-r-transparent ${className}`} />;
}

export function ResultCard({ tone = "glass", children }) {
    const inner = useRef(null);
    const [height, setHeight] = useState(null);
    useLayoutEffect(() => {
        const el = inner.current;
        const measure = () => setHeight(el.offsetHeight);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const toneClass = tone === "warn" ? "border border-warning-200 bg-warning-50/85 shadow-lg backdrop-blur-md" : panelClass;
    return (
        <div style={{ height: height ?? "auto" }} className={`result-card pointer-events-auto overflow-hidden rounded-2xl ${toneClass}`}>
            <div ref={inner} className="p-4">
                {children}
            </div>
        </div>
    );
}

function RouteMark() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 shrink-0 text-brand-700" fill="none">
            <path d="M3 18c5 0 4-12 9-12s4 12 9 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3" opacity="0.35" />
            <circle className="loading-route-dot" r="2.5" fill="currentColor" />
        </svg>
    );
}

function Bar({ className }) {
    return <span className={`loading-skeleton block rounded-md ${className}`} />;
}

export function TripSkeleton({ label = "Finding routes…", legs = 3 }) {
    return (
        <div className="loading-swap-in flex flex-col gap-3">
            <p role="status" className="flex items-center gap-2 text-sm font-medium text-mist-700">
                <RouteMark />
                {label}
            </p>
            <div aria-hidden="true" className="flex flex-col gap-3">
                <div className="flex items-end justify-between">
                    <Bar className="h-8 w-28" />
                    <Bar className="h-5 w-16 rounded-full" />
                </div>
                <Bar className="h-4 w-44" />
                <div className="flex items-center gap-1.5">
                    {[0, 1, 2, 3].map((i) => (
                        <span key={i} className="loading-skeleton block h-6 w-6 rounded-full" />
                    ))}
                    <Bar className="ml-1 h-3 w-24" />
                </div>
                {Array.from({ length: legs }, (_, i) => (
                    <div key={i} className="flex gap-3">
                        <span className="loading-skeleton block h-6 w-6 shrink-0 rounded-full" />
                        <div className="flex flex-1 flex-col gap-1.5 pt-0.5">
                            <Bar className="h-3.5 w-3/5" />
                            <Bar className="h-3 w-4/5" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function Refreshing({ busy, label = "Updating route…", indicator = true, children, className = "" }) {
    return (
        <div className={`relative ${className}`} aria-busy={busy}>
            <div data-busy={busy} className="loading-dim">
                {children}
            </div>
            <div aria-hidden="true" data-busy={busy} className="loading-veil pointer-events-none absolute inset-0 rounded-2xl" />
            {indicator && (
                <div aria-hidden={!busy} data-busy={busy} className="loading-overlay pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center">
                    <span className="loading-progress relative block h-1 w-full overflow-hidden rounded-full bg-brand-100">
                        <span className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-brand-500" />
                    </span>
                    <span role="status" className="mt-3 flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium text-mist-800 shadow-md ring-1 ring-mist-200">
                        <Spinner className="h-3.5 w-3.5 text-brand-700" />
                        {busy ? label : ""}
                    </span>
                </div>
            )}
        </div>
    );
}
