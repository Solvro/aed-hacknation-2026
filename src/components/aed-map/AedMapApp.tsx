"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AVAILABILITY_LABEL,
  aedTitle,
  distanceM,
  formatDistance,
  fullAddress,
  loadAeds,
  loadMobileAeds,
  nearest,
  walkMinutes,
  type Aed,
  type AedDataset,
  type LngLat,
  type MobileAed,
  type Ranked,
} from "./data";
import type { MapViewHandle, Viewport } from "./MapView";
import { AedDetail } from "./AedDetail";
import { AvailabilityMark } from "./AvailabilityMark";
import { PlaceSearch } from "./PlaceSearch";
import { IconChevronUp, IconLocate, MinuteArc } from "./icons";

// MapLibre działa tylko w przeglądarce (WebGL) — bez SSR, osobny bundle.
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="mz-map mz-map--loading" aria-hidden />,
});

type Filters = { only247: boolean; outdoor: boolean; showMobile: boolean };
type User = LngLat & { accuracy: number };

const GEO_ERRORS: Record<number, string> = {
  1: "Przeglądarka nie ma zgody na lokalizację. Włącz ją w ustawieniach strony albo wpisz adres poniżej.",
  2: "Nie udało się ustalić położenia. Wpisz adres albo przesuń mapę.",
  3: "Ustalanie położenia trwa za długo. Spróbuj ponownie albo wpisz adres.",
};

export default function AedMapApp() {
  const mapRef = useRef<MapViewHandle>(null);

  const [data, setData] = useState<AedDataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ only247: false, outdoor: false, showMobile: false });
  const [mobile, setMobile] = useState<MobileAed[] | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  // telefon: panel od dołu w 3 pozycjach — zajawka / pół ekranu (mapa + lista) / prawie cały ekran
  const [sheet, setSheet] = useState<"peek" | "half" | "full">("peek");
  const [announcement, setAnnouncement] = useState("");

  // ---- dane
  useEffect(() => {
    const ctrl = new AbortController();
    loadAeds(ctrl.signal)
      .then((d) => {
        setData(d);
        // głęboki link ?aed=<id>
        const id = new URLSearchParams(window.location.search).get("aed");
        const hit = id ? d.items.find((a) => a.id === id) : undefined;
        if (hit) {
          setSelectedIdx(hit.idx);
          setSheet("half");
          requestAnimationFrame(() => mapRef.current?.flyTo(hit, 17));
        }
      })
      .catch((e) => e.name !== "AbortError" && setLoadError(e.message));
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (!filters.showMobile || mobile) return;
    const ctrl = new AbortController();
    loadMobileAeds(ctrl.signal).then(setMobile).catch(() => {});
    return () => ctrl.abort();
  }, [filters.showMobile, mobile]);

  const visible = useMemo(() => {
    if (!data) return [];
    return data.items.filter((a) => (!filters.only247 || a.avail === 0) && (!filters.outdoor || a.indoor === 0));
  }, [data, filters.only247, filters.outdoor]);

  const selected = selectedIdx != null && data ? data.items[selectedIdx] : null;

  // Lista liczona od użytkownika, a bez lokalizacji — od środka mapy.
  const origin: LngLat | null = user ?? viewport?.center ?? null;
  // Lista ma sens dopiero na poziomie miasta — z widoku całego kraju "najbliższy" byłby o godzinę drogi.
  const tooFar = !user && (viewport?.zoom ?? 0) < 10;
  const ranked: Ranked[] = useMemo(
    () => (origin && !tooFar ? nearest(visible, origin, 8) : []),
    [visible, origin?.lat, origin?.lon, tooFar], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const inView = useMemo(() => {
    if (!viewport) return null;
    const [w, s, e, n] = viewport.bounds;
    let count = 0;
    for (const a of visible) if (a.lon >= w && a.lon <= e && a.lat >= s && a.lat <= n) count++;
    return count;
  }, [visible, viewport]);

  // ---- akcje
  const select = useCallback(
    (idx: number, opts: { fly?: boolean } = {}) => {
      if (!data) return;
      const aed = data.items[idx];
      setSelectedIdx(idx);
      setSheet("half");
      const url = new URL(window.location.href);
      url.searchParams.set("aed", aed.id);
      window.history.replaceState(null, "", url);
      if (opts.fly) {
        if (user && distanceM(user, aed) < 3000) mapRef.current?.frame([user, aed]);
        else mapRef.current?.flyTo(aed, 17);
      }
    },
    [data, user],
  );

  const clearSelection = () => {
    setSelectedIdx(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("aed");
    window.history.replaceState(null, "", url);
  };

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setGeoError("Ta przeglądarka nie udostępnia lokalizacji. Wpisz adres poniżej.");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const u = { lon: pos.coords.longitude, lat: pos.coords.latitude, accuracy: pos.coords.accuracy };
        setUser(u);
        setLocating(false);
        setSelectedIdx(null);
        setSheet("half");
        const top = nearest(visible, u, 3);
        const best = top[0];
        if (best) {
          mapRef.current?.frame([u, ...top.map((r) => r.aed)]);
          setAnnouncement(`Najbliższy AED: ${formatDistance(best.distance)}, około ${walkMinutes(best.distance)} minut pieszo.`);
        }
      },
      (err) => {
        setLocating(false);
        setGeoError(GEO_ERRORS[err.code] ?? GEO_ERRORS[2]);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };

  const flyToNearestFromCenter = () => {
    if (!viewport) return;
    const best = nearest(visible, viewport.center, 1)[0];
    if (best) mapRef.current?.flyTo(best.aed, 15);
  };

  const generated = data ? new Date(data.generatedAt).toLocaleDateString("pl-PL") : null;
  const distanceToSelected = selected && user ? distanceM(user, selected) : null;

  return (
    <div className="mz" data-sheet={sheet} data-located={user ? "" : undefined}>
      <aside className="mz-panel" aria-label="Wyszukiwanie AED">
        <button
          type="button"
          className="mz-sheet-handle"
          aria-expanded={sheet !== "peek"}
          aria-controls="mz-panel-body"
          onClick={() => setSheet((s) => (s === "peek" ? "half" : s === "half" ? "full" : "peek"))}
        >
          <span className="mz-sheet-handle__bar" aria-hidden />
          <span className="mz-sr">{sheet === "full" ? "Zwiń panel" : "Rozwiń panel z listą AED"}</span>
          <IconChevronUp className="mz-sheet-handle__icon" />
        </button>

        <div id="mz-panel-body" className="mz-panel__body">
          {selected ? (
            <AedDetail aed={selected} distance={distanceToSelected} onBack={clearSelection} />
          ) : (
            <>
              <section className="mz-start" aria-labelledby="mz-start-title">
                <h1 id="mz-start-title" className="mz-start__title">Znajdź najbliższy defibrylator</h1>
                <p className="mz-start__emergency">
                  Ktoś nie oddycha? <a href="tel:112">Zadzwoń 112</a> i zacznij uciskać klatkę piersiową.
                  AED niech przyniesie druga osoba.
                </p>

                <button type="button" className="mz-btn mz-btn--primary mz-btn--block" onClick={locate} disabled={locating}>
                  <IconLocate />
                  {locating ? "Ustalam położenie…" : user ? "Odśwież moje położenie" : "Pokaż AED najbliżej mnie"}
                </button>
                {geoError && <p className="mz-error" role="alert">{geoError}</p>}

                <PlaceSearch onPick={(p) => mapRef.current?.flyTo(p, 15)} />
              </section>

              <fieldset className="mz-filters">
                <legend className="mz-sr">Filtry</legend>
                <Toggle label="Tylko całodobowe" checked={filters.only247} onChange={(v) => setFilters((f) => ({ ...f, only247: v }))} />
                <Toggle label="Na zewnątrz budynku" checked={filters.outdoor} onChange={(v) => setFilters((f) => ({ ...f, outdoor: v }))} />
                <Toggle label="AED w wozach straży" checked={filters.showMobile} onChange={(v) => setFilters((f) => ({ ...f, showMobile: v }))} />
              </fieldset>

              <section className="mz-list" aria-labelledby="mz-list-title" aria-busy={!data}>
                <div className="mz-list__head">
                  <h2 id="mz-list-title" className="mz-list__title">{user ? "Najbliżej Ciebie" : "Najbliżej środka mapy"}</h2>
                  {inView != null && (
                    <p className="mz-list__count">
                      <span className="mz-num">{inView.toLocaleString("pl-PL")}</span> w widoku
                    </p>
                  )}
                </div>

                {loadError && (
                  <p className="mz-error" role="alert">
                    Nie udało się wczytać danych AED ({loadError}). Odśwież stronę.
                  </p>
                )}
                {!data && !loadError && <ListSkeleton />}

                {data && tooFar && (
                  <p className="mz-hint">
                    Pokaż swoje położenie albo wpisz adres — wtedy ułożymy AED od najbliższego.
                    Możesz też przybliżyć mapę i kliknąć dowolny znacznik.
                  </p>
                )}

                {data && ranked.length > 0 && (
                  <ol className="mz-items">
                    {ranked.map(({ aed, distance }, i) => (
                      <li key={aed.id}>
                        <AedRow
                          aed={aed}
                          distance={distance}
                          badge={user ? badgeFor(ranked, i) : null}
                          onSelect={() => select(aed.idx, { fly: true })}
                        />
                      </li>
                    ))}
                  </ol>
                )}

                {data && ranked.length > 0 && ranked[0].distance > 5000 && (
                  <div className="mz-empty">
                    <p>W pobliżu nie mamy żadnego AED — najbliższy jest {formatDistance(ranked[0].distance)} stąd.</p>
                    <button type="button" className="mz-btn mz-btn--quiet" onClick={flyToNearestFromCenter}>
                      Pokaż go na mapie
                    </button>
                  </div>
                )}
              </section>

              <Legend />

              <footer className="mz-foot">
                <p>
                  Nie każdy AED jest na mapie. Jeśli nie widzisz żadnego w pobliżu, nie szukaj go —
                  uciskaj klatkę i zapytaj dyspozytora 112. <Link href="/jak-uzyc-aed" className="mz-link">Jak użyć AED (3 min)</Link>
                </p>
                <p className="mz-foot__meta">
                  {data ? `${data.items.length.toLocaleString("pl-PL")} AED` : "AED"} z 19 źródeł
                  {generated && ` · stan na ${generated}`} · © OpenStreetMap, dane gmin i urzędów
                </p>
              </footer>
            </>
          )}
        </div>
      </aside>

      <div className="mz-stage">
        <MapView
          ref={mapRef}
          aeds={visible}
          mobile={filters.showMobile ? mobile : null}
          selected={selected}
          user={user}
          dark={false}
          onSelect={(idx) => select(idx)}
          onViewport={setViewport}
        />
        <button type="button" className="mz-locate-fab" onClick={locate} disabled={locating} aria-label="Pokaż moje położenie i najbliższe AED">
          <IconLocate width={22} height={22} />
        </button>
      </div>

      <p className="mz-sr" role="status" aria-live="polite">{announcement}</p>
    </div>
  );
}

/** "Najbliższy" dla pierwszego; jeśli ten ma ograniczony dostęp — dodatkowo "Najbliższy publiczny". */
function badgeFor(list: Ranked[], i: number): string | null {
  if (i === 0) return "Najbliższy";
  if (list[0].aed.avail === 2 && list.findIndex((r) => r.aed.avail !== 2) === i) return "Najbliższy publiczny";
  return null;
}

/** Drugi wiersz tylko wtedy, gdy wnosi coś nowego względem tytułu. */
function secondLine(aed: Aed, title: string): string {
  const fold = (x: string) => x.toLocaleLowerCase("pl-PL").replace(/[^a-ząćęłńóśźż0-9]+/g, " ").trim();
  const t = fold(title);
  for (const cand of [aed.location, fullAddress(aed)]) {
    const c = fold(cand);
    if (c && !t.includes(c.slice(0, 24)) && !c.includes(t.slice(0, 24))) return cand;
  }
  return "";
}

function AedRow({ aed, distance, badge, onSelect }: { aed: Aed; distance: number; badge: string | null; onSelect(): void }) {
  const minutes = walkMinutes(distance);
  const title = aedTitle(aed);
  const where = secondLine(aed, title);
  return (
    <button type="button" className="mz-row" onClick={onSelect}>
      <span className="mz-row__eta">
        <MinuteArc minutes={minutes} />
        <span className="mz-row__min mz-num">{minutes} min</span>
      </span>
      <span className="mz-row__body">
        {badge && <span className="mz-row__badge">{badge}</span>}
        <span className="mz-row__title">{title}</span>
        {where && <span className="mz-row__where">{where}</span>}
        <span className="mz-row__meta">
          <AvailabilityMark avail={aed.avail} size={12} />
          {AVAILABILITY_LABEL[aed.avail]}
          <span aria-hidden>·</span>
          <span className="mz-num">{formatDistance(distance)}</span>
        </span>
      </span>
    </button>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="mz-chip">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Legend() {
  return (
    <details className="mz-legend">
      <summary>Co oznaczają znaczniki</summary>
      <ul>
        <li><AvailabilityMark avail={0} /> Dostępny całą dobę</li>
        <li><AvailabilityMark avail={1} /> W godzinach otwarcia budynku lub dla klientów</li>
        <li><AvailabilityMark avail={2} /> Dostęp ograniczony (np. teren firmy)</li>
        <li><span className="mz-legend__cluster mz-num" aria-hidden>24</span> Kilka AED blisko siebie — przybliż mapę</li>
        <li><MinuteArc minutes={3} size={20} /> Czas dojścia na tle 5 minut, w których defibrylacja daje największe szanse</li>
      </ul>
    </details>
  );
}

function ListSkeleton() {
  return (
    <ul className="mz-skeleton" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} />
      ))}
    </ul>
  );
}
