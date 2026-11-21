"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Box3, Matrix4, Quaternion, Vector3, type Group, type MeshStandardMaterial, type SkinnedMesh } from "three";
import gsap from "gsap";
import { snapshotPose, aimAt, fixMakeHumanMaterials, getBones, headBone, makeBoneRotator, makeLocalPush, rotateWorld, worldPos } from "./humans/rig";
import { hit, padPose, surfaceAt, type BodyAnchors } from "./humans/anchors";
import { COMPRESSION_DEPTH, breathPoseWeight, breathRise, compressionWave, getCprPhase } from "../cpr";
import type { Vec3 } from "./config";

const VICTIM_URL = "/models/victim.glb";

/** Poszkodowany leży na plecach: głowa w stronę +X, twarz w górę (+Y), lewa strona ciała w stronę +Z. */
const LYING_QUAT = new Quaternion().setFromRotationMatrix(
  new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0)),
);
const VICTIM_POS: Vec3 = [-0.95, 0.15, 0];

type Props = {
  headTilt: boolean;
  shirtOff: boolean;
  compress: boolean;
  cprStart: { current: number };
  reducedMotion: boolean;
  onReady: (anchors: BodyAnchors) => void;
};

/** Postać wygenerowana w MPFB2/MakeHuman (CC0) – patrz public/models/LICENSE.md. */
export function Victim({ headTilt, shirtOff, compress, cprStart, reducedMotion, onReady }: Props) {
  const gltf = useGLTF(VICTIM_URL, false);
  const groupRef = useRef<Group>(null);

  const rig = useMemo(() => {
    const scene = cloneSkinned(gltf.scene) as Group;
    fixMakeHumanMaterials(scene);
    const body = scene.getObjectByName("Body") as SkinnedMesh;
    const shirt = scene.getObjectByName("Shirt") as SkinnedMesh;
    const bones = getBones(scene);
    // Osobne materiały koszulki, żeby mogła płynnie zniknąć.
    shirt.material = (shirt.material as MeshStandardMaterial).clone();
    return { scene, body, bones, shirt, resetPose: snapshotPose(bones) };
  }, [gltf]);

  const headTiltValue = useRef(0);
  const controls = useRef<{ setHead: (a: number) => void; setChest: (t: number) => void } | null>(null);

  // Pozowanie: ręce wzdłuż ciała (lewa lekko odwiedziona – dostęp do boku przy naklejaniu elektrod).
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    rig.resetPose();
    group.updateMatrixWorld(true);
    const b = rig.bones;

    // Odśwież bryły ograniczające skórowanej siatki. Kwantyzacja glTF trzyma pozycje w zakresie [-1, 1]
    // (skala w macierzach szkieletu), więc bryły geometrii trzeba podmienić na skórowane – inaczej raycast odrzuca trafienia.
    const refresh = () => {
      group.updateMatrixWorld(true);
      rig.body.skeleton.update();
      rig.body.computeBoundingBox();
      rig.body.computeBoundingSphere();
      rig.body.geometry.boundingBox = rig.body.boundingBox!.clone();
      rig.body.geometry.boundingSphere = rig.body.boundingSphere!.clone();
    };
    const UPWARD = new Vector3(0, 1, 0);
    const backY = (x: number, z: number) => hit(rig.body, new Vector3(x, -2, z), UPWARD)?.y ?? null;
    const Zaxis = new Vector3(0, 0, 1);

    // Postawa stojąca położona na plecach dotyka podłogi tylko pośladkami – odchyl kręgosłup i szyję,
    // żeby łopatki i potylica oparły się o podłogę.
    refresh();
    {
      const sh = worldPos(b.upperarm_l).add(worldPos(b.upperarm_r)).multiplyScalar(0.5);
      const pelvisX = worldPos(b.pelvis).x;
      const chestX = sh.x - 0.1;
      const backChest = backY(chestX, 0.05);
      const backPelvis = backY(pelvisX + 0.02, 0.06);
      if (backChest !== null && backPelvis !== null) {
        const spineX = worldPos(b.spine_01).x;
        rotateWorld(b.spine_01, Zaxis, -Math.atan2(backChest - backPelvis, chestX - spineX));
      }
      refresh();
      const head = worldPos(headBone(b));
      const neck = worldPos(b.neck_01);
      const backHead = backY(head.x + 0.03, 0);
      const backChest2 = backY(chestX, 0.05);
      if (backHead !== null && backChest2 !== null) {
        rotateWorld(b.neck_01, Zaxis, -Math.atan2(backHead - backChest2, head.x + 0.03 - neck.x) * 0.9);
      }
    }

    // Oprzyj ciało o podłogę (najniższy punkt skórowanej siatki na y = 0).
    refresh();
    const box = new Box3().copy(rig.body.boundingBox!).applyMatrix4(rig.body.matrixWorld);
    group.position.y -= box.min.y - 0.003;
    refresh();

    // Ręce wzdłuż ciała (lewa lekko odwiedziona – dostęp do boku przy naklejaniu elektrod) i stopy.
    const poseArm = (side: "l" | "r", out: number) => {
      const upper = b[`upperarm_${side}`];
      const lower = b[`lowerarm_${side}`];
      const hand = b[`hand_${side}`];
      const s = worldPos(upper);
      const lenU = worldPos(lower).distanceTo(s);
      const lenL = worldPos(hand).distanceTo(worldPos(lower));
      const zSign = Math.sign(s.z) || 1;
      const elbow = new Vector3(s.x - lenU * Math.cos(out), 0.07, s.z + zSign * lenU * Math.sin(out));
      aimAt(upper, lower, elbow);
      const e = worldPos(lower);
      const wrist = new Vector3(e.x - lenL * Math.cos(out * 0.6), 0.05, e.z + zSign * lenL * Math.sin(out * 0.6));
      aimAt(lower, hand, wrist);
      const middle = b[`middle_01_${side}`];
      if (middle) aimAt(hand, middle, wrist.clone().add(new Vector3(-0.1, -0.03, zSign * 0.02)));
    };
    poseArm("l", 0.55);
    poseArm("r", 0.12);

    // Stopy lekko na zewnątrz – naturalna pozycja leżąca.
    for (const side of ["l", "r"] as const) {
      const foot = b[`foot_${side}`];
      const ball = b[`ball_${side}`];
      if (!foot || !ball) continue;
      const f = worldPos(foot);
      const zSign = Math.sign(f.z) || 1;
      aimAt(foot, ball, f.clone().add(new Vector3(-0.04, 0.1, zSign * 0.05)));
    }

    // Ponowne oparcie o podłogę po ułożeniu rąk.
    refresh();
    box.copy(rig.body.boundingBox!).applyMatrix4(rig.body.matrixWorld);
    group.position.y -= box.min.y - 0.003;
    refresh();
    const setHead = makeBoneRotator(b.neck_01, new Vector3(0, 0, 1));
    const setChest = makeLocalPush(b.spine_03, new Vector3(0, -COMPRESSION_DEPTH, 0));
    controls.current = { setHead, setChest };

    // Punkty anatomiczne (raycast w powierzchnię ciała w aktualnej pozie).
    const shL = worldPos(b.upperarm_l);
    const shR = worldPos(b.upperarm_r);
    const down = new Vector3(0, -1, 0);
    const X = new Vector3(1, 0, 0);
    const Z = new Vector3(0, 0, 1);
    const Y = new Vector3(0, 1, 0);
    const torsoHalf = Math.max(Math.abs(shL.z), Math.abs(shR.z));
    const shoulderX = (shL.x + shR.x) / 2;

    const comp = surfaceAt(rig.body, new Vector3(shoulderX - 0.15, 1.5, 0), down, X, Z);
    const right = surfaceAt(rig.body, new Vector3(shoulderX - 0.075, 1.5, shR.z * 0.5), down, X, Z);
    // Lewa elektroda: linia pachowa środkowa poniżej pachy – poziomy promień w połowie grubości tułowia.
    const leftX = shoulderX - 0.2;
    const top = hit(rig.body, new Vector3(leftX, 2, 0.05), down)?.y ?? 0.25;
    const bottom = backY(leftX, 0.05) ?? 0;
    const left = surfaceAt(
      rig.body,
      new Vector3(leftX, bottom + (top - bottom) * 0.5, 1.2),
      new Vector3(0, 0, -1),
      X,
      Y,
      (p) => Math.abs(p.z) < torsoHalf * 0.85,
    );

    // Twarz: najwyższy punkt głowy wzdłuż osi ciała to czubek nosa.
    const headPos = worldPos(headBone(b));
    let nose = new Vector3(headPos.x, headPos.y, 0);
    for (let dx = -0.06; dx <= 0.22; dx += 0.005) {
      const p = hit(rig.body, new Vector3(headPos.x + dx, 2, 0), down);
      if (p && p.y > nose.y) nose = p;
    }
    const faceAt = (dx: number) =>
      (hit(rig.body, new Vector3(nose.x + dx, 2, 0), down) ?? nose.clone().add(new Vector3(dx, -0.03, 0))).toArray() as Vec3;

    if (comp && right && left) {
      onReady({
        compression: comp.point.toArray() as Vec3,
        head: headPos.toArray() as Vec3,
        face: { nose: nose.toArray() as Vec3, forehead: faceAt(0.075), chin: faceAt(-0.075) },
        padTargets: {
          right: padPose(right.point, right.normal, Math.PI / 2),
          left: padPose(left.point, left.normal, 0),
        },
      });
    } else {
      console.warn("Nie udało się wyznaczyć punktów anatomicznych", { comp, right, left });
    }
  }, [rig, onReady]);

  useEffect(() => {
    const proxy = { a: headTiltValue.current };
    const tween = gsap.to(proxy, {
      a: headTilt ? -0.42 : 0,
      duration: reducedMotion ? 0 : 0.9,
      ease: "power2.inOut",
      onUpdate: () => {
        headTiltValue.current = proxy.a;
        controls.current?.setHead(proxy.a);
      },
    });
    return () => {
      tween.kill();
    };
  }, [headTilt, reducedMotion]);
  useEffect(() => {
    const mat = rig.shirt.material as MeshStandardMaterial;
    rig.shirt.visible = true;
    mat.transparent = true;
    mat.depthWrite = false;
    const tween = gsap.to(mat, {
      opacity: shirtOff ? 0 : 1,
      duration: reducedMotion ? 0 : 0.7,
      ease: "power1.inOut",
      onComplete: () => {
        rig.shirt.visible = !shirtOff;
        mat.transparent = shirtOff;
        mat.depthWrite = true;
      },
    });
    return () => {
      tween.kill();
    };
  }, [shirtOff, reducedMotion, rig]);

  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    if (!compress || reducedMotion) {
      c.setChest(0);
      c.setHead(headTiltValue.current);
      return;
    }
    const p = getCprPhase(performance.now() / 1000 - cprStart.current);
    if (p.kind === "compress") {
      c.setChest(compressionWave(p.phase));
      c.setHead(headTiltValue.current);
    } else {
      // Oddechy ratownicze: odgięcie głowy i dwukrotne uniesienie klatki piersiowej.
      c.setChest(-0.25 * breathRise(p.t));
      c.setHead(headTiltValue.current - 0.32 * breathPoseWeight(p.t));
    }
  });

  return (
    <group ref={groupRef} position={VICTIM_POS} quaternion={LYING_QUAT}>
      <primitive object={rig.scene} />
    </group>
  );
}

useGLTF.preload(VICTIM_URL, false);
