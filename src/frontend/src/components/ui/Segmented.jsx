import { segmentClass, segmentGroupClass } from "../../lib/ui";

export default function Segmented({ legend, options, value, onChange, className = "" }) {
    return (
        <fieldset className={className}>
            <legend className="mb-1 text-xs font-medium text-mist-700">{legend}</legend>
            <div className={segmentGroupClass}>
                {options.map((o) => (
                    <button
                        key={o.label}
                        type="button"
                        aria-pressed={value === o.value}
                        onClick={() => onChange(o.value)}
                        className={segmentClass(value === o.value)}
                    >
                        {o.label}
                    </button>
                ))}
            </div>
        </fieldset>
    );
}
