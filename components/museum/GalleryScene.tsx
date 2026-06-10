"use client";

import * as THREE from "three";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import {
  Environment,
  MeshReflectorMaterial,
  PointerLockControls,
  Text,
  useProgress,
} from "@react-three/drei";
import { useRouter } from "next/navigation";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";
import type { MuseumData, PaintingData } from "@/lib/types";
import InspectView from "./InspectView";

/* ------------------------------------------------------------------ */
/* constants & layout                                                  */
/* ------------------------------------------------------------------ */

const SPACING = 3.2; // distance between painting centers along a wall
const ROOM_W = 7.2; // hall width (x)
const ROOM_H = 4; // ceiling height
const HANG_Y = 1.55; // painting center height
const EYE = 1.6; // camera eye height
const WALK_SPEED = 3; // m/s
const MARGIN = 0.45; // keep-away distance from walls
const WALL_COLOR = "#e8e4dc";

const FRAME_W = 0.075; // gold frame bar width
const FRAME_D = 0.09; // gold frame depth
const MAT_B = 0.06; // white mat border width

type Hung = {
  painting: PaintingData;
  index: number;
  side: 1 | -1; // sign of wall x
  z: number;
  w: number; // canvas width (m)
  h: number; // canvas height (m)
  rotY: number;
  wallX: number;
};

function paintingSize(p: PaintingData): { w: number; h: number } {
  const aspect = p.width && p.height ? p.width / p.height : 0.78;
  const maxPx = Math.max(p.width ?? 1200, p.height ?? 1200);
  const long = maxPx < 900 ? 1.2 : 1.6; // smaller works hang smaller
  return aspect >= 1
    ? { w: long, h: long / aspect }
    : { w: long * aspect, h: long };
}

function buildLayout(paintings: PaintingData[]) {
  const n = paintings.length;
  const perWall = Math.max(1, Math.ceil(n / 2));
  const roomL = (perWall - 1) * SPACING + 7.4;
  const halfL = roomL / 2;
  const hung: Hung[] = paintings.map((p, i) => {
    const side: 1 | -1 = i % 2 === 0 ? -1 : 1;
    const slot = Math.floor(i / 2);
    const z = -halfL + 3.7 + slot * SPACING;
    const { w, h } = paintingSize(p);
    return {
      painting: p,
      index: i,
      side,
      z,
      w,
      h,
      rotY: side === -1 ? Math.PI / 2 : -Math.PI / 2,
      wallX: (side * ROOM_W) / 2,
    };
  });
  return { hung, roomL, halfL };
}

type PaintingApi = { mesh: THREE.Mesh; setHighlight: (on: boolean) => void };
type Registry = Map<number, PaintingApi>;

const UP = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------------ */
/* error boundary (per-painting so one bad image never blanks the room)*/
/* ------------------------------------------------------------------ */

class PaintingBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    /* swallow — texture failed to load */
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/* ------------------------------------------------------------------ */
/* painting canvas (suspense texture) + placeholders                   */
/* ------------------------------------------------------------------ */

function PaintingImage({ url, w, h }: { url: string; w: number; h: number }) {
  const texture = useLoader(THREE.TextureLoader, url);
  useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
  }, [texture]);
  return (
    <mesh position={[0, 0, 0.046]}>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial map={texture} roughness={0.88} metalness={0} />
    </mesh>
  );
}

function CanvasPlaceholder({
  w,
  h,
  label,
}: {
  w: number;
  h: number;
  label?: string;
}) {
  return (
    <group position={[0, 0, 0.046]}>
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color="#332d26" roughness={1} />
      </mesh>
      {label ? (
        <Text
          position={[0, 0, 0.002]}
          fontSize={0.045}
          letterSpacing={0.18}
          color="#8d8475"
          anchorX="center"
          anchorY="middle"
          maxWidth={w * 0.9}
          textAlign="center"
        >
          {label}
        </Text>
      ) : null}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* one framed painting + mat + glass + placard + hit plane             */
/* ------------------------------------------------------------------ */

function Painting({
  item,
  registryRef,
}: {
  item: Hung;
  registryRef: React.RefObject<Registry>;
}) {
  const { painting: p, w, h } = item;
  const hitRef = useRef<THREE.Mesh>(null);

  // per-painting frame material so highlight is local to one frame
  const frameMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color("#8f7338"),
        metalness: 0.7,
        roughness: 0.35,
        emissive: new THREE.Color("#c9a35c"),
        emissiveIntensity: 0,
      }),
    []
  );

  useEffect(() => {
    const mesh = hitRef.current;
    const reg = registryRef.current;
    if (!mesh || !reg) return;
    reg.set(item.index, {
      mesh,
      setHighlight: (on: boolean) => {
        frameMat.emissiveIntensity = on ? 0.25 : 0;
      },
    });
    return () => {
      reg.delete(item.index);
    };
  }, [item.index, frameMat, registryRef]);

  useEffect(() => () => frameMat.dispose(), [frameMat]);

  const innerW = w + MAT_B * 2;
  const innerH = h + MAT_B * 2;
  const outerW = innerW + FRAME_W * 2;
  const outerH = innerH + FRAME_W * 2;
  const texUrl = p.thumbUrl ?? p.imageUrl;

  return (
    <group position={[item.wallX, HANG_Y, item.z]} rotation={[0, item.rotY, 0]}>
      {/* gold frame — four bars */}
      <mesh
        material={frameMat}
        castShadow
        position={[0, (innerH + FRAME_W) / 2, FRAME_D / 2]}
      >
        <boxGeometry args={[outerW, FRAME_W, FRAME_D]} />
      </mesh>
      <mesh
        material={frameMat}
        castShadow
        position={[0, -(innerH + FRAME_W) / 2, FRAME_D / 2]}
      >
        <boxGeometry args={[outerW, FRAME_W, FRAME_D]} />
      </mesh>
      <mesh
        material={frameMat}
        castShadow
        position={[(innerW + FRAME_W) / 2, 0, FRAME_D / 2]}
      >
        <boxGeometry args={[FRAME_W, innerH, FRAME_D]} />
      </mesh>
      <mesh
        material={frameMat}
        castShadow
        position={[-(innerW + FRAME_W) / 2, 0, FRAME_D / 2]}
      >
        <boxGeometry args={[FRAME_W, innerH, FRAME_D]} />
      </mesh>

      {/* white mat board */}
      <mesh position={[0, 0, 0.04]}>
        <planeGeometry args={[innerW, innerH]} />
        <meshStandardMaterial color="#f5f1e8" roughness={0.95} />
      </mesh>

      {/* the canvas itself — suspense + error fallback */}
      <PaintingBoundary
        fallback={<CanvasPlaceholder w={w} h={h} label="CANVAS UNAVAILABLE" />}
      >
        <Suspense fallback={<CanvasPlaceholder w={w} h={h} />}>
          <PaintingImage url={texUrl} w={w} h={h} />
        </Suspense>
      </PaintingBoundary>

      {/* subtle protective glass that catches moving highlights */}
      <mesh position={[0, 0, 0.056]}>
        <planeGeometry args={[innerW, innerH]} />
        <meshPhysicalMaterial
          transparent
          opacity={0.05}
          roughness={0.05}
          metalness={0}
          envMapIntensity={2}
        />
      </mesh>

      {/* invisible (but raycastable) hit plane covering the whole frame */}
      <mesh
        ref={hitRef}
        position={[0, 0, 0.08]}
        userData={{ idx: item.index }}
      >
        <planeGeometry args={[outerW, outerH]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>

      {/* museum wall placard */}
      <group position={[outerW / 2 + 0.33, -0.18, 0.012]}>
        <mesh>
          <planeGeometry args={[0.36, 0.16]} />
          <meshStandardMaterial color="#efece4" roughness={0.8} />
        </mesh>
        <Text
          position={[0, 0.028, 0.002]}
          fontSize={0.02}
          maxWidth={0.31}
          color="#23201b"
          anchorX="center"
          anchorY="middle"
          textAlign="center"
          lineHeight={1.25}
        >
          {p.title.length > 64 ? `${p.title.slice(0, 61)}…` : p.title}
        </Text>
        <Text
          position={[0, -0.048, 0.002]}
          fontSize={0.0155}
          color="#6b655c"
          anchorX="center"
          anchorY="middle"
        >
          {p.yearText ?? ""}
        </Text>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* per-painting ceiling track spot + visible fixture                   */
/* ------------------------------------------------------------------ */

function PaintingSpot({
  item,
  castShadow,
}: {
  item: Hung;
  castShadow: boolean;
}) {
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(item.wallX, HANG_Y, item.z);
    return o;
  }, [item]);

  const lx = item.side * (ROOM_W / 2 - 1.2);

  return (
    <group>
      <primitive object={target} />
      <spotLight
        position={[lx, 3.92, item.z]}
        target={target}
        angle={0.45}
        penumbra={0.7}
        decay={2}
        distance={8}
        intensity={26}
        color="#ffeeda"
        castShadow={castShadow}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.02}
      />
      {/* visible track-light fixture so the light "comes from" something */}
      <group position={[lx, 3.9, item.z]}>
        <mesh position={[0, 0.05, 0]}>
          <cylinderGeometry args={[0.016, 0.016, 0.14, 8]} />
          <meshStandardMaterial color="#1c1c1c" roughness={0.5} metalness={0.6} />
        </mesh>
        <group rotation={[0, 0, item.side * 0.5]}>
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.05, 0.058, 0.17, 12]} />
            <meshStandardMaterial color="#161616" roughness={0.45} metalness={0.7} />
          </mesh>
          <mesh position={[0, -0.17, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.045, 16]} />
            <meshStandardMaterial color="#000000" emissive="#ffdf9f" emissiveIntensity={3} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* entry feature wall — artist name in big letters, museum vinyl style */
/* ------------------------------------------------------------------ */

function NameWall({
  artist,
  halfL,
  dates,
}: {
  artist: MuseumData["artist"];
  halfL: number;
  dates: string;
}) {
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(0, 2.05, -halfL);
    return o;
  }, [halfL]);
  const nameSize = Math.min(0.42, 5.4 / Math.max(8, artist.name.length));
  return (
    <group>
      <group position={[0, 0, -halfL + 0.03]}>
        <Text
          position={[0, 2.3, 0]}
          fontSize={nameSize}
          letterSpacing={0.14}
          color="#2c2620"
          anchorX="center"
          anchorY="middle"
          maxWidth={ROOM_W - 1}
          textAlign="center"
        >
          {artist.name.toUpperCase()}
        </Text>
        {dates ? (
          <Text
            position={[0, 1.82, 0]}
            fontSize={0.105}
            letterSpacing={0.32}
            color="#6f675a"
            anchorX="center"
            anchorY="middle"
          >
            {dates}
          </Text>
        ) : null}
        <Text
          position={[0, 1.54, 0]}
          fontSize={0.082}
          letterSpacing={0.45}
          color={artist.periodColor || "#9b8453"}
          anchorX="center"
          anchorY="middle"
        >
          {artist.periodName.toUpperCase()}
        </Text>
      </group>
      <primitive object={target} />
      <spotLight
        position={[0, 3.85, -halfL + 2.4]}
        target={target}
        angle={0.7}
        penumbra={0.8}
        decay={2}
        distance={9}
        intensity={18}
        color="#fff3e2"
      />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* room shell — reflective floor, walls, cove ceiling, trim, benches   */
/* ------------------------------------------------------------------ */

function Bench({ z }: { z: number }) {
  return (
    <group position={[0, 0, z]}>
      {/* leather seat */}
      <mesh castShadow receiveShadow position={[0, 0.43, 0]}>
        <boxGeometry args={[0.62, 0.13, 2.4]} />
        <meshStandardMaterial color="#3a2c22" roughness={0.45} metalness={0.05} />
      </mesh>
      {/* steel pedestal legs */}
      <mesh castShadow position={[0, 0.185, -0.95]}>
        <boxGeometry args={[0.5, 0.37, 0.08]} />
        <meshStandardMaterial color="#15120f" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh castShadow position={[0, 0.185, 0.95]}>
        <boxGeometry args={[0.5, 0.37, 0.08]} />
        <meshStandardMaterial color="#15120f" metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}

function Room({ roomL }: { roomL: number }) {
  const halfL = roomL / 2;
  const benchZs = useMemo(
    () => (roomL > 19 ? [-roomL / 4 + 1.2, roomL / 4 - 1.2] : [0]),
    [roomL]
  );
  const coveW = 1.6;
  const sideW = (ROOM_W - coveW) / 2;

  return (
    <group>
      {/* reflective dark floor — the realism centerpiece */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_W, roomL]} />
        <MeshReflectorMaterial
          blur={[300, 100]}
          resolution={1024}
          mixBlur={0.9}
          mixStrength={0.6}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          roughness={0.5}
          metalness={0.2}
          mirror={0.55}
          color="#2b231b"
        />
      </mesh>

      {/* long walls */}
      <mesh
        position={[-ROOM_W / 2, ROOM_H / 2 + 0.2, 0]}
        rotation={[0, Math.PI / 2, 0]}
        receiveShadow
      >
        <planeGeometry args={[roomL, ROOM_H + 0.4]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.94} />
      </mesh>
      <mesh
        position={[ROOM_W / 2, ROOM_H / 2 + 0.2, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        receiveShadow
      >
        <planeGeometry args={[roomL, ROOM_H + 0.4]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.94} />
      </mesh>
      {/* end walls */}
      <mesh position={[0, ROOM_H / 2 + 0.2, -halfL]} receiveShadow>
        <planeGeometry args={[ROOM_W, ROOM_H + 0.4]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.94} />
      </mesh>
      <mesh
        position={[0, ROOM_H / 2 + 0.2, halfL]}
        rotation={[0, Math.PI, 0]}
        receiveShadow
      >
        <planeGeometry args={[ROOM_W, ROOM_H + 0.4]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.94} />
      </mesh>

      {/* ceiling with recessed lighting cove down the center */}
      <mesh position={[-(coveW / 2 + sideW / 2), ROOM_H, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[sideW, roomL]} />
        <meshStandardMaterial color="#ddd8ce" roughness={0.95} />
      </mesh>
      <mesh position={[coveW / 2 + sideW / 2, ROOM_H, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[sideW, roomL]} />
        <meshStandardMaterial color="#ddd8ce" roughness={0.95} />
      </mesh>
      {/* glowing cove recess */}
      <mesh position={[0, ROOM_H + 0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[coveW, roomL]} />
        <meshStandardMaterial color="#fbf6ea" emissive="#ffe8c0" emissiveIntensity={1.1} />
      </mesh>
      <mesh position={[-coveW / 2, ROOM_H + 0.15, 0]}>
        <boxGeometry args={[0.04, 0.32, roomL]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.9} />
      </mesh>
      <mesh position={[coveW / 2, ROOM_H + 0.15, 0]}>
        <boxGeometry args={[0.04, 0.32, roomL]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.9} />
      </mesh>
      <mesh position={[0, ROOM_H + 0.15, -(halfL - 0.02)]}>
        <boxGeometry args={[coveW + 0.08, 0.32, 0.04]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.9} />
      </mesh>
      <mesh position={[0, ROOM_H + 0.15, halfL - 0.02]}>
        <boxGeometry args={[coveW + 0.08, 0.32, 0.04]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.9} />
      </mesh>

      {/* lighting track rails */}
      <mesh position={[-(ROOM_W / 2 - 1.2), 3.97, 0]}>
        <boxGeometry args={[0.05, 0.045, roomL - 4]} />
        <meshStandardMaterial color="#1d1d1d" metalness={0.6} roughness={0.5} />
      </mesh>
      <mesh position={[ROOM_W / 2 - 1.2, 3.97, 0]}>
        <boxGeometry args={[0.05, 0.045, roomL - 4]} />
        <meshStandardMaterial color="#1d1d1d" metalness={0.6} roughness={0.5} />
      </mesh>

      {/* baseboard trim */}
      <mesh position={[-(ROOM_W / 2 - 0.02), 0.07, 0]}>
        <boxGeometry args={[0.04, 0.14, roomL]} />
        <meshStandardMaterial color="#2a241d" roughness={0.6} />
      </mesh>
      <mesh position={[ROOM_W / 2 - 0.02, 0.07, 0]}>
        <boxGeometry args={[0.04, 0.14, roomL]} />
        <meshStandardMaterial color="#2a241d" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.07, -(halfL - 0.02)]}>
        <boxGeometry args={[ROOM_W, 0.14, 0.04]} />
        <meshStandardMaterial color="#2a241d" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.07, halfL - 0.02]}>
        <boxGeometry args={[ROOM_W, 0.14, 0.04]} />
        <meshStandardMaterial color="#2a241d" roughness={0.6} />
      </mesh>

      {benchZs.map((z) => (
        <Bench key={z} z={z} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* first-person player: WASD walk + center-screen raycast aim          */
/* ------------------------------------------------------------------ */

const KEY_MAP: Record<string, "f" | "b" | "l" | "r"> = {
  KeyW: "f",
  ArrowUp: "f",
  KeyS: "b",
  ArrowDown: "b",
  KeyA: "l",
  ArrowLeft: "l",
  KeyD: "r",
  ArrowRight: "r",
};

function Player({
  halfL,
  lockedRef,
  registryRef,
  aimedRef,
  hintRef,
}: {
  halfL: number;
  lockedRef: React.RefObject<boolean>;
  registryRef: React.RefObject<Registry>;
  aimedRef: React.RefObject<number>;
  hintRef: React.RefObject<HTMLDivElement | null>;
}) {
  const camera = useThree((s) => s.camera);
  const keys = useRef({ f: false, b: false, l: false, r: false });
  const vel = useRef(new THREE.Vector3());
  const fwd = useRef(new THREE.Vector3());
  const rightV = useRef(new THREE.Vector3());
  const move = useRef(new THREE.Vector3());
  const center = useRef(new THREE.Vector2(0, 0));
  const scratch = useRef<THREE.Mesh[]>([]);
  const ray = useRef<THREE.Raycaster | null>(null);
  if (!ray.current) {
    ray.current = new THREE.Raycaster();
    ray.current.far = 6;
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = KEY_MAP[e.code];
      if (k) {
        keys.current[k] = true;
        if (lockedRef.current) e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = KEY_MAP[e.code];
      if (k) keys.current[k] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [lockedRef]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const locked = lockedRef.current === true;
    const registry = registryRef.current;

    // --- movement (ground plane only, smoothed acceleration) ---
    camera.getWorldDirection(fwd.current);
    fwd.current.y = 0;
    if (fwd.current.lengthSq() > 0.0001) fwd.current.normalize();
    rightV.current.crossVectors(fwd.current, UP); // fwd × up = camera right
    move.current.set(0, 0, 0);
    if (locked) {
      if (keys.current.f) move.current.add(fwd.current);
      if (keys.current.b) move.current.sub(fwd.current);
      if (keys.current.r) move.current.add(rightV.current);
      if (keys.current.l) move.current.sub(rightV.current);
      if (move.current.lengthSq() > 0) {
        move.current.normalize().multiplyScalar(WALK_SPEED);
      }
    }
    vel.current.lerp(move.current, 1 - Math.exp(-12 * dt));
    camera.position.addScaledVector(vel.current, dt);
    camera.position.x = THREE.MathUtils.clamp(
      camera.position.x,
      -(ROOM_W / 2 - MARGIN),
      ROOM_W / 2 - MARGIN
    );
    camera.position.z = THREE.MathUtils.clamp(
      camera.position.z,
      -(halfL - MARGIN),
      halfL - MARGIN
    );
    camera.position.y = EYE;

    // --- aim raycast from screen center ---
    let aim = -1;
    if (locked && registry && registry.size > 0 && ray.current) {
      ray.current.setFromCamera(center.current, camera);
      scratch.current.length = 0;
      registry.forEach((api) => scratch.current.push(api.mesh));
      const hits = ray.current.intersectObjects(scratch.current, false);
      if (hits.length > 0) {
        const idx = hits[0].object.userData.idx;
        if (typeof idx === "number") aim = idx;
      }
    }
    if (aim !== aimedRef.current && registry) {
      const prev = registry.get(aimedRef.current);
      if (prev) prev.setHighlight(false);
      const next = registry.get(aim);
      if (next) next.setHighlight(true);
      aimedRef.current = aim;
      if (hintRef.current) hintRef.current.style.opacity = aim >= 0 ? "1" : "0";
    }
  });

  return null;
}

/* ------------------------------------------------------------------ */
/* main scene                                                          */
/* ------------------------------------------------------------------ */

export default function GalleryScene({ data }: { data: MuseumData }) {
  const router = useRouter();
  const { artist, paintings } = data;
  const { hung, roomL, halfL } = useMemo(
    () => buildLayout(paintings),
    [paintings]
  );

  const controlsRef = useRef<PointerLockControlsImpl | null>(null);
  const registryRef = useRef<Registry>(new Map());
  const aimedRef = useRef(-1);
  const lockedRef = useRef(false);
  const hintRef = useRef<HTMLDivElement | null>(null);

  const [locked, setLocked] = useState(false);
  const [entered, setEntered] = useState(false);
  const [inspected, setInspected] = useState<PaintingData | null>(null);
  const { active, progress } = useProgress();

  const dates =
    artist.birthYear != null || artist.deathYear != null
      ? `${artist.birthYear ?? "?"} – ${artist.deathYear ?? "?"}`
      : "";

  const openAimed = useCallback(() => {
    const idx = aimedRef.current;
    if (idx < 0) return;
    const p = paintings[idx];
    if (!p) return;
    setInspected(p);
    controlsRef.current?.unlock();
  }, [paintings]);

  // click / E / Enter while locked & aiming → inspect
  useEffect(() => {
    const onClick = () => {
      if (lockedRef.current) openAimed();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!lockedRef.current) return;
      if (e.code === "KeyE" || e.code === "Enter") openAimed();
    };
    document.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [openAimed]);

  const handleLock = useCallback(() => {
    lockedRef.current = true;
    setLocked(true);
    setEntered(true);
  }, []);

  const handleUnlock = useCallback(() => {
    lockedRef.current = false;
    setLocked(false);
    const prev = registryRef.current.get(aimedRef.current);
    if (prev) prev.setHighlight(false);
    aimedRef.current = -1;
    if (hintRef.current) hintRef.current.style.opacity = "0";
  }, []);

  const closeInspect = useCallback(() => setInspected(null), []);
  const tryLock = useCallback(() => {
    if (!active) controlsRef.current?.lock();
  }, [active]);

  return (
    <div className="fixed inset-0 bg-black">
      <Canvas
        shadows="soft"
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ fov: 70, near: 0.05, far: 120, position: [0, EYE, halfL - 1.7] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.1;
        }}
      >
        <color attach="background" args={["#0d0c0a"]} />

        <Room roomL={roomL} />
        {hung.map((item) => (
          <Painting key={item.painting.id} item={item} registryRef={registryRef} />
        ))}
        {hung.map((item) => (
          <PaintingSpot
            key={item.painting.id}
            item={item}
            castShadow={item.index < 4}
          />
        ))}
        <NameWall artist={artist} halfL={halfL} dates={dates} />

        {/* low fill so the dark parts never go pure black */}
        <hemisphereLight args={["#e9e2d2", "#3d3226", 0.22]} />
        <PaintingBoundary fallback={null}>
          <Suspense fallback={null}>
            <Environment preset="apartment" environmentIntensity={0.25} />
          </Suspense>
        </PaintingBoundary>

        <Player
          halfL={halfL}
          lockedRef={lockedRef}
          registryRef={registryRef}
          aimedRef={aimedRef}
          hintRef={hintRef}
        />
        {/* selector points at nothing → we control locking manually */}
        <PointerLockControls
          ref={controlsRef}
          selector="#__gallery_no_autolock"
          onLock={handleLock}
          onUnlock={handleUnlock}
        />
      </Canvas>

      {/* crosshair + inspect hint */}
      {locked && !inspected && (
        <div className="pointer-events-none fixed left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2">
          <div className="h-1.5 w-1.5 rounded-full bg-white/80 mix-blend-difference" />
          <div
            ref={hintRef}
            style={{ opacity: 0, transition: "opacity 150ms ease" }}
            className="absolute left-1/2 top-4 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-[11px] tracking-wide whitespace-nowrap text-white/90"
          >
            ⏎ inspect
          </div>
        </div>
      )}

      {/* HUD — back to timeline + artist label */}
      {!inspected && (
        <>
          <div className="fixed top-5 left-5 z-50">
            <button
              onClick={() => router.push("/")}
              className="rounded-full border border-white/15 bg-black/50 px-4 py-2 text-xs tracking-[0.2em] text-white/80 uppercase backdrop-blur transition-colors hover:bg-black/70 hover:text-white"
            >
              ← Timeline
            </button>
          </div>
          <div className="pointer-events-none fixed top-5 right-5 z-50 text-right">
            <p className="font-display text-sm tracking-[0.25em] text-white/85 uppercase">
              {artist.name}
            </p>
            {dates && (
              <p className="mt-0.5 text-[11px] tracking-[0.2em] text-white/45">
                {dates}
              </p>
            )}
          </div>
        </>
      )}

      {/* start screen */}
      {!entered && !inspected && (
        <div
          className="fixed inset-0 z-40 flex cursor-pointer items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={tryLock}
        >
          <div className="px-8 text-center">
            <p className="text-xs tracking-[0.4em] text-[var(--gold)] uppercase">
              {artist.periodName}
            </p>
            <h1 className="font-display mt-3 text-5xl text-white">{artist.name}</h1>
            {dates && (
              <p className="mt-2 text-sm tracking-[0.3em] text-white/50">{dates}</p>
            )}
            <div className="mt-10 text-sm text-white/75">
              {active ? (
                <p>Hanging the paintings… {Math.round(progress)}%</p>
              ) : (
                <p className="animate-pulse">Click to enter</p>
              )}
            </div>
            <p className="mt-4 text-xs text-white/40">
              WASD walk · mouse look · click a painting to inspect · Esc to exit
            </p>
          </div>
        </div>
      )}

      {/* paused (pointer unlocked) screen */}
      {entered && !locked && !inspected && (
        <div
          className="fixed inset-0 z-40 flex cursor-pointer items-center justify-center bg-black/55"
          onClick={tryLock}
        >
          <div className="text-center">
            <p className="text-sm tracking-[0.25em] text-white/85 uppercase">
              Click to continue walking
            </p>
            <p className="mt-2 text-xs text-white/40">
              WASD walk · mouse look · click a painting to inspect
            </p>
          </div>
        </div>
      )}

      {inspected && <InspectView painting={inspected} onClose={closeInspect} />}
    </div>
  );
}
