import { ms } from "./tokens";

const MAX_WAIT_MS = 6000;
const holds = new Set();
let revealed = false;

export function holdBoot(promise) {
    if (!revealed) holds.add(Promise.resolve(promise).catch(() => {}));
    return promise;
}

export function bootHold() {
    let release;
    holdBoot(new Promise((resolve) => (release = resolve)));
    return release;
}

export const hasBooted = () => revealed;

async function settled() {
    let seen = 0;
    while (holds.size > seen) {
        seen = holds.size;
        await Promise.all([...holds]);
    }
}

function lift() {
    const root = document.documentElement;
    const splash = document.getElementById("splash");
    clearTimeout(window.__bootSlowTimer);
    root.classList.remove("booting");
    root.classList.add("revealing");
    setTimeout(() => root.classList.remove("revealing"), ms("duration-reveal") * 2);
    if (!splash) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        splash.remove();
        return;
    }
    splash.classList.add("splash-out");
    splash.addEventListener("animationend", (e) => e.target === splash && splash.remove());
    setTimeout(() => splash.remove(), ms("duration-reveal") * 2);
}

let started = false;
export function revealWhenReady() {
    if (started) return;
    started = true;
    reveal();
}

async function reveal() {
    for (const src of ["/logo.svg", "/wordmark.svg"]) {
        const img = new Image();
        img.src = src;
        holdBoot(img.decode());
    }
    holdBoot(document.fonts?.load('1em "IBM Plex Sans"'));
    const cap = new Promise((resolve) => setTimeout(resolve, Math.max(0, MAX_WAIT_MS - performance.now())));
    await Promise.race([settled(), cap]);
    revealed = true;
    holds.clear();
    lift();
}
