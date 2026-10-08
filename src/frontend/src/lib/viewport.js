const typing = () => document.activeElement?.matches?.("input, textarea, select, [contenteditable]") ?? false;

export function pinDocument() {
    const reset = () => {
        if ((window.scrollX || window.scrollY) && !typing()) window.scrollTo(0, 0);
    };
    window.addEventListener("scroll", reset, { passive: true });
    window.visualViewport?.addEventListener("resize", reset);
    document.addEventListener("focusout", () => setTimeout(reset, 0));
}
