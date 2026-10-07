import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { DEFAULT_AREA_RADIUS_M, MODE_STYLE, approximateAreas, journeyStops } from "../lib/journey";

maplibregl.setWorkerUrl(workerUrl);

const STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";
const CAPE_TOWN = [18.4241, -33.9249];

function pin(color) {
    const el = document.createElement("div");
    const dot = document.createElement("div");
    dot.className = "map-pin";
    dot.style.cssText = `width:16px;height:16px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)`;
    el.appendChild(dot);
    return el;
}

const EMPTY = [];
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const FADE_LAYERS = [
    ["legs-casing", "line-opacity"],
    ...Object.keys(MODE_STYLE).map((kind) => [`legs-${kind}`, "line-opacity"]),
    ["stops-dot", "circle-opacity"],
    ["stops-dot", "circle-stroke-opacity"],
];

function circle([lon, lat], metres, steps = 40) {
    const dLat = metres / 111320;
    const dLon = metres / (111320 * Math.cos((lat * Math.PI) / 180));
    const ring = Array.from({ length: steps + 1 }, (_, i) => {
        const a = (2 * Math.PI * i) / steps;
        return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)];
    });
    return { type: "Polygon", coordinates: [ring] };
}

function addOverlayLayers(map) {
    const empty = { type: "FeatureCollection", features: [] };
    map.addSource("areas", { type: "geojson", data: empty });
    map.addLayer({ id: "areas-fill", type: "fill", source: "areas", paint: { "fill-color": "#d9b45a", "fill-opacity": 0.22 } });
    map.addLayer({
        id: "areas-outline",
        type: "line",
        source: "areas",
        paint: { "line-color": "#9a7a2e", "line-width": 1.5, "line-dasharray": [2, 2] },
    });
    map.addSource("alts", { type: "geojson", data: empty });
    map.addLayer({
        id: "alts-line",
        type: "line",
        source: "alts",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
            "line-color": "#5f7062",
            "line-width": ["case", ["get", "hl"], 6, 3],
            "line-opacity": ["case", ["get", "hl"], 0.85, 0.45],
            "line-width-transition": { duration: 200 },
            "line-opacity-transition": { duration: 200 },
        },
    });
    map.addSource("legs", { type: "geojson", data: empty });
    map.addLayer({
        id: "legs-casing",
        type: "line",
        source: "legs",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 8 },
    });
    for (const [kind, style] of Object.entries(MODE_STYLE)) {
        map.addLayer({
            id: `legs-${kind}`,
            type: "line",
            source: "legs",
            filter: ["==", ["get", "kind"], kind],
            layout: { "line-cap": style.dash ? "butt" : "round", "line-join": "round" },
            paint: {
                "line-color": style.color,
                "line-width": 5,
                ...(style.dash ? { "line-dasharray": [1.2, 1.6] } : {}),
            },
        });
    }
    map.addSource("stops", { type: "geojson", data: empty });
    map.addLayer({
        id: "stops-dot",
        type: "circle",
        source: "stops",
        paint: {
            "circle-radius": ["case", ["==", ["get", "role"], "end"], 6, 3.5],
            "circle-color": "#ffffff",
            "circle-stroke-width": 2,
            "circle-stroke-color": ["case", ["get", "approx"], "#9a7a2e", "#1a1f1a"],
        },
    });
    map.addLayer({
        id: "stops-label",
        type: "symbol",
        source: "stops",
        filter: ["==", ["get", "role"], "end"],
        minzoom: 12,
        layout: {
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 12,
            "text-offset": [0, 1.1],
            "text-anchor": "top",
            "text-optional": true,
        },
        paint: { "text-color": "#1a1f1a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
    });
}

export default function MapView({
    origin,
    destination,
    legs,
    altRoutes = EMPTY,
    highlight = null,
    areaRadius = DEFAULT_AREA_RADIUS_M,
    insetLeft = 0,
    insetTop = 0,
    insetBottom = 0,
}) {
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const markersRef = useRef([]);
    const readyRef = useRef(false);
    const boundsRef = useRef(null);
    const propsRef = useRef({ origin, destination, legs, altRoutes, highlight, areaRadius, insetLeft, insetTop, insetBottom });
    propsRef.current = { origin, destination, legs, altRoutes, highlight, areaRadius, insetLeft, insetTop, insetBottom };

    const applyInsets = () => {
        const map = mapRef.current;
        if (!map) return;
        const { insetLeft, insetTop, insetBottom } = propsRef.current;
        map.setPadding({ left: insetLeft, top: insetTop, right: 0, bottom: insetBottom });
        const topRight = containerRef.current?.querySelector(".maplibregl-ctrl-top-right");
        if (topRight) topRight.style.top = `${insetTop}px`;
    };

    const drawAlts = () => {
        const map = mapRef.current;
        if (!map || !readyRef.current) return;
        const { altRoutes, highlight } = propsRef.current;
        map.getSource("alts").setData({
            type: "FeatureCollection",
            features: altRoutes.flatMap((r) =>
                r.legs.map((l) => ({
                    type: "Feature",
                    properties: { hl: r.index === highlight },
                    geometry: { type: "LineString", coordinates: l.shape ?? [l.from, l.to] },
                }))
            ),
        });
    };

    const draw = () => {
        const map = mapRef.current;
        if (!map || !readyRef.current) return;
        const { origin, destination, legs, areaRadius } = propsRef.current;

        map.getSource("legs").setData({
            type: "FeatureCollection",
            features: legs.map((l) => ({
                type: "Feature",
                properties: { kind: l.kind },
                geometry: { type: "LineString", coordinates: l.shape ?? [l.from, l.to] },
            })),
        });

        const stops = journeyStops(legs);
        map.getSource("areas").setData({
            type: "FeatureCollection",
            features: approximateAreas(stops).map((a) => ({
                type: "Feature",
                properties: { name: a.name },
                geometry: circle(a.coord, areaRadius),
            })),
        });
        map.getSource("stops").setData({
            type: "FeatureCollection",
            features: stops.map((s) => ({
                type: "Feature",
                properties: { name: s.name, approx: s.approx, role: s.role },
                geometry: { type: "Point", coordinates: s.coord },
            })),
        });

        markersRef.current.forEach((m) => m.remove());
        markersRef.current = [];
        const bounds = new maplibregl.LngLatBounds();
        const addPin = (place, color) => {
            if (!place) return;
            markersRef.current.push(
                new maplibregl.Marker({ element: pin(color) }).setLngLat([place.lon, place.lat]).addTo(map)
            );
            bounds.extend([place.lon, place.lat]);
        };
        addPin(origin, "#1a1f1a");
        addPin(destination, "#108418");
        legs.forEach((l) => (l.shape ?? [l.from, l.to]).forEach((pt) => bounds.extend(pt)));

        if (legs.length && !prefersReducedMotion()) {
            FADE_LAYERS.forEach(([id, prop]) => {
                map.setPaintProperty(id, `${prop}-transition`, { duration: 0, delay: 0 });
                map.setPaintProperty(id, prop, 0);
            });
            setTimeout(() => {
                if (mapRef.current !== map) return;
                FADE_LAYERS.forEach(([id, prop]) => {
                    map.setPaintProperty(id, `${prop}-transition`, { duration: 700, delay: 0 });
                    map.setPaintProperty(id, prop, 1);
                });
            }, 60);
        }

        boundsRef.current = bounds.isEmpty() ? null : bounds;
        fit(map.loaded() ? 600 : 0);
        drawAlts();
    };

    const fit = (duration) => {
        const map = mapRef.current;
        if (!map || !readyRef.current || !boundsRef.current) return;
        map.fitBounds(boundsRef.current, { padding: 48, maxZoom: 15, duration });
    };

    useEffect(() => {
        let map = null;
        let ro = null;
        const timer = setTimeout(() => {
            map = new maplibregl.Map({
                container: containerRef.current,
                style: STYLE_URL,
                center: CAPE_TOWN,
                zoom: 11,
            });
            mapRef.current = map;
            if (import.meta.env.DEV || window.__WAYFOUND_CAPTURE__) {
                window.__map = map;
                window.__mapErrors = [];
                map.on("error", (e) => window.__mapErrors.push(String(e.error?.message ?? e.error)));
            }
            map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
            applyInsets();

            map.on("load", () => {
                addOverlayLayers(map);
                map.on("click", "stops-dot", (e) => {
                    const f = e.features[0];
                    const note = f.properties.approx === true || f.properties.approx === "true"
                        ? "<br><span style=\"color:#7a5f1f\">Area stop: the bus stops somewhere around here</span>"
                        : "";
                    new maplibregl.Popup({ closeButton: false, offset: 10 })
                        .setLngLat(f.geometry.coordinates)
                        .setHTML(`<strong></strong>${note}`)
                        .addTo(map)
                        .getElement()
                        .querySelector("strong").textContent = f.properties.name;
                });
                map.on("mouseenter", "stops-dot", () => (map.getCanvas().style.cursor = "pointer"));
                map.on("mouseleave", "stops-dot", () => (map.getCanvas().style.cursor = ""));
                readyRef.current = true;
                draw();
            });

            ro = new ResizeObserver(() => map.resize());
            ro.observe(containerRef.current);
        }, 0);

        return () => {
            clearTimeout(timer);
            ro?.disconnect();
            readyRef.current = false;
            markersRef.current = [];
            map?.remove();
            mapRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- creates the map once; draw/applyInsets read the latest props through propsRef
    }, []);

    useEffect(() => {
        applyInsets();
        fit(300);
    }, [insetLeft, insetTop, insetBottom]);

    useEffect(draw, [origin, destination, legs]);
    useEffect(drawAlts, [altRoutes, highlight]);
    useEffect(() => {
        if (!altRoutes.length || !boundsRef.current) return;
        altRoutes.forEach((r) => r.legs.forEach((l) => (l.shape ?? [l.from, l.to]).forEach((pt) => boundsRef.current.extend(pt))));
        fit(600);
    }, [altRoutes]);

    return <div ref={containerRef} className="h-full w-full" role="region" aria-label="Map" />;
}
