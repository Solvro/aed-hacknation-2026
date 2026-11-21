// Jeden zestaw ikon: obrys 1.75, zaokrąglone końce, siatka 24 px. Dekoracyjne — aria-hidden;
// znaczenie zawsze niesie tekst obok.

import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base = (props: P) => ({
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
  ...props,
});

export const IconLocate = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);

export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </svg>
);

export const IconWalk = (p: P) => (
  <svg {...base(p)}>
    <circle cx="13" cy="4.5" r="1.75" />
    <path d="m9.5 21 2.2-6.5L14 17v4M8 11.5l2.5-3.5 3.5 1 2 3.5 2.5 1M11.7 14.5l1-5" />
  </svg>
);

export const IconArrowLeft = (p: P) => (
  <svg {...base(p)}>
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </svg>
);

export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconClock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const IconDoor = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h8A1.5 1.5 0 0 1 16 4.5V21M3 21h18M12.5 12h.01" />
  </svg>
);

export const IconPin = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.25" />
  </svg>
);

export const IconStairs = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 20h5v-5h5v-5h5V5h3" />
  </svg>
);

export const IconFlag = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
  </svg>
);

export const IconCopy = (p: P) => (
  <svg {...base(p)}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </svg>
);

export const IconPhone = (p: P) => (
  <svg {...base(p)}>
    <path d="M6.6 3.5h2.6l1.3 4-2 1.3a11 11 0 0 0 6.7 6.7l1.3-2 4 1.3v2.6A2 2 0 0 1 18.3 19.5 15.5 15.5 0 0 1 4.5 5.7 2 2 0 0 1 6.6 3.5Z" />
  </svg>
);

export const IconChevronUp = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 15 6-6 6 6" />
  </svg>
);

/** Znak AED (serce z błyskawicą), wypełniony — używany w nagłówku panelu i legendzie. */
export const AedGlyph = (p: P) => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden focusable={false} {...p}>
    <path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.1 5.3 3 1.7-1.9 3.2-3 5.3-3 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21Z" />
    <path fill="var(--mz-surface)" d="M13 7.5 9.5 13h2.6l-1.1 4.5 3.9-6h-2.7l.8-4Z" />
  </svg>
);

/**
 * Łuk stopera z logo „Minuta Życia”: jaka część 5-minutowego okna na defibrylację
 * zejdzie na dojście. Pełny czerwony łuk = dojście zajmie 5 min lub więcej.
 */
export function MinuteArc({ minutes, size = 28 }: { minutes: number; size?: number }) {
  const r = 10;
  const c = 2 * Math.PI * r;
  const frac = Math.min(minutes, 5) / 5;
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden focusable={false} className="mz-arc">
      <rect x="11.5" y="0.5" width="5" height="3.5" rx="1" className="mz-arc__crown" />
      <circle cx="14" cy="16" r={r} className="mz-arc__track" />
      <circle
        cx="14"
        cy="16"
        r={r}
        className="mz-arc__value"
        strokeDasharray={`${c * frac} ${c}`}
        transform="rotate(-90 14 16)"
      />
    </svg>
  );
}
