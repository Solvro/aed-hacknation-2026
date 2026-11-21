"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import {
  CanvasTexture,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
  type Group,
  type MeshStandardMaterial,
} from "three";
import gsap from "gsap";
import { AED_POS, AED_SIZE, type ScreenMode } from "./config";

const AED_GREEN = "#0a8f4a";
const SHOCK_ORANGE = "#f28c28";

type Props = {
  lidOpen: boolean;
  powerOn: boolean;
  powerHighlight: boolean;
  shockReady: boolean;
  screen: ScreenMode;
  reducedMotion: boolean;
  onShock: () => void;
};

function heartGeometry(scale: number) {
  const s = new Shape();
  s.moveTo(5, 5);
  s.bezierCurveTo(5, 5, 4, 0, 0, 0);
  s.bezierCurveTo(-6, 0, -6, 7, -6, 7);
  s.bezierCurveTo(-6, 11, -3, 15.4, 5, 19);
  s.bezierCurveTo(12, 15.4, 16, 11, 16, 7);
  s.bezierCurveTo(16, 7, 16, 0, 10, 0);
  s.bezierCurveTo(7, 0, 5, 5, 5, 5);
  const g = new ShapeGeometry(s, 24);
  g.center();
  g.scale(scale, scale, scale);
  return g;
}

function boltGeometry(scale: number) {
  const pts: [number, number][] = [
    [0.15, 1], [-0.4, -0.05], [0, -0.05], [-0.15, -1], [0.4, 0.12], [0, 0.12],
  ];
  const s = new Shape();
  s.moveTo(...pts[0]);
  pts.slice(1).forEach((p) => s.lineTo(...p));
  s.closePath();
  const g = new ShapeGeometry(s);
  g.scale(scale, scale, scale);
  return g;
}

/** Ekran AED rysowany na <canvas> i używany jako tekstura. */
function useScreenTexture(mode: ScreenMode, reducedMotion: boolean) {
  const { canvas, texture } = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 144;
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return { canvas: c, texture: t };
  }, []);

  useEffect(() => () => texture.dispose(), [texture]);

  const acc = useRef(0);
  const startedAt = useRef(0);

  useEffect(() => {
    startedAt.current = performance.now() / 1000;
    acc.current = 1; // wymuś rysowanie przy zmianie trybu
  }, [mode]);

  useFrame((_, delta) => {
    acc.current += delta;
    const animated = !reducedMotion && (mode === "analyze" || mode === "shock" || mode === "cpr");
    if (acc.current < (animated ? 1 / 20 : 0.5)) return;
    acc.current = 0;
    const t = performance.now() / 1000 - startedAt.current;
    drawScreen(canvas.getContext("2d")!, mode, reducedMotion ? 0.6 : t, canvas.width, canvas.height);
    texture.needsUpdate = true;
  });

  return texture;
}

function drawScreen(ctx: CanvasRenderingContext2D, mode: ScreenMode, t: number, w: number, h: number) {
  ctx.fillStyle = mode === "off" ? "#050807" : "#0c1a14";
  ctx.fillRect(0, 0, w, h);
  if (mode === "off") return;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const title = (text: string, color = "#e9fff3", y = 34, size = 26) => {
    ctx.fillStyle = color;
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.fillText(text, w / 2, y);
  };

  if (mode === "pads") {
    title("NAKLEJ");
    title("ELEKTRODY", "#e9fff3", 66);
    ctx.strokeStyle = "#3ddc84";
    ctx.lineWidth = 4;
    ctx.strokeRect(w / 2 - 50, 92, 36, 30);
    ctx.strokeRect(w / 2 + 14, 92, 36, 30);
    return;
  }
  if (mode === "analyze" || mode === "shock") {
    // migotanie komór – nieregularna fala
    ctx.strokeStyle = "#3ddc84";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 3) {
      const k = x * 0.09 + t * 7;
      const y = 102 + Math.sin(k) * 14 + Math.sin(k * 1.9 + 1.3) * 8 + Math.sin(k * 0.45) * 6;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (mode === "analyze") {
      title("ANALIZA RYTMU", "#e9fff3", 34, 24);
    } else {
      const on = Math.floor(t * 2) % 2 === 0;
      title("WYŁADOWANIE", on ? SHOCK_ORANGE : "#ffd8b0", 28, 24);
      title("ZALECANE", on ? SHOCK_ORANGE : "#ffd8b0", 56, 22);
    }
    return;
  }
  if (mode === "shocked") {
    title("WYŁADOWANIE", "#ffd8b0", 52, 24);
    title("WYKONANE", "#ffd8b0", 84, 22);
    return;
  }
  // cpr
  const remaining = Math.max(0, 120 - Math.floor(t));
  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, "0");
  title("RKO 30:2", "#e9fff3", 42, 30);
  title(`${mm}:${ss}`, "#3ddc84", 96, 34);
}

export function AedDevice({ lidOpen, powerOn, powerHighlight, shockReady, screen, reducedMotion, onShock }: Props) {
  const lidRef = useRef<Group>(null);
  const powerMat = useRef<MeshStandardMaterial>(null);
  const shockMat = useRef<MeshStandardMaterial>(null);
  const shockRing = useRef<Group>(null);
  const heart = useMemo(() => heartGeometry(0.0042), []);
  const bolt = useMemo(() => boltGeometry(0.022), []);
  const smallBolt = useMemo(() => boltGeometry(0.012), []);
  const screenTex = useScreenTexture(screen, reducedMotion);

  useEffect(() => () => [heart, bolt, smallBolt].forEach((g) => g.dispose()), [heart, bolt, smallBolt]);

  useEffect(() => {
    if (!lidRef.current) return;
    const tween = gsap.to(lidRef.current.rotation, {
      x: lidOpen ? -1.95 : 0,
      duration: reducedMotion ? 0 : 1,
      ease: "power2.out",
    });
    return () => {
      tween.kill();
    };
  }, [lidOpen, reducedMotion]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    // ≤ 1 błysk na sekundę – bezpiecznie względem WCAG 2.3.1
    const pulse = reducedMotion ? 1 : 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
    if (powerMat.current) {
      powerMat.current.emissiveIntensity = powerHighlight ? 0.4 + 1.4 * pulse : powerOn ? 0.6 : 0;
    }
    if (shockMat.current) {
      shockMat.current.emissiveIntensity = shockReady ? 0.2 + 1.6 * pulse : 0.05;
    }
    if (shockRing.current) {
      shockRing.current.visible = shockReady;
      const s = reducedMotion ? 1.3 : 1.1 + 0.5 * ((t * 0.9) % 1);
      shockRing.current.scale.setScalar(s);
    }
  });

  const [w, h, d] = AED_SIZE;
  const setCursor = (c: string) => () => {
    document.body.style.cursor = c;
  };

  return (
    <group position={AED_POS}>
      {/* Obudowa */}
      <RoundedBox args={[w, h, d]} radius={0.02} smoothness={4} position={[0, h / 2, 0]}>
        <meshStandardMaterial color={AED_GREEN} roughness={0.45} />
      </RoundedBox>
      {/* Panel pod pokrywą */}
      <mesh position={[0, h + 0.0005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w - 0.03, d - 0.03]} />
        <meshStandardMaterial color="#1f2a26" roughness={0.6} />
      </mesh>
      {/* Ekran */}
      <mesh position={[-0.065, h + 0.002, -0.055]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.112, 0.063]} />
        <meshBasicMaterial map={screenTex} toneMapped={false} />
      </mesh>
      {/* Przycisk zasilania */}
      <mesh position={[0.07, h + 0.005, -0.055]}>
        <cylinderGeometry args={[0.017, 0.017, 0.01, 24]} />
        <meshStandardMaterial ref={powerMat} color="#3ddc84" emissive="#3ddc84" emissiveIntensity={0} />
      </mesh>
      {/* Przycisk wyładowania */}
      <group position={[0.07, h + 0.006, 0.045]}>
        <mesh
          onClick={(e) => {
            e.stopPropagation();
            if (shockReady) onShock();
          }}
          onPointerOver={shockReady ? setCursor("pointer") : undefined}
          onPointerOut={setCursor("")}
        >
          <cylinderGeometry args={[0.026, 0.026, 0.012, 32]} />
          <meshStandardMaterial ref={shockMat} color={SHOCK_ORANGE} emissive={SHOCK_ORANGE} emissiveIntensity={0.05} />
        </mesh>
        <mesh geometry={smallBolt} position={[0, 0.0065, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <meshBasicMaterial color="#ffffff" />
        </mesh>
        <group ref={shockRing} visible={false}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
            <ringGeometry args={[0.03, 0.034, 40]} />
            <meshBasicMaterial color={SHOCK_ORANGE} transparent opacity={0.9} />
          </mesh>
        </group>
      </group>
      {/* Gniazdo kabla */}
      <mesh position={[-w / 2 - 0.004, 0.05, -0.02]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.012, 0.012, 0.012, 16]} />
        <meshStandardMaterial color="#111" />
      </mesh>

      {/* Pokrywa na zawiasie przy tylnej krawędzi */}
      <group ref={lidRef} position={[0, h, -d / 2]}>
        <RoundedBox args={[w, 0.022, d]} radius={0.01} smoothness={3} position={[0, 0.011, d / 2]}>
          <meshStandardMaterial color={AED_GREEN} roughness={0.45} />
        </RoundedBox>
        {/* Znak AED: serce z błyskawicą */}
        <group position={[0, 0.0225, d / 2]} rotation={[0, Math.PI, 0]}>
          <mesh geometry={heart} rotation={[-Math.PI / 2, 0, 0]}>
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh geometry={bolt} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0005, 0.002]}>
            <meshBasicMaterial color={AED_GREEN} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
