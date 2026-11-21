"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { CameraControls, ContactShadows } from "@react-three/drei";
import type { Group, PointLight } from "three";
import gsap from "gsap";
import type { StepId } from "@/lib/aed-steps";
import { CAMERA_PRESETS, getSceneState, type PadSide, type PadState } from "./config";
import type { BodyAnchors } from "./humans/anchors";
import { Victim } from "./Victim";
import { AedDevice } from "./AedDevice";
import { Pads } from "./Pads";
import { Rescuer } from "./Rescuer";
import { BreathCheck, DangerZone, Phone112, SoundWaves } from "./Effects";

export type AedSceneProps = {
  stepId: StepId;
  padsPlaced: PadState;
  shockCount: number;
  reducedMotion: boolean;
  allowOrbit: boolean;
  onPlacePad: (side: PadSide) => void;
  onShock: () => void;
};

export default function AedScene(props: AedSceneProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: CAMERA_PRESETS.bezpieczenstwo.position, fov: 40, near: 0.05, far: 30 }}
      gl={{ antialias: true, alpha: true }}
      onPointerMissed={() => {
        document.body.style.cursor = "";
      }}
    >
      <SceneContents {...props} />
    </Canvas>
  );
}

function SceneContents({
  stepId,
  padsPlaced,
  shockCount,
  reducedMotion,
  allowOrbit,
  onPlacePad,
  onShock,
}: AedSceneProps) {
  const s = getSceneState(stepId, shockCount > 0);
  const patientRef = useRef<Group>(null);
  const flashRef = useRef<PointLight>(null);
  const [anchors, setAnchors] = useState<BodyAnchors | null>(null);
  // Wspólny zegar RKO dla ratowniczki i ugięcia klatki piersiowej.
  const cprStart = useRef(0);
  useEffect(() => {
    if (s.compress) cprStart.current = performance.now() / 1000;
  }, [stepId, s.compress]);
  const placed: PadState = {
    right: padsPlaced.right || s.padsForcedOn,
    left: padsPlaced.left || s.padsForcedOn,
  };

  // Efekt wyładowania: krótki błysk i drgnięcie ciała (pomijany przy ograniczonym ruchu).
  const prevShock = useRef(shockCount);
  useEffect(() => {
    if (shockCount <= prevShock.current) {
      prevShock.current = shockCount;
      return;
    }
    prevShock.current = shockCount;
    if (reducedMotion || !patientRef.current || !flashRef.current) return;
    const tl = gsap.timeline();
    tl.to(flashRef.current, { intensity: 6, duration: 0.06 })
      .to(patientRef.current.position, { y: 0.025, duration: 0.07, ease: "power2.out" }, 0)
      .to(patientRef.current.position, { y: 0, duration: 0.25, ease: "bounce.out" }, 0.07)
      .to(flashRef.current, { intensity: 0, duration: 0.35 }, 0.06);
    return () => {
      tl.kill();
    };
  }, [shockCount, reducedMotion]);

  return (
    <>
      <hemisphereLight args={["#ffffff", "#b9c4be", 1.1]} />
      <directionalLight position={[1.5, 3, 2]} intensity={1.6} />
      <directionalLight position={[-2, 1.5, -1]} intensity={0.4} />
      <pointLight
        ref={flashRef}
        position={[anchors?.compression[0] ?? 0.3, 0.5, 0.2]}
        intensity={0}
        distance={2}
        color="#fff3c4"
      />

      <CameraRig stepId={stepId} reducedMotion={reducedMotion} allowOrbit={allowOrbit} />

      {/* Podłoga */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]}>
        <circleGeometry args={[30, 64]} />
        <meshStandardMaterial color="#cfd8d3" roughness={1} />
      </mesh>
      <ContactShadows position={[0, 0.001, 0]} scale={4} resolution={512} blur={2.4} opacity={0.45} far={0.6} />

      <Suspense fallback={null}>
        <group ref={patientRef}>
          <Victim
            headTilt={s.headTilt}
            shirtOff={s.shirtOff}
            compress={s.compress}
            cprStart={cprStart}
            reducedMotion={reducedMotion}
            onReady={setAnchors}
          />
          {anchors && (
            <Pads
              targets={anchors.padTargets}
              placed={placed}
              showTargets={s.padTargets}
              showCables={s.cables}
              reducedMotion={reducedMotion}
              onPlace={onPlacePad}
            />
          )}
        </group>
        {anchors && (
          <Rescuer
            active={s.compress}
            anchors={anchors}
            cprStart={cprStart}
            reducedMotion={reducedMotion}
          />
        )}
      </Suspense>

      <AedDevice
        lidOpen={s.lidOpen}
        powerOn={s.powerOn}
        powerHighlight={s.powerHighlight}
        shockReady={s.shockReady}
        screen={s.screen}
        reducedMotion={reducedMotion}
        onShock={onShock}
      />

      {anchors && (
        <>
          <SoundWaves active={s.waves} head={anchors.head} reducedMotion={reducedMotion} />
          <BreathCheck active={s.breathCheck} head={anchors.head} />
        </>
      )}
      <Phone112 active={s.phone} reducedMotion={reducedMotion} />
      {s.dangerZone && <DangerZone reducedMotion={reducedMotion} />}
    </>
  );
}

/** Płynne przejścia kamery między krokami; na wąskich ekranach kamera się oddala. */
function CameraRig({ stepId, reducedMotion, allowOrbit }: { stepId: StepId; reducedMotion: boolean; allowOrbit: boolean }) {
  const ref = useRef<CameraControls>(null);
  const size = useThree((st) => st.size);
  const gl = useThree((st) => st.gl);
  const aspect = size.width / Math.max(1, size.height);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const { position: p, target: t } = CAMERA_PRESETS[stepId];
    const k = aspect < 0.8 ? 1.65 : aspect < 1.2 ? 1.25 : 1;
    void c.setLookAt(
      t[0] + (p[0] - t[0]) * k,
      t[1] + (p[1] - t[1]) * k,
      t[2] + (p[2] - t[2]) * k,
      t[0],
      t[1],
      t[2],
      !reducedMotion,
    );
  }, [stepId, aspect, reducedMotion]);

  useEffect(() => {
    // Na dotyku nie przechwytujemy gestów, żeby dało się przewijać stronę.
    gl.domElement.style.touchAction = allowOrbit ? "none" : "pan-y";
  }, [allowOrbit, gl]);

  return (
    <CameraControls
      ref={ref}
      enabled={allowOrbit}
      minDistance={0.4}
      maxDistance={4}
      maxPolarAngle={Math.PI / 2 - 0.08}
      smoothTime={0.6}
    />
  );
}
