import {
  Bone,
  type MeshStandardMaterial,
  Object3D,
  Quaternion,
  SkinnedMesh,
  Vector3,
} from "three";

/*
 * Narzędzia do pozowania szkieletu (szkielet w stylu UE: pelvis, spine_01..03, clavicle_l/r,
 * upperarm_l/r, lowerarm_l/r, hand_l/r, thigh_l/r, calf_l/r, foot_l/r, neck_01, Head).
 * Wszystkie operacje działają w przestrzeni świata, więc nie zależą od lokalnych osi kości.
 */

const _q = new Quaternion();
const _pq = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();

export function getBones(root: Object3D): Record<string, Bone> {
  const bones: Record<string, Bone> = {};
  root.traverse((o) => {
    if ((o as Bone).isBone) bones[o.name] = o as Bone;
  });
  return bones;
}

/** Zapamiętuje pozę spoczynkową, żeby pozowanie było idempotentne (StrictMode uruchamia efekty dwa razy). */
export function snapshotPose(bones: Record<string, Bone>) {
  const saved = Object.values(bones).map((b) => ({ b, q: b.quaternion.clone(), p: b.position.clone() }));
  return () => {
    for (const { b, q, p } of saved) {
      b.quaternion.copy(q);
      b.position.copy(p);
    }
  };
}

/** Obraca kość o kąt wokół osi zadanej w przestrzeni świata. */
export function rotateWorld(bone: Object3D, axis: Vector3, angle: number) {
  bone.parent!.updateWorldMatrix(true, false);
  bone.parent!.getWorldQuaternion(_pq);
  _q.setFromAxisAngle(_a.copy(axis).normalize(), angle);
  // local' = P⁻¹ · R · P · local
  const parentInv = _pq.clone().invert();
  bone.quaternion.premultiply(_pq).premultiply(_q).premultiply(parentInv);
  bone.updateWorldMatrix(false, true);
}

/** Obraca kość tak, aby odcinek kość→dziecko wskazywał zadany kierunek (świat). */
export function aimDirection(bone: Object3D, child: Object3D, dir: Vector3) {
  bone.updateWorldMatrix(true, true);
  const from = child.getWorldPosition(_a).sub(bone.getWorldPosition(_b)).normalize();
  const to = dir.clone().normalize();
  const rot = new Quaternion().setFromUnitVectors(from, to);
  bone.parent!.getWorldQuaternion(_pq);
  const parentInv = _pq.clone().invert();
  bone.quaternion.premultiply(_pq).premultiply(rot).premultiply(parentInv);
  bone.updateWorldMatrix(false, true);
}

/** Obraca kość tak, aby jej dziecko znalazło się na linii do punktu docelowego (świat). */
export function aimAt(bone: Object3D, child: Object3D, target: Vector3) {
  bone.updateWorldMatrix(true, false);
  const dir = target.clone().sub(bone.getWorldPosition(_b));
  aimDirection(bone, child, dir);
}

export function worldPos(o: Object3D) {
  o.updateWorldMatrix(true, false);
  return o.getWorldPosition(new Vector3());
}


/**
 * Animowana rotacja kości wokół osi świata względem pozy bazowej.
 * Zwraca funkcję set(angle), tanią do wywoływania co klatkę.
 */
export function makeBoneRotator(bone: Object3D, axis: Vector3) {
  bone.parent!.updateWorldMatrix(true, false);
  const P = bone.parent!.getWorldQuaternion(new Quaternion());
  const Pinv = P.clone().invert();
  const base = bone.quaternion.clone();
  const ax = axis.clone().normalize();
  const tmp = new Quaternion();
  return (angle: number) => {
    tmp.setFromAxisAngle(ax, angle);
    bone.quaternion.copy(base).premultiply(P).premultiply(tmp).premultiply(Pinv);
  };
}

/**
 * Przesunięcie kości w świecie bez przesuwania jej dzieci – deformuje tylko
 * wierzchołki przypięte do tej kości (np. ugięcie klatki piersiowej przy uciśnięciu).
 */
export function makeLocalPush(bone: Object3D, worldOffset: Vector3) {
  bone.parent!.updateWorldMatrix(true, false);
  bone.updateWorldMatrix(false, false);
  const parentInvQ = bone.parent!.getWorldQuaternion(new Quaternion()).invert();
  const boneInvQ = bone.getWorldQuaternion(new Quaternion()).invert();
  const offParent = worldOffset.clone().applyQuaternion(parentInvQ);
  const offBone = worldOffset.clone().applyQuaternion(boneInvQ);
  const base = bone.position.clone();
  const children = bone.children.map((c) => ({ c, base: c.position.clone() }));
  return (t: number) => {
    bone.position.copy(base).addScaledVector(offParent, t);
    for (const { c, base: cb } of children) c.position.copy(cb).addScaledVector(offBone, -t);
  };
}


/**
 * Skręca kość wokół osi (świat) tak, aby wektor `currentLocal` (w układzie kości)
 * był jak najbliżej kierunku `desired` (świat). Służy np. do obrócenia wnętrza dłoni w dół.
 */
export function twistToward(bone: Object3D, axis: Vector3, currentLocal: Vector3, desired: Vector3) {
  bone.updateWorldMatrix(true, false);
  const q = bone.getWorldQuaternion(new Quaternion());
  const ax = axis.clone().normalize();
  const cur = currentLocal.clone().applyQuaternion(q);
  const a = cur.sub(ax.clone().multiplyScalar(cur.dot(ax))).normalize();
  const d = desired.clone().sub(ax.clone().multiplyScalar(desired.dot(ax))).normalize();
  const angle = Math.atan2(new Vector3().crossVectors(a, d).dot(ax), a.dot(d));
  rotateWorld(bone, ax, angle);
}

/** Kierunek zapisany w przestrzeni świata, przeliczony do lokalnego układu kości (np. normalna dłoni w T-pose). */
export function toBoneLocal(bone: Object3D, worldDir: Vector3) {
  bone.updateWorldMatrix(true, false);
  return worldDir.clone().applyQuaternion(bone.getWorldQuaternion(new Quaternion()).invert());
}

/** Kość głowy: `head` (MPFB game_engine) lub `Head` (inne eksporty UE). */
export function headBone(bones: Record<string, Bone>) {
  return bones.head ?? bones.Head;
}

/**
 * Normalna wnętrza dłoni (w układzie kości dłoni), wyliczona z położenia palców w pozie spoczynkowej –
 * niezależna od tego, czy model stoi w T-pose czy A-pose.
 */
export function palmNormalLocal(bones: Record<string, Bone>, side: "l" | "r") {
  const hand = bones[`hand_${side}`];
  const fingers = worldPos(bones[`middle_01_${side}`]).sub(worldPos(hand)).normalize();
  const across = worldPos(bones[`pinky_01_${side}`]).sub(worldPos(bones[`index_01_${side}`])).normalize();
  const n = side === "l" ? new Vector3().crossVectors(across, fingers) : new Vector3().crossVectors(fingers, across);
  return toBoneLocal(hand, n.normalize());
}

/**
 * Materiały z eksportu MakeHuman są oznaczone jako przezroczyste (BLEND), co psuje sortowanie.
 * Skóra i ubrania – nieprzezroczyste; włosy, brwi i rzęsy – alpha test.
 */
export function fixMakeHumanMaterials(root: Object3D) {
  root.traverse((o) => {
    const mesh = o as SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats as MeshStandardMaterial[]) {
      const n = `${m.name} ${mesh.name}`.toLowerCase();
      const cutout = /hair|short0|ponytail|bob0|long0|braid|afro|eyebrow|eyelash/.test(n);
      m.transparent = false;
      m.depthWrite = true;
      if (cutout) {
        m.alphaTest = 0.45;
        m.side = 2; // DoubleSide
      } else {
        m.alphaTest = 0;
      }
      m.metalness = 0;
      if (/body|skin/.test(n)) m.roughness = 0.62;
      m.needsUpdate = true;
    }
  });
}

/**
 * Dwukostne IK (ramię + przedramię): dłoń trafia w `target`, łokieć wygina się w stronę `pole`.
 * Gdy cel jest poza zasięgiem, ręka się prostuje.
 */
export function solveTwoBone(upper: Object3D, lower: Object3D, end: Object3D, target: Vector3, pole: Vector3) {
  const s = worldPos(upper);
  const a = worldPos(lower).distanceTo(s);
  const b = worldPos(end).distanceTo(worldPos(lower));
  const toT = target.clone().sub(s);
  const dist = Math.min(Math.max(toT.length(), 1e-4), a + b - 1e-4);
  const dir = toT.normalize();
  const p = pole.clone().sub(s);
  const perp = p.sub(dir.clone().multiplyScalar(p.dot(dir))).normalize();
  const cosA = Math.min(1, Math.max(-1, (a * a + dist * dist - b * b) / (2 * a * dist)));
  const elbow = s
    .clone()
    .addScaledVector(dir, a * cosA)
    .addScaledVector(perp, a * Math.sqrt(1 - cosA * cosA));
  aimAt(upper, lower, elbow);
  aimAt(lower, end, target);
}

/** Wybrane kości: zapis i odczyt kwaternionów (do mieszania póz). */
export function captureQuats(bones: Object3D[]) {
  return bones.map((b) => b.quaternion.clone());
}
