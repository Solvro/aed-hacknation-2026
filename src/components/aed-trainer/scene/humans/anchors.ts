import { Quaternion, Raycaster, Vector3, type SkinnedMesh } from "three";
import type { PadPose, PadSide, Vec3 } from "../config";

/** Punkty anatomiczne wyznaczone na podstawie rzeczywistej powierzchni ciała. */
export type BodyAnchors = {
  /** Środek dolnej połowy mostka – miejsce uciskania. */
  compression: Vec3;
  padTargets: Record<PadSide, PadPose>;
  head: Vec3;
  /** Twarz (poszkodowany leży na wznak): czubek nosa, czoło i broda – do pozy oddechów ratowniczych. */
  face: { nose: Vec3; forehead: Vec3; chin: Vec3 };
};

const raycaster = new Raycaster();
const UP = new Vector3(0, 1, 0);

export function hit(body: SkinnedMesh, origin: Vector3, dir: Vector3, accept?: (p: Vector3) => boolean) {
  raycaster.set(origin, dir.clone().normalize());
  raycaster.far = 5;
  const hits = raycaster.intersectObject(body, false);
  for (const h of hits) if (!accept || accept(h.point)) return h.point.clone();
  return null;
}

/** Punkt i normalna powierzchni (normalna z różnic skończonych – dokładna także dla skórowanej siatki). */
export function surfaceAt(
  body: SkinnedMesh,
  origin: Vector3,
  dir: Vector3,
  tangentA: Vector3,
  tangentB: Vector3,
  accept?: (p: Vector3) => boolean,
) {
  const p = hit(body, origin, dir, accept);
  if (!p) return null;
  const d = 0.015;
  const sample = (t: Vector3, s: number) => hit(body, origin.clone().addScaledVector(t, s * d), dir, accept) ?? p;
  const a = sample(tangentA, 1).sub(sample(tangentA, -1));
  const b = sample(tangentB, 1).sub(sample(tangentB, -1));
  const n = new Vector3().crossVectors(a, b).normalize();
  if (n.dot(dir) > 0) n.negate();
  return { point: p, normal: n };
}

export function padPose(point: Vector3, normal: Vector3, yaw: number, lift = 0.004): PadPose {
  const align = new Quaternion().setFromUnitVectors(UP, normal);
  const q = align.multiply(new Quaternion().setFromAxisAngle(UP, yaw));
  const pos = point.clone().addScaledVector(normal, lift);
  return { position: pos.toArray() as Vec3, quaternion: q.toArray() as [number, number, number, number] };
}
