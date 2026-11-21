"use client";

import { useState } from "react";
import {
  AVAILABILITY_LABEL,
  aedTitle,
  formatDistance,
  formatHours,
  fullAddress as joinAddress,
  googleWalkingUrl,
  reportUrl,
  walkMinutes,
  type Aed,
} from "./data";
import { IconArrowLeft, IconClock, IconCopy, IconDoor, IconFlag, IconPhone, IconPin, IconStairs, IconWalk, MinuteArc } from "./icons";
import { AvailabilityMark } from "./AvailabilityMark";

export function AedDetail({ aed, distance, onBack }: { aed: Aed; distance: number | null; onBack(): void }) {
  const [copied, setCopied] = useState(false);
  const title = aedTitle(aed);
  const hours = formatHours(aed.hours);
  const fullAddress = joinAddress(aed);
  const minutes = distance != null ? walkMinutes(distance) : null;

  const copy = async () => {
    const text = fullAddress || `${aed.lat.toFixed(6)}, ${aed.lon.toFixed(6)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* brak uprawnień do schowka — przycisk po prostu nic nie zmienia */
    }
  };

  return (
    <article className="mz-detail" aria-labelledby="mz-detail-title">
      <button type="button" className="mz-back" onClick={onBack}>
        <IconArrowLeft width={18} height={18} />
        Lista AED
      </button>

      <header className="mz-detail__head">
        <p className="mz-detail__avail">
          <AvailabilityMark avail={aed.avail} />
          {AVAILABILITY_LABEL[aed.avail]}
        </p>
        <h2 id="mz-detail-title" className="mz-detail__title">{title}</h2>
        {fullAddress && fullAddress !== title && <p className="mz-detail__address">{fullAddress}</p>}
      </header>

      {minutes != null && distance != null && (
        <div className="mz-eta">
          <MinuteArc minutes={minutes} size={40} />
          <div>
            <p className="mz-eta__main">
              ok. {minutes} min pieszo <span className="mz-eta__dist">· {formatDistance(distance)}</span>
            </p>
            <p className="mz-eta__hint">
              {minutes <= 2
                ? "Blisko. Jeśli jest druga osoba, niech biegnie po AED, a Ty uciskaj."
                : minutes <= 5
                  ? "Wyślij kogoś po AED. Ty dzwoń 112 i uciskaj klatkę."
                  : "Daleko. Nie odchodź od poszkodowanego — zacznij RKO i zapytaj dyspozytora 112 o bliższy AED."}
            </p>
          </div>
        </div>
      )}

      {aed.location && aed.location !== title && (
        <section className="mz-where" aria-label="Gdzie dokładnie">
          <h3 className="mz-where__label">Gdzie dokładnie</h3>
          <p className="mz-where__text">{aed.location}</p>
        </section>
      )}

      <dl className="mz-facts">
        {hours.length > 0 && (
          <div className="mz-fact">
            <dt><IconClock /><span className="mz-sr">Godziny</span></dt>
            <dd>{hours.map((h) => <span key={h} className="mz-fact__line">{h}</span>)}</dd>
          </div>
        )}
        {aed.indoor !== -1 && (
          <div className="mz-fact">
            <dt><IconDoor /><span className="mz-sr">Umiejscowienie</span></dt>
            <dd>{aed.indoor === 1 ? "Wewnątrz budynku" : "Na zewnątrz budynku"}</dd>
          </div>
        )}
        {aed.level && (
          <div className="mz-fact">
            <dt><IconStairs /><span className="mz-sr">Piętro</span></dt>
            <dd>Poziom {aed.level}</dd>
          </div>
        )}
        {aed.phone && (
          <div className="mz-fact">
            <dt><IconPhone /><span className="mz-sr">Telefon</span></dt>
            <dd><a href={`tel:${aed.phone.replace(/\s/g, "")}`}>{aed.phone}</a></dd>
          </div>
        )}
        {aed.quality === 2 && (
          <div className="mz-fact mz-fact--warn">
            <dt><IconPin /><span className="mz-sr">Dokładność</span></dt>
            <dd>Położenie przybliżone — wyznaczone z adresu bez numeru budynku.</dd>
          </div>
        )}
      </dl>

      <div className="mz-actions">
        <a className="mz-btn mz-btn--primary" href={googleWalkingUrl(aed)} target="_blank" rel="noopener noreferrer">
          <IconWalk />
          Prowadź pieszo
        </a>
        <button type="button" className="mz-btn mz-btn--quiet" onClick={copy}>
          <IconCopy />
          <span aria-live="polite">{copied ? "Skopiowano" : fullAddress ? "Kopiuj adres" : "Kopiuj współrzędne"}</span>
        </button>
      </div>

      <footer className="mz-detail__foot">
        <p>Źródło: {aed.sources.join(", ")}</p>
        <a href={reportUrl(aed)} target="_blank" rel="noopener noreferrer" className="mz-link">
          <IconFlag width={16} height={16} />
          AED nie ma albo jest gdzie indziej? Zgłoś
        </a>
      </footer>
    </article>
  );
}
