import { fieldClass, fieldErrorClass, labelClass } from "../../lib/ui";

export default function Field({
    id,
    label,
    note,
    labelHidden = false,
    error,
    as = "input",
    className = "",
    controlClassName = "",
    children,
    ...props
}) {
    const Control = as;
    return (
        <div className={className}>
            <label htmlFor={id} className={labelHidden ? "sr-only" : labelClass}>
                {label}
                {note && <span className="font-normal text-mist-500"> {note}</span>}
            </label>
            <Control
                id={id}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                className={`${error ? fieldErrorClass : fieldClass} ${as === "textarea" ? "" : "h-11"} ${controlClassName}`.trim()}
                {...props}
            >
                {children}
            </Control>
            {error && (
                <p id={`${id}-error`} className="mt-1 text-xs text-danger-700">
                    {error}
                </p>
            )}
        </div>
    );
}
