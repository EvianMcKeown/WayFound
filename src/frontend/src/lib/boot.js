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
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const spinnerGone = () => {
        const spinner = splash.querySelector(".splash-spinner");
        const from = spinner ? Number(getComputedStyle(spinner).opacity) : 0;
        if (!from) return Promise.resolve();
        return spinner
            .animate([{ opacity: from }, { opacity: 0 }], { duration: ms("duration-base") * from, easing: "ease-out", fill: "forwards" })
            .finished.catch(() => {});
    };
    const swap = () => {
        splash?.remove();
        root.classList.remove("booting");
        root.classList.add("revealing");
        setTimeout(() => root.classList.remove("revealing"), 1200);
    };
    if (reduced || !splash) {
        swap();
        return;
    }
    if (document.startViewTransition) {
        spinnerGone().then(() => document.startViewTransition(swap));
        return;
    }
    splash.classList.add("splash-out");
    root.classList.remove("booting");
    root.classList.add("revealing");
    splash.addEventListener("animationend", () => splash.remove(), { once: true });
    setTimeout(() => {
        splash.remove();
        root.classList.remove("revealing");
    }, 1200);
}

let started = false;
export function revealWhenReady() {
    if (started) return;
    started = true;
    reveal();
}

async function reveal() {
    const logo = new Image();
    logo.src = "/logo.svg";
    holdBoot(logo.decode());
    holdBoot(document.fonts?.load('1em "IBM Plex Sans"'));
    const cap = new Promise((resolve) => setTimeout(resolve, Math.max(0, MAX_WAIT_MS - performance.now())));
    await Promise.race([settled(), cap]);
    revealed = true;
    holds.clear();
    lift();
}
