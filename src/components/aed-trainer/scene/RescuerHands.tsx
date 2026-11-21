"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, RoundedBox } from "@react-three/drei";
import type { Group } from "three";
import gsap from "gsap";
import { COMPRESSION_POINT } from "./config";

const RATE_HZ = 110 / 60; // 110 uciśnięć na minutę
const COMPRESS_TIME = 30 / RATE_HZ;
const BREATHS_TIME = 4;
const CYCLE = COMPRESS_TIME + BREATHS_TIME;
const DEPTH = 0.022;

type Props = { active: boolean; reducedMotion: boolean };

/** Dłonie ratownika uciskające klatkę piersiową z licznikiem 30:2. */
export function RescuerHands({ active, reducedMotion }: Props) {
  const rootRef = useRef<Group>(null);
  const handsRef = useRef<Group>(null);
  const counterRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef(0);
  const lastLabel = useRef("");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (active) {
      root.visible = true;
      startedAt.current = performance.now() / 1000;
      lastLabel.current = "";
    }
    const tween = gsap.to(root.scale, {
      x: active ? 1 : 0.001,
      y: active ? 1 : 0.001,
      z: active ? 1 : 0.001,
      duration: reducedMotion ? 0 : 0.4,
      ease: active ? "back.out(1.6)" : "power1.in",
      onComplete: () => {
        if (!active) root.visible = false;
      },
    });
    return () => {
      tween.kill();
    };
  }, [active, reducedMotion]);

  useFrame(() => {
    if (!active || !handsRef.current) return;
    let label: string;
    if (reducedMotion) {
      handsRef.current.position.y = 0;
      label = "30 : 2";
    } else {
      const t = (performance.now() / 1000 - startedAt.current) % CYCLE;
      if (t < COMPRESS_TIME) {
        const phase = (t * RATE_HZ) % 1;
        handsRef.current.position.y = -DEPTH * Math.sin(Math.PI * phase);
        label = String(Math.min(30, Math.floor(t * RATE_HZ) + 1));
      } else {
        handsRef.current.position.y = 0.04;
        label = "2 oddechy";
      }
    }
    if (counterRef.current && label !== lastLabel.current) {
      counterRef.current.textContent = label;
      lastLabel.current = label;
    }
  });

  const armDir = { y: 0.34, z: 0.12 };
  const armLen = Math.hypot(armDir.y, armDir.z);
  const armTilt = Math.atan2(armDir.z, armDir.y);

  return (
    <group ref={rootRef} position={COMPRESSION_POINT} visible={false} scale={0.001}>
      <group ref={handsRef}>
        {/* Dłonie ułożone jedna na drugiej */}
        <RoundedBox args={[0.1, 0.028, 0.075]} radius={0.012} position={[0, 0.016, 0]}>
          <meshStandardMaterial color="#c98e6c" roughness={0.7} />
        </RoundedBox>
        <RoundedBox args={[0.1, 0.028, 0.075]} radius={0.012} position={[0, 0.042, 0.004]} rotation={[0, 0.25, 0]}>
          <meshStandardMaterial color="#c98e6c" roughness={0.7} />
        </RoundedBox>
        {/* Wyprostowane ramiona */}
        {[-1, 1].map((s) => (
          <group key={s} position={[0.04 * s, 0.05, 0]} rotation={[armTilt, 0, -0.08 * s]}>
            {/* przedramię */}
            <mesh position={[0, armLen * 0.3, 0]}>
              <capsuleGeometry args={[0.024, armLen * 0.6, 4, 12]} />
              <meshStandardMaterial color="#c98e6c" roughness={0.7} />
            </mesh>
            {/* rękaw, zanika ku górze */}
            <mesh position={[0, armLen * 0.85, 0]}>
              <cylinderGeometry args={[0.034, 0.03, armLen * 0.45, 14]} />
              <meshStandardMaterial color="#d24b3c" roughness={0.8} />
            </mesh>
          </group>
        ))}
      </group>
      {/* <Html> zawsze zamontowany (patrz Effects.tsx); tekst ustawiany imperatywnie w useFrame. */}
      <Html position={[-0.24, 0.12, 0]} center zIndexRange={[20, 0]}>
        <div ref={counterRef} aria-hidden="true" className="scene-bubble scene-bubble--counter" hidden={!active} />
      </Html>
    </group>
  );
}
