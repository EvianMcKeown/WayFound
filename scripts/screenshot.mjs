#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
);
const BASE = args.base ?? "http://localhost:5173";
const OUT = args.out ?? "screenshots";
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const PORT = 9300 + Math.floor(Math.random() * 500);
const CHROME = args.chrome ?? "google-chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OVERFLOW_CHECK = `(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    const desc = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "");
    if (document.documentElement.scrollWidth > vw + 1) out.push("page scrolls sideways: " + document.documentElement.scrollWidth + " > " + vw);
    for (const el of document.querySelectorAll("body *")) {
        if (el.closest(".maplibregl-map")) continue;
        const cs = getComputedStyle(el);
        if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1) {
            out.push("scrolls sideways: " + desc(el) + " " + el.scrollWidth + " > " + el.clientWidth);
        }
    }
    for (const el of document.querySelectorAll("input, select, textarea, button, a, p, h1, h2, h3, img, label, li, dd, dt, summary")) {
        if (el.closest(".maplibregl-map, [aria-hidden=true], .sr-only")) continue;
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > vw + 1 || r.left < -1)) out.push("sticks out: " + desc(el) + " [" + Math.round(r.left) + ", " + Math.round(r.right) + "] of " + vw);
    }
    return out;
})()`;

const VIEWPORTS = { desktop: [1440, 900], mobile: [Number(args.width) || 390, 844] };

const JOURNEY = "/?from=-33.92210,18.42570&fromLabel=Cape%20Town%20Station&to=-33.98060,18.46530&toLabel=Claremont%20Station";

const SET_FIELD = `(sel, v) => {
    const el = document.querySelector(sel);
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}`;

const RESULT = `document.querySelector('section[aria-label="Journey result"], section[aria-label="Journey planner"]')`;
const clickText = (selector, text) =>
    `[...document.querySelectorAll('${selector}')].find((b) => b.textContent.trim() === '${text}')?.click()`;

const plannerNow = () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return { day: (now.getDay() + 6) % 7, time: `${pad(now.getHours())}:${pad(now.getMinutes())}` };
};

const MANY_ROUTES = "/?from=-33.97800,18.57000&fromLabel=Gugulethu&to=-33.90250,18.42070&toLabel=V%26A%20Waterfront";

const replan = (day, time) => async (page) => {
    await page.waitFor("!!window.__map", "planner");
    await page.waitFor(`!!${RESULT}?.innerText.includes('→') || document.body.innerText.includes('No public transport route found')`, "first plan");
    await page.eval(`if (!document.querySelector('#time')) document.querySelector('button[aria-label="Change journey"]')?.click()`);
    await page.waitFor("!!document.querySelector('#time, #time-sheet')", "search form");
    await page.eval(`(${SET_FIELD})("#day, #day-sheet", "${day}"); (${SET_FIELD})("#time, #time-sheet", "${time}")`);
    await sleep(300);
    await page.eval(`document.querySelector('form button[type=submit]').click()`);
};

const openCompare = async (page) => {
    await replan(1, "08:00")(page);
    await page.waitFor(`${RESULT}?.innerText.includes("08:00 →")`, "08:00 journey result");
    await sleep(500);
    await page.waitFor("[...document.querySelectorAll('button')].some((b) => /^Compare routes|in use · compare/.test(b.textContent.trim()))", "Compare routes button");
    await page.eval(`[...document.querySelectorAll('button')].find((b) => /^Compare routes|in use · compare/.test(b.textContent.trim()))?.click()`);
    await page.waitFor("document.querySelectorAll('[role=radio]').length > 0", "route options");
    await sleep(600);
};

const mapIdle = (page) =>
    page.waitFor("window.__map && window.__map.loaded() && window.__map.areTilesLoaded() && !window.__map.isMoving()", "map idle");

const SHOTS = [
    { name: "planner-empty", path: "/", ready: mapIdle },
    {
        name: "planner-result",
        path: JOURNEY,
        setup: replan(1, "08:00"),
        ready: async (p) => {
            await p.waitFor(`${RESULT}?.innerText.includes("08:00 →")`, "08:00 journey result");
            await mapIdle(p);
        },
    },
    {
        name: "planner-noroute",
        path: JOURNEY,
        stub: { "*/api/plan/*": { earliest_arrival: null, path: [], path_objs: [] } },
        ready: async (p) => {
            await p.waitFor("document.body.innerText.includes('No public transport route found')", "no-route box");
            await mapIdle(p);
        },
    },
    {
        name: "planner-search",
        path: "/",
        only: "mobile",
        setup: async (p) => {
            await p.waitFor("!!window.__map", "planner");
            await p.eval(`${clickText("button", "Where to?")}`);
            await p.waitFor("!!document.querySelector('#time-sheet')", "search form");
        },
        ready: mapIdle,
    },
    {
        name: "planner-steps",
        path: JOURNEY,
        only: "mobile",
        setup: async (p) => {
            await replan(1, "08:00")(p);
            await p.waitFor(`${RESULT}?.innerText.includes("08:00 →")`, "08:00 journey result");
            await sleep(500);
            await p.eval(`${clickText("button", "Steps")}`);
            await sleep(600);
        },
        ready: mapIdle,
    },
    {
        name: "planner-compare",
        path: MANY_ROUTES,
        setup: async (p) => {
            await openCompare(p);
        },
        ready: mapIdle,
    },
    {
        name: "planner-compare-pick",
        path: MANY_ROUTES,
        setup: async (p) => {
            await openCompare(p);
            const count = await p.eval(`document.querySelectorAll('[role=radio]').length`);
            if (count < 2) throw new Error("expected at least two route options for the README journey, got " + count);
            const second = await p.eval(`document.querySelectorAll('[role=radio]')[1].querySelector('span > span').textContent.trim()`);
            await p.eval(`document.querySelectorAll('[role=radio]')[1].click()`);
            await sleep(500);
            const checked = await p.eval(`document.querySelectorAll('[role=radio]')[1]?.getAttribute('aria-checked')`);
            const shown = await p.eval(`${RESULT}?.innerText`);
            if (checked !== "true" && !shown.includes(second)) throw new Error("choosing the second option did not make it the route in use");
            if (!shown.includes(second)) throw new Error("headline does not show the chosen option's duration " + second);
        },
        ready: mapIdle,
    },
    {
        name: "planner-saved-alternative",
        path: async () => {
            const body = { source_lat: -33.978, source_lon: 18.57, target_lat: -33.9025, target_lon: 18.4207, ...plannerNow(), alternatives: 5 };
            const res = await fetch((args.api ?? "http://127.0.0.1:8000") + "/api/plan/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
            const second = (await res.json()).journeys?.[1];
            if (!second) throw new Error("the planner returned no second option for the many-routes trip");
            globalThis.__altDuration = second.summary.duration;
            return `${MANY_ROUTES}&alt=${encodeURIComponent(second.signature)}`;
        },
        setup: async (p) => {
            await p.waitFor(`${RESULT}?.innerText.includes("Route 2 in use")`, "the saved alternative in use");
            const shown = await p.eval(`${RESULT}?.innerText`);
            const want = Math.floor(globalThis.__altDuration / 60) + " h " + String(globalThis.__altDuration % 60).padStart(2, "0") + " min";
            if (!shown.includes(want)) throw new Error("expected the saved alternative (" + want + ") to be shown, got: " + shown.slice(0, 120));
        },
        ready: mapIdle,
    },
    {
        name: "planner-wheel-up-down",
        path: JOURNEY,
        only: "mobile",
        setup: async (p) => {
            await replan(1, "08:00")(p);
            await p.waitFor(`${RESULT}?.innerText.includes("08:00 →")`, "08:00 journey result");
            await sleep(500);
            const height = () => p.eval(`Math.round(document.querySelector('section[aria-label="Journey planner"]').getBoundingClientRect().height)`);
            const wheel = (dy) => p.eval(`document.querySelector('section[aria-label="Journey planner"]').dispatchEvent(new WheelEvent('wheel', { deltaY: ${dy}, bubbles: true, cancelable: true }))`);
            const peek = await height();
            await wheel(60);
            await sleep(600);
            const expanded = await height();
            await wheel(-60);
            await sleep(600);
            const back = await height();
            console.log(`sheet height: peek ${peek}px, after scroll down ${expanded}px, after scroll up ${back}px`);
            if (!(expanded > peek + 100 && Math.abs(back - peek) < 4)) throw new Error('sheet did not expand and collapse');
            await wheel(60);
            await sleep(600);
        },
        ready: mapIdle,
    },
    {
        name: "planner-pull-open",
        path: "/",
        only: "mobile",
        setup: async (p) => {
            await p.waitFor("!!window.__map", "planner");
            await p.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Where to?')`, "Where to? button");
            await sleep(500);
            await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
            const pull = async (x, y) => {
                await p.send("Input.synthesizeScrollGesture", { x, y, yDistance: -200, gestureSourceType: "touch", speed: 800 });
                await sleep(700);
                return p.eval(`!!document.querySelector('#time-sheet')`);
            };
            const spot = (find) =>
                p.eval(`(() => { const r = (${find}).getBoundingClientRect(); return [Math.round(r.left + 40), Math.round(r.top + r.height / 2)]; })()`);
            const onButton = await spot(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Where to?')`);
            const fromButton = await pull(...onButton);
            if (!fromButton) throw new Error('dragging up from "Where to?" did not open the search');
            await p.eval(`[...document.querySelectorAll('button[aria-label="Close search"]')].forEach((b) => b.click())`);
            await sleep(500);
            const around = await p.eval(`(() => { const r = document.querySelector('section[aria-label="Journey planner"]').getBoundingClientRect(); return [Math.round(r.right - 20), Math.round(r.top + 16)]; })()`);
            const fromSpace = await pull(...around);
            if (!fromSpace) throw new Error("dragging up from the space around Where to? did not open the search");
            const sheetBox = () =>
                p.eval(`(() => { const r = document.querySelector('section[aria-label="Journey planner"]').getBoundingClientRect(); return [Math.round(r.left + 100), Math.round(r.top + 50)]; })()`);
            const push = async (x, y) => {
                await p.send("Input.synthesizeScrollGesture", { x, y, yDistance: 250, gestureSourceType: "touch", speed: 800 });
                await sleep(700);
                return p.eval(`!document.querySelector('#time-sheet')`);
            };
            const closedFromHeading = await push(...(await sheetBox()));
            if (!closedFromHeading) throw new Error("dragging down on the Plan a journey sheet did not close it");
            await p.eval(`location.href = ${JSON.stringify(JOURNEY)}`);
            await p.waitFor(`${RESULT}?.innerText.includes('→')`, "journey result");
            await sleep(800);
            await p.eval(`document.querySelector('button[aria-label="Change journey"]').click()`);
            await p.waitFor("!!document.querySelector('#time-sheet')", "search form");
            await sleep(500);
            const closedOverTrip = await push(...(await sheetBox()));
            console.log(`pull: from the button ${fromButton}, from the space around it ${fromSpace}; drag down closes it ${closedFromHeading}, over a trip ${closedOverTrip}`);
            await p.send("Emulation.setTouchEmulationEnabled", { enabled: false });
            if (!closedOverTrip) throw new Error("dragging down on Change journey did not close it");
        },
        ready: mapIdle,
    },
    {
        name: "planner-touch-up-down",
        path: JOURNEY,
        only: "mobile",
        setup: async (p) => {
            await replan(1, "08:00")(p);
            await p.waitFor(`${RESULT}?.innerText.includes("08:00 →")`, "08:00 journey result");
            await sleep(500);
            await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
            const sheet = `document.querySelector('section[aria-label="Journey planner"]')`;
            const height = () => p.eval(`Math.round(${sheet}.getBoundingClientRect().height)`);
            const swipe = async (x, y, distance) => {
                await p.send("Input.synthesizeScrollGesture", { x, y, yDistance: distance, gestureSourceType: "touch", speed: 800 });
                await sleep(700);
            };
            const topOf = () => p.eval(`Math.round(${sheet}.getBoundingClientRect().top)`);
            const peek = await height();
            await swipe(60, (await topOf()) + 80, -200);
            const up = await height();
            await swipe(60, (await topOf()) + 50, 250);
            const down = await height();
            await swipe(300, (await topOf()) + peek - 60, -200);
            const upOnButton = await height();
            console.log(`touch: peek ${peek}px, swipe up ${up}px, swipe down ${down}px, swipe up from the buttons ${upOnButton}px`);
            await p.send("Emulation.setTouchEmulationEnabled", { enabled: false });
            if (!(up > peek + 100 && Math.abs(down - peek) < 4 && upOnButton > peek + 100)) throw new Error("touch swipes did not move the sheet");
        },
        ready: mapIdle,
    },
    {
        name: "planner-icon-motion",
        path: JOURNEY,
        only: "desktop",
        setup: async (p) => {
            await sleep(800);
            const turn = () => p.eval(`getComputedStyle(document.querySelector('button[aria-label="Swap start and destination"] svg')).transform`);
            const before = await turn();
            await p.eval(`document.querySelector('button[aria-label="Swap start and destination"]').click()`);
            await sleep(700);
            const after = await turn();
            console.log(`swap icon transform: ${before} -> ${after}`);
            if (before === after) throw new Error("swap icon did not turn");
            const radius = await p.eval(`(() => { const svg = document.querySelector('button[aria-label="Use my location"] svg'); svg.dataset.busy = 'true'; return new Promise((res) => setTimeout(() => res(getComputedStyle(svg.querySelector('.ico-locate-ring')).r + ' ' + getComputedStyle(svg.querySelector('.ico-locate-ring')).opacity), 500)); })()`);
            console.log("locate ring while busy (r, opacity):", radius);
            if (parseFloat(radius) === 7 || parseFloat(radius.split(" ")[1]) === 0) throw new Error("locate ring is not pulsing");
            const pressed = await p.eval(`getComputedStyle(document.querySelector('button[type=submit]')).transitionProperty`);
            if (!pressed.includes("transform")) throw new Error("buttons do not animate transform");
        },
        ready: mapIdle,
    },
    {
        name: "planner-edit",
        path: JOURNEY,
        only: "mobile",
        setup: async (p) => {
            await replan(1, "08:00")(p);
            await p.waitFor(`${RESULT}?.innerText.includes("08:00 →")`, "08:00 journey result");
            await sleep(500);
            await p.eval("document.querySelector('button[aria-label=\"Change journey\"]').click()");
            await p.waitFor("!!document.querySelector('#time-sheet')", "search form");
        },
        ready: mapIdle,
    },
    { name: "login", path: "/login" },
    { name: "signup", path: "/signup" },
    {
        name: "signup-errors",
        path: "/signup",
        setup: async (p) => {
            await p.waitFor("!!document.querySelector('form')", "form");
            await p.eval(`document.querySelector('form button[type=submit]').click()`);
            await p.waitFor("!!document.querySelector('[aria-invalid=true]')", "field errors");
        },
    },
    { name: "about", path: "/about" },
    { name: "faq", path: "/faq" },
    { name: "report", path: "/report" },
    {
        name: "menu-open",
        path: "/about",
        only: "mobile",
        setup: async (p) => {
            await p.waitFor("!!document.querySelector('[aria-controls=mobile-nav]')", "menu button");
            await p.eval(`document.querySelector('[aria-controls=mobile-nav]').click()`);
        },
    },
    { name: "savedroutes", path: "/savedroutes", auth: true, ready: (p) => p.waitFor("!document.body.innerText.includes('Loading…')", "routes") },
    {
        name: "savedroutes-alternative",
        path: "/",
        stub: {
            "*/api/saved-routes/*": [
                { id: 1, name: "To work", start_location: "Gugulethu", end_location: "V&A Waterfront", origin_lat: -33.978, origin_lon: 18.57, dest_lat: -33.9025, dest_lon: 18.4207, route_signature: "ga_GUGULETU>GABS004|mr_HARFIELD_ROAD>mr_133|mc_WOODSTOCK>mc_WATERFRONT", created_at: "2026-10-05T09:00:00Z" },
                { id: 2, name: "", start_location: "Cape Town Station", end_location: "Claremont Station", origin_lat: -33.9221, origin_lon: 18.4257, dest_lat: -33.9806, dest_lon: 18.4653, route_signature: "", created_at: "2026-10-01T09:00:00Z" },
            ],
        },
        setup: async (p) => {
            await p.waitFor("!!window.__map", "planner");
            await p.eval(`(() => {
                const b64 = (o) => btoa(JSON.stringify(o)).split("=").join("").split("+").join("-").split("/").join("_");
                const token = b64({ alg: "none", typ: "JWT" }) + "." + b64({ username: "Alex", token_type: "access", exp: 1893456000 }) + ".demo";
                localStorage.setItem("access", token); localStorage.setItem("refresh", token);
                location.assign("/savedroutes");
            })()`);
            await sleep(1500);
            await p.waitFor("document.body.innerText.includes('To work')", "the stubbed routes");
            const chips = await p.eval(`[...document.querySelectorAll('li')].filter((li) => li.innerText.includes('Chosen route · 3 rides')).length`);
            const fastest = await p.eval(`[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Use fastest').length`);
            if (chips !== 1 || fastest !== 1) throw new Error("expected one chosen-route chip and one Use fastest button, got " + chips + " and " + fastest);
        },
    },
    { name: "settings", path: "/settings", auth: true, ready: (p) => p.waitFor("!document.body.innerText.includes('Loading…')", "settings") },
    {
        name: "account-menu",
        path: "/about",
        auth: true,
        only: "desktop",
        setup: async (p) => {
            await p.waitFor("!!document.querySelector('[aria-haspopup=menu]')", "account button");
            await p.eval(`document.querySelector('[aria-haspopup=menu]').click()`);
        },
    },
];

async function connect() {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((r, j) => {
        ws.addEventListener("open", r, { once: true });
        ws.addEventListener("error", j, { once: true });
    });
    let id = 0;
    const pending = new Map();
    const listeners = new Map();
    ws.addEventListener("message", (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        } else if (msg.method && listeners.has(msg.method)) {
            listeners.get(msg.method)(msg.params);
        }
    });
    const send = (method, params = {}) =>
        new Promise((resolve) => {
            const n = ++id;
            pending.set(n, resolve);
            ws.send(JSON.stringify({ id: n, method, params }));
        });
    const page = {
        send,
        on: (method, fn) => listeners.set(method, fn),
        async stub(map) {
            if (!map) return send("Fetch.disable");
            listeners.set("Fetch.requestPaused", ({ requestId, request }) => {
                if (process.env.DEBUG) console.log("paused", request.method, request.url);
                const hit = Object.entries(map).find(([pattern]) =>
                    new RegExp("^" + pattern.split("*").map((x) => x.replace(/[.?+^$()[\]{}|\\]/g, "\\$&")).join(".*") + "$").test(request.url)
                );
                if (!hit) return send("Fetch.continueRequest", { requestId });
                if (request.method === "OPTIONS") {
                    return send("Fetch.fulfillRequest", {
                        requestId,
                        responseCode: 204,
                        responseHeaders: [
                            { name: "Access-Control-Allow-Origin", value: "*" },
                            { name: "Access-Control-Allow-Methods", value: "GET, POST, PATCH, PUT, DELETE" },
                            { name: "Access-Control-Allow-Headers", value: "content-type, authorization" },
                        ],
                    });
                }
                send("Fetch.fulfillRequest", {
                    requestId,
                    responseCode: 200,
                    responseHeaders: [
                        { name: "Content-Type", value: "application/json" },
                        { name: "Access-Control-Allow-Origin", value: "*" },
                    ],
                    body: Buffer.from(JSON.stringify(hit[1])).toString("base64"),
                });
            });
            return send("Fetch.enable", { patterns: Object.keys(map).map((urlPattern) => ({ urlPattern })) });
        },
        eval: async (expression) =>
            (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value,
        async waitFor(expression, label, timeoutMs = 60000) {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                if (await page.eval(expression)) return;
                await sleep(400);
            }
            const text = await page.eval("document.body.innerText.slice(0, 300)");
            throw new Error(`timed out waiting for ${label} at ${await page.eval("location.href")}\n${text}`);
        },
        async goto(path) {
            await send("Page.navigate", { url: BASE + path });
            await sleep(300);
            await page.waitFor("document.readyState === 'complete' && !!document.querySelector('header')", `load ${path}`);
        },
        close: () => ws.close(),
    };
    listeners.set("Runtime.exceptionThrown", ({ exceptionDetails: d }) =>
        console.error("page error:", d.exception?.description?.split("\n").slice(0, 3).join(" | ") ?? d.text)
    );
    await send("Page.enable");
    await send("Runtime.enable");
    return page;
}

async function signIn(page) {
    await page.goto("/login");
    const ok = await page.eval(`fetch("${BASE.replace(/:\d+$/, ":8000")}/api/login/", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({username: ${JSON.stringify(args.user)}, password: ${JSON.stringify(args.password)}})
    }).then(r => r.ok ? r.json() : null).then(d => {
        if (!d) return false;
        localStorage.setItem("access", d.access); localStorage.setItem("refresh", d.refresh); return true;
    })`);
    if (!ok) throw new Error("sign-in failed: check --user/--password and that the backend is on :8000");
}

const profile = mkdtempSync(join(tmpdir(), "wayfound-shots-"));
const chrome = spawn(
    CHROME,
    [
        "--headless=new",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
        "--hide-scrollbars",
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${profile}`,
        "about:blank",
    ],
    { stdio: "ignore" }
);

try {
    for (let i = 0; ; i++) {
        try {
            await fetch(`http://127.0.0.1:${PORT}/json`);
            break;
        } catch {
            if (i > 60) throw new Error("Chrome did not start");
            await sleep(250);
        }
    }
    mkdirSync(OUT, { recursive: true });
    const page = await connect();
    const canAuth = Boolean(args.user && args.password);
    let signedIn = false;

    for (const shot of SHOTS) {
        if (ONLY && !ONLY.has(shot.name)) continue;
        if (shot.auth && !canAuth) {
            console.log(`skip ${shot.name} (needs --user/--password)`);
            continue;
        }
        if (shot.auth !== signedIn && canAuth) {
            if (shot.auth) await signIn(page);
            else await page.eval("localStorage.clear()");
            signedIn = Boolean(shot.auth);
        }
        for (const [label, [width, height]] of Object.entries(VIEWPORTS)) {
            if (shot.only && shot.only !== label) continue;
            await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: label === "mobile" });
            await page.stub(shot.stub ?? null);
            await page.goto(typeof shot.path === "function" ? await shot.path() : shot.path);
            await page.eval("document.fonts.ready.then(() => true)");
            if (shot.setup) await shot.setup(page);
            if (shot.ready) await shot.ready(page);
            await sleep(shot.ready === mapIdle || shot.name.startsWith("planner") ? 1500 : 500);
            const overflow = await page.eval(OVERFLOW_CHECK);
            if (overflow?.length) {
                console.log(`OVERFLOW ${shot.name} (${label}):`);
                overflow.slice(0, 8).forEach((line) => console.log("   ", line));
                process.exitCode = 1;
            }
            const file = join(OUT, `${shot.name}-${label}.png`);
            const { result } = await page.send("Page.captureScreenshot", { format: "png" });
            writeFileSync(file, Buffer.from(result.data, "base64"));
            console.log("wrote", file);
        }
    }
    const errors = await page.eval("JSON.stringify(window.__mapErrors ?? [])");
    if (errors !== "[]") console.log("map errors:", errors);
    page.close();
} finally {
    const exited = new Promise((r) => chrome.once("exit", r));
    chrome.kill();
    await Promise.race([exited, sleep(5000)]);
    try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
    }
}
