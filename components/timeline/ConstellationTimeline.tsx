"use client";

/**
 * Variant B — "Constellation Map"
 * A night-sky star map of art history. Each period is a glowing nebula
 * cluster positioned along a (mildly non-linear) time axis; each artist is
 * a star that resolves into a portrait node past a zoom threshold.
 * Pan/zoom is fully imperative (refs + transforms), no per-frame React state.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import gsap from "gsap";
import type {
  TimelineArtist,
  TimelinePeriod,
  TimelineVariantProps,
} from "@/lib/types";

/* ----------------------------- constants ------------------------------ */

const GOLD = "#c9a35c";
const WORLD_W = 5400;
const PAD_X = 320;
const AXIS_Y = 800;
const GAMMA = 2.2; // non-linear time exponent: gives 1850–2026 breathing room
const LOD_NEAR = 0.85; // zoom level where stars resolve into portraits
const ZOOM_MAX = 4.5;
const TOP_CHROME = 90;
const BOTTOM_CHROME = 40;

const ERA_TICKS = [500, 700, 900, 1100, 1300, 1450, 1600, 1700, 1800, 1875, 1925, 1975, 2026];

/* ------------------------------ helpers ------------------------------- */

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Deterministic 0..1 hash from a string (stable star scatter). */
function hash01(str: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(201, 163, 92, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function formatYear(y: number): string {
  return y < 0 ? `${Math.abs(y)} BC` : `${y}`;
}

/** Box-shadow starfield: one element paints a whole layer of stars. */
function makeStarShadows(count: number, salt: number): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.round(hash01(`sx${i}`, salt) * 3600);
    const y = Math.round(hash01(`sy${i}`, salt) * 2200);
    const a = (0.18 + hash01(`sa${i}`, salt) * 0.55).toFixed(2);
    const r = hash01(`sr${i}`, salt) > 0.85 ? 1 : 0;
    parts.push(`${x}px ${y}px 0 ${r}px rgba(235, 240, 255, ${a})`);
  }
  return parts.join(", ");
}

/* ------------------------------- layout ------------------------------- */

type StarNode = {
  artist: TimelineArtist;
  lx: number; // local x within cluster group
  ly: number;
  wx: number; // world coords
  wy: number;
};

type Cluster = {
  period: TimelinePeriod;
  cx: number;
  cy: number;
  spread: number;
  glowR: number;
  stars: StarNode[];
  links: Array<{ a: StarNode; b: StarNode }>;
  labelY: number;
};

type Layout = {
  clusters: Cluster[];
  starsBySlug: Map<string, { star: StarNode; cluster: Cluster }>;
  xOfYear: (y: number) => number;
  bounds: { x0: number; y0: number; x1: number; y1: number };
};

function buildLayout(periods: TimelinePeriod[]): Layout {
  const sorted = [...periods].sort((a, b) => a.sort - b.sort);
  let minYear = Infinity;
  let maxYear = -Infinity;
  for (const p of sorted) {
    minYear = Math.min(minYear, p.startYear);
    maxYear = Math.max(maxYear, p.endYear);
  }
  if (!isFinite(minYear) || maxYear <= minYear) {
    minYear = 500;
    maxYear = 2026;
  }
  const span = maxYear - minYear;
  const xOfYear = (y: number): number =>
    PAD_X + (WORLD_W - PAD_X * 2) * Math.pow(clamp((y - minYear) / span, 0, 1), GAMMA);

  // 3 staggered rows around the axis so contemporaneous clusters don't collide.
  const ROW_OFFSETS = [-265, 135, -55];

  const clusters: Cluster[] = sorted.map((p, i) => {
    const px0 = xOfYear(p.startYear);
    const px1 = xOfYear(p.endYear);
    const cx = (px0 + px1) / 2;
    const jitter = (hash01(p.slug, 7) - 0.5) * 70;
    const cy = AXIS_Y + ROW_OFFSETS[i % ROW_OFFSETS.length] + jitter;
    const spread = clamp((px1 - px0) * 0.62, 190, 430);
    const glowR = clamp(120 + p.artists.length * 16, 140, 230);

    const pSpan = Math.max(1, p.endYear - p.startYear);
    const stars: StarNode[] = p.artists.map((a: TimelineArtist, j: number) => {
      const frac = clamp((a.activeStart - p.startYear) / pSpan, 0, 1);
      const lx =
        (frac - 0.5) * spread + (hash01(a.slug, 3) - 0.5) * 34;
      const ly =
        (j % 2 === 0 ? -1 : 1) * (34 + hash01(a.slug, 11) * 96) +
        (hash01(a.slug, 19) - 0.5) * 30;
      return { artist: a, lx, ly, wx: cx + lx, wy: cy + ly };
    });

    // Constellation chain: connect chronological neighbours within the period.
    const chain = [...stars].sort((a, b) => a.lx - b.lx);
    const links: Array<{ a: StarNode; b: StarNode }> = [];
    for (let k = 0; k < chain.length - 1; k++) {
      links.push({ a: chain[k], b: chain[k + 1] });
    }

    const lowest = stars.reduce((m, s) => Math.max(m, s.ly), 0);
    const labelY = Math.max(lowest + 64, glowR * 0.62 + 30);

    return { period: p, cx, cy, spread, glowR, stars, links, labelY };
  });

  const starsBySlug = new Map<string, { star: StarNode; cluster: Cluster }>();
  for (const c of clusters) {
    for (const s of c.stars) starsBySlug.set(s.artist.slug, { star: s, cluster: c });
  }

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of clusters) {
    x0 = Math.min(x0, c.cx - c.spread / 2 - 180);
    x1 = Math.max(x1, c.cx + c.spread / 2 + 180);
    y0 = Math.min(y0, c.cy - 230);
    y1 = Math.max(y1, c.cy + c.labelY + 110);
  }
  if (!isFinite(x0)) {
    x0 = 0; y0 = AXIS_Y - 400; x1 = WORLD_W; y1 = AXIS_Y + 400;
  }

  return { clusters, starsBySlug, xOfYear, bounds: { x0, y0, x1, y1 } };
}

/* ----------------------------- component ------------------------------ */

export default function ConstellationTimeline({
  periods,
  filter,
  onSelectArtist,
}: TimelineVariantProps) {
  const layout = useMemo(() => buildLayout(periods), [periods]);
  const isEmpty = layout.clusters.every((c) => c.stars.length === 0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const parallaxRefs = useRef<Array<HTMLDivElement | null>>([null, null, null]);
  const groupEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const haloEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const dotEls = useRef<Set<HTMLElement>>(new Set());
  const cardEls = useRef<Set<HTMLElement>>(new Set());

  const cam = useRef({ x: 0, y: 0, k: 0.25 });
  const sizeRef = useRef({ w: 1200, h: 800 });
  const minZoomRef = useRef(0.1);
  const lodNearRef = useRef(false);
  const camTween = useRef<gsap.core.Tween | null>(null);
  const haloTween = useRef<gsap.core.Tween | null>(null);
  const drag = useRef({
    active: false,
    captured: false,
    sx: 0,
    sy: 0,
    cx: 0,
    cy: 0,
    moved: false,
  });
  const enteredRef = useRef(false);
  const hadFocusRef = useRef(false);

  const starShadows = useMemo(
    () => [makeStarShadows(110, 1), makeStarShadows(80, 2), makeStarShadows(45, 3)],
    []
  );

  /* ------------------------- imperative camera ------------------------ */

  const applyCamera = useCallback(() => {
    const root = rootRef.current;
    const world = worldRef.current;
    if (!root || !world) return;
    const { x, y, k } = cam.current;
    world.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${k})`;
    // Semantic zoom: labels/nodes counter-scale so text stays screen-constant.
    const inv = clamp(1 / k, 0.3, 3.4);
    root.style.setProperty("--inv", inv.toFixed(4));

    // Parallax starfield (subtle, slower than the world).
    const factors = [0.03, 0.07, 0.12];
    parallaxRefs.current.forEach((el, i) => {
      if (el) el.style.transform = `translate3d(${x * factors[i]}px, ${y * factors[i]}px, 0)`;
    });

    // LOD crossfade: stars <-> portrait nodes.
    const near = k >= LOD_NEAR;
    if (near !== lodNearRef.current) {
      lodNearRef.current = near;
      const dots = Array.from(dotEls.current);
      const cards = Array.from(cardEls.current);
      gsap.killTweensOf(dots);
      gsap.killTweensOf(cards);
      gsap.to(cards, { autoAlpha: near ? 1 : 0, duration: 0.5, ease: "power2.out", overwrite: "auto" });
      gsap.to(dots, { autoAlpha: near ? 0 : 1, duration: 0.5, ease: "power2.out", overwrite: "auto" });
    }
  }, []);

  const killCamTween = useCallback(() => {
    camTween.current?.kill();
    camTween.current = null;
  }, []);

  const viewCenter = useCallback(() => {
    const { w, h } = sizeRef.current;
    return { vx: w / 2, vy: TOP_CHROME + (h - TOP_CHROME - BOTTOM_CHROME) / 2 };
  }, []);

  const overviewCamera = useCallback(() => {
    const { w, h } = sizeRef.current;
    const b = layout.bounds;
    const bw = Math.max(1, b.x1 - b.x0);
    const bh = Math.max(1, b.y1 - b.y0);
    const availH = Math.max(200, h - TOP_CHROME - BOTTOM_CHROME);
    const k = clamp(Math.min((w - 90) / bw, (availH - 40) / bh), 0.06, LOD_NEAR * 0.92);
    const { vx, vy } = viewCenter();
    return { x: vx - ((b.x0 + b.x1) / 2) * k, y: vy - ((b.y0 + b.y1) / 2) * k, k };
  }, [layout, viewCenter]);

  const flyTo = useCallback(
    (wx: number, wy: number, k: number, duration = 1.5) => {
      killCamTween();
      const { vx, vy } = viewCenter();
      camTween.current = gsap.to(cam.current, {
        x: vx - wx * k,
        y: vy - wy * k,
        k,
        duration,
        ease: "power3.inOut",
        onUpdate: applyCamera,
      });
    },
    [applyCamera, killCamTween, viewCenter]
  );

  /* --------------------------- mount / size --------------------------- */

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      sizeRef.current = { w: root.clientWidth || 1200, h: root.clientHeight || 800 };
      minZoomRef.current = Math.max(0.05, overviewCamera().k * 0.55);
      applyCamera();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [overviewCamera, applyCamera]);

  /* ------------------------ entrance animation ------------------------ */

  useEffect(() => {
    if (isEmpty || enteredRef.current) return;
    enteredRef.current = true;

    const over = overviewCamera();
    // Begin slightly tighter and drift out to the full sky.
    cam.current = { x: over.x * 1.06 - sizeRef.current.w * 0.02, y: over.y, k: over.k * 1.22 };
    applyCamera();
    camTween.current = gsap.to(cam.current, {
      ...over,
      duration: 2.1,
      ease: "power2.inOut",
      onUpdate: applyCamera,
    });

    const groups = Array.from(groupEls.current.values());
    const ctx = gsap.context(() => {
      gsap.fromTo(
        groups,
        { autoAlpha: 0, scale: 0.55 },
        {
          autoAlpha: 1,
          scale: 1,
          duration: 1.25,
          ease: "power2.out",
          stagger: 0.07,
          transformOrigin: "0px 0px",
          clearProps: "scale",
        }
      );
      if (rootRef.current) {
        gsap.fromTo(
          rootRef.current.querySelectorAll(".ctl-skyfade"),
          { opacity: 0 },
          { opacity: 1, duration: 2.4, ease: "power1.out", stagger: 0.2 }
        );
      }
    }, rootRef);
    return () => ctx.revert();
  }, [isEmpty, overviewCamera, applyCamera]);

  /* ----------------------------- filtering ---------------------------- */

  useEffect(() => {
    if (isEmpty) return;

    const activePeriod = filter.artistSlug
      ? layout.starsBySlug.get(filter.artistSlug)?.cluster.period.slug ?? null
      : filter.periodSlug;

    // Nothing focused and nothing was focused before: leave the entrance
    // animation (camera drift + cluster bloom) alone.
    if (activePeriod === null && !filter.artistSlug && !hadFocusRef.current) return;

    haloTween.current?.kill();
    haloTween.current = null;
    haloEls.current.forEach((el) => gsap.set(el, { opacity: 0 }));

    // Dim everything that isn't in focus.
    groupEls.current.forEach((el, slug) => {
      const dimmed = activePeriod !== null && slug !== activePeriod;
      gsap.to(el, { opacity: dimmed ? 0.1 : 1, duration: 0.9, ease: "power2.inOut", overwrite: "auto" });
    });

    if (filter.artistSlug) {
      hadFocusRef.current = true;
      const hit = layout.starsBySlug.get(filter.artistSlug);
      if (hit) {
        flyTo(hit.star.wx, hit.star.wy + 14, 2.1, 1.7);
        const halo = haloEls.current.get(filter.artistSlug);
        if (halo) {
          haloTween.current = gsap.fromTo(
            halo,
            { opacity: 0.95, scale: 0.55 },
            { opacity: 0, scale: 2.3, duration: 1.7, ease: "power1.out", repeat: -1, delay: 0.6 }
          );
        }
      }
      return;
    }

    if (filter.periodSlug) {
      hadFocusRef.current = true;
      const c = layout.clusters.find((cl) => cl.period.slug === filter.periodSlug);
      if (c) {
        const { w, h } = sizeRef.current;
        const k = clamp(
          Math.min((w * 0.72) / (c.spread + 280), ((h - TOP_CHROME - BOTTOM_CHROME) * 0.8) / 560),
          Math.max(0.95, LOD_NEAR + 0.1),
          1.7
        );
        flyTo(c.cx, c.cy + c.labelY * 0.3, k, 1.6);
      }
      return;
    }

    // Cleared: back to the full sky.
    hadFocusRef.current = false;
    const over = overviewCamera();
    killCamTween();
    camTween.current = gsap.to(cam.current, {
      ...over,
      duration: 1.5,
      ease: "power3.inOut",
      onUpdate: applyCamera,
    });
  }, [filter, layout, isEmpty, flyTo, overviewCamera, killCamTween, applyCamera]);

  /* --------------------------- pan & zoom ----------------------------- */

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      killCamTween();
      const rect = root.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const c = cam.current;
      const nk = clamp(c.k * Math.exp(-e.deltaY * 0.0016), minZoomRef.current, ZOOM_MAX);
      const r = nk / c.k;
      c.x = mx - (mx - c.x) * r;
      c.y = my - (my - c.y) * r;
      c.k = nk;
      applyCamera();
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [applyCamera, killCamTween]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      killCamTween();
      drag.current = {
        active: true,
        captured: false,
        sx: e.clientX,
        sy: e.clientY,
        cx: cam.current.x,
        cy: cam.current.y,
        moved: false,
      };
    },
    [killCamTween]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d.active) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 5) {
        d.moved = true;
        // Only capture once an actual drag starts — capturing on pointerdown
        // would retarget the click away from the artist buttons.
        e.currentTarget.setPointerCapture(e.pointerId);
        d.captured = true;
        e.currentTarget.style.cursor = "grabbing";
      }
      if (!d.moved) return;
      cam.current.x = d.cx + dx;
      cam.current.y = d.cy + dy;
      applyCamera();
    },
    [applyCamera]
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    d.active = false;
    if (d.captured) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      d.captured = false;
    }
    e.currentTarget.style.cursor = "grab";
  }, []);

  const handleSelect = useCallback(
    (slug: string) => {
      if (drag.current.moved) return; // it was a pan, not a click
      onSelectArtist(slug);
    },
    [onSelectArtist]
  );

  /* ------------------------------ render ------------------------------ */

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 overflow-hidden select-none"
      style={{
        background:
          "radial-gradient(120% 90% at 50% 0%, #0b0e1c 0%, #07080f 45%, #06070c 100%)",
        cursor: "grab",
        touchAction: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <style>{`
        @keyframes ctl-twinkle {
          0%, 100% { opacity: 0.35; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1.12); }
        }
        @keyframes ctl-drift-a {
          from { transform: translate3d(0, 0, 0); }
          to { transform: translate3d(-46px, -30px, 0); }
        }
        @keyframes ctl-drift-b {
          from { transform: translate3d(0, 0, 0); }
          to { transform: translate3d(38px, -22px, 0); }
        }
        @keyframes ctl-breathe {
          0%, 100% { opacity: 0.85; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 1; transform: translate(-50%, -50%) scale(1.07); }
        }
        .ctl-inv {
          transform: translate(-50%, -50%) scale(var(--inv, 1));
        }
      `}</style>

      {/* ---------- starfield backdrop (3 parallax layers) ---------- */}
      {starShadows.map((shadows, i) => (
        <div
          key={i}
          ref={(el) => {
            parallaxRefs.current[i] = el;
          }}
          className="ctl-skyfade pointer-events-none absolute"
          style={{ inset: "-25%", willChange: "transform" }}
          aria-hidden
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              animation: `${i % 2 === 0 ? "ctl-drift-a" : "ctl-drift-b"} ${140 + i * 70}s ease-in-out infinite alternate`,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: 1 + i,
                height: 1 + i,
                borderRadius: "50%",
                boxShadow: shadows,
                opacity: 0.85 - i * 0.18,
              }}
            />
          </div>
        </div>
      ))}

      {/* ---------- empty state (ingestion still running) ---------- */}
      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div
            className="h-2 w-2 rounded-full"
            style={{
              background: GOLD,
              boxShadow: `0 0 18px 4px ${hexToRgba(GOLD, 0.55)}`,
              animation: "ctl-twinkle 2.2s ease-in-out infinite",
            }}
          />
          <p className="font-display text-lg tracking-[0.25em] text-white/70 uppercase">
            Charting the sky
          </p>
          <p className="text-xs tracking-[0.3em] text-white/35 uppercase">
            Artwork data is still arriving — check back in a moment
          </p>
        </div>
      )}

      {/* -------------------- the transformed world -------------------- */}
      {!isEmpty && (
        <div
          ref={worldRef}
          className="absolute top-0 left-0"
          style={{
            width: WORLD_W,
            height: AXIS_Y * 2,
            transformOrigin: "0 0",
            willChange: "transform",
          }}
        >
          {/* date axis line + era ticks, floating behind everything */}
          <svg
            className="pointer-events-none absolute top-0 left-0"
            width={WORLD_W}
            height={AXIS_Y * 2}
            style={{ overflow: "visible" }}
            aria-hidden
          >
            <line
              x1={layout.xOfYear(ERA_TICKS[0]) - 120}
              y1={AXIS_Y}
              x2={layout.xOfYear(ERA_TICKS[ERA_TICKS.length - 1]) + 120}
              y2={AXIS_Y}
              stroke="rgba(244, 239, 230, 0.13)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {ERA_TICKS.map((year) => (
              <line
                key={year}
                x1={layout.xOfYear(year)}
                y1={AXIS_Y - 9}
                x2={layout.xOfYear(year)}
                y2={AXIS_Y + 9}
                stroke="rgba(244, 239, 230, 0.2)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {ERA_TICKS.map((year) => (
            <div
              key={year}
              className="pointer-events-none absolute"
              style={{ left: layout.xOfYear(year), top: AXIS_Y + 26 }}
              aria-hidden
            >
              <span
                className="ctl-inv absolute block text-[10px] tracking-[0.28em] whitespace-nowrap text-white/30 uppercase"
                style={{ willChange: "transform" }}
              >
                {formatYear(year)}
              </span>
            </div>
          ))}

          {/* ----------------- constellation clusters ----------------- */}
          {layout.clusters.map((c) => (
            <div
              key={c.period.slug}
              ref={(el) => {
                if (el) groupEls.current.set(c.period.slug, el);
                else groupEls.current.delete(c.period.slug);
              }}
              className="absolute"
              style={{ left: c.cx, top: c.cy, width: 0, height: 0 }}
            >
              {/* nebula glow */}
              <div
                className="pointer-events-none absolute"
                style={{
                  left: 0,
                  top: 0,
                  width: c.glowR * 2.6,
                  height: c.glowR * 1.9,
                  transform: "translate(-50%, -50%)",
                  borderRadius: "50%",
                  background: `radial-gradient(ellipse at center, ${hexToRgba(c.period.color, 0.34)} 0%, ${hexToRgba(c.period.color, 0.14)} 42%, ${hexToRgba(c.period.color, 0.04)} 64%, transparent 78%)`,
                  animation: `ctl-breathe ${11 + hash01(c.period.slug) * 7}s ease-in-out infinite`,
                }}
                aria-hidden
              />

              {/* constellation lines (1px on screen at any zoom) */}
              <svg
                className="pointer-events-none absolute"
                width={c.spread + 160}
                height={520}
                viewBox={`${-(c.spread + 160) / 2} -260 ${c.spread + 160} 520`}
                style={{
                  left: -(c.spread + 160) / 2,
                  top: -260,
                  overflow: "visible",
                }}
                aria-hidden
              >
                {c.links.map((ln, i) => (
                  <line
                    key={i}
                    x1={ln.a.lx}
                    y1={ln.a.ly}
                    x2={ln.b.lx}
                    y2={ln.b.ly}
                    stroke={hexToRgba(c.period.color, 0.38)}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>

              {/* period label: name + real date range */}
              <div
                className="pointer-events-none absolute"
                style={{ left: 0, top: c.labelY }}
              >
                <div
                  className="ctl-inv absolute flex flex-col items-center whitespace-nowrap"
                  style={{ willChange: "transform" }}
                >
                  <span
                    className="font-display text-[15px] tracking-[0.14em]"
                    style={{ color: "rgba(244, 239, 230, 0.92)", textShadow: "0 1px 10px rgba(0,0,0,0.8)" }}
                  >
                    {c.period.name}
                  </span>
                  <span
                    className="mt-0.5 text-[9px] font-medium tracking-[0.34em] uppercase"
                    style={{ color: GOLD, fontVariant: "small-caps" }}
                  >
                    {formatYear(c.period.startYear)} – {formatYear(c.period.endYear)}
                  </span>
                </div>
              </div>

              {/* artist stars */}
              {c.stars.map((s) => (
                <div
                  key={s.artist.slug}
                  className="absolute"
                  style={{ left: s.lx, top: s.ly, width: 0, height: 0 }}
                >
                  <div className="ctl-inv absolute" style={{ willChange: "transform" }}>
                    {/* gold halo (artist-filter pulse) */}
                    <div
                      ref={(el) => {
                        if (el) haloEls.current.set(s.artist.slug, el);
                        else haloEls.current.delete(s.artist.slug);
                      }}
                      className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        width: 92,
                        height: 92,
                        opacity: 0,
                        border: `1px solid ${hexToRgba(GOLD, 0.9)}`,
                        boxShadow: `0 0 26px 6px ${hexToRgba(GOLD, 0.35)}, inset 0 0 18px ${hexToRgba(GOLD, 0.25)}`,
                      }}
                      aria-hidden
                    />

                    {/* far LOD: twinkling star point */}
                    <div
                      ref={(el) => {
                        if (el) dotEls.current.add(el);
                      }}
                      className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                      aria-hidden
                    >
                      <div
                        className="rounded-full"
                        style={{
                          width: 7,
                          height: 7,
                          background: "#f6f3ea",
                          boxShadow: `0 0 10px 2px ${hexToRgba(c.period.color, 0.85)}, 0 0 22px 6px ${hexToRgba(c.period.color, 0.3)}`,
                          animation: `ctl-twinkle ${2.4 + hash01(s.artist.slug) * 3.4}s ease-in-out ${hash01(s.artist.slug, 5) * 4}s infinite`,
                        }}
                      />
                    </div>

                    {/* near LOD: portrait node */}
                    <button
                      ref={(el) => {
                        if (el) cardEls.current.add(el);
                      }}
                      type="button"
                      onClick={() => handleSelect(s.artist.slug)}
                      className="group absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center"
                      style={{ opacity: 0, visibility: "hidden" }}
                      aria-label={`Open ${s.artist.name}`}
                    >
                      <span
                        className="flex items-center justify-center overflow-hidden rounded-full transition-transform duration-300 group-hover:scale-110"
                        style={{
                          width: 56,
                          height: 56,
                          border: `1.5px solid ${hexToRgba(GOLD, 0.75)}`,
                          background: `radial-gradient(circle, ${hexToRgba(c.period.color, 0.5)} 0%, rgba(8, 10, 18, 0.92) 75%)`,
                          boxShadow: `0 0 16px 2px ${hexToRgba(c.period.color, 0.45)}, 0 4px 18px rgba(0,0,0,0.6)`,
                        }}
                      >
                        {s.artist.portraitUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={s.artist.portraitUrl}
                            alt=""
                            width={56}
                            height={56}
                            draggable={false}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="font-display text-lg" style={{ color: GOLD }}>
                            {s.artist.name.charAt(0)}
                          </span>
                        )}
                      </span>
                      <span
                        className="font-display mt-1.5 text-[11px] leading-tight whitespace-nowrap"
                        style={{ color: "rgba(244, 239, 230, 0.95)", textShadow: "0 1px 8px rgba(0,0,0,0.9)" }}
                      >
                        {s.artist.name}
                      </span>
                      <span
                        className="text-[8px] tracking-[0.24em] whitespace-nowrap"
                        style={{ color: hexToRgba(GOLD, 0.85) }}
                      >
                        {formatYear(s.artist.activeStart)}–{formatYear(s.artist.activeEnd)}
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* vignette for the planetarium feel */}
      <div
        className="ctl-skyfade pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(85% 70% at 50% 45%, transparent 55%, rgba(3, 4, 8, 0.55) 100%)",
        }}
        aria-hidden
      />
    </div>
  );
}
