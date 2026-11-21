"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSuspenseQuery } from "@tanstack/react-query";
import { aedInstructionQuery } from "@/lib/queries";
import { STEP_IDS } from "@/lib/aed-steps";
import { useMediaQuery, usePrefersReducedMotion, useWebGLSupport } from "@/hooks/useMediaQuery";
import { useSpeech } from "@/hooks/useSpeech";
import type { PadSide, PadState } from "./scene/config";
import { getCprPhase } from "./cpr";

const AedScene = dynamic(() => import("./scene/AedScene"), {
  ssr: false,
  loading: () => <SceneMessage>Ładowanie sceny 3D…</SceneMessage>,
});

const PADS_INDEX = STEP_IDS.indexOf("elektrody");
const SHOCK_INDEX = STEP_IDS.indexOf("wyladowanie");
const NO_PADS: PadState = { right: false, left: false };

const PAD_LABELS: Record<PadSide, string> = {
  right: "Pod prawym obojczykiem",
  left: "Na lewym boku, pod pachą",
};

export function AedTrainer() {
  const { data } = useSuspenseQuery(aedInstructionQuery);
  const steps = data.steps;

  const [index, setIndex] = useState(0);
  const [padsPlaced, setPadsPlaced] = useState<PadState>(NO_PADS);
  const [shockCount, setShockCount] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [motionOverride, setMotionOverride] = useState<boolean | null>(null);
  const [voice, setVoice] = useState(false);
  const [show3d, setShow3d] = useState(true);

  const systemReduced = usePrefersReducedMotion();
  const reducedMotion = motionOverride ?? systemReduced;
  const coarsePointer = useMediaQuery("(pointer: coarse)");
  const webgl = useWebGLSupport();
  const { speak, supported: speechSupported } = useSpeech(voice);

  const step = steps[index];
  const isLast = index === steps.length - 1;
  const shockDone = shockCount > 0;
  const taskPending =
    (step.task?.type === "place-pads" && !(padsPlaced.right && padsPlaced.left)) ||
    (step.task?.type === "shock" && !shockDone);

  useEffect(() => {
    speak(step.aedPrompt ?? `${step.title}. ${step.instruction}`);
  }, [step, speak]);

  function goTo(next: number) {
    const i = Math.max(0, Math.min(steps.length - 1, next));
    if (i < PADS_INDEX) setPadsPlaced(NO_PADS);
    if (i < SHOCK_INDEX) setShockCount(0);
    setIndex(i);
    setAnnouncement(`Krok ${steps[i].number} z ${steps.length}: ${steps[i].title}`);
  }

  function placePad(side: PadSide) {
    setPadsPlaced((p) => {
      const next = { ...p, [side]: true };
      setAnnouncement(
        next.right && next.left
          ? "Obie elektrody naklejone. Przejdź dalej."
          : `Elektroda naklejona: ${PAD_LABELS[side].toLowerCase()}.`,
      );
      return next;
    });
  }

  function shock() {
    if (shockDone) return;
    setShockCount((c) => c + 1);
    setAnnouncement("Wyładowanie wykonane. Rozpocznij RKO.");
    speak("Wyładowanie wykonane. Rozpocznij resuscytację.");
  }

  const canRender3d = show3d && webgl === true;

  return (
    <section aria-label="Interaktywna instrukcja użycia AED" className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* Scena 3D */}
        <div
          role="img"
          aria-label={`Ilustracja kroku ${step.number}: ${step.sceneDescription}`}
          className="scene-bg sticky top-0 z-10 h-[44vh] min-h-[280px] overflow-hidden rounded-2xl border border-border shadow-sm lg:relative lg:h-[620px] lg:shadow-none"
        >
          {canRender3d ? (
            <AedScene
              stepId={step.id}
              padsPlaced={padsPlaced}
              shockCount={shockCount}
              reducedMotion={reducedMotion}
              allowOrbit={!coarsePointer}
              onPlacePad={placePad}
              onShock={shock}
            />
          ) : (
            <SceneMessage>
              {webgl === false
                ? "Twoja przeglądarka nie obsługuje grafiki 3D. Instrukcja tekstowa obok jest kompletna."
                : webgl === null
                  ? "Ładowanie sceny 3D…"
                  : "Widok 3D jest wyłączony. Instrukcja tekstowa obok jest kompletna."}
            </SceneMessage>
          )}
          {canRender3d && (step.id === "wezwij-pomoc" || step.id === "rko") && (
            <CprCounter key={step.id} reducedMotion={reducedMotion} />
          )}
          <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-surface/90 px-3 py-1 text-sm font-semibold shadow-sm">
            Krok {step.number} z {steps.length}
          </span>
          {canRender3d && taskPending && (
            <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-[#f5b700] px-3 py-1 text-sm font-semibold text-[#1a1400] shadow">
              {step.task?.type === "place-pads" ? "Dotknij żółtych miejsc na klatce piersiowej" : "Naciśnij pomarańczowy przycisk na AED"}
            </span>
          )}
        </div>

        {/* Panel kroku */}
        <div className="flex flex-col rounded-2xl border border-border bg-surface">
          <div className="flex-1 p-5 sm:p-6">
            <p className="text-sm font-semibold text-brand">
              Krok {step.number} z {steps.length}
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">{step.title}</h2>
            <p className="mt-3 text-base leading-relaxed">{step.instruction}</p>

            {step.warning && (
              <p className="mt-4 rounded-xl border border-danger bg-danger-soft px-4 py-3 font-semibold text-danger">
                {step.warning}
              </p>
            )}

            {step.aedPrompt && (
              <figure className="mt-4 rounded-xl bg-brand-soft px-4 py-3">
                <figcaption className="text-xs font-semibold uppercase tracking-wide text-brand">
                  Komunikat AED
                </figcaption>
                <blockquote className="mt-1 font-medium">
                  „{index === SHOCK_INDEX && shockDone ? "Wyładowanie wykonane. Rozpocznij RKO." : step.aedPrompt}”
                </blockquote>
              </figure>
            )}

            {step.task?.type === "place-pads" && (
              <fieldset className="mt-4">
                <legend className="text-sm font-semibold">{step.task.label}</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(["right", "left"] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      onClick={() => placePad(side)}
                      disabled={padsPlaced[side]}
                      className="rounded-xl border-2 border-[#b58800] bg-[#fff6d6] px-3 py-2 text-left text-sm font-semibold text-[#3d2e00] enabled:hover:bg-[#ffeeb0] disabled:border-brand disabled:bg-brand-soft disabled:text-brand"
                    >
                      {padsPlaced[side] ? "✓ " : ""}
                      {PAD_LABELS[side]}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {step.task?.type === "shock" && (
              <button
                type="button"
                onClick={shock}
                disabled={shockDone}
                className="mt-4 w-full rounded-xl bg-[#f28c28] px-4 py-3 font-bold text-[#1f1000] enabled:hover:bg-[#e07b17] disabled:bg-brand-soft disabled:text-brand"
              >
                {shockDone ? "✓ Wyładowanie wykonane" : `⚡ ${step.task.label}`}
              </button>
            )}

            <ul className="mt-5 list-disc space-y-1.5 pl-5 text-sm text-muted">
              {step.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>

          <div className="sticky bottom-0 flex gap-3 rounded-b-2xl border-t border-border bg-surface p-4 lg:static">
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
              className="rounded-xl border border-border px-5 py-3 font-semibold enabled:hover:bg-surface-2 disabled:opacity-40"
            >
              Wstecz
            </button>
            <button
              type="button"
              onClick={() => goTo(isLast ? 0 : index + 1)}
              className="flex-1 rounded-xl bg-brand px-5 py-3 font-semibold text-on-brand hover:bg-brand-strong"
            >
              {isLast ? "Zacznij od nowa" : "Dalej"}
            </button>
          </div>
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* Pasek kroków */}
      <nav aria-label="Kroki instrukcji">
        <ol className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {steps.map((s, i) => {
            const current = i === index;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  aria-current={current ? "step" : undefined}
                  className={`flex w-full flex-col items-start rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                    current
                      ? "border-brand bg-brand text-on-brand"
                      : i < index
                        ? "border-brand/40 bg-brand-soft hover:border-brand"
                        : "border-border bg-surface hover:bg-surface-2"
                  }`}
                >
                  <span className="font-bold">{s.number}</span>
                  <span className="truncate w-full">{s.short}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Ustawienia dostępności */}
      <fieldset className="flex flex-wrap gap-x-6 gap-y-3 rounded-2xl border border-border bg-surface px-5 py-4">
        <legend className="px-1 text-sm font-semibold">Ustawienia</legend>
        <Toggle
          label="Ogranicz animacje"
          checked={reducedMotion}
          onChange={(v) => setMotionOverride(v)}
          hint={motionOverride === null ? "zgodnie z ustawieniami systemu" : undefined}
        />
        <Toggle
          label="Lektor (czyta komunikaty AED)"
          checked={voice}
          onChange={setVoice}
          disabled={!speechSupported}
        />
        <Toggle label="Widok 3D" checked={show3d} onChange={setShow3d} />
      </fieldset>

      <p className="text-xs text-muted">
        {data.source} Treść ma charakter edukacyjny i nie zastępuje szkolenia z pierwszej pomocy.
      </p>
    </section>
  );
}

/** Licznik uciśnięć zsynchronizowany z animacją dłoni (ten sam zegar co w scenie). */
function CprCounter({ reducedMotion }: { reducedMotion: boolean }) {
  const valueRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = valueRef.current;
    if (!el) return;
    if (reducedMotion) {
      el.textContent = "30 : 2";
      return;
    }
    const start = performance.now() / 1000;
    let raf = 0;
    let last = "";
    const tick = () => {
      const p = getCprPhase(performance.now() / 1000 - start);
      const label = p.kind === "compress" ? `${p.count} / 30` : "2 oddechy";
      if (label !== last) el.textContent = last = label;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute right-3 top-3 min-w-28 rounded-xl bg-surface/95 px-3 py-2 text-center shadow-sm"
    >
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">Uciśnięcia</span>
      <span ref={valueRef} className="block text-xl font-bold tabular-nums" />
    </div>
  );
}

function SceneMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-6 text-center text-muted">
      <p className="max-w-sm">{children}</p>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-3 text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="relative h-6 w-11 shrink-0 rounded-full bg-border transition-colors peer-checked:bg-brand peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)] after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}
