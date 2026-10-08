export const cssVar = (name) => `var(--${name})`;

export const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

export const resolveColor = (value) => {
    const ref = /^var\(--(.+)\)$/.exec(value);
    return ref ? token(ref[1]) : value;
};

export const ms = (name) => {
    const v = token(name);
    return v.endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000;
};

export const easeCamera = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
