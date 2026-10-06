export const surfaceClass = "bg-white/70 shadow-lg backdrop-blur-md";
export const panelClass = `border border-white/60 ${surfaceClass}`;

export const fieldClass =
    "w-full rounded-lg border border-mist-300 bg-white/80 px-3 py-2 text-sm text-mist-900 placeholder-mist-400 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20";

const BUTTON_BASE =
    "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/40 disabled:cursor-not-allowed disabled:opacity-60";

const BUTTON_VARIANT = {
    primary: "bg-brand-700 text-white shadow-sm hover:bg-brand-800",
    secondary: "border border-mist-300 bg-white/80 text-mist-700 shadow-sm hover:border-mist-400 hover:bg-white hover:text-mist-900",
    ghost: "text-mist-700 hover:bg-mist-100 hover:text-mist-900",
    danger: "border border-mist-300 bg-white/80 text-red-700 shadow-sm hover:border-red-300 hover:bg-red-50",
};

const BUTTON_SIZE = { md: "px-4 py-2", sm: "px-3 py-1.5", icon: "p-2", avatar: "py-1 pl-1 pr-2" };

export const buttonClass = (variant = "primary", size = "md") =>
    `${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]}`;

export const segmentGroupClass = "inline-flex rounded-lg border border-mist-300 bg-white/80 p-0.5";
export const segmentClass = (active) =>
    `rounded-md px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/40 ${
        active ? "bg-brand-700 text-white shadow-sm" : "text-mist-600 hover:bg-mist-100"
    }`;

export const linkClass = "font-medium text-brand-700 hover:underline";

export const labelClass = "mb-1 block text-xs font-medium text-mist-600";

export const alertClass = (error) =>
    `rounded-xl border px-3 py-2 text-sm backdrop-blur-md ${
        error ? "border-red-200 bg-red-50/85 text-red-800" : "border-green-200 bg-green-50/85 text-green-800"
    }`;
