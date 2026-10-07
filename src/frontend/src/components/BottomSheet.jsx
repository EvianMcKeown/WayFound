import { useEffect, useLayoutEffect, useRef, useState } from "react";

const TOP_GAP_PX = 135;
const GRAB_PX = 24;
const GRABBER_BLOCK_PX = 24;

export default function BottomSheet({ label, expanded, onExpandedChange, onHeightChange, pinned = null, peek, more = null }) {
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
    const height = !sizes.peek ? undefined : expanded && canExpand ? Math.min(fullHeight, sizes.available) : peekHeight;

    useEffect(() => {
        if (height != null) onHeightChange?.(height);
    }, [height]); // eslint-disable-line react-hooks/exhaustive-deps

    const onPointerDown = (e) => {
        drag.current = { y: e.clientY };
    };
    const onPointerMove = (e) => {
        if (!drag.current) return;
        const dy = e.clientY - drag.current.y;
        if (!expanded && canExpand && dy < -GRAB_PX) {
            onExpandedChange(true);
            drag.current = null;
        } else if (expanded && dy > GRAB_PX && (scrollRef.current?.scrollTop ?? 0) <= 0) {
            onExpandedChange(false);
            drag.current = null;
        }
    };
    const endDrag = () => {
        drag.current = null;
    };
    const onWheel = (e) => {
        if (!expanded && canExpand && e.deltaY > 8) onExpandedChange(true);
        else if (expanded && e.deltaY < -8 && (scrollRef.current?.scrollTop ?? 0) <= 0) onExpandedChange(false);
    };
    const onKeyDown = (e) => {
        if (e.key === "Escape" && expanded) onExpandedChange(false);
    };

    return (
        <section
            ref={rootRef}
            aria-label={label}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onWheel={onWheel}
            onKeyDown={onKeyDown}
            style={{ height, touchAction: expanded ? "pan-y" : "none" }}
            className="absolute inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden rounded-t-3xl bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.14)] transition-[height] duration-[250ms] ease-out motion-reduce:transition-none"
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
            <div ref={scrollRef} className={`min-h-0 flex-1 overscroll-contain ${expanded ? "overflow-y-auto" : "overflow-hidden"}`}>
                <div ref={fullRef}>
                    <div ref={peekRef}>{peek}</div>
                    {more}
                </div>
            </div>
        </section>
    );
}
