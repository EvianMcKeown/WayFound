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
const PORT = 9300 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
{
    const problems = checkScript();
    for (const p of problems) console.warn("caption check:", p);
    if (args.check) {
        console.log(problems.length ? `${problems.length} caption problem(s)` : "captions OK");
        process.exit(problems.length ? 1 : 0);
    }
}

mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "wayfound-video-"));
const dist = join(tmpdir(), "wayfound-video-dist");

if (!args["no-build"] || !existsSync(join(dist, "index.html"))) {
    console.log("building the app…");
    const b = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--outDir", dist, "--emptyOutDir"], { cwd: join(root, "src/frontend"), stdio: "inherit" });
    if (b.status !== 0) throw new Error("build failed");
}

const { server, origin } = await startServer({ dist, stageDir: here });
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
const video = join(OUT, "help-video.mp4");
const rawVideo = join(work, "raw.mp4");
let sink = null;
let shots = 0;
async function enableVirtualTime() {
    sink = frameSink({ out: rawVideo, fps: FPS, width: 1920, height: 1080 });
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
    shots += n;
    frameCount++;
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

async function dissolveTo(zoom = 1, ms = 900, mode = "fade") {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await ev(`stage.ghost(${q("data:image/png;base64," + shot.result.data)})`);
    await ev(`stage.swapNow(${zoom})`);
    await ev(`stage.dissolve(${ms}, ${zoom}, ${q(mode)})`);
}

const api = { ev, send, wait, caption, click, clickHere, pointer, type, waitRect, waitFor, waitMap, focus, home, camera, union, rectsOf, dissolveTo, poster, origin, q };
const scenes = storyboard(api);

const sceneTimes = [];
try {
    await connect();
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: SCALE, mobile: false });
    await send("Runtime.addBinding", { name: "__mouse" });
    await send("Runtime.addBinding", { name: "__touch" });
    wireInput();
    await send("Page.navigate", { url: `${origin}/stage.html` });
    await waitFor("document.readyState === 'complete' && !!window.stage", "stage");
    const renderer = await ev(`(() => { const g = document.createElement("canvas").getContext("webgl2"); const x = g && g.getExtension("WEBGL_debug_renderer_info"); return g ? (x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) : "no WebGL"; })()`);
    console.log("rendering with:", renderer);
    console.log(BLUR > 1 ? `motion blur: up to ${BLUR} shots per frame, shutter open ${Math.round(SHUTTER * 360)}°` : "motion blur: off");
    if (GPU !== "software" && !renderer.toLowerCase().includes(GPU)) throw new Error(`wanted a ${GPU} GPU but the browser is using "${renderer}"`);
    await ev("document.fonts.ready.then(() => true)");
    await ev("stage.cardPre('Every bus and train. One map.')");
    await ev("stage.fade(true, 0)");
    await sleep(1500);
    await enableVirtualTime();
    await ev("stage.fade(false, 600)");
    await wait(300);
    const started = Date.now();
    for (const [name, play] of Object.entries(scenes)) {
        if (ONLY && !ONLY.has(name)) continue;
        const s0 = Date.now(), v0 = clock();
        try {
            await play();
        } catch (err) {
            const shot = await send("Page.captureScreenshot", { format: "png" }, 20000).catch(() => null);
            if (shot?.result?.data) {
                writeFileSync(join(OUT, "failed.png"), Buffer.from(shot.result.data, "base64"));
                console.error(`the ${name} scene failed ${((clock() - v0) / 1000).toFixed(1)}s in; the stage at that moment is in ${join(OUT, "failed.png")}`);
            }
            throw err;
        }
        sceneTimes.push({ name, start: v0, end: clock() });
        console.log(`${name}: ${((clock() - v0) / 1000).toFixed(1)}s of video (rendered in ${((Date.now() - s0) / 1000).toFixed(0)}s)`);
    }
    await caption(null);
    await ev("stage.fade(true, 700)");
    await wait(200);
    console.log(`rendered ${frameCount} frames (${(clock() / 1000).toFixed(1)}s of video, ${shots} screenshots: ${(shots / frameCount).toFixed(2)} a frame) in ${((Date.now() - started) / 1000).toFixed(0)}s`);
} finally {
    ws?.close();
    chrome.kill();
    server.close();
}

if (frameCount < 10) throw new Error("no frames captured");
const total = frameCount / FPS;
if ((await sink.close()) !== 0) throw new Error("ffmpeg failed");

const barFilter = args["no-bar"]
    ? "format=yuv420p"
    : `[0:v]drawbox=x=0:y=ih-6:w=iw:h=6:color=0x1a1f1a@0.14:t=fill[track];[track][1:v]overlay=x='-w+w*min(1,t/${total.toFixed(3)})':y=H-h:shortest=1,format=yuv420p`;
const final = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", rawVideo, ...(args["no-bar"] ? ["-vf", barFilter] : ["-f", "lavfi", "-i", `color=c=0x1bb625:s=1920x6:r=${FPS}`, "-filter_complex", barFilter]),
    "-r", String(FPS), "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-movflags", "+faststart", "-an", video], { stdio: "inherit" });
if (final.status !== 0) throw new Error("ffmpeg failed (progress bar pass)");

const posterSec = posterAt != null ? Math.min(total - 0.1, posterAt / 1000 + 1) : Math.min(total - 0.1, 2);
spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", posterSec.toFixed(3), "-i", video, "-frames:v", "1", "-q:v", "3", join(OUT, "help-video-poster.jpg")]);

const stamp = (ms) => { const t = Math.max(0, Math.round(ms)); const h = String(Math.floor(t / 3600000)).padStart(2, "0"), m = String(Math.floor(t / 60000) % 60).padStart(2, "0"), s = String(Math.floor(t / 1000) % 60).padStart(2, "0"), x = String(t % 1000).padStart(3, "0"); return `${h}:${m}:${s}.${x}`; };
writeFileSync(join(OUT, "help-video.vtt"), "WEBVTT\n\n" + cues.filter((c) => c.end).map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join("\n"));

const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
console.log(`\ntimeline (${total.toFixed(1)}s):`);
for (const s of sceneTimes) {
    console.log(`  ${mmss(s.start)} - ${mmss(s.end)}  ${s.name.toUpperCase()}`);
    for (const c of cues.filter((c) => c.end && c.start >= s.start && c.start < s.end)) {
        const short = c.end - c.start < MIN_CAPTION_MS ? `   <- only ${((c.end - c.start) / 1000).toFixed(1)}s on screen (at least ${MIN_CAPTION_MS / 1000}s)` : "";
        console.log(`      ${mmss(c.start)}  ${c.text}${short}`);
    }
}

if (!args.keep) rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log("wrote", video);
