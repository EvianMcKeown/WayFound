import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".mp4": "video/mp4",
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const DEMO_TOKEN = `${b64({ alg: "none", typ: "JWT" })}.${b64({ username: "Alex", token_type: "access", exp: 1893456000 })}.demo`;

const CLOCK = `<script>
window.__WAYFOUND_CAPTURE__ = true;
try { localStorage.setItem("access", "${DEMO_TOKEN}"); localStorage.setItem("refresh", "${DEMO_TOKEN}"); } catch { /* no storage */ }
(() => {
    const Real = Date;
    const base = new Real(2026, 9, 6, 8, 0, 0).getTime(); // Tuesday 6 October 2026, 08:00
    const start = Real.now();
    const now = () => base + (Real.now() - start);
    class FakeDate extends Real {
        constructor(...args) {
            if (args.length === 0) super(now());
            else super(...args);
        }
        static now() {
            return now();
        }
    }
    window.Date = FakeDate;
})();
</script>`;

const PLACES = [
    { label: "Gugulethu, Cape Town", lat: -33.978, lon: 18.57 },
    { label: "Gugulethu Square, NY1, Gugulethu, Cape Town", lat: -33.9768, lon: 18.5725 },
    { label: "Gugulethu Sports Complex, Cape Town", lat: -33.9791, lon: 18.5664 },
    { label: "V&A Waterfront, Cape Town", lat: -33.9025, lon: 18.4207 },
    { label: "V&A Waterfront Clock Tower, Cape Town", lat: -33.9038, lon: 18.4217 },
    { label: "V&A Waterfront Amphitheatre, Cape Town", lat: -33.9031, lon: 18.4192 },
];

function geocode(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return PLACES.filter((p) => words.every((w) => p.label.toLowerCase().includes(w)));
}

export function startServer({ dist, stageDir, port = 4180, backend = "http://127.0.0.1:8000" }) {
    const indexHtml = readFileSync(join(dist, "index.html"), "utf8").replace("<head>", `<head>${CLOCK}`);

    const send = (res, status, body, type) => {
        res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
        res.end(body);
    };

    const serveFile = (res, root, rel) => {
        const file = normalize(join(root, rel));
        if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return false;
        send(res, 200, readFileSync(file), TYPES[extname(file)] ?? "application/octet-stream");
        return true;
    };

    const server = createServer(async (req, res) => {
        const url = new URL(req.url, "http://x");
        try {
            if (url.pathname === "/stage.html") return void send(res, 200, readFileSync(join(stageDir, "stage.html")), TYPES[".html"]);
            if (url.pathname.startsWith("/stage/") && serveFile(res, stageDir, url.pathname.slice(7))) return;
            if (url.pathname === "/api/preferences/") return void send(res, 200, JSON.stringify({ minimize_walking: false, minimize_stops: false }), TYPES[".json"]);
            if (url.pathname === "/api/saved-routes/" && req.method === "POST") {
                req.resume();
                return void send(res, 201, JSON.stringify({ id: 1 }), TYPES[".json"]);
            }
            if (url.pathname === "/api/geocode/") return void send(res, 200, JSON.stringify(geocode(url.searchParams.get("q") ?? "")), TYPES[".json"]);
            if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin/")) {
                const chunks = [];
                for await (const c of req) chunks.push(c);
                const upstream = await fetch(backend + req.url, {
                    method: req.method,
                    headers: { "content-type": req.headers["content-type"] ?? "application/json" },
                    body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
                });
                return void send(res, upstream.status, Buffer.from(await upstream.arrayBuffer()), upstream.headers.get("content-type") ?? TYPES[".json"]);
            }
            if (url.pathname === "/" || url.pathname === "/index.html") return void send(res, 200, indexHtml, TYPES[".html"]);
            if (serveFile(res, dist, decodeURIComponent(url.pathname))) return;
            send(res, 200, indexHtml, TYPES[".html"]);
        } catch (err) {
            send(res, 500, String(err), "text/plain");
        }
    });
    return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${port}` })));
}
