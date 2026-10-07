export default function Checkbox({ label, hint, className = "", ...props }) {
    return (
        <label className={`flex text-sm text-mist-700 ${hint ? "items-start gap-3" : "items-center gap-2"} ${className}`.trim()}>
            <input type="checkbox" className={`accent-brand-700 ${hint ? "mt-0.5 h-4 w-4" : ""}`.trim()} {...props} />
            {hint ? (
                <span>
                    <span className="font-medium text-mist-800">{label}</span>
                    <span className="block text-xs text-mist-600">{hint}</span>
                </span>
            ) : (
                label
            )}
        </label>
    );
}
