import { MODE_STYLE } from "../lib/journey";

const GLYPH = {
    walk: (
        <>
            <circle cx="12.5" cy="6.6" r="1.8" fill="currentColor" stroke="none" />
            <path d="M12 10l-.5 5M8.5 12.5L12 11l3.5 2M11.5 15L9 19.5M11.5 15l3 4.5" />
        </>
    ),
    bus: (
        <>
            <rect x="6" y="5.5" width="12" height="12" rx="2.5" />
            <path d="M6 11h12" strokeWidth="1.2" />
            <circle cx="9.2" cy="14.4" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="14.8" cy="14.4" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="9" cy="19.2" r="1.1" />
            <circle cx="15" cy="19.2" r="1.1" />
        </>
    ),
    train: (
        <>
            <rect x="7" y="5" width="10" height="12.5" rx="3" />
            <rect x="9.2" y="7.4" width="5.6" height="4" rx="1" strokeWidth="1.2" />
            <circle cx="9.6" cy="14.6" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="14.4" cy="14.6" r="0.9" fill="currentColor" stroke="none" />
            <path d="M9 20l2-2.5M15 20l-2-2.5" />
        </>
    ),
};
const GLYPH_OF = { walk: "walk", myciti: "bus", "golden-arrow": "bus", metrorail: "train" };

export default function ModeBadge({ kind, className = "h-6 w-6" }) {
    const style = MODE_STYLE[kind];
    return (
        <span
            aria-hidden="true"
            className={`inline-grid shrink-0 place-items-center rounded-full ${className}`}
            style={{ background: style.color, color: style.glyph }}
        >
            <svg viewBox="0 0 24 24" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                {GLYPH[GLYPH_OF[kind]]}
            </svg>
        </span>
    );
}
