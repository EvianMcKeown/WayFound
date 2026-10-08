import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { frameSink } from "./frames.mjs";
import { startServer } from "./server.mjs";
import storyboard from "./storyboard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") ? "1" : all[i + 1] ?? "1"]] : acc), [])
);
const OUT = resolve(args.out ?? "help-video");
const SCALE = Number(args.scale) || 1;
const FPS = Number(args.fps) || 30;
const GPU = (args.gpu ?? "nvidia").toLowerCase();
const STEP = 1000 / FPS;
const BLUR = Math.max(1, Math.round(Number(args.blur ?? 32)) || 1);
const GAP_PX = 1;
const SHUTTER = BLUR > 1 ? Math.min(1, Math.max(0.05, Number(args.shutter ?? 0.5) || 0.5)) : 1;
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const CHROME = args.chrome ?? "google-chrome";
const WORKER = args.worker ? args.worker.split(",") : null;
const PORT = Number(args["cdp-port"]) || 9300 + Math.floor(Math.random() * 500);
const W = 1920, H = 1080, FRAME_BYTES = W * H * 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sceneOf = (s) => (typeof s === "function" ? { play: s } : s);

const MAX_WORDS = 6, MIN_CAPTION_MS = 1500;
const plain = (html) => html.replace(/<[^>]+>/g, "");
const words = (text) => text.split(/\s+/).filter((w) => /\w/.test(w)).length;
function checkScript() {
    const unquote = (s) => JSON.parse(`"${s}"`);
    const board = [...readFileSync(join(here, "storyboard.mjs"), "utf8").matchAll(/^(?!\s*\/\/).*?\bcaption\(\s*"((?:[^"\\]|\\.)*)"/gm)].map((m) => plain(unquote(m[1])));
    const script = [...readFileSync(join(here, "script.txt"), "utf8").matchAll(/^\s*CAPTION\s+"([^"]*)"/gm)].map((m) => m[1]);
    const problems = [];
    for (let i = 0; i < Math.max(board.length, script.length); i++) {
        if (board[i] !== script[i]) problems.push(`caption ${i + 1}: storyboard.mjs says ${JSON.stringify(board[i] ?? "(nothing)")}, script.txt says ${JSON.stringify(script[i] ?? "(nothing)")}`);
    }
    for (const c of board) if (words(c) > MAX_WORDS) problems.push(`${JSON.stringify(c)} has ${words(c)} words (at most ${MAX_WORDS})`);
    return problems;
}
if (!WORKER) {
    const problems = checkScript();
    for (const p of problems) console.warn("caption check:", p);
    if (args.check) {
        console.log(problems.length ? `${problems.length} caption problem(s)` : "captions OK");
        process.exit(problems.length ? 1 : 0);
    }
}

const dist = join(tmpdir(), "wayfound-video-dist");
const cacheDir = join(tmpdir(), "wayfound-video-cache");

if (!WORKER) {
    mkdirSync(OUT, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
    const work = mkdtempSync(join(tmpdir(), "wayfound-video-"));

    if (!args["no-build"] || !existsSync(join(dist, "index.html"))) {
        console.log("building the app…");
        const b = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--outDir", dist, "--emptyOutDir"], { cwd: join(root, "src/frontend"), stdio: "inherit" });
        if (b.status !== 0) throw new Error("build failed");
    }

    const meta = Object.fromEntries(Object.entries(storyboard(new Proxy({}, { get: (_, k) => (k === "q" ? JSON.stringify : undefined) }))).map(([k, s]) => [k, sceneOf(s)]));
    const order = Object.keys(meta).filter((n) => !ONLY || ONLY.has(n));
    if (!order.length) throw new Error(`no such scene: ${args.only}`);
    const groups = args.sequential ? [order] : order.map((n) => [n]);

    const timingFile = join(cacheDir, "timing.json"), seedFile = join(cacheDir, "saved-route.json");
    const timing = { intro: 3400, desktop: 47300, phone: 25600, outro: 4400, ...(existsSync(timingFile) ? JSON.parse(readFileSync(timingFile, "utf8")) : {}) };
    const offsets = [];
    for (let gi = 0, at = 0; gi < groups.length; gi++) {
        offsets.push(at);
        for (const n of groups[gi]) at += timing[n] ?? 0;
    }

    const passed = ["--fps", String(FPS), "--blur", String(BLUR), "--shutter", String(SHUTTER), "--scale", String(SCALE), "--gpu", GPU, "--chrome", CHROME, "--out", OUT];
    const children = new Set();
    let runs = 0;
    function runWorker(gi, seed) {
        const group = groups[gi], name = group.join("+"), n = runs++;
        const dir = join(work, `${gi}-${name}-${n}`);
        mkdirSync(dir, { recursive: true });
        const first = meta[group[0]];
        const carry = gi > 0 && first.carry ? first.carry : null;
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--worker", group.join(","), "--seg", dir,
            "--server-port", String(4181 + n), "--cdp-port", String(PORT + 1 + n), "--offset", String(offsets[gi]),
            ...(carry ? ["--carry", carry] : []), ...(gi === groups.length - 1 ? ["--ending"] : []), ...(seed ? ["--seed", seed] : []), ...passed],
            { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
        children.add(child);
        for (const [from, to] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
            let buf = "";
            from.setEncoding("utf8");
            from.on("data", (d) => {
                buf += d;
                for (let i; (i = buf.indexOf("\n")) >= 0; buf = buf.slice(i + 1)) to.write(`[${name}] ${buf.slice(0, i)}\n`);
            });
        }
        return new Promise((res, rej) => child.on("close", (code) => {
            children.delete(child);
            if (code !== 0) return rej(new Error(`the ${name} render failed (exit ${code})`));
            res({ dir, json: JSON.parse(readFileSync(join(dir, "seg.json"), "utf8")) });
        }));
    }
    const killAll = () => { for (const c of children) c.kill(); };
    process.on("SIGINT", () => { killAll(); process.exit(130); });

    const started = Date.now();
    const groupOf = (scene) => groups.findIndex((g) => g.includes(scene));
    const savedSource = (gi) => { const from = meta[groups[gi][0]].savedFrom; const src = from ? groupOf(from) : -1; return src >= 0 && src !== gi ? src : -1; };
    const writeSeed = (r) => { const route = r.json.saved?.[0]; if (route) writeFileSync(seedFile, JSON.stringify(route)); return route; };
    const seedUsed = [];
    const promises = [];
    console.log(`rendering ${groups.map((g) => g.join("+")).join(", ")} ${groups.length > 1 ? "in parallel" : "in one browser"}`);
    for (let gi = 0; gi < groups.length; gi++) {
        const src = savedSource(gi);
        if (src >= 0 && !existsSync(seedFile)) {
            console.log(`${groups[gi].join("+")} waits for ${groups[src].join("+")}: it opens the route that scene saves, and no earlier render has saved one`);
            promises[gi] = promises[src].then((r) => { seedUsed[gi] = JSON.stringify(writeSeed(r) ?? null); return runWorker(gi, seedFile); });
        } else {
            if (src >= 0) seedUsed[gi] = readFileSync(seedFile, "utf8");
            promises[gi] = runWorker(gi, src >= 0 ? seedFile : null);
        }
    }
    let results;
    try {
        results = await Promise.all(promises);
    } catch (err) {
        killAll();
        throw err;
    }
    for (let gi = 0; gi < groups.length; gi++) {
        const src = savedSource(gi);
        if (src < 0) continue;
        const actual = writeSeed(results[src]);
        if (actual && JSON.stringify(actual) !== seedUsed[gi]) {
            console.log(`${groups[gi].join("+")}: ${groups[src].join("+")} saved a different route this time, so it is rendered again with that one`);
            results[gi] = await runWorker(gi, seedFile);
        }
    }
    for (const r of results) for (const s of r.json.sceneTimes) timing[s.name] = Math.round(s.end - s.start);
    writeFileSync(timingFile, JSON.stringify(timing));
    console.log(`all scenes rendered in ${((Date.now() - started) / 1000).toFixed(0)}s; joining them`);

    const inputs = [], parts = [], cues = [], sceneTimes = [];
    let frames = 0, posterAt = null;
    for (let i = 0; i < results.length; i++) {
        const { dir, json } = results[i];
        const segment = join(dir, "seg.mp4");
        const k = i > 0 ? json.carry.length : 0;
        if (k) {
            const prev = readFileSync(join(results[i - 1].dir, "last.rgb"));
            const head = spawnSync("ffmpeg", ["-loglevel", "error", "-i", segment, "-frames:v", String(k), "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { maxBuffer: FRAME_BYTES * k + 1024 });
            if (head.status !== 0 || head.stdout.length < FRAME_BYTES * k) throw new Error(`could not read the first ${k} frames of ${segment}`);
            const mixed = Buffer.allocUnsafe(FRAME_BYTES * k);
            for (let f = 0; f < k; f++) {
                const a = json.carry[f], b = 1 - a, o = f * FRAME_BYTES, src = head.stdout;
                for (let j = 0; j < FRAME_BYTES; j++) mixed[o + j] = (a * prev[j] + b * src[o + j] + 0.5) | 0;
            }
            const clip = join(dir, "carry.mp4");
            const enc = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-framerate", String(FPS), "-i", "pipe:0",
                "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", "-an", clip], { input: mixed, maxBuffer: 1 << 20 });
            if (enc.status !== 0) throw new Error("ffmpeg failed (blending a dissolve)");
            inputs.push(clip);
            parts.push(`[${inputs.length - 1}:v]setpts=PTS-STARTPTS[p${parts.length}]`);
            inputs.push(segment);
            parts.push(`[${inputs.length - 1}:v]trim=start_frame=${k},setpts=PTS-STARTPTS[p${parts.length}]`);
            console.log(`${json.scenes.join("+")}: blended its first ${k} frames with the end of ${results[i - 1].json.scenes.join("+")}`);
        } else {
            inputs.push(segment);
            parts.push(`[${inputs.length - 1}:v]setpts=PTS-STARTPTS[p${parts.length}]`);
        }
        const t0 = frames * STEP;
        for (const c of json.cues) cues.push({ ...c, start: c.start + t0, end: c.end + t0 });
        for (const s of json.sceneTimes) sceneTimes.push({ ...s, start: s.start + t0, end: s.end + t0 });
        if (json.posterAt != null && posterAt == null) posterAt = json.posterAt + t0;
        frames += json.frames;
    }
    if (frames < 10) throw new Error("no frames captured");
    const total = frames / FPS;

    const video = join(OUT, "help-video.mp4");
    const joined = `${parts.join(";")};${parts.map((_, i) => `[p${i}]`).join("")}concat=n=${parts.length}:v=1:a=0[cat]`;
    const graph = args["no-bar"]
        ? `${joined};[cat]format=yuv420p[v]`
        : `${joined};[cat]drawbox=x=0:y=ih-6:w=iw:h=6:color=0x1a1f1a@0.14:t=fill[track];[track][${inputs.length}:v]overlay=x='-w+w*min(1,t/${total.toFixed(3)})':y=H-h:shortest=1,format=yuv420p[v]`;
    const final = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs.flatMap((f) => ["-i", f]),
        ...(args["no-bar"] ? [] : ["-f", "lavfi", "-i", `color=c=0x2c71f8:s=${W}x6:r=${FPS}`]),
        "-filter_complex", graph, "-map", "[v]", "-r", String(FPS), "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-movflags", "+faststart", "-an", video], { stdio: "inherit" });
    if (final.status !== 0) throw new Error("ffmpeg failed (joining the scenes and the progress bar)");

    const posterSec = posterAt != null ? Math.min(total - 0.1, posterAt / 1000 + 1) : Math.min(total - 0.1, 2);
    spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", posterSec.toFixed(3), "-i", video, "-frames:v", "1", "-q:v", "3", join(OUT, "help-video-poster.jpg")]);

    const stamp = (ms) => { const t = Math.max(0, Math.round(ms)); const h = String(Math.floor(t / 3600000)).padStart(2, "0"), m = String(Math.floor(t / 60000) % 60).padStart(2, "0"), s = String(Math.floor(t / 1000) % 60).padStart(2, "0"), x = String(t % 1000).padStart(3, "0"); return `${h}:${m}:${s}.${x}`; };
    writeFileSync(join(OUT, "help-video.vtt"), "WEBVTT\n\n" + cues.filter((c) => c.end).map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join("\n"));

    const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
    console.log(`\ntimeline (${total.toFixed(1)}s, ${frames} frames, rendered in ${((Date.now() - started) / 1000).toFixed(0)}s):`);
    for (const s of sceneTimes) {
        console.log(`  ${mmss(s.start)} - ${mmss(s.end)}  ${s.name.toUpperCase()}`);
        for (const c of cues.filter((c) => c.end && c.start >= s.start && c.start < s.end)) {
            const short = c.end - c.start < MIN_CAPTION_MS ? `   <- only ${((c.end - c.start) / 1000).toFixed(1)}s on screen (at least ${MIN_CAPTION_MS / 1000}s)` : "";
            console.log(`      ${mmss(c.start)}  ${c.text}${short}`);
        }
    }
    if (!args.keep) {
        try {
            rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
        } catch (err) {
            console.warn(`could not remove ${work} (${err.code}); it can be deleted by hand`);
        }
    }
    console.log("wrote", video);
    process.exit(0);
}

const SEG = resolve(args.seg);
const CARRY = args.carry ?? null;
const OFFSET = Number(args.offset) || 0;
mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "wayfound-video-worker-"));

const seed = args.seed ? JSON.parse(readFileSync(args.seed, "utf8")) : null;
const { server, origin, saved } = await startServer({ dist, stageDir: here, port: Number(args["server-port"]) || 4180, seed });
const chrome = spawn(
    CHROME,
    ["--headless=new", ...(GPU === "software"
        ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
        : ["--use-angle=d3d11", "--enable-gpu", "--enable-gpu-rasterization", "--enable-zero-copy"]),
        "--ignore-gpu-blocklist", "--hide-scrollbars", "--mute-audio", "--window-size=1920,1080", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(work, "profile")}`, "about:blank"],
    { stdio: "ignore" }
);

let ws, id = 0;
const pending = new Map();
const handlers = new Map();
async function connect() {
    for (let i = 0; i < 100; i++) {
        try {
            const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
            const t = targets.find((x) => x.type === "page");
            if (t) {
                ws = new WebSocket(t.webSocketDebuggerUrl);
                await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
                break;
            }
        } catch { }
        await sleep(200);
    }
    if (!ws) throw new Error("could not reach the browser");
    ws.addEventListener("message", (e) => {
        const m = JSON.parse(e.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        else if (m.method) handlers.get(m.method)?.(m.params);
    });
}
const send = (method, params = {}, timeoutMs = 120000) =>
    new Promise((resolve, reject) => {
        const n = ++id;
        const timer = setTimeout(() => { pending.delete(n); reject(new Error(`the browser did not answer ${method} within ${timeoutMs / 1000}s (last action: ${lastAction})`)); }, timeoutMs);
        pending.set(n, (m) => { clearTimeout(timer); resolve(m); });
        ws.send(JSON.stringify({ id: n, method, params }));
    });
const on = (method, fn) => handlers.set(method, fn);
let lastAction = "";
const evalRaw = async (expression) => {
    lastAction = expression.slice(0, 90);
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`${expression.slice(0, 80)}: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
};
const ev = async (expression) => {
    if (!virtual) return evalRaw(expression);
    let done = false, value, error;
    evalRaw(expression).then((v) => { done = true; value = v; }, (e) => { done = true; error = e; });
    while (!done) await stepFrame();
    if (error) throw error;
    return value;
};

let virtual = false;
let frameCount = 0;
let budgetDone = null;
const clock = () => frameCount * STEP;
let sink = null;
let shots = 0;
let carrying = !!CARRY;
const carries = [];
async function enableVirtualTime() {
    sink = frameSink({ out: join(SEG, "seg.mp4"), fps: FPS, width: W, height: H });
    on("Emulation.virtualTimeBudgetExpired", () => budgetDone?.());
    await send("Emulation.setVirtualTimePolicy", { policy: "pause" });
    virtual = true;
}
async function advance(ms) {
    const expired = new Promise((resolve, reject) => {
        budgetDone = resolve;
        setTimeout(() => reject(new Error("page time did not advance (a network request may be stuck)")), 30000).unref();
    });
    await send("Emulation.setVirtualTimePolicy", { policy: "pauseIfNetworkFetchesPending", budget: ms });
    await expired;
}
async function stepFrame() {
    const n = BLUR > 1 ? Math.min(BLUR, Math.max(1, Math.ceil((await evalRaw("stage.motion()")) * SHUTTER / GAP_PX))) : 1;
    sink.frame(n);
    if (SHUTTER < 1) await advance(STEP * (1 - SHUTTER));
    for (let i = 0; i < n; i++) {
        await advance((STEP * SHUTTER) / n);
        await evalRaw("stage.tick()");
        const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 92, optimizeForSpeed: true }, 40000);
        await sink.shot(Buffer.from(shot.result.data, "base64"));
    }
    if (carrying) {
        const c = Number(await evalRaw("stage.carry()"));
        if (c > 0.0005) carries.push(c);
        else carrying = false;
    }
    shots += n;
    frameCount++;
    if (frameCount % (FPS * 5) === 0) console.log(`${(clock() / 1000).toFixed(0)}s of video so far`);
}
async function wait(ms) {
    if (!virtual) return sleep(ms);
    for (let n = Math.max(1, Math.round(ms / STEP)); n > 0; n--) await stepFrame();
}
const cues = [];

const mousePos = { x: 0, y: 0 };
let touching = false;
function wireInput() {
    on("Runtime.bindingCalled", ({ name, payload }) => {
        const d = JSON.parse(payload);
        if (name === "__mouse") {
            [mousePos.x, mousePos.y] = d;
            send("Input.dispatchMouseEvent", { type: "mouseMoved", x: d[0], y: d[1], button: "none" });
        } else if (name === "__touch") {
            const [phase, x, y] = d;
            if (phase === "down") {
                touching = true;
                send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
                send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
            } else if (phase === "move" && touching) send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
            else if (phase === "up" && touching) { touching = false; send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 }); }
        }
    });
}

const q = JSON.stringify;
const rect = (sel, text) => ev(`stage.rect(${q(sel)}, ${text == null ? "null" : q(text)})`);
async function waitRect(sel, text, ms = 20000) {
    const t = Date.now();
    for (;;) {
        const r = await rect(sel, text);
        if (r && r.w > 0) return r;
        if (Date.now() - t > ms) throw new Error(`timed out waiting for ${sel} ${text ?? ""}`);
        await wait(150);
    }
}
const waitFor = async (expr, label, ms = 30000) => {
    const t = Date.now();
    while (!(await ev(expr))) {
        if (Date.now() - t > ms) throw new Error(`timed out waiting for ${label}`);
        await wait(200);
    }
};
const waitMap = () => waitFor("stage.mapIdle()", "map idle");
const at = (r, fx = 0.5, fy = 0.5) => [r.x + r.w * fx, r.y + r.h * fy];

async function pointer(sel, text, { fx = 0.5, fy = 0.5, ms } = {}) {
    const r = await waitRect(sel, text);
    const [x, y] = at(r, fx, fy);
    await ev(`stage.moveTo(${x}, ${y}, ${ms ?? "null"})`);
    return r;
}
async function clickHere() {
    await wait(60);
    const [x, y] = await ev("stage.press()");
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await wait(70);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
    await ev("stage.release()");
    await wait(80);
}
async function click(sel, text, opts) {
    await pointer(sel, text, opts);
    await clickHere();
}
async function type(text, perChar = 72) {
    for (const ch of text) {
        await send("Input.insertText", { text: ch });
        await wait(perChar + ((ch.charCodeAt(0) * 7) % 40));
    }
}
let openCue = null;
async function caption(html, text) {
    if (openCue) { openCue.end = clock(); openCue = null; }
    await ev(`stage.caption(${q(html)})`);
    if (html) { openCue = { start: clock(), end: null, text: text ?? plain(html) }; cues.push(openCue); }
}
let posterAt = null;
const poster = () => { posterAt = clock(); };
const camera = (x, y, z, ms) => ev(`stage.camera(${x}, ${y}, ${z}, ${ms})`);
const focus = (r, o) => ev(`stage.focus(${q(r)}, ${q(o ?? {})})`);
const home = (ms) => ev(`stage.home(${ms ?? 1400})`);
const union = (rs) => {
    const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
    return { x: x0, y: y0, w: Math.max(...rs.map((r) => r.x + r.w)) - x0, h: Math.max(...rs.map((r) => r.y + r.h)) - y0 };
};
const rectsOf = (sel) => ev(`[...stage.app().querySelectorAll(${q(sel)})].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }).filter((r) => r.w > 0)`);

let ghostCarried = false;
async function dissolveTo(zoom = 1, ms = 900, mode = "fade") {
    let still = null;
    if (CARRY === "ghost" && !ghostCarried) ghostCarried = true;
    else still = "data:image/png;base64," + (await send("Page.captureScreenshot", { format: "png" })).result.data;
    await ev(`stage.ghost(${q(still)})`);
    await ev(`stage.swapNow(${zoom})`);
    await ev(`stage.dissolve(${ms}, ${zoom}, ${q(mode)})`);
}

const api = { ev, send, wait, caption, click, clickHere, pointer, type, waitRect, waitFor, waitMap, focus, home, camera, union, rectsOf, dissolveTo, poster, origin, q };
const scenes = Object.fromEntries(Object.entries(storyboard(api)).map(([k, s]) => [k, sceneOf(s)]));

const sceneTimes = [];
try {
    await connect();
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
    await send("Runtime.addBinding", { name: "__mouse" });
    await send("Runtime.addBinding", { name: "__touch" });
    wireInput();
    await send("Page.navigate", { url: `${origin}/stage.html` });
    await waitFor("document.readyState === 'complete' && !!window.stage", "stage");
    const renderer = await ev(`(() => { const g = document.createElement("canvas").getContext("webgl2"); const x = g && g.getExtension("WEBGL_debug_renderer_info"); return g ? (x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) : "no WebGL"; })()`);
    console.log("rendering with:", renderer);
    if (GPU !== "software" && !renderer.toLowerCase().includes(GPU)) throw new Error(`wanted a ${GPU} GPU but the browser is using "${renderer}"`);
    await ev("document.fonts.ready.then(() => true)");
    await ev("stage.ready.then(() => true)");
    await scenes[WORKER[0]].setup?.();
    await sleep(1500);
    if (CARRY) await ev(`stage.carryMode = ${q(CARRY)}`);
    await ev(`stage.startClock(${OFFSET})`);
    await enableVirtualTime();
    const started = Date.now();
    for (const [i, name] of WORKER.entries()) {
        const s0 = Date.now(), v0 = clock();
        try {
            if (i > 0) await scenes[name].setup?.();
            await scenes[name].play();
        } catch (err) {
            const shot = await send("Page.captureScreenshot", { format: "png" }, 20000).catch(() => null);
            if (shot?.result?.data) {
                writeFileSync(join(OUT, `failed-${name}.png`), Buffer.from(shot.result.data, "base64"));
                console.error(`the ${name} scene failed ${((clock() - v0) / 1000).toFixed(1)}s in; the stage at that moment is in ${join(OUT, `failed-${name}.png`)}`);
            }
            throw err;
        }
        sceneTimes.push({ name, start: v0, end: clock() });
        console.log(`${name}: ${((clock() - v0) / 1000).toFixed(1)}s of video (rendered in ${((Date.now() - s0) / 1000).toFixed(0)}s)`);
    }
    if (args.ending) {
        await caption(null);
        await ev("stage.fade(true, 700)");
        await wait(200);
    }
    if (openCue) { openCue.end = clock(); openCue = null; }
    console.log(`filmed ${frameCount} frames (${(clock() / 1000).toFixed(1)}s, ${shots} screenshots: ${(shots / frameCount).toFixed(2)} a frame) in ${((Date.now() - started) / 1000).toFixed(0)}s`);
} finally {
    ws?.close();
    chrome.kill();
    server.close();
}

if (frameCount < 1) throw new Error("no frames captured");
if ((await sink.close()) !== 0) throw new Error("ffmpeg failed");
writeFileSync(join(SEG, "last.rgb"), sink.last());
writeFileSync(join(SEG, "seg.json"), JSON.stringify({ scenes: WORKER, frames: frameCount, cues, posterAt, sceneTimes, carry: carries, saved: saved() }));
if (chrome.exitCode == null) await Promise.race([new Promise((r) => chrome.once("exit", r)), sleep(10000)]);
try {
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
} catch (err) {
    console.warn(`could not remove ${work} (${err.code}); it can be deleted by hand`);
}
process.exit(0);
