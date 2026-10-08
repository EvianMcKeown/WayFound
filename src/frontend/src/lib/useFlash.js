import { useCallback, useEffect, useState } from "react";
import { ms } from "./tokens";

const MIN_READ_MS = 4000;
const UNDO_READ_MS = 8000;
const MAX_READ_MS = 8000;
const MS_PER_CHAR = 70;

const readTime = (m) => Math.min(MAX_READ_MS, Math.max(m.undo ? UNDO_READ_MS : MIN_READ_MS, m.text.length * MS_PER_CHAR));

export default function useFlash() {
    const [message, setMessageState] = useState(null);
    const [leaving, setLeaving] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const held = hovered || focused;

    const setMessage = useCallback((next) => {
        setLeaving(false);
        if (!next) {
            setHovered(false);
            setFocused(false);
        }
        setMessageState(next);
    }, []);

    useEffect(() => {
        if (!message || message.error || held) return;
        const read = readTime(message);
        const fade = setTimeout(() => setLeaving(true), read);
        const gone = setTimeout(() => setMessage(null), read + ms("duration-slow"));
        return () => {
            clearTimeout(fade);
            clearTimeout(gone);
        };
    }, [message, held, setMessage]);

    const hold = (set) => () => {
        set(true);
        setLeaving(false);
    };
    const flash = {
        className: `transition-opacity duration-(--duration-slow) ease-out-soft motion-reduce:transition-none ${leaving ? "opacity-0" : ""}`,
        onPointerEnter: hold(setHovered),
        onPointerLeave: () => setHovered(false),
        onFocus: hold(setFocused),
        onBlur: () => setFocused(false),
    };
    return [message, setMessage, flash];
}
