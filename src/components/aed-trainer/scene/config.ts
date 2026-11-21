import type { StepId } from "@/lib/aed-steps";
import { STEP_IDS } from "@/lib/aed-steps";
import { Euler, Quaternion } from "three";

/**
 * Układ sceny (jednostki ≈ metry):
 * poszkodowany leży na plecach wzdłuż osi X, głowa w stronę +X, twarz w górę (+Y).
 * Jego prawa strona to -Z, lewa +Z. Kamera i AED są po stronie +Z, ratowniczka klęczy po stronie -Z.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type PadSide = "right" | "left";
export type PadState = Record<PadSide, boolean>;

export const AED_POS: Vec3 = [0.82, 0, 0.44];
export const AED_SIZE: Vec3 = [0.28, 0.09, 0.24];

export type PadPose = { position: Vec3; quaternion: Quat };

function eulerQuat(x: number, y: number, z: number): Quat {
  return new Quaternion().setFromEuler(new Euler(x, y, z)).toArray() as Quat;
}

/** Elektrody złożone w AED (świat). Docelowe miejsca liczy Victim (raycast w ciało). */
export const PAD_TRAY: Record<PadSide, PadPose> = {
  right: { position: [AED_POS[0] - 0.07, 0.095, AED_POS[2] + 0.05], quaternion: eulerQuat(0, 0, 0) },
  left: { position: [AED_POS[0] - 0.06, 0.103, AED_POS[2] + 0.06], quaternion: eulerQuat(0, 0.08, 0) },
};

export const AED_CONNECTOR: Vec3 = [AED_POS[0] - AED_SIZE[0] / 2, 0.05, AED_POS[2] - 0.02];

export type CameraPreset = { position: Vec3; target: Vec3 };

export const CAMERA_PRESETS: Record<StepId, CameraPreset> = {
  bezpieczenstwo: { position: [-0.1, 1.55, 2.2], target: [-0.05, 0.1, 0.05] },
  oddech: { position: [1.0, 0.9, -0.6], target: [0.6, 0.15, 0] },
  "wezwij-pomoc": { position: [-0.6, 0.95, 1.15], target: [0.25, 0.42, -0.2] },
  "wlacz-aed": { position: [1.0, 0.85, 1.35], target: [0.72, 0.1, 0.35] },
  elektrody: { position: [0.42, 1.0, 0.95], target: [0.45, 0.14, 0.12] },
  analiza: { position: [-0.05, 1.45, 1.85], target: [0.0, 0.05, 0.1] },
  wyladowanie: { position: [0.78, 0.72, 1.12], target: [0.65, 0.1, 0.3] },
  rko: { position: [-0.6, 0.95, 1.15], target: [0.25, 0.42, -0.2] },
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
