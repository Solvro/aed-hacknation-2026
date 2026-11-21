"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Quaternion, Vector3, type Bone, type Group } from "three";
import {
  aimAt,
  aimDirection,
  captureQuats,
  fixMakeHumanMaterials,
  getBones,
  headBone,
  palmNormalLocal,
  rotateWorld,
  snapshotPose,
  solveTwoBone,
  twistToward,
  worldPos,
} from "./humans/rig";
import { COMPRESSION_DEPTH, breathPoseWeight, compressionWave, getCprPhase } from "../cpr";
import type { BodyAnchors } from "./humans/anchors";

const RESCUER_URL = "/models/rescuer.glb";
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);

type Props = {
  active: boolean;
  anchors: BodyAnchors;
  cprStart: { current: number };
  reducedMotion: boolean;
};

type Anim = {
  bones: Bone[];
  restoreA: () => void;
  qA: Quaternion[];
  qB: Quaternion[];
  /** Kąt zgięcia w biodrach na metr obniżenia barków. */
  hingePerMeter: number;
  hands: Vector3;
  solveArms: (hands: Vector3) => void;
};

/**
 * Ratowniczka klęczy po prawej stronie poszkodowanego (−Z), twarzą do niego (+Z).
 * Uciśnięcia: kolana nieruchomo, tułów zgina się w biodrach, ramiona pozostają wyprostowane,
 * a dłonie podążają za uginającą się klatką piersiową (5 cm, pełne odprężenie).
 * Oddechy: przejście do głowy – dłoń na czole, druga pod brodą, twarz nad ustami poszkodowanego.
 */
export function Rescuer({ active, anchors, cprStart, reducedMotion }: Props) {
  const gltf = useGLTF(RESCUER_URL, false);
  const groupRef = useRef<Group>(null);
  const anim = useRef<Anim | null>(null);

  const rig = useMemo(() => {
    const scene = cloneSkinned(gltf.scene) as Group;
    fixMakeHumanMaterials(scene);
    const bones = getBones(scene);
    scene.updateMatrixWorld(true);
    const palm = { l: palmNormalLocal(bones, "l"), r: palmNormalLocal(bones, "r") };
    return { scene, bones, palm, resetPose: snapshotPose(bones) };
  }, [gltf]);

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    rig.resetPose();
    const b = rig.bones;
    const head = headBone(b);
    const target = new Vector3(...anchors.compression);
    group.position.set(target.x, 0, -0.75);
    group.updateMatrixWorld(true);

    // 1. Klęk: obniż miednicę.
    group.position.y += 0.56 - worldPos(b.pelvis).y;
    group.updateMatrixWorld(true);

    // 2. Pochylenie tułowia nad poszkodowanym.
    rotateWorld(b.spine_01, X, 0.42);
    rotateWorld(b.spine_02, X, 0.28);
    rotateWorld(b.spine_03, X, 0.16);
    rotateWorld(b.neck_01, X, -0.25);
    rotateWorld(head, X, 0.2);

    // 3. Barki pionowo nad mostkiem.
    const shoulders = () => worldPos(b.upperarm_l).add(worldPos(b.upperarm_r)).multiplyScalar(0.5);
    const sh = shoulders();
    group.position.x += target.x - sh.x;
    group.position.z += target.z - 0.02 - sh.z;
    group.updateMatrixWorld(true);

    // 4. Nogi: kolana na ziemi, podudzia do tyłu, stopy w zgięciu podeszwowym.
    const pelvis = worldPos(b.pelvis);
    for (const side of ["l", "r"] as const) {
      const thigh = b[`thigh_${side}`];
      const calf = b[`calf_${side}`];
      const foot = b[`foot_${side}`];
      const ball = b[`ball_${side}`];
      const t = worldPos(thigh);
      const out = Math.sign(t.x - pelvis.x) || 1;
      aimAt(thigh, calf, new Vector3(t.x + out * 0.06, 0.07, t.z + 0.1));
      const k = worldPos(calf);
      aimAt(calf, foot, new Vector3(k.x + out * 0.02, 0.08, k.z - 0.42));
      if (ball) aimDirection(foot, ball, new Vector3(0, -0.25, -1));
    }

    // 5. Ręce wyprostowane, nadgarstki na mostku, dłonie płasko jedna na drugiej.
    const solveArms = (hands: Vector3) => {
      for (const side of ["l", "r"] as const) {
        const upper = b[`upperarm_${side}`];
        const lower = b[`lowerarm_${side}`];
        const hand = b[`hand_${side}`];
        const sx = Math.sign(worldPos(upper).x - hands.x) || 1;
        const wrist = hands.clone().add(new Vector3(sx * 0.012, side === "l" ? 0.018 : 0, -0.03));
        aimAt(upper, lower, wrist);
        aimAt(lower, hand, wrist);
        const middle = b[`middle_01_${side}`];
        if (middle) {
          const fingers = new Vector3(-sx * 0.3, -0.12, 1).normalize();
          aimDirection(hand, middle, fingers);
          twistToward(hand, fingers, rig.palm[side], DOWN);
        }
      }
    };
    const hands = target.clone().add(new Vector3(0, 0.03, -0.01));
    solveArms(hands);

    // Kości animowane co klatkę; poza A = dłonie na mostku (bez ugięcia).
    const animBones = [
      b.spine_01, b.spine_02, b.spine_03, b.neck_01, head,
      b.clavicle_l, b.clavicle_r, b.upperarm_l, b.upperarm_r,
      b.lowerarm_l, b.lowerarm_r, b.hand_l, b.hand_r,
    ].filter(Boolean);
    const restoreA = snapshotPose(Object.fromEntries(animBones.map((bone) => [bone.name, bone])));
    const qA = captureQuats(animBones);

    // Kalibracja: o ile opadają barki przy zgięciu w biodrach.
    const sh0 = shoulders().y;
    rotateWorld(b.spine_01, X, 0.1);
    const drop = Math.max(0.01, sh0 - shoulders().y);
    restoreA();

    // Poza B (oddechy): skręt i pochylenie tułowia tak, aby twarz znalazła się nad ustami poszkodowanego.
    const nose = new Vector3(...anchors.face.nose);
    const headTarget = nose.clone().add(new Vector3(-0.03, 0.2, -0.08));
    const applyLean = (twist: number, lean: number) => {
      restoreA();
      rotateWorld(b.spine_01, Y, twist * 0.5);
      rotateWorld(b.spine_02, Y, twist * 0.3);
      rotateWorld(b.spine_03, Y, twist * 0.2);
      const facing = new Vector3(Math.sin(twist), 0, Math.cos(twist));
      rotateWorld(b.spine_01, new Vector3().crossVectors(Y, facing), lean);
      return facing;
    };
    let best = { twist: 0, lean: 0, cost: Infinity };
    for (let twist = 0; twist <= 1.3; twist += 0.1) {
      for (let lean = -0.4; lean <= 0.9; lean += 0.05) {
        applyLean(twist, lean);
        const cost = worldPos(head).distanceTo(headTarget);
        if (cost < best.cost) best = { twist, lean, cost };
      }
    }
    const facing = applyLean(best.twist, best.lean);
    const lateral = new Vector3().crossVectors(Y, facing);
    rotateWorld(b.neck_01, lateral, 0.25);
    rotateWorld(head, lateral, 0.25);
    // Lewa dłoń na czole (odgięcie głowy), prawa pod brodą (uniesienie żuchwy).
    const forehead = new Vector3(...anchors.face.forehead).add(new Vector3(0, 0.035, 0));
    const chin = new Vector3(...anchors.face.chin).add(new Vector3(-0.01, 0.02, -0.05));
    const reach = (side: "l" | "r", goal: Vector3, pole: Vector3, fingers: Vector3) => {
      const upper = b[`upperarm_${side}`];
      solveTwoBone(upper, b[`lowerarm_${side}`], b[`hand_${side}`], goal, worldPos(upper).add(pole));
      const middle = b[`middle_01_${side}`];
      if (middle) {
        aimDirection(b[`hand_${side}`], middle, fingers);
        twistToward(b[`hand_${side}`], fingers, rig.palm[side], DOWN);
      }
    };
    reach("l", forehead, new Vector3(0.3, 0.1, -0.3), new Vector3(0.2, -0.3, 1));
    reach("r", chin, new Vector3(-0.3, -0.2, -0.2), new Vector3(0.6, -0.2, 0.8));
    const qB = captureQuats(animBones);
    restoreA();

    anim.current = { bones: animBones, restoreA, qA, qB, hingePerMeter: 0.1 / drop, hands, solveArms };
  }, [rig, anchors]);

  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = active;
  }, [active]);

  useFrame(() => {
    const a = anim.current;
    if (!a || !active) return;
    if (reducedMotion) {
      a.restoreA();
      return;
    }
    const p = getCprPhase(performance.now() / 1000 - cprStart.current);
    if (p.kind === "compress") {
      a.restoreA();
      const d = COMPRESSION_DEPTH * compressionWave(p.phase);
      if (d > 1e-4) {
        // Ciężar tułowia: zgięcie w biodrach obniża barki, wyprostowane ręce spychają mostek.
        rotateWorld(a.bones[0], X, d * a.hingePerMeter);
        a.solveArms(a.hands.clone().add(new Vector3(0, -d, 0)));
      }
    } else {
      const w = breathPoseWeight(p.t);
      a.bones.forEach((bone, i) => bone.quaternion.slerpQuaternions(a.qA[i], a.qB[i], w));
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <primitive object={rig.scene} />
    </group>
  );
}

useGLTF.preload(RESCUER_URL, false);
