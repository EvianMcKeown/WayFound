export const surfaceClass = "bg-white/70 shadow-lg backdrop-blur-md";
export const panelClass = `border border-white/60 ${surfaceClass}`;
export const panelSolidClass = "border border-mist-200 bg-white shadow-sm";

const FIELD_BASE =
    "w-full rounded-lg border bg-white px-3 py-2 text-base text-mist-900 placeholder-mist-500 focus:outline-none focus:ring-2";
export const fieldClass = `${FIELD_BASE} border-mist-300 focus:border-brand-700 focus:ring-brand-700/20`;
export const fieldErrorClass = `${FIELD_BASE} border-danger-300 focus:border-danger-500 focus:ring-danger-500/20`;

const BUTTON_BASE =
    "group inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-(--duration-fast) ease-out-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/40 enabled:active:scale-(--scale-press) motion-reduce:transition-none motion-reduce:active:transform-none disabled:cursor-not-allowed disabled:opacity-60";

const BUTTON_VARIANT = {
    primary: "bg-brand-700 text-white shadow-sm hover:bg-brand-800",
    secondary: "border border-mist-300 bg-white/80 text-mist-700 shadow-sm hover:border-mist-400 hover:bg-white hover:text-mist-900",
    ghost: "text-mist-700 hover:bg-mist-100 hover:text-mist-900",
    danger: "border border-mist-300 bg-white/80 text-danger-700 shadow-sm hover:border-danger-300 hover:bg-danger-50",
};

const BUTTON_SIZE = { md: "min-h-11 px-4", sm: "min-h-10 px-3", icon: "h-11 w-11", avatar: "min-h-11 pl-1 pr-2" };

export const buttonClass = (variant = "primary", size = "md") =>
    `${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]}`;

export const linkClass = "font-medium text-brand-700 hover:underline";

export const labelClass = "mb-1 block text-xs font-medium text-mist-700";

export const alertClass = (error) =>
    `rounded-xl border px-3 py-2 text-sm backdrop-blur-md ${
        error ? "border-danger-200 bg-danger-50/85 text-danger-800" : "border-success-200 bg-success-50/85 text-success-800"
    }`;
