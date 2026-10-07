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

const VIEWPORTS = { desktop: [1440, 900], mobile: [390, 844] };

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

const replan = (day, time) => async (page) => {
    await page.waitFor("!!window.__map", "planner");
    await page.waitFor(`!!${RESULT}?.innerText.includes('→') || document.body.innerText.includes('No public transport route found')`, "first plan");
    await page.eval(`if (!document.querySelector('#time')) document.querySelector('button[aria-label="Change journey"]')?.click()`);
    await page.waitFor("!!document.querySelector('#time, #time-sheet')", "search form");
    await page.eval(`(${SET_FIELD})("#day, #day-sheet", "${day}"); (${SET_FIELD})("#time, #time-sheet", "${time}")`);
    await sleep(300);
    await page.eval(`document.querySelector('form button[type=submit]').click()`);
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
            await page.goto(shot.path);
            await page.eval("document.fonts.ready.then(() => true)");
            if (shot.setup) await shot.setup(page);
            if (shot.ready) await shot.ready(page);
            await sleep(shot.ready === mapIdle || shot.name.startsWith("planner") ? 1500 : 500);
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
