// Logo aplikacji „Minuta Życia” (źródło: assets/minuta-zycia-logo-bez-tla.svg).
// Grafitowe elementy dziedziczą kolor tekstu (currentColor), kolory marki są stałe.

export const BRAND = {
  red: "#E0144A",
  green: "#3F6B4F",
  sage: "#70967D",
  ink: "#1A1D1B",
  paper: "#F8FBF9",
} as const;

export function Logo({ className, title = "Minuta Życia" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 420 116" className={className} role="img" aria-label={title}>
      <g transform="translate(6 2)">
        <rect x="44" y="4" width="12" height="9" rx="2" fill="currentColor" />
        <circle cx="50" cy="56" r="38" fill="none" stroke={BRAND.sage} strokeWidth="9" />
        <path d="M50 18 A38 38 0 0 1 82.9 37" fill="none" stroke={BRAND.red} strokeWidth="9" strokeLinecap="round" />
        <path d="M55 32 L40 60 L50 60 L45 82 L62 52 L52 52 L58 32 Z" fill={BRAND.red} />
      </g>
      <text x="119" y="64" fontSize="40" fontWeight="800" letterSpacing="-0.5" fill="currentColor" style={{ fontFamily: "inherit" }}>
        Minuta <tspan fill={BRAND.red}>Życia</tspan>
      </text>
      <text x="121" y="90" fontSize="13" fontWeight="600" letterSpacing="2.6" fill={BRAND.green} style={{ fontFamily: "inherit" }}>
        KAŻDA MINUTA SIĘ LICZY
      </text>
    </svg>
  );
}
