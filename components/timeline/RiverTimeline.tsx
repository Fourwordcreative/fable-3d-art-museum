"use client";

/**
 * Variant A — "River of Time"
 *
 * A horizontal braided river of period strata on a museum-night background.
 * - Non-linear time mapping: x = ((year - min) / span)^1.6 * WORLD_W, so the
 *   20th century gets breathing room while chronology + real-date ticks hold.
 * - Semantic zoom: pan/zoom is done imperatively on a single transformed world
 *   div; labels and artist nodes counter-scale via a --inv CSS variable so
 *   they keep constant screen size at any zoom.
 * - LOD: bands only when zoomed out; artist nodes fade in past LOD_Z.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import type {
  TimelineArtist,
  TimelinePeriod,
  TimelineVariantProps,
} from "@/lib/types";

/* ------------------------------ constants ------------------------------ */

const WORLD_W = 2600; // logical world width in px
const BAND_H = 118; // band thickness (world units)
const LANE_H = 150; // vertical pitch between braided lanes
const EXP = 1.6; // non-linear time exponent
const LOD_Z = 2.0; // zoom (relative to fit) past which artists appear
const CHROME_TOP = 90;
const CHROME_BOTTOM = 40;
const GOLD = "#c9a35c";

const GRAIN =
  "url(\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.9'/%3E%3C/svg%3E\")";

const RADII = [
  "140px 220px 180px 120px / 70px 50px 80px 55px",
  "200px 120px 150px 230px / 55px 80px 50px 70px",
  "120px 190px 240px 140px / 80px 55px 65px 75px",
  "230px 150px 130px 200px / 60px 75px 55px 80px",
];

const NODE_Y_OFFSETS = [-32, 6, -14, 24, -26, 16];

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/* ------------------------------- layout -------------------------------- */

type Camera = { x: number; y: number; s: number };

type BandLayout = {
  period: TimelinePeriod;
  lane: number;
  x0: number;
  x1: number;
  y: number; // lane center (world units)
};

type NodeLayout = {
  artist: TimelineArtist;
  periodSlug: string;
  cx: number; // center of active years
  x0: number; // x(activeStart)
  x1: number; // x(activeEnd)
  y: number;
};

type Layout = {
  worldH: number;
  xOf: (year: number) => number;
  yearOf: (x: number) => number;
  bands: BandLayout[];
  nodes: NodeLayout[];
};

function buildLayout(periods: TimelinePeriod[]): Layout {
  const sorted = [...periods].sort(
    (a, b) => a.startYear - b.startYear || a.sort - b.sort
  );
  const minYear = sorted.length
    ? Math.min(500, ...sorted.map((p) => p.startYear))
    : 500;
  const maxYear = sorted.length
    ? Math.max(2026, ...sorted.map((p) => p.endYear))
    : 2026;
  const span = Math.max(1, maxYear - minYear);

  const xOf = (year: number) =>
    Math.pow(clamp((year - minYear) / span, 0, 1), EXP) * WORLD_W;
  const yearOf = (x: number) =>
    minYear + Math.pow(clamp(x / WORLD_W, 0, 1), 1 / EXP) * span;

  // Braided lanes: overlapping periods stack; sequential ones share a lane.
  const laneEnds: number[] = [];
  const bands: BandLayout[] = sorted.map((p) => {
    let lane = laneEnds.findIndex((end) => p.startYear >= end - 1);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(p.endYear);
    } else {
      laneEnds[lane] = Math.max(laneEnds[lane], p.endYear);
    }
    return { period: p, lane, x0: xOf(p.startYear), x1: xOf(p.endYear), y: 0 };
  });
  const laneCount = Math.max(1, laneEnds.length);
  const worldH = laneCount * LANE_H + 60;
  bands.forEach((b, i) => {
    b.y = 30 + b.lane * LANE_H + LANE_H / 2 + ((i % 2) * 12 - 6);
  });

  const nodes: NodeLayout[] = [];
  for (const b of bands) {
    const artists = [...b.period.artists].sort(
      (a, z) => a.activeStart - z.activeStart
    );
    artists.forEach((a, i) => {
      const x0 = xOf(a.activeStart);
      const x1 = xOf(Math.max(a.activeEnd, a.activeStart + 1));
      nodes.push({
        artist: a,
        periodSlug: b.period.slug,
        x0,
        x1,
        cx: (x0 + x1) / 2,
        y: b.y + NODE_Y_OFFSETS[i % NODE_Y_OFFSETS.length],
      });
    });
  }

  return { worldH, xOf, yearOf, bands, nodes };
}

/* ------------------------------ component ------------------------------ */

export default function RiverTimeline({
  periods,
  filter,
  onSelectArtist,
}: TimelineVariantProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const artistLayerRef = useRef<HTMLDivElement | null>(null);
  const axisRef = useRef<HTMLDivElement | null>(null);
  const bandRefs = useRef(new Map<string, HTMLDivElement>());
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const tickPool = useRef<HTMLDivElement[]>([]);

  const camRef = useRef<Camera>({ x: 0, y: 0, s: 1 });
  const camTween = useRef<gsap.core.Tween | null>(null);
  const vpRef = useRef({ w: 1, h: 1 });
  const layoutRef = useRef<Layout | null>(null);
  const nearRef = useRef(false);
  const clickBlock = useRef(false);
  const enteredRef = useRef(false);
  const prevFilterKey = useRef("");

  // The ONLY React state: LOD tier. Pan/zoom never re-renders.
  const [near, setNear] = useState(false);

  const layout = useMemo(() => buildLayout(periods), [periods]);

  /* --------------------------- camera helpers --------------------------- */

  const fitScale = useCallback(
    () => Math.max(0.02, (vpRef.current.w - 160) / WORLD_W),
    []
  );

  const contentCenterY = useCallback(
    () => CHROME_TOP + (vpRef.current.h - CHROME_TOP - CHROME_BOTTOM) / 2,
    []
  );

  const overviewCam = useCallback((): Camera => {
    const { w } = vpRef.current;
    const worldH = layoutRef.current?.worldH ?? 400;
    const s = fitScale();
    return {
      x: (w - WORLD_W * s) / 2,
      y: contentCenterY() - (worldH / 2) * s,
      s,
    };
  }, [fitScale, contentCenterY]);

  const updateAxis = useCallback(() => {
    const lay = layoutRef.current;
    const axis = axisRef.current;
    if (!lay || !axis) return;
    const cam = camRef.current;
    const { w } = vpRef.current;

    const xA = clamp(-cam.x / cam.s, 0, WORLD_W);
    const xB = clamp((w - cam.x) / cam.s, 0, WORLD_W);
    const yA = lay.yearOf(xA);
    const yB = lay.yearOf(xB);
    const span = Math.max(1, yB - yA);

    const maxTicks = Math.max(4, Math.floor(w / 100));
    const steps = [1000, 500, 250, 100, 50, 25, 10, 5, 2, 1];
    let step = steps[0];
    for (const st of steps) {
      if (span / st <= maxTicks) step = st;
      else break;
    }

    const pool = tickPool.current;
    let i = 0;
    for (let yr = Math.ceil(yA / step) * step; yr <= yB + 0.001; yr += step) {
      let el = pool[i];
      if (!el) {
        el = document.createElement("div");
        el.style.cssText =
          "position:absolute;left:0;top:0;height:100%;will-change:transform;";
        const line = document.createElement("span");
        line.style.cssText =
          "position:absolute;left:0;top:0;width:1px;height:10px;transform:translateX(-50%);background:rgba(201,163,92,0.55);display:block;";
        const lab = document.createElement("span");
        lab.style.cssText =
          "position:absolute;left:0;top:14px;transform:translateX(-50%);font-size:10px;letter-spacing:0.14em;color:rgba(244,239,230,0.5);font-variant-numeric:tabular-nums;white-space:nowrap;display:block;";
        el.appendChild(line);
        el.appendChild(lab);
        axis.appendChild(el);
        pool.push(el);
      }
      const sx = lay.xOf(yr) * cam.s + cam.x;
      el.style.display = sx < -40 || sx > w + 40 ? "none" : "block";
      el.style.transform = `translate3d(${sx}px,0,0)`;
      const lab = el.lastChild as HTMLElement;
      lab.textContent = String(Math.round(yr));
      i++;
    }
    for (let j = i; j < pool.length; j++) pool[j].style.display = "none";
  }, []);

  const applyCamera = useCallback(() => {
    const cam = camRef.current;
    const lay = layoutRef.current;
    const world = worldRef.current;
    if (!world || !lay) return;
    const { w, h } = vpRef.current;
    const fit = fitScale();

    cam.s = clamp(cam.s, fit * 0.8, fit * 45);
    const ww = WORLD_W * cam.s;
    const wh = lay.worldH * cam.s;
    cam.x = clamp(cam.x, w * 0.35 - ww, w * 0.65);
    cam.y = clamp(cam.y, h * 0.4 - wh, h * 0.6);

    world.style.transform = `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.s})`;
    world.style.setProperty("--inv", String(1 / cam.s));

    const isNear = cam.s >= fit * LOD_Z;
    if (isNear !== nearRef.current) {
      nearRef.current = isNear;
      setNear(isNear);
    }
    updateAxis();
  }, [fitScale, updateAxis]);

  /* ------------------------ mount / layout / size ----------------------- */

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    layoutRef.current = layout;

    const measure = () => {
      const r = root.getBoundingClientRect();
      vpRef.current = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    };
    measure();

    if (!enteredRef.current) {
      camRef.current = overviewCam();
    }
    applyCamera();

    // Entrance: bands draw in staggered, labels + axis fade after.
    if (!enteredRef.current && layout.bands.length > 0) {
      enteredRef.current = true;
      const bandEls = layout.bands
        .map((b) => bandRefs.current.get(b.period.slug))
        .filter((el): el is HTMLDivElement => Boolean(el));
      gsap.fromTo(
        bandEls,
        { scaleX: 0, opacity: 0 },
        {
          scaleX: 1,
          opacity: 1,
          transformOrigin: "left center",
          duration: 1.2,
          ease: "power3.out",
          stagger: 0.06,
        }
      );
      gsap.fromTo(
        root.querySelectorAll<HTMLElement>(".rt-band-label"),
        { autoAlpha: 0, y: 10 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.9,
          ease: "power2.out",
          delay: 0.55,
          stagger: 0.05,
        }
      );
      const axisWrap = root.querySelector<HTMLElement>(".rt-axis");
      if (axisWrap) {
        gsap.fromTo(
          axisWrap,
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: 1.1, delay: 0.8, ease: "power2.out" }
        );
      }
    }

    const ro = new ResizeObserver(() => {
      measure();
      applyCamera();
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [layout, overviewCam, applyCamera]);

  /* ------------------------- pan / zoom (input) ------------------------- */

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const pts = new Map<number, { x: number; y: number }>();
    let lastC: { x: number; y: number } | null = null;
    let lastD = 0;
    let moved = 0;

    const local = (e: { clientX: number; clientY: number }) => {
      const r = root.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const centroid = () => {
      let x = 0;
      let y = 0;
      pts.forEach((p) => {
        x += p.x;
        y += p.y;
      });
      const n = Math.max(1, pts.size);
      return { x: x / n, y: y / n };
    };
    const distance = () => {
      if (pts.size < 2) return 0;
      const arr = Array.from(pts.values());
      return Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
    };
    const zoomAt = (px: number, py: number, f: number) => {
      const cam = camRef.current;
      const fit = fitScale();
      const ns = clamp(cam.s * f, fit * 0.8, fit * 45);
      const k = ns / cam.s;
      cam.x = px - (px - cam.x) * k;
      cam.y = py - (py - cam.y) * k;
      cam.s = ns;
      applyCamera();
    };
    const panBy = (dx: number, dy: number) => {
      camRef.current.x += dx;
      camRef.current.y += dy;
      applyCamera();
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      camTween.current?.kill();
      root.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, local(e));
      if (pts.size === 1) {
        moved = 0;
        clickBlock.current = false;
      }
      lastC = centroid();
      lastD = distance();
      root.classList.add("cursor-grabbing");
      root.classList.remove("cursor-grab");
    };
    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, local(e));
      const c = centroid();
      if (!lastC) {
        lastC = c;
        return;
      }
      if (pts.size >= 2) {
        const d = distance();
        if (lastD > 0 && d > 0) zoomAt(c.x, c.y, d / lastD);
        lastD = d;
      }
      panBy(c.x - lastC.x, c.y - lastC.y);
      moved += Math.abs(c.x - lastC.x) + Math.abs(c.y - lastC.y);
      if (moved > 6) clickBlock.current = true;
      lastC = c;
    };
    const onUp = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      lastC = pts.size ? centroid() : null;
      lastD = distance();
      if (!pts.size) {
        root.classList.remove("cursor-grabbing");
        root.classList.add("cursor-grab");
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camTween.current?.kill();
      const m = e.deltaMode === 1 ? 16 : 1;
      const dx = e.deltaX * m;
      const dy = e.deltaY * m;
      const p = local(e);
      if (e.ctrlKey || e.metaKey) {
        // trackpad pinch (macOS reports as ctrl+wheel)
        zoomAt(p.x, p.y, Math.exp(-dy * 0.012));
      } else if (e.shiftKey) {
        panBy(-(dx + dy), 0);
      } else if (Math.abs(dx) > Math.abs(dy) * 1.2) {
        // two-finger horizontal scroll → pan along the river
        panBy(-dx, -dy);
      } else {
        zoomAt(p.x, p.y, Math.exp(-dy * 0.0021));
      }
    };

    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onUp);
    root.addEventListener("pointercancel", onUp);
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      root.removeEventListener("wheel", onWheel);
    };
  }, [applyCamera, fitScale]);

  /* ----------------------------- LOD tiers ------------------------------ */

  useEffect(() => {
    const root = rootRef.current;
    const layer = artistLayerRef.current;
    if (!root || !layer) return;
    const inners = root.querySelectorAll<HTMLElement>(".rt-node-inner");
    if (near) {
      layer.style.pointerEvents = "auto";
      gsap.to(layer, { autoAlpha: 1, duration: 0.4, overwrite: "auto" });
      if (inners.length) {
        gsap.fromTo(
          inners,
          { autoAlpha: 0, scale: 0.4 },
          {
            autoAlpha: 1,
            scale: 1,
            duration: 0.55,
            ease: "back.out(1.6)",
            stagger: { each: 0.01, from: "random" },
            overwrite: "auto",
          }
        );
      }
    } else {
      layer.style.pointerEvents = "none";
      gsap.to(layer, { autoAlpha: 0, duration: 0.35, overwrite: "auto" });
    }
  }, [near]);

  /* --------------------------- filter reactions ------------------------- */

  useEffect(() => {
    const lay = layoutRef.current;
    if (!lay) return;
    const key = `${filter.periodSlug ?? ""}|${filter.artistSlug ?? ""}`;
    if (key === prevFilterKey.current) return;
    prevFilterKey.current = key;

    const fit = fitScale();
    const { w } = vpRef.current;
    const cy = contentCenterY();

    let focusPeriod: string | null = filter.periodSlug;
    let target: Camera | null = null;
    let pulseSlug: string | null = null;

    if (filter.artistSlug) {
      const n = lay.nodes.find((nd) => nd.artist.slug === filter.artistSlug);
      if (n) {
        focusPeriod = n.periodSlug;
        const s = clamp(fit * 9, fit * LOD_Z * 1.15, fit * 45);
        target = { s, x: w / 2 - n.cx * s, y: cy - n.y * s };
        pulseSlug = n.artist.slug;
      }
    } else if (filter.periodSlug) {
      const b = lay.bands.find((bb) => bb.period.slug === filter.periodSlug);
      if (b) {
        const bw = Math.max(40, b.x1 - b.x0);
        const s = clamp((w * 0.72) / bw, fit * LOD_Z * 1.03, fit * 20);
        target = { s, x: w / 2 - ((b.x0 + b.x1) / 2) * s, y: cy - b.y * s };
      }
    } else {
      target = overviewCam();
    }

    // Dim non-focused strata to ~15% (restore to 1 when cleared).
    lay.bands.forEach((b) => {
      const el = bandRefs.current.get(b.period.slug);
      if (!el) return;
      const dim = focusPeriod ? (b.period.slug === focusPeriod ? 1 : 0.15) : 1;
      gsap.to(el, {
        opacity: dim,
        duration: 0.8,
        ease: "power2.inOut",
        overwrite: "auto",
      });
    });

    if (target) {
      camTween.current?.kill();
      camTween.current = gsap.to(camRef.current, {
        x: target.x,
        y: target.y,
        s: target.s,
        duration: 1.35,
        ease: "power3.inOut",
        onUpdate: applyCamera,
        onComplete: () => {
          if (!pulseSlug) return;
          const nodeEl = nodeRefs.current.get(pulseSlug);
          const ring = nodeEl?.querySelector<HTMLElement>(".rt-pulse");
          if (ring) {
            gsap.fromTo(
              ring,
              { scale: 1, autoAlpha: 0.9 },
              {
                scale: 2.8,
                autoAlpha: 0,
                duration: 1.1,
                ease: "power2.out",
                repeat: 2,
              }
            );
          }
        },
      });
    }
  }, [
    filter.periodSlug,
    filter.artistSlug,
    layout,
    fitScale,
    contentCenterY,
    overviewCam,
    applyCamera,
  ]);

  /* -------------------------------- render ------------------------------ */

  const handleArtistClick = useCallback(
    (slug: string) => {
      if (!clickBlock.current) onSelectArtist(slug);
    },
    [onSelectArtist]
  );

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 cursor-grab touch-none overflow-hidden bg-[#0b0c10] select-none"
    >
      {/* ------------------------------ world ----------------------------- */}
      <div
        ref={worldRef}
        className="absolute top-0 left-0"
        style={{
          width: WORLD_W,
          height: layout.worldH,
          transformOrigin: "0 0",
          willChange: "transform",
        }}
      >
        {/* period strata */}
        {layout.bands.map((b, i) => (
          <div
            key={b.period.slug}
            ref={(el) => {
              if (el) bandRefs.current.set(b.period.slug, el);
              else bandRefs.current.delete(b.period.slug);
            }}
            className="rt-band absolute"
            style={{
              left: b.x0,
              top: b.y - BAND_H / 2,
              width: Math.max(24, b.x1 - b.x0),
              height: BAND_H,
              borderRadius: RADII[i % RADII.length],
              background: `linear-gradient(90deg, color-mix(in srgb, ${b.period.color} 4%, transparent), color-mix(in srgb, ${b.period.color} 30%, transparent) 12%, color-mix(in srgb, ${b.period.color} 44%, transparent) 50%, color-mix(in srgb, ${b.period.color} 30%, transparent) 88%, color-mix(in srgb, ${b.period.color} 4%, transparent))`,
              border: `1px solid color-mix(in srgb, ${b.period.color} 45%, transparent)`,
              boxShadow: `0 0 60px color-mix(in srgb, ${b.period.color} 16%, transparent), inset 0 1px 0 rgba(255,255,255,0.10)`,
              willChange: "transform, opacity",
            }}
          >
            {/* counter-scaled label (keeps constant screen size) */}
            <div
              className="absolute top-1/2 left-1/2"
              style={{ transform: "translate(-50%,-50%) scale(var(--inv,1))" }}
            >
              <div className="rt-band-label flex flex-col items-center text-center whitespace-nowrap">
                <span
                  className="font-display text-[15px] tracking-[0.22em] text-[#f4efe6] uppercase"
                  style={{ textShadow: "0 2px 12px rgba(0,0,0,0.85)" }}
                >
                  {b.period.name}
                </span>
                <span className="mt-1 text-[10px] tracking-[0.3em] text-[#c9a35c]/90">
                  {b.period.startYear} – {b.period.endYear}
                </span>
              </div>
            </div>
          </div>
        ))}

        {/* artist layer (LOD: hidden until zoomed past threshold) */}
        <div
          ref={artistLayerRef}
          className="absolute inset-0"
          style={{ opacity: 0, visibility: "hidden", pointerEvents: "none" }}
        >
          {layout.nodes.map((n) => (
            <div key={n.artist.slug}>
              {/* lifespan bar: activeStart → activeEnd, thin at any zoom */}
              <div
                className="absolute"
                style={{
                  left: n.x0,
                  width: Math.max(2, n.x1 - n.x0),
                  top: n.y,
                  height: "calc(var(--inv,1) * 2px)",
                  transform: "translateY(-50%)",
                  background: `linear-gradient(90deg, transparent, ${GOLD}80 12%, ${GOLD}cc 50%, ${GOLD}80 88%, transparent)`,
                }}
              />
              {/* counter-scaled node */}
              <div
                ref={(el) => {
                  if (el) nodeRefs.current.set(n.artist.slug, el);
                  else nodeRefs.current.delete(n.artist.slug);
                }}
                className="rt-artist absolute"
                style={{
                  left: n.cx,
                  top: n.y,
                  transform: "translate(-50%,-50%) scale(var(--inv,1))",
                  willChange: "transform",
                }}
              >
                <button
                  type="button"
                  onClick={() => handleArtistClick(n.artist.slug)}
                  className="rt-node-inner group relative flex cursor-pointer flex-col items-center gap-1.5"
                  title={`${n.artist.name} · ${n.artist.activeStart}–${n.artist.activeEnd} · ${n.artist.paintingCount} paintings`}
                >
                  <span className="rt-pulse pointer-events-none absolute top-[22px] left-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#c9a35c] opacity-0" />
                  <span className="relative block h-11 w-11 overflow-hidden rounded-full border-2 border-[#c9a35c] bg-[#14151c] shadow-[0_4px_18px_rgba(0,0,0,0.65)] transition-transform duration-200 group-hover:scale-110">
                    {n.artist.portraitUrl ? (
                      <img
                        src={n.artist.portraitUrl}
                        alt={n.artist.name}
                        loading="lazy"
                        draggable={false}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="font-display flex h-full w-full items-center justify-center text-base text-[#c9a35c]">
                        {n.artist.name.charAt(0)}
                      </span>
                    )}
                  </span>
                  <span
                    className="font-display max-w-[130px] truncate text-[11px] tracking-wide text-[#f4efe6]/90"
                    style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}
                  >
                    {n.artist.name}
                  </span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ----------------------------- date axis --------------------------- */}
      <div
        className="rt-axis pointer-events-none absolute inset-x-0 z-20"
        style={{ bottom: CHROME_BOTTOM, height: 46 }}
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#c9a35c]/35 to-transparent" />
        <div ref={axisRef} className="absolute inset-0 overflow-hidden" />
      </div>

      {/* ------------------------- vignette + grain ------------------------ */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(ellipse 120% 90% at 50% 45%, transparent 52%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 z-10 opacity-[0.05] mix-blend-overlay"
        style={{ backgroundImage: GRAIN, backgroundSize: "160px 160px" }}
      />

      {/* ----------------------------- empty state ------------------------- */}
      {layout.bands.length === 0 && (
        <div className="absolute inset-0 z-30 flex items-center justify-center">
          <p className="font-display text-sm tracking-[0.3em] text-white/40 uppercase">
            The collection is still being ingested…
          </p>
        </div>
      )}
    </div>
  );
}
