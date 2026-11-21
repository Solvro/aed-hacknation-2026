"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, RoundedBox } from "@react-three/drei";
import type { Group, Mesh, MeshBasicMaterial } from "three";
import type { Vec3 } from "./config";

/*
 * Uwaga: komponenty z drei <Html> muszą pozostać zamontowane (React 19 + drei:
 * warunkowe odmontowanie <Html> rzuca błąd removeChild). Ukrywamy je propsem `active`.
 */

/** Rozchodzące się fale: „Czy wszystko w porządku?” */
export function SoundWaves({ active, head, reducedMotion }: { active: boolean; head: Vec3; reducedMotion: boolean }) {
  const rings = useRef<(Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    if (!active) return;
    const t = clock.getElapsedTime();
    rings.current.forEach((ring, i) => {
      if (!ring) return;
      const p = reducedMotion ? (i + 1) / 3.5 : (t * 0.6 + i / 3) % 1;
      ring.scale.setScalar(0.15 + p * 0.45);
      (ring.material as MeshBasicMaterial).opacity = reducedMotion ? 0.5 : 0.8 * (1 - p);
    });
  });
  return (
    <group position={[head[0], 0.01, head[2]]} visible={active}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(m) => { rings.current[i] = m; }} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.92, 1, 64]} />
          <meshBasicMaterial color="#087a40" transparent depthWrite={false} />
        </mesh>
      ))}
      <Html position={[-0.3, 0.42, 0]} center zIndexRange={[20, 0]}>
        <div aria-hidden="true" className="scene-bubble" hidden={!active}>„Czy wszystko w porządku?”</div>
      </Html>
    </group>
  );
}

export function BreathCheck({ active, head }: { active: boolean; head: Vec3 }) {
  return (
    <Html position={[head[0] + 0.05, head[1] + 0.3, head[2]]} center zIndexRange={[20, 0]}>
      <div aria-hidden="true" className="scene-bubble" hidden={!active}>Patrz · słuchaj · wyczuwaj (max 10 s)</div>
    </Html>
  );
}

/** Telefon z wybranym numerem 112. */
export function Phone112({ active, reducedMotion }: { active: boolean; reducedMotion: boolean }) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current || reducedMotion || !active) return;
    ref.current.position.y = 0.42 + Math.sin(clock.getElapsedTime() * 2) * 0.015;
  });
  return (
    <group ref={ref} position={[1.08, 0.42, 0.05]} rotation={[-0.2, -0.6, 0]} visible={active}>
      <RoundedBox args={[0.075, 0.15, 0.01]} radius={0.008}>
        <meshStandardMaterial color="#1b1f22" roughness={0.4} />
      </RoundedBox>
      <mesh position={[0, 0, 0.0056]}>
        <planeGeometry args={[0.064, 0.134]} />
        <meshBasicMaterial color="#0f5132" />
      </mesh>
      <Html position={[0, 0, 0.01]} center zIndexRange={[20, 0]}>
        <div aria-hidden="true" className="scene-bubble scene-bubble--danger" hidden={!active}>112 · głośnik</div>
      </Html>
    </group>
  );
}

/** Czerwona strefa wokół poszkodowanego: nikt nie dotyka. */
export function DangerZone({ reducedMotion }: { reducedMotion: boolean }) {
  const mat = useRef<MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (!mat.current) return;
    mat.current.opacity = reducedMotion ? 0.7 : 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(clock.getElapsedTime() * Math.PI * 2));
  });
  return (
    <group position={[-0.12, 0.004, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[1.18, 0.62, 1]}>
        <ringGeometry args={[0.94, 1, 96]} />
        <meshBasicMaterial ref={mat} color="#c8102e" transparent depthWrite={false} />
      </mesh>
    </group>
  );
}
