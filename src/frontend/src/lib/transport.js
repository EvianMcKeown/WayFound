export const OPERATORS = [
    { mode: 0, kind: "myciti", label: "MyCiTi" },
    { mode: 1, kind: "golden-arrow", label: "Golden Arrow" },
    { mode: 2, kind: "metrorail", label: "Metrorail" },
];

export const NO_AVOID = { modes: [], lines: [] };

export const operatorOf = (mode) => OPERATORS.find((o) => o.mode === mode);
export const avoidCount = (a) => a.modes.length + a.lines.length;

const sorted = (xs) => [...xs].sort();
export const sameAvoid = (a, b) =>
    sorted(a.modes).join() === sorted(b.modes).join() && sorted(a.lines.map((l) => l.key)).join() === sorted(b.lines.map((l) => l.key)).join();

export const lineName = (line) => `${line.operator ?? operatorOf(line.mode)?.label ?? ""} ${line.label}`.trim();

export const avoidNames = (a) => [...a.modes.map((m) => operatorOf(m)?.label ?? `mode ${m}`), ...a.lines.map(lineName)];

export const avoidFromPrefs = (p) => ({
    modes: p?.excluded_modes ?? [],
    lines: (p?.excluded_lines_detail ?? []).map((d) => ({
        key: d.key,
        label: d.label,
        mode: d.mode,
        operator: d.operator,
        unavailable: Boolean(d.unavailable),
    })),
});
export const avoidToPrefs = (a) => ({ excluded_modes: a.modes, excluded_lines: a.lines.map((l) => l.key) });

export const avoidToPlan = (a) => ({ exclude_modes: a.modes, exclude_lines: a.lines.map((l) => l.key) });

export const withMode = (a, mode, avoided) => ({
    ...a,
    modes: avoided ? [...new Set([...a.modes, mode])].sort() : a.modes.filter((m) => m !== mode),
});
export const withLine = (a, line) => (a.lines.some((l) => l.key === line.key) ? a : { ...a, lines: [...a.lines, line] });
export const withoutLine = (a, key) => ({ ...a, lines: a.lines.filter((l) => l.key !== key) });
