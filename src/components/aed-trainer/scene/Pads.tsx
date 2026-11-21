"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { QuadraticBezierLine, RoundedBox } from "@react-three/drei";
import { Quaternion, Vector3, type Group } from "three";
import gsap from "gsap";
import {
  AED_CONNECTOR,
  PAD_TRAY,
  type PadPose,
  type PadSide,
  type PadState,
} from "./config";

type BezierLineHandle = {
  setPoints: (start: Vector3, end: Vector3, mid?: Vector3) => void;
};

type Props = {
  targets: Record<PadSide, PadPose>;
  placed: PadState;
  showTargets: boolean;
  showCables: boolean;
  reducedMotion: boolean;
  onPlace: (side: PadSide) => void;
};

const SIDES: PadSide[] = ["right", "left"];

export function Pads({ targets, placed, showTargets, showCables, reducedMotion, onPlace }: Props) {
  return (
    <group>
      {SIDES.map((side) => (
        <Pad
          key={side}
          side={side}
          target={targets[side]}
          placed={placed[side]}
          showTarget={showTargets && !placed[side]}
          showCable={showCables}
          reducedMotion={reducedMotion}
          onPlace={() => onPlace(side)}
        />
      ))}
    </group>
  );
}

function poseQuat(p: PadPose) {
  return new Quaternion(...p.quaternion);
}

function Pad({
  side,
  target,
  placed,
  showTarget,
  showCable,
  reducedMotion,
  onPlace,
}: {
  side: PadSide;
  target: PadPose;
  placed: boolean;
  showTarget: boolean;
  showCable: boolean;
  reducedMotion: boolean;
  onPlace: () => void;
}) {
  const padRef = useRef<Group>(null);
  const targetRef = useRef<Group>(null);
  const lineRef = useRef<BezierLineHandle>(null);
  const tmp = useMemo(
    () => ({ start: new Vector3(...AED_CONNECTOR), end: new Vector3(), mid: new Vector3() }),
    [],
  );
  const tray = PAD_TRAY[side];

  // Lot elektrody po łuku: z AED na klatkę piersiową (lub z powrotem).
  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;
    const to = placed ? target : tray;
    const fromPos = pad.position.clone();
    const fromQuat = pad.quaternion.clone();
    const toPos = new Vector3(...to.position);
    const toQuat = poseQuat(to);
    if (reducedMotion || fromPos.distanceTo(toPos) < 1e-4) {
      pad.position.copy(toPos);
      pad.quaternion.copy(toQuat);
      return;
    }
    const proxy = { p: 0 };
    const tween = gsap.to(proxy, {
      p: 1,
      duration: 0.9,
      ease: "power2.inOut",
      onUpdate: () => {
        pad.position.lerpVectors(fromPos, toPos, proxy.p);
        pad.position.y += Math.sin(Math.PI * proxy.p) * 0.18;
        pad.quaternion.slerpQuaternions(fromQuat, toQuat, proxy.p);
      },
    });
    return () => {
      tween.kill();
    };
  }, [placed, reducedMotion, target, tray]);

  useFrame(({ clock }) => {
    if (targetRef.current && showTarget) {
      const s = reducedMotion ? 1 : 1 + 0.15 * Math.sin(clock.getElapsedTime() * 4);
      targetRef.current.scale.setScalar(s);
    }
    if (lineRef.current && padRef.current && showCable) {
      tmp.end.copy(padRef.current.position);
      tmp.mid.lerpVectors(tmp.start, tmp.end, 0.5);
      tmp.mid.y = 0.005;
      lineRef.current.setPoints(tmp.start, tmp.end, tmp.mid);
    }
  });

  return (
    <>
      <group ref={padRef} position={tray.position} quaternion={tray.quaternion}>
        <RoundedBox args={[0.12, 0.006, 0.085]} radius={0.0025} smoothness={2}>
          <meshStandardMaterial color="#f4f4f2" roughness={0.6} />
        </RoundedBox>
        <mesh position={[0, 0.0032, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.06, 0.04]} />
          <meshBasicMaterial color="#c8102e" />
        </mesh>
      </group>

      {showCable && (
        <QuadraticBezierLine
          ref={lineRef as never}
          start={AED_CONNECTOR}
          end={tray.position}
          color="#20262a"
          lineWidth={2.2}
        />
      )}

      {showTarget && (
        <group position={target.position} quaternion={target.quaternion}>
          <group ref={targetRef}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
              <ringGeometry args={[0.05, 0.062, 40]} />
              <meshBasicMaterial color="#f5b700" transparent opacity={0.95} depthWrite={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
              <circleGeometry args={[0.05, 32]} />
              <meshBasicMaterial color="#f5b700" transparent opacity={0.25} depthWrite={false} />
            </mesh>
          </group>
          {/* Większy, niewidoczny obszar kliknięcia – łatwiej trafić palcem */}
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0.006, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onPlace();
            }}
            onPointerOver={() => {
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              document.body.style.cursor = "";
            }}
          >
            <circleGeometry args={[0.09, 24]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      )}
    </>
  );
}
