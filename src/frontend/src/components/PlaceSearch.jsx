import { useEffect, useId, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { buttonClass } from "../lib/ui";

const DEBOUNCE_MS = 300;

export default function PlaceSearch({ label, value, onChange, placeholder, allowLocate = false }) {
    const inputId = useId();
    const listId = `${inputId}-list`;
    const [text, setText] = useState(value?.label ?? "");
    const [options, setOptions] = useState([]);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [status, setStatus] = useState("idle");
    const justSelected = useRef(false);

    useEffect(() => {
        justSelected.current = true;
        setText(value?.label ?? "");
    }, [value]);

    useEffect(() => {
        if (justSelected.current) {
            justSelected.current = false;
            return;
        }
        const q = text.trim();
        if (q.length < 3) {
            setOptions([]);
            setStatus("idle");
            return;
        }
        const ctrl = new AbortController();
        const timer = setTimeout(async () => {
            setStatus("loading");
            try {
                const results = await apiFetch(`/api/geocode/?q=${encodeURIComponent(q)}`, {
                    signal: ctrl.signal,
                });
                setOptions(results);
                setActive(-1);
                setStatus(results.length ? "idle" : "empty");
                setOpen(true);
            } catch (err) {
                if (err.name !== "AbortError") setStatus("error");
            }
        }, DEBOUNCE_MS);
        return () => {
            clearTimeout(timer);
            ctrl.abort();
        };
    }, [text]);

    const choose = (place) => {
        justSelected.current = true;
        setText(place.label);
        setOpen(false);
        onChange(place);
    };

    const onKeyDown = (e) => {
        if (e.key === "ArrowDown" && options.length) {
            e.preventDefault();
            setOpen(true);
            setActive((i) => (i + 1) % options.length);
        } else if (e.key === "ArrowUp" && options.length) {
            e.preventDefault();
            setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
        } else if (e.key === "Enter" && open && active >= 0) {
            e.preventDefault();
            choose(options[active]);
        } else if (e.key === "Escape") {
            setOpen(false);
        }
    };

    const locate = () => {
        navigator.geolocation?.getCurrentPosition(
            (pos) => choose({ label: "My location", lat: pos.coords.latitude, lon: pos.coords.longitude }),
            () => setStatus("error"),
            { timeout: 8000 }
        );
    };

    return (
        <div className="relative">
            <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-mist-600">
                {label}
            </label>
            <div className="flex gap-2">
                <input
                    id={inputId}
                    type="text"
                    value={text}
                    placeholder={placeholder}
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={open}
                    aria-controls={listId}
                    aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
                    onChange={(e) => {
                        setText(e.target.value);
                        if (value) onChange(null);
                    }}
                    onFocus={() => options.length && setOpen(true)}
                    onBlur={() => setTimeout(() => setOpen(false), 120)}
                    onKeyDown={onKeyDown}
                    className="w-full rounded-lg border border-mist-300 bg-white px-3 py-2 text-sm text-mist-900 placeholder-mist-400 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
                />
                {allowLocate && "geolocation" in navigator && (
                    <button
                        type="button"
                        onClick={locate}
                        title="Use my location"
                        aria-label="Use my location"
                        className={`${buttonClass("secondary", "icon")} shrink-0`}
                    >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                            <circle cx="12" cy="12" r="8" />
                        </svg>
                    </button>
                )}
            </div>

            {open && (
                <ul
                    id={listId}
                    role="listbox"
                    className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-mist-200 bg-white py-1 shadow-lg"
                >
                    {options.map((o, i) => (
                        <li
                            key={`${o.lat},${o.lon},${i}`}
                            id={`${listId}-${i}`}
                            role="option"
                            aria-selected={i === active}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                choose(o);
                            }}
                            className={`cursor-pointer px-3 py-2 text-sm ${
                                i === active ? "bg-brand-50 text-brand-700" : "text-mist-800 hover:bg-mist-50"
                            }`}
                        >
                            {o.label}
                        </li>
                    ))}
                    {status === "empty" && <li className="px-3 py-2 text-sm text-mist-500">No matches found</li>}
                </ul>
            )}
            {status === "loading" && <p className="mt-1 text-xs text-mist-500">Searching…</p>}
            {status === "error" && (
                <p className="mt-1 text-xs text-red-600">Address search is unavailable right now.</p>
            )}
        </div>
    );
}
