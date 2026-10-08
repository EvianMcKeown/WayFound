import { useEffect, useLayoutEffect, useRef, useState } from "react";

const TOP_GAP_PX = 135;
const GRAB_PX = 24;
const GRABBER_BLOCK_PX = 24;

export default function BottomSheet({ label, expanded, onExpandedChange, onHeightChange, onPull, onDismiss, pinned = null, peek, more = null }) {
    const rootRef = useRef(null);
    const scrollRef = useRef(null);
    const pinnedRef = useRef(null);
    const peekRef = useRef(null);
    const fullRef = useRef(null);
    const drag = useRef(null);
    const [sizes, setSizes] = useState({ pinned: 0, peek: 0, full: 0, available: 0 });
    const canExpand = more != null;
    const hasPinned = pinned != null;

    useLayoutEffect(() => {
        const measure = () =>
            setSizes({
                pinned: pinnedRef.current?.offsetHeight ?? 0,
                peek: peekRef.current?.offsetHeight ?? 0,
                full: fullRef.current?.offsetHeight ?? 0,
                available: Math.max(0, (rootRef.current?.offsetParent?.clientHeight ?? 0) - TOP_GAP_PX),
            });
        measure();
        const ro = new ResizeObserver(measure);
        [pinnedRef.current, peekRef.current, fullRef.current, rootRef.current?.offsetParent].forEach((el) => el && ro.observe(el));
        return () => ro.disconnect();
    }, [canExpand, hasPinned]);

    const peekHeight = sizes.pinned + sizes.peek + GRABBER_BLOCK_PX;
    const fullHeight = sizes.pinned + sizes.full + GRABBER_BLOCK_PX;
    const peekCapped = sizes.available > 0 ? Math.min(peekHeight, sizes.available) : peekHeight;
    const scrollable = expanded || peekHeight > peekCapped;
    const height = !sizes.peek ? undefined : expanded && canExpand ? Math.min(fullHeight, sizes.available) : peekCapped;

    useEffect(() => {
        if (height != null) onHeightChange?.(height);
    }, [height]); // eslint-disable-line react-hooks/exhaustive-deps

    const onPointerDown = (e) => {
        drag.current = { y: e.clientY };
    };
    const onPointerMove = (e) => {
        if (!drag.current) return;
        const dy = e.clientY - drag.current.y;
        if (!expanded && dy < -GRAB_PX && (canExpand || onPull)) {
            if (canExpand) onExpandedChange(true);
            else onPull();
            drag.current = null;
        } else if (dy > GRAB_PX && (scrollRef.current?.scrollTop ?? 0) <= 0 && (expanded || onDismiss)) {
            if (expanded) onExpandedChange(false);
            else onDismiss();
            drag.current = null;
        }
    };
    const endDrag = () => {
        drag.current = null;
    };
    const onWheel = (e) => {
        if (!expanded && e.deltaY > 8 && (canExpand || onPull)) {
            if (canExpand) onExpandedChange(true);
            else onPull();
        } else if (e.deltaY < -8 && (scrollRef.current?.scrollTop ?? 0) <= 0 && (expanded || onDismiss)) {
            if (expanded) onExpandedChange(false);
            else onDismiss();
        }
    };
    const latest = useRef({});
    latest.current = { expanded, canExpand, onExpandedChange, onPull, onDismiss };
    useEffect(() => {
        const el = rootRef.current;
        if (!el) return;
        let startY = null;
        const onStart = (e) => {
            startY = e.touches.length === 1 ? e.touches[0].clientY : null;
        };
        const onMove = (e) => {
            if (startY == null) return;
            const { expanded, canExpand, onExpandedChange, onPull, onDismiss } = latest.current;
            const dy = e.touches[0].clientY - startY;
            if (!expanded && (canExpand || onPull)) {
                e.preventDefault();
                if (dy < -GRAB_PX) {
                    if (canExpand) onExpandedChange(true);
                    else onPull();
                    startY = null;
                }
            } else if (dy > GRAB_PX && (scrollRef.current?.scrollTop ?? 0) <= 0 && (expanded || onDismiss)) {
                e.preventDefault();
                if (expanded) onExpandedChange(false);
                else onDismiss();
                startY = null;
            }
        };
        const end = () => {
            startY = null;
        };
        el.addEventListener("touchstart", onStart, { passive: true });
        el.addEventListener("touchmove", onMove, { passive: false });
        el.addEventListener("touchend", end, { passive: true });
        el.addEventListener("touchcancel", end, { passive: true });
        return () => {
            el.removeEventListener("touchstart", onStart);
            el.removeEventListener("touchmove", onMove);
            el.removeEventListener("touchend", end);
            el.removeEventListener("touchcancel", end);
        };
    }, []);

    const onKeyDown = (e) => {
        if (e.key === "Escape" && expanded) onExpandedChange(false);
    };

    return (
        <section
            ref={rootRef}
            aria-label={label}
            data-reveal="sheet"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onWheel={onWheel}
            onKeyDown={onKeyDown}
            style={{ height, touchAction: scrollable ? "pan-y" : "none" }}
            className="absolute inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden rounded-t-3xl bg-white shadow-sheet transition-[height] duration-(--duration-slow) ease-out-soft motion-reduce:transition-none"
        >
            {canExpand ? (
                <button
                    type="button"
                    onClick={() => onExpandedChange(!expanded)}
                    aria-expanded={expanded}
                    aria-label={expanded ? "Show less of the trip" : "Show the trip steps"}
                    className="flex h-6 w-full shrink-0 items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/40"
                >
                    <span aria-hidden="true" className="h-1 w-10 rounded-full bg-mist-300" />
                </button>
            ) : (
                <div aria-hidden="true" className="flex h-6 w-full shrink-0 items-center justify-center">
                    <span className="h-1 w-10 rounded-full bg-mist-300" />
                </div>
            )}
            {pinned != null && <div ref={pinnedRef} className="shrink-0">{pinned}</div>}
            <div ref={scrollRef} className={`min-h-0 flex-1 overscroll-contain ${scrollable ? "overflow-y-auto" : "overflow-hidden"}`}>
                <div ref={fullRef}>
                    <div ref={peekRef}>{peek}</div>
                    {more}
                </div>
            </div>
        </section>
    );
}
