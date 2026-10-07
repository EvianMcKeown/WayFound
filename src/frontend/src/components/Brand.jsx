import { Link } from "react-router-dom";

const SMALL_ICON = "drop-shadow-sm";
const LARGE_ICON = "bg-white shadow-md ring-1 ring-brand-100";
const FLAT_ICON = "drop-shadow-sm";
const SIZES = {
    sm: { logo: "h-6 w-6", src: "/favicon.svg", icon: SMALL_ICON, word: "text-sm", tag: null },
    md: { logo: "h-9 w-9 rounded-lg", src: "/logo.png", icon: FLAT_ICON, word: "text-xl", tag: null },
    lg: { logo: "h-16 w-16 rounded-2xl", src: "/logo.png", icon: LARGE_ICON, word: "text-3xl", tag: "text-sm" },
    xl: { logo: "h-24 w-24 rounded-3xl", src: "/logo.png", icon: LARGE_ICON, word: "text-4xl sm:text-5xl", tag: "text-base" },
};

export function Wordmark({ className = "" }) {
    return (
        <span className={`font-bold tracking-tight ${className}`}>
            <span className="text-mist-900">Way</span>
            <span className="text-brand-700">Found</span>
        </span>
    );
}

export default function Brand({ size = "md", stacked = false, tagline = true, to = "/", className = "" }) {
    const s = SIZES[size];
    const content = (
        <>
            <img src={s.src} alt="" className={`${s.logo} ${s.icon} shrink-0`} />
            <span className={`flex flex-col leading-none ${stacked ? "items-center" : ""}`}>
                <Wordmark className={s.word} />
                {tagline && s.tag && (
                    <span className={`mt-1 font-medium text-mist-600 ${s.tag}`}>
                        Cape Town Journey Planner
                    </span>
                )}
            </span>
        </>
    );
    const layout = `flex items-center ${stacked ? "flex-col gap-3 text-center" : "gap-3"} ${className}`;

    return to ? (
        <Link
            to={to}
            aria-label="WayFound home"
            className={`${layout} rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/40`}
        >
            {content}
        </Link>
    ) : (
        <div className={layout}>{content}</div>
    );
}
