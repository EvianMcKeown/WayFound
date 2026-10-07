const fmt = (n) => Number(n).toFixed(5);

export function plannerLink(origin, destination) {
    const p = new URLSearchParams({
        from: `${fmt(origin.lat)},${fmt(origin.lon)}`,
        fromLabel: origin.label,
        to: `${fmt(destination.lat)},${fmt(destination.lon)}`,
        toLabel: destination.label,
    });
    return `/?${p}`;
}

export function savedRouteLink(r) {
    const alt = r.route_signature ? { alt: r.route_signature } : {};
    if ([r.origin_lat, r.origin_lon, r.dest_lat, r.dest_lon].every((v) => v != null)) {
        const link = plannerLink(
            { lat: r.origin_lat, lon: r.origin_lon, label: r.start_location },
            { lat: r.dest_lat, lon: r.dest_lon, label: r.end_location }
        );
        return r.route_signature ? `${link}&${new URLSearchParams(alt)}` : link;
    }
    return `/?${new URLSearchParams({ from: r.start_location, to: r.end_location, ...alt })}`;
}

function parsePlace(value, label) {
    const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(value ?? "");
    if (!m) return null;
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon, label: label || `${fmt(lat)}, ${fmt(lon)}` };
}

export function readPlannerLink(params) {
    const from = params.get("from");
    const to = params.get("to");
    if (!from || !to) return null;
    const a = parsePlace(from, params.get("fromLabel"));
    const b = parsePlace(to, params.get("toLabel"));
    const alt = params.get("alt") || null;
    return a && b ? { places: [a, b], alt } : { text: [from, to], alt };
}
