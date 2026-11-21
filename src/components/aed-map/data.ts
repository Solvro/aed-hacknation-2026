// Dane AED dla mapy: wczytanie kompaktowego pliku z public/data, odległości, formatowanie.

export type Availability = 0 | 1 | 2; // 0 = całą dobę, 1 = w godzinach / dla klientów, 2 = ograniczony
export type Quality = 0 | 1 | 2; // 0 = natywne, 1 = geokod do budynku, 2 = przybliżone

export interface Aed {
  idx: number;
  id: string;
  lon: number;
  lat: number;
  name: string;
  location: string;
  address: string;
  city: string;
  hours: string;
  indoor: -1 | 0 | 1;
  avail: Availability;
  quality: Quality;
  sources: string[];
  level: string;
  phone: string;
}

export interface MobileAed {
  id: string;
  lon: number;
  lat: number;
  name: string;
  location: string;
  city: string;
}

export interface AedDataset {
  generatedAt: string;
  items: Aed[];
}

type Row = (string | number)[];

export async function loadAeds(signal?: AbortSignal): Promise<AedDataset> {
  const res = await fetch("/data/aed.json", { signal });
  if (!res.ok) throw new Error(`Nie udało się pobrać danych AED (${res.status})`);
  const json: { generatedAt: string; fields: string[]; items: Row[] } = await res.json();
  const f = Object.fromEntries(json.fields.map((k, i) => [k, i]));
  const items = json.items.map((r, idx): Aed => ({
    idx,
    id: String(r[f.id]),
    lon: Number(r[f.lon]),
    lat: Number(r[f.lat]),
    name: String(r[f.name] ?? ""),
    location: String(r[f.location] ?? ""),
    address: String(r[f.address] ?? ""),
    city: String(r[f.city] ?? ""),
    hours: String(r[f.hours] ?? ""),
    indoor: Number(r[f.indoor]) as Aed["indoor"],
    avail: Number(r[f.avail]) as Availability,
    quality: Number(r[f.quality]) as Quality,
    sources: String(r[f.sources] ?? "").split("|").filter(Boolean),
    level: String(r[f.level] ?? ""),
    phone: String(r[f.phone] ?? ""),
  }));
  return { generatedAt: json.generatedAt, items };
}

export async function loadMobileAeds(signal?: AbortSignal): Promise<MobileAed[]> {
  const res = await fetch("/data/aed-mobile.json", { signal });
  if (!res.ok) throw new Error(`Nie udało się pobrać danych (${res.status})`);
  const json: { fields: string[]; items: Row[] } = await res.json();
  const f = Object.fromEntries(json.fields.map((k, i) => [k, i]));
  return json.items.map((r) => ({
    id: String(r[f.id]),
    lon: Number(r[f.lon]),
    lat: Number(r[f.lat]),
    name: String(r[f.name] ?? ""),
    location: String(r[f.location] ?? ""),
    city: String(r[f.city] ?? ""),
  }));
}

export interface LngLat {
  lon: number;
  lat: number;
}

/** Odległość w metrach (wzór haversine). */
export function distanceM(a: LngLat, b: LngLat): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface Ranked {
  aed: Aed;
  distance: number;
}

/** N najbliższych AED do punktu. 16 tys. punktów liczy się w ~1–2 ms, bez indeksu. */
export function nearest(items: Aed[], from: LngLat, n = 8, filter?: (a: Aed) => boolean): Ranked[] {
  const best: Ranked[] = [];
  for (const aed of items) {
    if (filter && !filter(aed)) continue;
    // szybkie odrzucenie: ~0.5° to ~35–55 km
    if (best.length === n && Math.abs(aed.lat - from.lat) > 0.5) continue;
    const d = distanceM(from, aed);
    if (best.length < n || d < best[best.length - 1].distance) {
      best.push({ aed, distance: d });
      best.sort((x, y) => x.distance - y.distance);
      if (best.length > n) best.pop();
    }
  }
  return best;
}

// Szacunek pieszo: odległość w linii prostej × 1,3 (kręta trasa), 80 m/min (~4,8 km/h).
export const walkMinutes = (meters: number) => Math.max(1, Math.round((meters * 1.3) / 80));

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toLocaleString("pl-PL", { maximumFractionDigits: m < 10000 ? 1 : 0 })} km`;
}

const capitalize = (s: string) => (s ? s[0].toLocaleUpperCase("pl-PL") + s.slice(1) : s);

export function aedTitle(a: Pick<Aed, "name" | "location" | "address">): string {
  return capitalize(a.name || a.address || a.location || "Defibrylator AED");
}

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  0: "Dostępny całą dobę",
  1: "W godzinach otwarcia",
  2: "Dostęp ograniczony",
};

const DAYS: Record<string, string> = {
  Mo: "pon.", Tu: "wt.", We: "śr.", Th: "czw.", Fr: "pt.", Sa: "sob.", Su: "niedz.", PH: "święta",
};

/** Godziny w formacie OSM -> czytelne linie po polsku ("Mo-Fr 08:00-16:00; Sa off"). */
export function formatHours(h: string): string[] {
  const t = h.trim();
  if (!t) return [];
  if (t === "24/7") return ["Całą dobę, 7 dni w tygodniu"];
  return t.split(/\s*;\s*/).filter(Boolean).map((part) =>
    part
      .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (d) => DAYS[d])
      .replace(/\boff\b|\bclosed\b/gi, "nieczynne")
      .replace(/(\d{2}:\d{2})-(\d{2}:\d{2})/g, "$1–$2")
      .replace(/\s*-\s*(?=[a-ząćęłńóśźż])/g, "–"),
  );
}

/** Adres z miastem, bez dublowania („Rynek Główny 3, 31-042 Kraków” + „Kraków”). */
export function fullAddress(a: Pick<Aed, "address" | "city">): string {
  if (!a.address) return a.city;
  if (!a.city || a.address.toLocaleLowerCase("pl-PL").includes(a.city.toLocaleLowerCase("pl-PL"))) return a.address;
  return `${a.address}, ${a.city}`;
}

export function googleWalkingUrl(a: LngLat): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lon}&travelmode=walking`;
}

/** Link do edycji/zgłoszenia błędu: dla OSM edytor, dla reszty notatka na mapie OSM w tym miejscu. */
export function reportUrl(a: Aed): string {
  const m = a.id.match(/^osm:(node|way|relation)\/(\d+)$/);
  if (m) return `https://www.openstreetmap.org/${m[1]}/${m[2]}`;
  return `https://www.openstreetmap.org/note/new#map=19/${a.lat}/${a.lon}`;
}
