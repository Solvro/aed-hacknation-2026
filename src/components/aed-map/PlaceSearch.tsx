"use client";

// Wyszukiwanie miejsca (adres, miasto) przez Photon (komoot, dane OSM, bez klucza).
// Combobox wg wzorca WAI-ARIA: strzałki, Enter, Escape. Zapytania z opóźnieniem 300 ms
// i anulowaniem poprzedniego, żeby nie zasypywać usługi przy każdym znaku.

import { useEffect, useId, useRef, useState } from "react";
import { IconSearch, IconClose } from "./icons";
import type { LngLat } from "./data";

interface Place extends LngLat {
  label: string;
  detail: string;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; street?: string; housenumber?: string; city?: string; county?: string; state?: string; postcode?: string };
}

async function searchPlaces(q: string, signal: AbortSignal): Promise<Place[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "8");
  url.searchParams.set("lang", "default"); // nazwy lokalne (po polsku), nie angielskie
  url.searchParams.set("bbox", "14.07,49.0,24.15,54.84");
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(String(res.status));
  const json: { features: PhotonFeature[] } = await res.json();
  const seen = new Set<string>();
  return json.features.map(({ geometry, properties: p }) => {
    const street = [p.street, p.housenumber].filter(Boolean).join(" ");
    const label = p.name ?? (street || p.city || "");
    const detail = [p.name && street ? street : "", p.city && p.city !== label ? p.city : "", p.state].filter(Boolean).join(", ");
    return { lon: geometry.coordinates[0], lat: geometry.coordinates[1], label, detail };
  })
    // kilka odcinków tej samej ulicy = jeden wynik
    .filter((p) => {
      const key = `${p.label}|${p.detail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

export function PlaceSearch({ onPick }: { onPick(p: LngLat, label: string): void }) {
  const id = useId();
  const listId = `${id}-list`;
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) return; // lista i tak jest ukryta poniżej 3 znaków
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setStatus("loading");
      try {
        const r = await searchPlaces(term, ctrl.signal);
        setResults(r);
        setActive(r.length ? 0 : -1);
        setOpen(true);
        setStatus("idle");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setStatus("error");
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const pick = (p: Place) => {
    onPick(p, p.label);
    setQ(p.label);
    setOpen(false);
    inputRef.current?.blur();
  };

  const showList = open && q.trim().length >= 3;

  return (
    <div className="mz-search">
      <label htmlFor={`${id}-input`} className="mz-search__label">
        Albo wpisz adres lub miejscowość
      </label>
      <div className="mz-search__field">
        <IconSearch className="mz-search__icon" />
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="np. Rynek Główny, Kraków"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && active >= 0 && results[active]) {
              e.preventDefault();
              pick(results[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {q && (
          <button type="button" className="mz-search__clear" aria-label="Wyczyść wyszukiwanie" onClick={() => { setQ(""); inputRef.current?.focus(); }}>
            <IconClose width={18} height={18} />
          </button>
        )}
      </div>
      {showList && (
        <ul id={listId} role="listbox" className="mz-search__list" aria-label="Podpowiedzi miejsc">
          {status === "error" && <li className="mz-search__note">Wyszukiwarka nie odpowiada. Przesuń mapę ręcznie albo spróbuj za chwilę.</li>}
          {status !== "error" && results.length === 0 && status === "idle" && (
            <li className="mz-search__note">Nie znaleźliśmy takiego miejsca w Polsce.</li>
          )}
          {results.map((r, i) => (
            <li
              key={`${r.lon},${r.lat},${i}`}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className="mz-search__option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
              onMouseEnter={() => setActive(i)}
            >
              <span className="mz-search__option-label">{r.label}</span>
              {r.detail && <span className="mz-search__option-detail">{r.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
