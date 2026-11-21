import type { Availability } from "./data";

/** Ten sam kształt co znacznik na mapie: pełne koło / obwódka / mały szary punkt. */
export function AvailabilityMark({ avail, size = 14 }: { avail: Availability; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden focusable={false} className="mz-mark">
      {avail === 0 && <circle cx="7" cy="7" r="6" className="mz-mark__solid" />}
      {avail === 1 && <circle cx="7" cy="7" r="5" className="mz-mark__ring" />}
      {avail === 2 && <circle cx="7" cy="7" r="3.75" className="mz-mark__muted" />}
    </svg>
  );
}
