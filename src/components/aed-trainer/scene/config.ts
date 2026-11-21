import type { StepId } from "@/lib/aed-steps";
import { STEP_IDS } from "@/lib/aed-steps";

/**
 * Układ sceny (jednostki ≈ metry):
 * poszkodowany leży na plecach wzdłuż osi X, głowa w stronę +X, twarz w górę (+Y).
 * Jego prawa strona to -Z, lewa +Z. Ratownik i kamera są po stronie +Z (lewy bok poszkodowanego).
 */

export type Vec3 = [number, number, number];
export type PadSide = "right" | "left";
export type PadState = Record<PadSide, boolean>;

export const TORSO = { center: [0.2, 0.12, 0] as Vec3, size: [0.6, 0.22, 0.38] as Vec3, radius: 0.07 };
export const CHEST_TOP_Y = TORSO.center[1] + TORSO.size[1] / 2; // 0.23
export const COMPRESSION_POINT: Vec3 = [0.3, CHEST_TOP_Y, 0];
export const HEAD_PIVOT: Vec3 = [0.56, 0.11, 0];

export const AED_POS: Vec3 = [0.82, 0, 0.44];
export const AED_SIZE: Vec3 = [0.28, 0.09, 0.24];

export type PadPose = { position: Vec3; rotation: Vec3 };

/** Docelowe miejsca elektrod (świat). */
export const PAD_TARGETS: Record<PadSide, PadPose> = {
  // pod prawym obojczykiem, na prawo od mostka
  right: { position: [0.41, CHEST_TOP_Y + 0.004, -0.08], rotation: [0, Math.PI / 2, 0] },
  // lewy bok, linia pachowa środkowa, poniżej pachy (na zaokrągleniu tułowia)
  left: { position: [0.25, 0.197, 0.184], rotation: [Math.PI / 3, 0, 0] },
};

/** Elektrody złożone w AED (świat). */
export const PAD_TRAY: Record<PadSide, PadPose> = {
  right: { position: [AED_POS[0] - 0.07, 0.095, AED_POS[2] + 0.05], rotation: [0, 0, 0] },
  left: { position: [AED_POS[0] - 0.06, 0.103, AED_POS[2] + 0.06], rotation: [0, 0.08, 0] },
};

export const AED_CONNECTOR: Vec3 = [AED_POS[0] - AED_SIZE[0] / 2, 0.05, AED_POS[2] - 0.02];

export type CameraPreset = { position: Vec3; target: Vec3 };

export const CAMERA_PRESETS: Record<StepId, CameraPreset> = {
  bezpieczenstwo: { position: [-0.1, 1.55, 2.2], target: [-0.05, 0.1, 0.05] },
  oddech: { position: [0.95, 0.55, -0.62], target: [0.68, 0.12, 0] },
  "wezwij-pomoc": { position: [0.2, 0.7, 1.55], target: [0.3, 0.28, 0.05] },
  "wlacz-aed": { position: [1.0, 0.85, 1.35], target: [0.72, 0.1, 0.35] },
  elektrody: { position: [0.42, 1.0, 0.95], target: [0.45, 0.14, 0.12] },
  analiza: { position: [-0.05, 1.45, 1.85], target: [0.0, 0.05, 0.1] },
  wyladowanie: { position: [0.78, 0.72, 1.12], target: [0.65, 0.1, 0.3] },
  rko: { position: [0.2, 0.7, 1.55], target: [0.3, 0.28, 0.05] },
};

export type ScreenMode = "off" | "pads" | "analyze" | "shock" | "shocked" | "cpr";

export function getSceneState(stepId: StepId, shockDone: boolean) {
  const index = STEP_IDS.indexOf(stepId);
  const at = (id: StepId) => STEP_IDS.indexOf(id);
  let screen: ScreenMode = "off";
  if (index >= at("wlacz-aed")) screen = "pads";
  if (stepId === "analiza") screen = "analyze";
  if (stepId === "wyladowanie") screen = shockDone ? "shocked" : "shock";
  if (stepId === "rko") screen = "cpr";
  return {
    index,
    waves: stepId === "bezpieczenstwo",
    headTilt: stepId === "oddech",
    breathCheck: stepId === "oddech",
    phone: stepId === "wezwij-pomoc",
    compress: stepId === "wezwij-pomoc" || stepId === "rko",
    lidOpen: index >= at("wlacz-aed"),
    powerOn: index >= at("wlacz-aed"),
    powerHighlight: stepId === "wlacz-aed",
    shirtOff: index >= at("elektrody"),
    cables: index >= at("elektrody"),
    padTargets: stepId === "elektrody",
    padsForcedOn: index > at("elektrody"),
    dangerZone: stepId === "analiza" || (stepId === "wyladowanie" && !shockDone),
    shockReady: stepId === "wyladowanie" && !shockDone,
    screen,
  };
}

export type SceneState = ReturnType<typeof getSceneState>;
