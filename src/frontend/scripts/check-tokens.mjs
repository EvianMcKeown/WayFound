import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

const ALLOWED_ARBITRARY = {
    "left-[11px]": "centres the trip's connector line (2px) under its 24px leg badge",
    "h-[calc(100%-1.75rem)]": "the connector line runs from below the badge to the next leg",
    "max-h-[calc(100%-4rem)]": "the desktop planner column fits below the 4rem header",
    "sm:grid-cols-[9rem_1fr]": "a label column beside its control (Settings)",
};
const ALLOWED_ARBITRARY_PREFIX = ["transition-["];

const DEFAULT_PALETTE =
    "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone";
const SCALES = {
    rounded: ["", "md", "lg", "xl", "2xl", "3xl", "full", "none"],
    shadow: ["sm", "md", "lg", "sheet", "none"],
    blur: ["3xl"],
    "backdrop-blur": ["md"],
    text: ["2xs", "xs", "sm", "base", "lg", "xl", "3xl", "4xl", "5xl"],
};

const RULES = [
    { name: "default palette colour", re: new RegExp(`\\b[a-z-]+-(?:${DEFAULT_PALETTE})-\\d{2,3}\\b`, "g") },
    { name: "colour literal", re: /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(/g },
    { name: "numeric duration", re: /\b(?:duration|delay)-\d+\b/g },
    {
        name: "arbitrary value",
        re: /(?:^|[\s"'`{(])((?:[a-z0-9-]+:)*[a-z][a-z0-9-]*-\[[^\]\s]+\])/g,
        group: 1,
        allow: (m) => m.replace(/^(?:[a-z0-9-]+:)*/, "") in ALLOWED_ARBITRARY || m in ALLOWED_ARBITRARY || ALLOWED_ARBITRARY_PREFIX.some((p) => m.replace(/^(?:[a-z0-9-]+:)*/, "").startsWith(p)),
    },
    {
        name: "off-scale size",
        re: /(?:^|[\s"'`{(:])((?:backdrop-blur|blur|rounded(?:-[trbl]{1,2})?|shadow|text)(?:-[a-z0-9]+)?)(?=[\s"'`}):]|$)/g,
        group: 1,
        allow: (m) => {
            const [, kind, size = ""] = /^(backdrop-blur|blur|rounded|shadow|text)(?:-[trbl]{1,2})?(?:-(.+))?$/.exec(m.replace(/^(rounded)-[trbl]{1,2}(?=-|$)/, "$1")) ?? [];
            if (!kind) return true;
            if (kind === "text" && !/^(?:\d?xs|sm|base|lg|\d?xl)$/.test(size)) return true;
            if (kind === "shadow" && /^(?:mist|brand|white|black)/.test(size)) return true;
            return SCALES[kind].includes(size);
        },
    },
];

function files(dir) {
    return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? files(p) : /\.(jsx?|css)$/.test(name) ? [p] : [];
    });
}

function codeLines(text) {
    const out = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
    return out.split(/\r?\n/).map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1"));
}

const IGNORED = {
    "src/App.css": "the Vite template's stylesheet; nothing imports it",
};

const problems = [];
for (const file of files(SRC)) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (rel in IGNORED) continue;
    const text = readFileSync(file, "utf8");
    if (file.endsWith(".css")) {
        const theme = /@theme[^{]*\{[\s\S]*?\n\}/.exec(text);
        const before = theme ? text.slice(0, theme.index) : text;
        const after = theme ? text.slice(theme.index + theme[0].length) : "";
        const offset = theme ? before.split("\n").length + theme[0].split("\n").length - 2 : 0;
        for (const [part, start] of [[before, 0], [after, offset]]) {
            codeLines(part).forEach((line, i) => {
                for (const m of line.matchAll(RULES[1].re)) problems.push(`${rel}:${start + i + 1}: colour literal outside @theme: ${m[0]}`);
            });
        }
        continue;
    }
    codeLines(text).forEach((line, i) => {
        for (const rule of RULES) {
            for (const m of line.matchAll(rule.re)) {
                const hit = m[rule.group ?? 0];
                if (rule.allow?.(hit)) continue;
                problems.push(`${rel}:${i + 1}: ${rule.name}: ${hit}`);
            }
        }
    });
}

if (problems.length) {
    console.error(problems.join("\n"));
    console.error(`\n${problems.length} value(s) outside the design tokens (docs/design/system.md). Use a token, or add one to src/index.css.`);
    process.exit(1);
}
console.log("check-tokens: every value comes from the design tokens");
