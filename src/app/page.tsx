import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:py-20">
      <p className="text-sm font-semibold uppercase tracking-wider text-brand">
        HackNation 2026 · Minuta Życia
      </p>
      <h1 className="mt-3 max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
        Defibrylator może użyć każdy. Pokażemy Ci jak.
      </h1>
      <p className="mt-4 max-w-xl text-lg text-muted">
        Interaktywna instrukcja 3D przeprowadzi Cię przez 8 kroków, od oceny
        bezpieczeństwa po wyładowanie i RKO. Zajmie to około 3 minuty.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/jak-uzyc-aed"
          className="rounded-xl bg-brand px-6 py-3 font-semibold text-on-brand hover:bg-brand-strong"
        >
          Zacznij instrukcję
        </Link>
        <Link
          href="/mapa"
          className="rounded-xl border border-border bg-surface px-6 py-3 font-semibold hover:bg-surface-2"
        >
          Mapa AED w Polsce
        </Link>
        <a
          href="/api/instrukcja-aed"
          className="rounded-xl border border-border bg-surface px-6 py-3 font-semibold hover:bg-surface-2"
        >
          Instrukcja jako JSON
        </a>
      </div>
    </div>
  );
}
