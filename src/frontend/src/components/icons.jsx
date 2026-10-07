const base = { viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

export const SwapIcon = ({ className = "h-5 w-5" }) => (
    <svg {...base} className={className}>
        <path d="M6 3v13M3 13l3 3 3-3M14 17V4M11 7l3-3 3 3" />
    </svg>
);

export const EditIcon = ({ className = "h-5 w-5" }) => (
    <svg {...base} className={className}>
        <path d="M3 17l.8-3.8L13.5 3.5l3 3L6.8 16.2zM11.5 5.5l3 3" />
    </svg>
);

export const SearchIcon = ({ className = "h-5 w-5" }) => (
    <svg {...base} className={className}>
        <circle cx="8.5" cy="8.5" r="5.5" />
        <path d="M13 13l4.5 4.5" />
    </svg>
);

export const LocateIcon = ({ className = "h-5 w-5" }) => (
    <svg {...base} className={className}>
        <circle cx="10" cy="10" r="3" />
        <circle cx="10" cy="10" r="7" />
        <path d="M10 1v3M10 16v3M1 10h3M16 10h3" />
    </svg>
);

export const CloseIcon = ({ className = "h-5 w-5" }) => (
    <svg {...base} className={className}>
        <path d="M4 4l12 12M16 4L4 16" />
    </svg>
);

export const ChevronIcon = ({ className = "h-4 w-4" }) => (
    <svg {...base} strokeWidth={1.8} className={className}>
        <path d="M5 8l5 5 5-5" />
    </svg>
);
