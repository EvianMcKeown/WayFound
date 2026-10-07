import { useEffect, useId, useState } from "react";
import { apiFetch } from "../lib/api";
import { MODE_STYLE } from "../lib/journey";
import { OPERATORS, lineName, operatorOf, withLine, withMode, withoutLine } from "../lib/transport";
import { fieldClass, labelClass } from "../lib/ui";
import { BanIcon, CloseIcon } from "./icons";
import { Button } from "./ui";

function ModeChip({ operator, avoided, onToggle }) {
    const style = MODE_STYLE[operator.kind];
    return (
        <button
            type="button"
            role="switch"
            aria-checked={!avoided}
            aria-label={`Use ${operator.label}`}
            onClick={onToggle}
            className={`group flex min-h-10 items-center gap-1.5 rounded-full border px-2.5 text-sm font-medium transition-[background-color,border-color,color,opacity] duration-[var(--duration-base)] ease-[var(--ease-out-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/40 enabled:active:scale-[0.97] ${
                avoided ? "border-mist-200 bg-mist-100 text-mist-600" : "border-mist-300 bg-white text-mist-900 hover:border-mist-400"
            }`}
        >
            {avoided ? (
                <BanIcon className="h-4 w-4 text-red-700" />
            ) : (
                <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ backgroundColor: style.color }} />
            )}
            <span className={avoided ? "line-through decoration-mist-500" : ""}>{operator.label}</span>
        </button>
    );
}

export function ModeChips({ avoid, onChange }) {
    return (
        <div role="group" aria-label="Transport to use" className="flex flex-wrap gap-2">
            {OPERATORS.map((o) => (
                <ModeChip key={o.mode} operator={o} avoided={avoid.modes.includes(o.mode)} onToggle={() => onChange(withMode(avoid, o.mode, !avoid.modes.includes(o.mode)))} />
            ))}
        </div>
    );
}

function LineChip({ line, onRemove }) {
    const style = MODE_STYLE[operatorOf(line.mode)?.kind];
    return (
        <li className={`ico-rise flex min-h-9 items-center gap-1.5 rounded-full border py-0.5 pl-3 pr-1 text-sm ${line.unavailable ? "border-amber-200 bg-amber-50 text-amber-800" : "border-mist-300 bg-white text-mist-900"}`}>
            {style && <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: style.color }} />}
            <span>
                {lineName(line)}
                {line.unavailable && <span className="ml-1 text-xs">(not in the timetable now)</span>}
            </span>
            <button
                type="button"
                onClick={onRemove}
                aria-label={`Stop avoiding ${lineName(line)}`}
                className="grid h-8 w-8 place-items-center rounded-full text-mist-600 hover:bg-mist-100 hover:text-mist-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/40"
            >
                <CloseIcon className="h-3.5 w-3.5" />
            </button>
        </li>
    );
}

const DEBOUNCE_MS = 200;

export function LinePicker({ avoid, onChange }) {
    const inputId = useId();
    const listId = `${inputId}-list`;
    const [text, setText] = useState("");
    const [found, setFound] = useState([]);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [status, setStatus] = useState("idle");

    const options = found.filter((l) => !avoid.modes.includes(l.mode) && !avoid.lines.some((a) => a.key === l.key));

    useEffect(() => {
        const q = text.trim();
        if (q.length < 1) {
            setFound([]);
            setStatus("idle");
            return;
        }
        const ctrl = new AbortController();
        const timer = setTimeout(async () => {
            setStatus("loading");
            try {
                const lines = await apiFetch(`/api/lines/?q=${encodeURIComponent(q)}&limit=8`, { signal: ctrl.signal });
                setFound(lines);
                setActive(-1);
                setStatus(lines.length ? "idle" : "empty");
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

    const choose = (line) => {
        onChange(withLine(avoid, line));
        setText("");
        setFound([]);
        setOpen(false);
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

    return (
        <div className="relative">
            <label htmlFor={inputId} className={labelClass}>
                Avoid a line
            </label>
            <input
                id={inputId}
                type="text"
                value={text}
                placeholder="113, Southern, Bellville…"
                autoComplete="off"
                role="combobox"
                aria-expanded={open}
                aria-controls={listId}
                aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
                onChange={(e) => setText(e.target.value)}
                onFocus={() => options.length && setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 120)}
                onKeyDown={onKeyDown}
                className={`${fieldClass} h-11`}
            />
            {open && (
                <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-mist-200 bg-white py-1 shadow-lg">
                    {options.map((l, i) => {
                        const style = MODE_STYLE[operatorOf(l.mode)?.kind];
                        return (
                            <li
                                key={l.key}
                                id={`${listId}-${i}`}
                                role="option"
                                aria-selected={i === active}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    choose(l);
                                }}
                                className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${i === active ? "bg-brand-50 text-brand-700" : "text-mist-800 hover:bg-mist-50"}`}
                            >
                                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: style?.color }} />
                                <span className="min-w-0 flex-1 truncate">{lineName(l)}</span>
                                {l.directions > 1 && <span className="shrink-0 text-xs text-mist-600">{l.directions} directions</span>}
                            </li>
                        );
                    })}
                    {!options.length && status !== "loading" && (
                        <li className="px-3 py-2 text-sm text-mist-600">{status === "error" ? "Line search is unavailable right now." : found.length ? "Everything matching is already avoided." : "No lines match."}</li>
                    )}
                </ul>
            )}
        </div>
    );
}

export default function AvoidTransport({ avoid, onChange, className = "" }) {
    return (
        <div className={`flex flex-col gap-3 ${className}`}>
            <ModeChips avoid={avoid} onChange={onChange} />
            <LinePicker avoid={avoid} onChange={onChange} />
            {avoid.lines.length > 0 && (
                <ul aria-label="Lines avoided" className="flex flex-wrap gap-2">
                    {avoid.lines.map((l) => (
                        <LineChip key={l.key} line={l} onRemove={() => onChange(withoutLine(avoid, l.key))} />
                    ))}
                </ul>
            )}
        </div>
    );
}

export function AvoidDefaults({ onSave, onReset, saving, className = "" }) {
    return (
        <div className={`flex flex-wrap items-center gap-2 ${className}`}>
            <Button variant="secondary" size="sm" onClick={onSave} disabled={saving}>
                {saving ? "Saving…" : "Make these my defaults"}
            </Button>
            <Button variant="ghost" size="sm" onClick={onReset}>
                Reset to my defaults
            </Button>
        </div>
    );
}
