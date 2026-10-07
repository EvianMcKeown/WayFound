export const MODE_STYLE = {
    walk: { label: "Walk", operator: "Walking", color: "#516153", glyph: "#ffffff", dash: true },
    myciti: { label: "Bus", operator: "MyCiTi", color: "#0a5689", glyph: "#ffffff", dash: false },
    "golden-arrow": { label: "Bus", operator: "Golden Arrow", color: "#fa8c26", glyph: "#1a1f1a", dash: false },
    metrorail: { label: "Train", operator: "Metrorail", color: "#00b0df", glyph: "#1a1f1a", dash: false },
};

const RIDE_KIND = { 0: "myciti", 1: "golden-arrow", 2: "metrorail" };
export const rideKind = (mode) => RIDE_KIND[mode] ?? "myciti";

const coord = (stop) => (stop ? [stop.lon, stop.lat] : null);

export function buildLegs(pathObjs, origin, destination) {
    const resolve = (stop, id) => {
        if (id === "virtual_start") return [origin.lon, origin.lat];
        if (id === "virtual_end") return [destination.lon, destination.lat];
        return coord(stop);
    };
    const nameOf = (stop, id) => {
        if (id === "virtual_start") return origin.label;
        if (id === "virtual_end") return destination.label;
        return stop?.name || id;
    };

    const legs = [];
    for (const step of pathObjs) {
        if (step.mode === "transfer") {
            const from = resolve(step.from_stop, step.from_stop_id);
            const to = resolve(step.stop, step.stop_id);
            if (!from || !to) continue;
            legs.push({
                kind: "walk",
                from,
                to,
                fromName: nameOf(step.from_stop, step.from_stop_id),
                toName: nameOf(step.stop, step.stop_id),
                fromApprox: !!step.from_stop?.approximate,
                toApprox: !!step.stop?.approximate,
                minutes: step.transfer_time,
                arrival: step.arrival_time,
            });
        } else if (step.mode === "trip") {
            const boardStop = step.board_stop || step.from_stop;
            const alightStop = step.disembark_stop || step.stop;
            const from = coord(boardStop);
            const to = coord(alightStop);
            if (!from || !to) continue;
            legs.push({
                kind: rideKind(step.route?.mode),
                from,
                to,
                shape: step.shape?.length > 1 ? step.shape : null,
                fromName: boardStop?.name || step.from_stop_id,
                toName: alightStop?.name || step.stop_id,
                fromApprox: !!boardStop?.approximate,
                toApprox: !!alightStop?.approximate,
                along: step.stops_along ?? [],
                routeName: step.route?.name || step.route_id,
                line: step.line ?? null,
                routeId: step.route_id,
                tripId: step.trip_id,
                stops: step.disembark_pos != null && step.board_pos != null
                    ? step.disembark_pos - step.board_pos
                    : null,
                arrival: step.arrival_time,
            });
        }
    }
    return legs;
}

export function summarise(legs, departure, arrival) {
    const rides = legs.filter((l) => l.kind !== "walk");
    return {
        duration: arrival - departure,
        transfers: Math.max(0, rides.length - 1),
        walkMinutes: legs.filter((l) => l.kind === "walk").reduce((s, l) => s + (l.minutes || 0), 0),
    };
}

export function buildOption(j, origin, destination, departure) {
    const legs = buildLegs(j.path_objs || [], origin, destination);
    return {
        legs,
        departure,
        arrival: j.earliest_arrival,
        summary: summarise(legs, departure, j.earliest_arrival),
        rank: j.rank,
        labels: j.labels ?? [],
        signature: j.signature,
    };
}

export function journeyStops(legs) {
    const seen = new Map();
    const add = (coord, name, approx, role) => {
        if (!coord) return;
        const key = coord.join(",");
        const old = seen.get(key);
        if (!old) seen.set(key, { coord, name, approx, role });
        else if (role === "end") old.role = "end";
    };
    for (const l of legs) {
        if (l.kind === "walk") continue;
        (l.along ?? []).forEach((s) => add([s.lon, s.lat], s.name, s.approximate, "via"));
        add(l.from, l.fromName, l.fromApprox, "end");
        add(l.to, l.toName, l.toApprox, "end");
    }
    return [...seen.values()];
}

export const DEFAULT_AREA_RADIUS_M = 400;
export const approximateAreas = (stops) => stops.filter((s) => s.approx);

export const hasApproximate = (legs) => legs.some((l) => l.fromApprox || l.toApprox);
