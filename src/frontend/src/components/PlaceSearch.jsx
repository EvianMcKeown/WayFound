import { useEffect, useId, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { Button } from "./ui";
import { LocateIcon } from "./icons";
import { fieldClass, labelClass } from "../lib/ui";

const DEBOUNCE_MS = 300;

export default function PlaceSearch({ label, value, onChange, placeholder, allowLocate = false, trailing = null }) {
    const inputId = useId();
    const listId = `${inputId}-list`;
    const [text, setText] = useState(value?.label ?? "");
    const [options, setOptions] = useState([]);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [status, setStatus] = useState("idle");
    const [locating, setLocating] = useState(false);
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
        setLocating(true);
        navigator.geolocation?.getCurrentPosition(
            (pos) => {
                setLocating(false);
                choose({ label: "My location", lat: pos.coords.latitude, lon: pos.coords.longitude });
            },
            () => {
                setLocating(false);
                setStatus("error");
            },
            { timeout: 8000 }
        );
    };

    return (
        <div className="relative">
            <label htmlFor={inputId} className={labelClass}>
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
                    className={`${fieldClass} h-11`}
                />
                {allowLocate && "geolocation" in navigator && (
                    <Button
                        variant="secondary"
                        size="icon"
                        onClick={locate}
                        title="Use my location"
                        aria-label="Use my location"
                        className="shrink-0"
                    >
                        <LocateIcon busy={locating} />
                    </Button>
                )}
                {trailing}
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
                    {status === "empty" && <li className="px-3 py-2 text-sm text-mist-600">No matches found</li>}
                </ul>
            )}
            {status === "loading" && <p className="mt-1 text-xs text-mist-600">Searching…</p>}
            {status === "error" && (
                <p className="mt-1 text-xs text-red-600">Address search is unavailable right now.</p>
            )}
        </div>
    );
}
