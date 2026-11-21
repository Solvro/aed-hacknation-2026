"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import {
  AttributionControl,
  Map as MLMap,
  NavigationControl,
  getVersion,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Aed, LngLat, MobileAed } from "./data";

// Worker MapLibre kopiowany do public/vendor przez scripts/copy-maplibre-worker.mjs
// (bundler nie przenosi pliku workera sam). Wersja w URL — świeży cache po aktualizacji.
setWorkerUrl(`/vendor/maplibre-gl-worker.mjs?v=${getVersion()}`);

export interface MapViewHandle {
  flyTo(p: LngLat, zoom?: number): void;
  /** Dopasuj widok, żeby zmieścić wszystkie punkty (np. użytkownik + najbliższe AED). */
  frame(points: LngLat[]): void;
}

export interface Viewport {
  center: LngLat;
  zoom: number;
  bounds: [number, number, number, number]; // w, s, e, n
}

interface Props {
  ref?: Ref<MapViewHandle>;
  aeds: Aed[];
  mobile: MobileAed[] | null;
  selected: Aed | null;
  user: (LngLat & { accuracy: number }) | null;
  dark: boolean;
  onSelect(idx: number): void;
  onViewport(v: Viewport): void;
}

const STYLE = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

// Kolory zgodne z tokenami w aed-map.css (MapLibre nie czyta zmiennych CSS).
const PALETTE = {
  light: { red: "#E0144A", ink: "#1A1D1B", paper: "#FFFFFF", muted: "#7B8781", user: "#1D4ED8", halo: "rgba(29,78,216,0.14)" },
  dark: { red: "#FF4D73", ink: "#EEF3F0", paper: "#141917", muted: "#8E9A94", user: "#7FB0FF", halo: "rgba(127,176,255,0.18)" },
};

const POLAND: [[number, number], [number, number]] = [[14.0, 48.9], [24.3, 55.0]];

// Minimalne typy GeoJSON (pakiet @types/geojson nie jest bezpośrednią zależnością projektu).
type PointFeature = {
  type: "Feature";
  id?: number;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, unknown>;
};
type FC = { type: "FeatureCollection"; features: PointFeature[] };

const emptyFC: FC = { type: "FeatureCollection", features: [] };

function toFC(aeds: Aed[]): FC {
  return {
    type: "FeatureCollection",
    features: aeds.map((a) => ({
      type: "Feature",
      id: a.idx,
      geometry: { type: "Point", coordinates: [a.lon, a.lat] },
      properties: { idx: a.idx, avail: a.avail },
    })),
  };
}

export default function MapView({ ref, aeds, mobile, selected, user, dark, onSelect, onViewport }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  // Bieżące dane w refach — po zmianie stylu (jasny/ciemny) warstwy trzeba odtworzyć.
  const state = useRef({ aeds, mobile, selected, user, dark, onSelect, onViewport });
  useLayoutEffect(() => {
    state.current = { aeds, mobile, selected, user, dark, onSelect, onViewport };
  });

  useImperativeHandle(ref, () => ({
    flyTo(p, zoom = 16) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      mapRef.current?.flyTo({ center: [p.lon, p.lat], zoom, essential: true, duration: reduce ? 0 : 900 });
    },
    frame(points) {
      if (!points.length) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const lons = points.map((p) => p.lon);
      const lats = points.map((p) => p.lat);
      // na telefonie dół ekranu zasłania panel — większy margines od dołu
      const narrow = window.matchMedia("(max-width: 1023px)").matches;
      mapRef.current?.fitBounds(
        [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: { top: 72, left: 56, right: 72, bottom: narrow ? Math.round(window.innerHeight * 0.5) : 72 }, maxZoom: 17, duration: reduce ? 0 : 900 },
      );
    },
  }));

  // ---- inicjalizacja (raz)
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MLMap({
      container: containerRef.current,
      style: state.current.dark ? STYLE.dark : STYLE.light,
      bounds: POLAND,
      fitBoundsOptions: { padding: 24 },
      minZoom: 4.5,
      maxZoom: 19,
      maxBounds: [[8, 46], [30, 57.5]],
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      // atrybucja w prawym górnym rogu — na telefonie dół ekranu zajmuje panel
      attributionControl: false,
    });
    map.addControl(new AttributionControl({ compact: true }), "top-right");
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;

    const addLayers = () => {
      const s = state.current;
      const c = s.dark ? PALETTE.dark : PALETTE.light;
      if (map.getSource("aed")) return;

      // Podpisy po polsku (style OpenFreeMap domyślnie biorą name:en / name_en).
      for (const layer of map.getStyle().layers) {
        if (layer.type !== "symbol" || !map.getLayoutProperty(layer.id, "text-field")) continue;
        map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", "name:pl"], ["get", "name"]]);
      }

      map.addSource("aed", {
        type: "geojson",
        data: toFC(s.aeds),
        cluster: true,
        clusterRadius: 46,
        clusterMaxZoom: 13,
      });
      map.addSource("aed-mobile", { type: "geojson", data: s.mobile ? mobileFC(s.mobile) : emptyFC });
      map.addSource("selected", { type: "geojson", data: s.selected ? pointFC(s.selected) : emptyFC });
      map.addSource("user", { type: "geojson", data: s.user ? pointFC(s.user) : emptyFC });

      // Klastry: jasny krążek z czerwoną obwódką i liczbą — spokojniejsze niż pełna czerwień przy tysiącach punktów.
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "aed",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": c.paper,
          "circle-stroke-color": c.red,
          "circle-stroke-width": 2.5,
          "circle-radius": ["step", ["get", "point_count"], 14, 25, 18, 150, 23, 800, 28],
        },
      });
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "aed",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["number-format", ["get", "point_count"], { locale: "pl-PL" }],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12.5,
          "text-allow-overlap": true,
        },
        paint: { "text-color": c.ink },
      });

      // AED mobilne (OSP/PSP) — opcjonalna warstwa, szare kółka
      map.addLayer({
        id: "aed-mobile",
        type: "circle",
        source: "aed-mobile",
        minzoom: 8,
        layout: { visibility: s.mobile ? "visible" : "none" },
        paint: {
          "circle-color": c.paper,
          "circle-stroke-color": c.muted,
          "circle-stroke-width": 2,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 14, 5],
        },
      });

      // Pojedyncze AED — kształt, nie tylko kolor, koduje dostępność:
      // pełny czerwony = całą dobę, czerwona obwódka = w godzinach, mały szary = ograniczony.
      map.addLayer({
        id: "aed-restricted",
        type: "circle",
        source: "aed",
        filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "avail"], 2]],
        paint: {
          "circle-color": c.muted,
          "circle-stroke-color": c.paper,
          "circle-stroke-width": 1.5,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 16, 6],
        },
      });
      map.addLayer({
        id: "aed-hours",
        type: "circle",
        source: "aed",
        filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "avail"], 1]],
        paint: {
          "circle-color": c.paper,
          "circle-stroke-color": c.red,
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 16, 3.5],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4.5, 16, 8],
        },
      });
      map.addLayer({
        id: "aed-247",
        type: "circle",
        source: "aed",
        filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "avail"], 0]],
        paint: {
          "circle-color": c.red,
          "circle-stroke-color": c.paper,
          "circle-stroke-width": 2,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 16, 9],
        },
      });

      // Wybrany AED: pierścień wokół punktu
      map.addLayer({
        id: "selected-ring",
        type: "circle",
        source: "selected",
        paint: {
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": c.ink,
          "circle-stroke-width": 3,
          "circle-radius": 16,
        },
      });

      // Użytkownik: konwencja z map nawigacyjnych (niebieska kropka + obszar dokładności)
      map.addLayer({
        id: "user-accuracy",
        type: "circle",
        source: "user",
        paint: {
          "circle-color": c.halo,
          "circle-radius": [
            "interpolate", ["exponential", 2], ["zoom"],
            0, 0,
            20, ["/", ["get", "accuracy"], 0.075],
          ],
        },
      });
      map.addLayer({
        id: "user-dot",
        type: "circle",
        source: "user",
        paint: { "circle-color": c.user, "circle-radius": 7, "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2.5 },
      });
    };

    map.on("style.load", addLayers);

    const clickable = ["aed-247", "aed-hours", "aed-restricted"];
    const onPoint = (e: MapLayerMouseEvent) => {
      const idx = e.features?.[0]?.properties?.idx;
      if (typeof idx === "number") state.current.onSelect(idx);
    };
    const onCluster = async (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const id = f?.properties?.cluster_id;
      if (f?.geometry.type !== "Point" || typeof id !== "number") return;
      const zoom = await (map.getSource("aed") as GeoJSONSource).getClusterExpansionZoom(id);
      map.easeTo({ center: f.geometry.coordinates as [number, number], zoom: zoom + 0.25 });
    };
    for (const l of clickable) map.on("click", l, onPoint);
    map.on("click", "clusters", onCluster);
    for (const l of [...clickable, "clusters"]) {
      map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
    }

    const emitViewport = () => {
      const c = map.getCenter();
      const b = map.getBounds();
      state.current.onViewport({
        center: { lon: c.lng, lat: c.lat },
        zoom: map.getZoom(),
        bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      });
    };
    map.on("moveend", emitViewport);
    map.once("load", emitViewport);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- aktualizacje danych
  useEffect(() => {
    (mapRef.current?.getSource("aed") as GeoJSONSource | undefined)?.setData(toFC(aeds));
  }, [aeds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer("aed-mobile")) return;
    (map.getSource("aed-mobile") as GeoJSONSource).setData(mobile ? mobileFC(mobile) : emptyFC);
    map.setLayoutProperty("aed-mobile", "visibility", mobile ? "visible" : "none");
  }, [mobile]);

  useEffect(() => {
    (mapRef.current?.getSource("selected") as GeoJSONSource | undefined)?.setData(selected ? pointFC(selected) : emptyFC);
  }, [selected]);

  useEffect(() => {
    (mapRef.current?.getSource("user") as GeoJSONSource | undefined)?.setData(user ? pointFC(user) : emptyFC);
  }, [user]);

  // ---- tryb jasny/ciemny: nowy styl, warstwy odtwarza handler "style.load"
  const firstDark = useRef(dark);
  useEffect(() => {
    if (firstDark.current === dark) return;
    firstDark.current = dark;
    mapRef.current?.setStyle(dark ? STYLE.dark : STYLE.light);
  }, [dark]);

  return (
    <div
      ref={containerRef}
      className="mz-map"
      role="region"
      aria-label="Mapa defibrylatorów AED. Lista najbliższych AED jest dostępna w panelu obok mapy."
    />
  );
}

function pointFC(p: LngLat & { accuracy?: number }): FC {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: { accuracy: p.accuracy ?? 0 } }],
  };
}

function mobileFC(items: MobileAed[]): FC {
  return {
    type: "FeatureCollection",
    features: items.map((m) => ({ type: "Feature", geometry: { type: "Point", coordinates: [m.lon, m.lat] }, properties: {} })),
  };
}
