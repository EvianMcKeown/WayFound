const base = { viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

export const SwapIcon = ({ className = "h-5 w-5", turns = 0 }) => (
    <svg {...base} className={`ico-turn ${className}`} style={{ transform: `rotate(${turns * 180}deg)` }}>
        <path className="ico-part ico-swap-down" d="M6 3v13M3 13l3 3 3-3" />
        <path className="ico-part ico-swap-up" d="M14 17V4M11 7l3-3 3 3" />
    </svg>
);

export const EditIcon = ({ className = "h-5 w-5" }) => (
    <svg {...base} className={className}>
        <g className="ico-edit">
            <path d="M3 17l.8-3.8L13.5 3.5l3 3L6.8 16.2zM11.5 5.5l3 3" />
        </g>
    </svg>
);

export const SearchIcon = ({ className = "h-5 w-5" }) => (
    <svg {...base} className={className}>
        <g className="ico-search">
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="M13 13l4.5 4.5" />
        </g>
    </svg>
);

export const LocateIcon = ({ className = "h-5 w-5", busy = false }) => (
    <svg {...base} className={className} data-busy={busy}>
        <circle className="ico-locate-dot" cx="10" cy="10" r="3" />
        <circle className="ico-locate-ring" cx="10" cy="10" r="7" />
        <circle cx="10" cy="10" r="7" />
        <path d="M10 1v3M10 16v3M1 10h3M16 10h3" />
    </svg>
);

export const CloseIcon = ({ className = "h-5 w-5" }) => (
    <svg {...base} className={className}>
        <path className="ico-part ico-close" d="M4 4l12 12M16 4L4 16" />
    </svg>
);

export const ChevronIcon = ({ className = "h-4 w-4", open = false }) => (
    <svg {...base} strokeWidth={1.8} className={`ico-chevron ${className}`} style={open ? { transform: "rotate(180deg)" } : undefined}>
        <path d="M5 8l5 5 5-5" />
    </svg>
);

export const BookmarkIcon = ({ className = "h-5 w-5", on = false }) => (
    <svg {...base} className={className} fill={on ? "currentColor" : "none"}>
        <path className="ico-part ico-bookmark" data-on={on} d="M5 3h10v14l-5-3.5L5 17z" />
    </svg>
);

export const MenuIcon = ({ className = "h-5 w-5", open = false }) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" className={className}>
        <path className="ico-part" d="M3 5h14" style={open ? { transform: "translateY(5px) rotate(45deg)" } : undefined} />
        <path className="ico-part" d="M3 10h14" style={open ? { opacity: 0, transform: "scaleX(0.2)" } : undefined} />
        <path className="ico-part" d="M3 15h14" style={open ? { transform: "translateY(-5px) rotate(-45deg)" } : undefined} />
    </svg>
);

export const CheckIcon = ({ className = "h-4 w-4" }) => (
    <svg {...base} strokeWidth={2.2} className={className}>
        <path className="ico-check" d="M4.5 10.5l3.5 3.5 7.5-8" />
    </svg>
);

export const BanIcon = ({ className = "h-4 w-4" }) => (
    <svg {...base} className={className}>
        <circle cx="10" cy="10" r="7.5" />
        <path className="ico-slash" d="M4.7 4.7l10.6 10.6" />
    </svg>
);
