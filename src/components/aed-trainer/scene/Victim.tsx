"use client";

import { useEffect, useMemo, useRef } from "react";
import { RoundedBox } from "@react-three/drei";
import { MeshStandardMaterial, type Group } from "three";
import gsap from "gsap";
import { HEAD_PIVOT, TORSO } from "./config";

const SKIN = "#e2ae8c";
const SHIRT = "#3b6fb6";
const PANTS = "#2f3a4a";
const HAIR = "#3a2a20";
const SHOE = "#22272b";

type Props = { headTilt: boolean; shirtOff: boolean; reducedMotion: boolean };

/** Stylizowana postać z prostych brył, w całości wygenerowana w kodzie. */
export function Victim({ headTilt, shirtOff, reducedMotion }: Props) {
  const headRef = useRef<Group>(null);

  const skin = useMemo(() => new MeshStandardMaterial({ color: SKIN, roughness: 0.75 }), []);
  const pants = useMemo(() => new MeshStandardMaterial({ color: PANTS, roughness: 0.9 }), []);
  // Jeden materiał koszulki dla tułowia i rękawów, żeby znikały razem.
  const shirt = useMemo(
    () => new MeshStandardMaterial({ color: SHIRT, roughness: 0.85, transparent: true }),
    [],
  );

  useEffect(() => () => [skin, pants, shirt].forEach((m) => m.dispose()), [skin, pants, shirt]);

  useEffect(() => {
    if (!headRef.current) return;
    const tween = gsap.to(headRef.current.rotation, {
      z: headTilt ? -0.38 : 0,
      duration: reducedMotion ? 0 : 0.9,
      ease: "power2.inOut",
    });
    return () => {
      tween.kill();
    };
  }, [headTilt, reducedMotion]);

  useEffect(() => {
    shirt.visible = true;
    shirt.depthWrite = false;
    const tween = gsap.to(shirt, {
      opacity: shirtOff ? 0 : 1,
      duration: reducedMotion ? 0 : 0.7,
      ease: "power1.inOut",
      onComplete: () => {
        shirt.visible = !shirtOff;
        shirt.depthWrite = !shirtOff;
      },
    });
    return () => {
      tween.kill();
    };
  }, [shirtOff, reducedMotion, shirt]);

  const [tx, ty, tz] = TORSO.size;

  return (
    <group>
      {/* Tułów (skóra) i koszulka */}
      <RoundedBox args={[tx, ty, tz]} radius={TORSO.radius} smoothness={4} position={TORSO.center} material={skin} />
      <RoundedBox
        args={[tx + 0.012, ty + 0.012, tz + 0.012]}
        radius={TORSO.radius + 0.006}
        smoothness={4}
        position={TORSO.center}
        material={shirt}
        renderOrder={1}
      />
      {/* Miednica */}
      <RoundedBox args={[0.22, 0.2, 0.36]} radius={0.07} smoothness={3} position={[-0.16, 0.105, 0]} material={pants} />

      {/* Szyja */}
      <mesh position={[0.53, 0.11, 0]} rotation={[0, 0, Math.PI / 2]} material={skin}>
        <cylinderGeometry args={[0.048, 0.05, 0.1, 16]} />
      </mesh>

      {/* Głowa – obraca się wokół szyi (odchylenie przy udrożnianiu dróg oddechowych) */}
      <group ref={headRef} position={HEAD_PIVOT}>
        <mesh position={[0.13, 0, 0]} material={skin}>
          <sphereGeometry args={[0.105, 32, 24]} />
        </mesh>
        <mesh position={[0.15, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <sphereGeometry args={[0.109, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={HAIR} roughness={0.95} />
        </mesh>
        <mesh position={[0.14, 0.1, 0]} material={skin}>
          <sphereGeometry args={[0.022, 16, 12]} />
        </mesh>
        {[-1, 1].map((s) => (
          <group key={s}>
            <mesh position={[0.17, 0.08, 0.036 * s]} scale={[1, 0.35, 1.6]}>
              <sphereGeometry args={[0.009, 10, 8]} />
              <meshStandardMaterial color="#2a1e18" />
            </mesh>
            <mesh position={[0.13, 0, 0.102 * s]} material={skin} scale={[1, 1, 0.5]}>
              <sphereGeometry args={[0.024, 12, 10]} />
            </mesh>
          </group>
        ))}
      </group>

      {/* Ręce wzdłuż ciała */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[0.43, 0.06, 0.245 * s]} rotation={[0, 0, Math.PI / 2]} material={shirt}>
            <cylinderGeometry args={[0.052, 0.052, 0.12, 16]} />
          </mesh>
          <mesh position={[0.3, 0.055, 0.245 * s]} rotation={[0, 0, Math.PI / 2]} material={skin}>
            <capsuleGeometry args={[0.044, 0.22, 6, 14]} />
          </mesh>
          <mesh position={[0.03, 0.05, 0.25 * s]} rotation={[0, 0, Math.PI / 2]} material={skin}>
            <capsuleGeometry args={[0.04, 0.24, 6, 14]} />
          </mesh>
          <mesh position={[-0.15, 0.045, 0.25 * s]} scale={[1.3, 0.7, 1]} material={skin}>
            <sphereGeometry args={[0.042, 14, 10]} />
          </mesh>
        </group>
      ))}

      {/* Nogi */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[-0.44, 0.075, 0.1 * s]} rotation={[0, 0, Math.PI / 2]} material={pants}>
            <capsuleGeometry args={[0.075, 0.32, 6, 14]} />
          </mesh>
          <mesh position={[-0.8, 0.065, 0.1 * s]} rotation={[0, 0, Math.PI / 2]} material={pants}>
            <capsuleGeometry args={[0.062, 0.32, 6, 14]} />
          </mesh>
          <RoundedBox args={[0.07, 0.13, 0.095]} radius={0.03} position={[-1.02, 0.09, 0.1 * s]}>
            <meshStandardMaterial color={SHOE} roughness={0.6} />
          </RoundedBox>
        </group>
      ))}
    </group>
  );
}
