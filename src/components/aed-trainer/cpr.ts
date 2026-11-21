/**
 * Wspólny rytm RKO dla ratowniczki, klatki piersiowej poszkodowanego i licznika:
 * 30 uciśnięć (110/min, głębokość 5 cm) + 2 oddechy ratownicze (przerwa < 10 s).
 */
export const CPR_RATE_HZ = 110 / 60;
export const COMPRESSION_DEPTH = 0.05;
const COMPRESS_TIME = 30 / CPR_RATE_HZ;
export const BREATHS_TIME = 5;
const CYCLE = COMPRESS_TIME + BREATHS_TIME;

export type CprPhase =
  | { kind: "compress"; count: number; phase: number }
  | { kind: "breaths"; t: number };

export function getCprPhase(elapsedSeconds: number): CprPhase {
  const t = elapsedSeconds % CYCLE;
  if (t < COMPRESS_TIME) {
    return {
      kind: "compress",
      count: Math.min(30, Math.floor(t * CPR_RATE_HZ) + 1),
      phase: (t * CPR_RATE_HZ) % 1,
    };
  }
  return { kind: "breaths", t: t - COMPRESS_TIME };
}

/** Ugięcie w cyklu uciśnięcia (0…1): równy czas uciśnięcia i pełnego odprężenia klatki. */
export function compressionWave(phase: number) {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
}

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** Przejście ratowniczki od klatki do głowy i z powrotem (0 = dłonie na mostku, 1 = przy ustach). */
export function breathPoseWeight(t: number) {
  const ramp = 0.9;
  if (t < ramp) return smooth(t / ramp);
  if (t > BREATHS_TIME - ramp) return smooth((BREATHS_TIME - t) / ramp);
  return 1;
}

/** Unoszenie się klatki piersiowej przy dwóch wdmuchnięciach (0…1), każde ok. 1 s. */
export function breathRise(t: number) {
  for (const [a, b] of [
    [1.1, 2.1],
    [2.5, 3.5],
  ]) {
    if (t >= a && t <= b) return Math.sin((Math.PI * (t - a)) / (b - a));
  }
  return 0;
}
