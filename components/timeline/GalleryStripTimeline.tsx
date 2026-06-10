"use client";

/**
 * Variant C — "Gallery Wall Strip"
 *
 * A horizontal museum corridor: one long, softly lit plaster wall divided into
 * period sections by thin gold partitions. Zoomed out you read the wall like a
 * floor plan; zoom in and each section reveals its artists as framed portrait
 * placards hung salon-style, each with a brass nameplate and its own picture
 * light. Semantic zoom: a single translated world layer, children re-positioned
 * imperatively (translate-only, never scaled) so text and frames stay crisp and
 * roughly constant screen size.
 */

import { useEffect, useMemo, useRef } from "react";
import { gsap } from "gsap";
import type {
  TimelineArtist,
  TimelinePeriod,
  TimelineVariantProps,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOLD = "#c9a35c";
const WORLD_W = 2600; // world units (px at z = 1)
const GAMMA = 2.2; // date-scale compression: recent eras get more room
const Z_REVEAL = 2.4; // placards appear past this zoom
const Z_TICK_50 = 2.1; // half-century ticks
const Z_TICK_10 = 5; // decade ticks (lines)
const Z_TICK_10_LABEL = 8; // decade tick labels
const MAX_Z = 14;
const PLACARD_W = 116;
const BAND_TOP = "20%"; // wall band occupies 20% → 80% of viewport height
const BAND_H = "60%";

// ---------------------------------------------------------------------------
// Layout types
// ---------------------------------------------------------------------------

type PlacardL = { a: TimelineArtist; x: number; row: number; fi: number };
type SectionL = {
  p: TimelinePeriod;
  x0: number;
  x1: number;
  w: number;
  placards: PlacardL[];
};
type Tick = { year: number; kind: "c" | "f" | "d"; x: number };
type Layout = { sections: SectionL[]; flat: PlacardL[]; ticks: Tick[] };

type Api = {
  frameSection: (i: number) => void;
  focusPeriod: (slug: string) => void;
  focusArtist: (slug: string) => void;
  overview: () => void;
};

// ---------------------------------------------------------------------------
// Visual helpers (pure CSS strings)
// ---------------------------------------------------------------------------

const plasterBg = (color: string): string =>
  [
    // top-down picture-light wash
    "radial-gradient(130% 85% at 50% -15%, rgba(255,233,195,0.16), rgba(255,233,195,0.03) 50%, transparent 72%)",
    // period tint washing down from the swatch — makes each bay read in color
    `linear-gradient(180deg, color-mix(in srgb, ${color} 36%, transparent) 0%, color-mix(in srgb, ${color} 17%, transparent) 24%, color-mix(in srgb, ${color} 7%, transparent) 52%, transparent 78%)`,
    // shaded panel edges so adjacent sections separate even when unzoomed
    "linear-gradient(90deg, rgba(0,0,0,0.55), transparent 5%, transparent 95%, rgba(0,0,0,0.55))",
    // floor shadow pooling at the bottom of the wall
    "radial-gradient(120% 90% at 50% 115%, rgba(0,0,0,0.55), transparent 58%)",
    // subtle vertical grain
    "repeating-linear-gradient(90deg, rgba(255,255,255,0.012) 0px, rgba(255,255,255,0.012) 2px, transparent 2px, transparent 6px)",
    // warm dark plaster
    "linear-gradient(180deg, #28211a 0%, #2d251c 32%, #271f16 68%, #1a140d 100%)",
  ].join(",");

const FRAME_BG =
  "linear-gradient(155deg, #6f552e 0%, #3a2d18 38%, #5a4521 62%, #2c2110 100%)";
const FRAME_SHADOW =
  "0 12px 22px rgba(0,0,0,0.55), 0 3px 6px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(0,0,0,0.65), inset 0 0 0 3px rgba(201,163,92,0.22)";
const PLATE_BG = "linear-gradient(180deg, #d4b35e 0%, #a98736 55%, #8a6b2a 100%)";

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GalleryStripTimeline({
  periods,
  filter,
  onSelectArtist,
}: TimelineVariantProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);

  // index-aligned element stores (filled by callback refs each render)
  const groupEls = useRef<(HTMLDivElement | null)[]>([]);
  const bgEls = useRef<(HTMLDivElement | null)[]>([]);
  const partEls = useRef<(HTMLDivElement | null)[]>([]);
  const headerEls = useRef<(HTMLButtonElement | null)[]>([]);
  const layerEls = useRef<(HTMLDivElement | null)[]>([]);
  const placardPosEls = useRef<(HTMLDivElement | null)[]>([]);
  const placardInnerEls = useRef<(HTMLDivElement | null)[]>([]);
  const glowEls = useRef<(HTMLDivElement | null)[]>([]);
  const tickEls = useRef<(HTMLDivElement | null)[]>([]);

  const apiRef = useRef<Api | null>(null);
  const draggedRef = useRef(false);
  const firstFilterRef = useRef(true);

  // -------------------------------------------------------------------------
  // Layout: compressed date scale + salon-wall placard placement
  // -------------------------------------------------------------------------
  const data = useMemo<Layout | null>(() => {
    const ps = [...periods]
      .filter((p) => p.endYear > p.startYear)
      .sort((a, b) => a.sort - b.sort);
    if (ps.length === 0) return null;

    const minY = Math.min(...ps.map((p) => p.startYear));
    const maxY = Math.max(...ps.map((p) => p.endYear));
    const span = Math.max(1, maxY - minY);
    const yearToX = (y: number): number =>
      Math.pow(Math.min(1, Math.max(0, (y - minY) / span)), GAMMA) * WORLD_W;

    let fi = 0;
    const flat: PlacardL[] = [];
    const sections: SectionL[] = ps.map((p) => {
      const x0 = yearToX(p.startYear);
      const x1 = yearToX(p.endYear);
      const w = x1 - x0;
      const pad = Math.min(20, w * 0.12);
      const artists = [...p.artists].sort((a, b) => a.activeStart - b.activeStart);
      const perRow = Math.max(1, Math.ceil(artists.length / 2));
      const gap = Math.min(
        44,
        Math.max(20, (w - pad * 2) / Math.max(1, perRow - 1))
      );
      const lastX: [number, number] = [-Infinity, -Infinity];
      const placards: PlacardL[] = artists.map((a, ai) => {
        const row = ai % 2;
        let x = Math.min(x1 - pad, Math.max(x0 + pad, yearToX(a.activeStart)));
        if (x < lastX[row] + gap) x = lastX[row] + gap;
        lastX[row] = x;
        const pl: PlacardL = { a, x, row, fi: fi++ };
        flat.push(pl);
        return pl;
      });
      return { p, x0, x1, w, placards };
    });

    const ticks: Tick[] = [];
    for (let y = Math.ceil(minY / 10) * 10; y <= maxY; y += 10) {
      ticks.push({
        year: y,
        kind: y % 100 === 0 ? "c" : y % 50 === 0 ? "f" : "d",
        x: yearToX(y),
      });
    }

    return { sections, flat, ticks };
  }, [periods]);

  // -------------------------------------------------------------------------
  // Imperative pan / zoom engine
  // -------------------------------------------------------------------------
  useEffect(() => {
    const root = rootRef.current;
    const world = worldRef.current;
    if (!root || !world || !data) return;

    const view = { x: 0, z: 1 }; // screenX = worldX * z - view.x
    let lastZ = -1;
    let revealed = false;
    let everRevealed = false;
    let tickLOD = -1;
    let viewTween: gsap.core.Tween | null = null;

    const vw = () => root.clientWidth || 1;
    const fitZ = () => (vw() * 0.94) / WORLD_W;
    const minZ = () => fitZ() * 0.95;
    // home view slightly over-fills the viewport so there is corridor to walk
    const homeZ = () => fitZ() * 1.18;
    const clampZ = (z: number) => Math.min(MAX_Z, Math.max(minZ(), z));

    // Unified clamp with slack on both ends. NOTE: never hard-recenter when the
    // world fits the viewport — that made every pan attempt a silent no-op.
    const clampX = () => {
      const over = WORLD_W * view.z - vw();
      const lo = Math.min(0, over) - 90;
      const hi = Math.max(0, over) + 90;
      view.x = Math.max(lo, Math.min(hi, view.x));
    };

    const applyChildren = () => {
      const z = view.z;
      data.sections.forEach((s, i) => {
        const bg = bgEls.current[i];
        if (bg) bg.style.transform = `translate3d(${s.x0 * z}px,0,0) scaleX(${z})`;
        const pt = partEls.current[i];
        if (pt) pt.style.transform = `translate3d(${s.x1 * z}px,0,0)`;
        const hd = headerEls.current[i];
        if (hd) {
          hd.style.transform = `translate3d(${s.x0 * z + 14}px,0,0)`;
          hd.style.maxWidth = `${Math.max(44, s.w * z - 22)}px`;
        }
      });
      data.flat.forEach((pl, i) => {
        const el = placardPosEls.current[i];
        if (el)
          el.style.transform = `translate3d(${pl.x * z - PLACARD_W / 2}px,0,0)`;
      });
      data.ticks.forEach((t, i) => {
        const el = tickEls.current[i];
        if (el) el.style.transform = `translate3d(${t.x * z}px,0,0)`;
      });
    };

    const applyLOD = () => {
      const z = view.z;

      // placard reveal — walking up to the wall
      const rev = z >= Z_REVEAL;
      if (rev !== revealed) {
        revealed = rev;
        layerEls.current.forEach((el) => {
          if (el)
            gsap.to(el, { autoAlpha: rev ? 1 : 0, duration: 0.45, overwrite: true });
        });
        if (rev && !everRevealed) {
          everRevealed = true;
          const inners = placardInnerEls.current.filter(
            (el): el is HTMLDivElement => el !== null
          );
          // drop-hang with a slight swing, like placards being hung
          gsap.fromTo(
            inners,
            { y: -34, rotation: (i: number) => (i % 2 ? 3 : -3), opacity: 0 },
            {
              y: 0,
              rotation: 0,
              opacity: 1,
              duration: 1.1,
              ease: "elastic.out(1, 0.45)",
              stagger: { each: 0.02, from: "random" },
            }
          );
        }
      }

      // date axis density
      const tl =
        z >= Z_TICK_10_LABEL ? 3 : z >= Z_TICK_10 ? 2 : z >= Z_TICK_50 ? 1 : 0;
      if (tl !== tickLOD) {
        tickLOD = tl;
        data.ticks.forEach((t, i) => {
          const el = tickEls.current[i];
          if (!el) return;
          const vis =
            t.kind === "c" ||
            (t.kind === "f" && tl >= 1) ||
            (t.kind === "d" && tl >= 2);
          gsap.to(el, { autoAlpha: vis ? 1 : 0, duration: 0.25, overwrite: true });
          if (t.kind === "d") {
            const lab = el.querySelector<HTMLElement>(".tick-label");
            if (lab) lab.style.opacity = tl >= 3 ? "1" : "0";
          }
        });
      }
    };

    const apply = () => {
      view.z = clampZ(view.z);
      clampX();
      world.style.transform = `translate3d(${-view.x}px,0,0)`;
      if (view.z !== lastZ) {
        lastZ = view.z;
        applyChildren();
        applyLOD();
      }
    };

    const goTo = (x: number, z: number, dur = 1.15) => {
      viewTween?.kill();
      viewTween = gsap.to(view, {
        x,
        z: clampZ(z),
        duration: dur,
        ease: "power3.inOut",
        onUpdate: apply,
      });
    };

    const frameSection = (i: number) => {
      const s = data.sections[i];
      if (!s) return;
      const z = Math.min(
        8,
        Math.max(Z_REVEAL + 0.3, (vw() * 0.84) / Math.max(1, s.w))
      );
      goTo((s.x0 + s.w / 2) * z - vw() / 2, z, 1.2);
    };

    // museum-wing dimming: unlit sections fall back into darkness
    const setDim = (lit: ((i: number) => boolean) | null) => {
      data.sections.forEach((_, i) => {
        const g = groupEls.current[i];
        if (g)
          gsap.to(g, {
            opacity: lit && !lit(i) ? 0.16 : 1,
            duration: 0.8,
            ease: "power2.out",
            overwrite: true,
          });
      });
    };

    const focusPeriod = (slug: string) => {
      const i = data.sections.findIndex((s) => s.p.slug === slug);
      if (i < 0) return;
      frameSection(i);
      setDim((j) => j === i);
    };

    const focusArtist = (slug: string) => {
      const fIdx = data.flat.findIndex((f) => f.a.slug === slug);
      if (fIdx < 0) return;
      const f = data.flat[fIdx];
      if (!f) return;
      const si = data.sections.findIndex((s) =>
        s.placards.some((pl) => pl.fi === f.fi)
      );
      const z = Math.max(4.2, Z_REVEAL + 0.6);
      goTo(f.x * z - vw() / 2, z, 1.3);
      setDim((j) => j === si);
      const glow = glowEls.current[fIdx];
      if (glow)
        gsap.fromTo(
          glow,
          { opacity: 0 },
          {
            opacity: 0.95,
            duration: 0.55,
            repeat: 5,
            yoyo: true,
            ease: "sine.inOut",
            delay: 0.9,
            overwrite: true,
          }
        );
    };

    const overview = () => {
      setDim(null);
      const z = homeZ();
      goTo((WORLD_W * z - vw()) / 2, z, 1.2);
    };

    apiRef.current = { frameSection, focusPeriod, focusArtist, overview };

    // ---- input handling -----------------------------------------------------
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      viewTween?.kill();
      // normalize line/page delta modes (Firefox) to pixels
      const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? vw() : 1;
      if (e.ctrlKey || e.metaKey) {
        // pinch / precision zoom toward cursor
        const rect = root.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const wx = (view.x + cx) / view.z;
        const nz = clampZ(view.z * Math.exp(-e.deltaY * k * 0.0028));
        view.z = nz;
        view.x = wx * nz - cx;
      } else {
        // corridor feel: vertical wheel also walks you down the hall
        view.x += (e.deltaX + e.deltaY) * k;
      }
      apply();
    };

    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    let lastPX = 0;
    let moved = 0;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // NOTE: do NOT setPointerCapture here — capturing on pointerdown
      // retargets the subsequent click to the root, which silently killed
      // every header/placard click. Capture is deferred until a real drag.
      viewTween?.kill();
      draggedRef.current = false;
      moved = 0;
      lastPX = e.clientX;
      if (pointers.size === 2) {
        // pinch never produces a click — safe to capture both pointers now
        for (const id of pointers.keys()) {
          try {
            root.setPointerCapture(id);
          } catch {
            /* pointer may already be gone */
          }
        }
        const [a, b] = [...pointers.values()];
        if (a && b) pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
      root.style.cursor = "grabbing";
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        if (!a || !b) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0 && d > 0) {
          const rect = root.getBoundingClientRect();
          const cx = (a.x + b.x) / 2 - rect.left;
          const wx = (view.x + cx) / view.z;
          const nz = clampZ(view.z * (d / pinchDist));
          view.z = nz;
          view.x = wx * nz - cx;
          apply();
        }
        pinchDist = d;
        draggedRef.current = true;
        return;
      }
      const dx = e.clientX - lastPX;
      lastPX = e.clientX;
      moved += Math.abs(dx);
      if (moved > 5 && !draggedRef.current) {
        draggedRef.current = true;
        try {
          root.setPointerCapture(e.pointerId); // safe now: click is suppressed anyway
        } catch {
          /* ignore */
        }
      }
      view.x -= dx;
      apply();
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinchDist = 0;
      if (pointers.size === 0) root.style.cursor = "grab";
    };

    const onResize = () => {
      lastZ = -1; // force child re-layout
      apply();
    };

    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onUp);
    root.addEventListener("pointercancel", onUp);
    window.addEventListener("resize", onResize);

    // ---- initial view + entrance --------------------------------------------
    view.z = homeZ();
    view.x = (WORLD_W * view.z - vw()) / 2;
    apply();

    const ctx = gsap.context(() => {
      const groups = groupEls.current.filter(
        (el): el is HTMLDivElement => el !== null
      );
      gsap.from(groups, {
        opacity: 0,
        y: 26,
        duration: 0.9,
        ease: "power3.out",
        stagger: 0.055,
        clearProps: "transform",
      });
    }, root);

    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      window.removeEventListener("resize", onResize);
      viewTween?.kill();
      ctx.revert();
      apiRef.current = null;
    };
  }, [data]);

  // -------------------------------------------------------------------------
  // Filter → camera focus
  // -------------------------------------------------------------------------
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    if (
      firstFilterRef.current &&
      filter.periodSlug === null &&
      filter.artistSlug === null
    ) {
      firstFilterRef.current = false;
      return; // don't fight the entrance animation
    }
    firstFilterRef.current = false;
    if (filter.artistSlug) api.focusArtist(filter.artistSlug);
    else if (filter.periodSlug) api.focusPeriod(filter.periodSlug);
    else api.overview();
  }, [filter, data]);

  // -------------------------------------------------------------------------
  // Hover micro-interaction (GSAP, transform/filter only)
  // -------------------------------------------------------------------------
  const hover = (el: HTMLDivElement, on: boolean, tilt: number) => {
    gsap.to(el, {
      rotation: on ? tilt : 0,
      y: on ? -3 : 0,
      filter: on ? "brightness(1.18)" : "brightness(1)",
      duration: 0.35,
      ease: "power2.out",
      overwrite: "auto",
    });
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (!data) {
    return (
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[#0b0c10]">
        <div className="text-center">
          <div
            className="font-display text-xl tracking-[0.25em] text-[#c9a35c]/80 uppercase"
            style={{ fontVariant: "small-caps" }}
          >
            The corridor is being hung
          </div>
          <div className="mt-2 text-xs tracking-[0.2em] text-white/35 uppercase">
            collection data is still arriving — check back in a moment
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 touch-none overflow-hidden select-none"
      style={{ background: "#0b0c10", cursor: "grab" }}
    >
      {/* static ceiling darkness above the wall band */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10"
        style={{
          height: BAND_TOP,
          background:
            "linear-gradient(180deg, #0b0c10 55%, rgba(11,12,16,0.6) 85%, transparent 100%)",
        }}
      />
      {/* static floor glow / reflection below the band */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
        style={{
          top: "80%",
          background:
            "linear-gradient(180deg, rgba(201,163,92,0.10), rgba(201,163,92,0.02) 32%, transparent 70%)",
        }}
      />
      {/* axis baseline (screen-fixed hairline; ticks pan with the world) */}
      <div
        className="pointer-events-none absolute inset-x-0 z-10 h-px"
        style={{ top: "calc(80% + 4px)", background: "rgba(255,255,255,0.14)" }}
      />

      {/* ---- the world: one translated layer ---- */}
      <div ref={worldRef} className="absolute inset-0 will-change-transform">
        {data.sections.map((s, i) => (
          <div
            key={s.p.slug}
            ref={(el) => {
              groupEls.current[i] = el;
            }}
            // pointer-events-none is critical: these stacked transparent
            // inset-0 boxes would otherwise swallow every click aimed at
            // headers/placards of earlier sections. Interactive children
            // re-enable pointer events explicitly.
            className="pointer-events-none absolute inset-0"
          >
            {/* wall section (the ONLY x-scaled element; gradients stretch fine) */}
            <div
              ref={(el) => {
                bgEls.current[i] = el;
              }}
              className="absolute left-0"
              style={{
                top: BAND_TOP,
                height: BAND_H,
                width: s.w,
                transformOrigin: "0 0",
                background: plasterBg(s.p.color),
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
            >
              {/* period color swatch along the top edge */}
              <div
                className="absolute inset-x-0 top-0 h-[8px]"
                style={{ background: s.p.color, opacity: 0.9 }}
              />
              {/* wainscot hairline */}
              <div
                className="absolute inset-x-0 bottom-[14%] h-px"
                style={{ background: "rgba(255,255,255,0.05)" }}
              />
              {/* baseboard */}
              <div
                className="absolute inset-x-0 bottom-0 h-[12px]"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(201,163,92,0.22), rgba(20,15,8,0.9) 35%, #060504)",
                  borderTop: "1px solid rgba(201,163,92,0.35)",
                }}
              />
            </div>

            {/* gold partition line at the section's end (never scaled) */}
            <div
              ref={(el) => {
                partEls.current[i] = el;
              }}
              className="absolute left-0 w-[3px] -ml-[1.5px]"
              style={{
                top: BAND_TOP,
                height: BAND_H,
                background: `linear-gradient(180deg, transparent, ${GOLD}ee 10%, #f0d9a6 50%, ${GOLD}ee 90%, transparent)`,
                boxShadow: `0 0 12px ${GOLD}66, 0 0 3px ${GOLD}`,
              }}
            />

            {/* section header — click to frame this wing */}
            <button
              ref={(el) => {
                headerEls.current[i] = el;
              }}
              type="button"
              onClick={() => {
                if (!draggedRef.current) apiRef.current?.frameSection(i);
              }}
              className="pointer-events-auto absolute left-0 cursor-pointer overflow-hidden text-left"
              style={{ top: "calc(20% + 16px)" }}
            >
              <div
                className="font-display overflow-hidden text-[21px] leading-none font-semibold tracking-[0.13em] text-ellipsis whitespace-nowrap text-[#f4efe6]"
                style={{
                  fontVariant: "small-caps",
                  textShadow: "0 1px 3px rgba(0,0,0,0.8)",
                }}
              >
                {s.p.name}
              </div>
              <div
                className="mt-1.5 h-[2px] w-12"
                style={{
                  background: `linear-gradient(90deg, ${s.p.color}, transparent)`,
                }}
              />
              <div className="mt-1.5 overflow-hidden text-[10px] tracking-[0.28em] whitespace-nowrap text-[#c9a35c]">
                {s.p.startYear} — {s.p.endYear}
                {s.placards.length > 0 && (
                  <span className="text-white/40">
                    {"  ·  "}
                    {s.placards.length} artists
                  </span>
                )}
              </div>
            </button>

            {/* placard layer (LOD: hidden until you walk up to the wall) */}
            <div
              ref={(el) => {
                layerEls.current[i] = el;
              }}
              className="absolute inset-0"
              style={{ opacity: 0, visibility: "hidden" }}
            >
              {s.placards.map((pl) => (
                <div
                  key={pl.a.slug}
                  ref={(el) => {
                    placardPosEls.current[pl.fi] = el;
                  }}
                  className="absolute left-0"
                  style={{
                    top: pl.row === 0 ? "30%" : "53%",
                    width: PLACARD_W,
                  }}
                >
                  <div
                    ref={(el) => {
                      placardInnerEls.current[pl.fi] = el;
                    }}
                    className="pointer-events-auto relative cursor-pointer will-change-transform"
                    style={{ transformOrigin: "50% -14px" }}
                    title={pl.a.nationality ?? pl.a.name}
                    onPointerEnter={(e) =>
                      hover(e.currentTarget, true, pl.fi % 2 ? 1.6 : -1.6)
                    }
                    onPointerLeave={(e) => hover(e.currentTarget, false, 0)}
                    onClick={() => {
                      if (!draggedRef.current) onSelectArtist(pl.a.slug);
                    }}
                  >
                    {/* gold spotlight pulse target (filter focus) */}
                    <div
                      ref={(el) => {
                        glowEls.current[pl.fi] = el;
                      }}
                      className="pointer-events-none absolute -inset-4 rounded-full"
                      style={{
                        background: `radial-gradient(50% 50% at 50% 42%, ${GOLD}8c, transparent 70%)`,
                        opacity: 0,
                      }}
                    />
                    {/* individual picture light from above */}
                    <div
                      className="pointer-events-none absolute -top-5 left-[12%] right-[12%] h-10"
                      style={{
                        background:
                          "radial-gradient(60% 90% at 50% 0%, rgba(255,222,150,0.32), transparent 72%)",
                      }}
                    />
                    {/* ornate frame */}
                    <div
                      className="relative rounded-[3px] p-[5px]"
                      style={{
                        background: FRAME_BG,
                        border: `1px solid ${GOLD}80`,
                        boxShadow: FRAME_SHADOW,
                      }}
                    >
                      <div
                        className="relative h-[104px] overflow-hidden"
                        style={{
                          border: "1px solid rgba(0,0,0,0.75)",
                          background: "#0e0c09",
                        }}
                      >
                        {/* monogram always underneath — shows when the
                            portrait is missing OR fails to load */}
                        <div
                          className="font-display absolute inset-0 flex items-center justify-center text-2xl tracking-widest"
                          style={{
                            color: `${GOLD}99`,
                            background:
                              "radial-gradient(80% 80% at 50% 30%, #221c14, #14100a)",
                          }}
                        >
                          {initials(pl.a.name)}
                        </div>
                        {pl.a.portraitUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={pl.a.portraitUrl}
                            alt=""
                            width={PLACARD_W - 12}
                            height={104}
                            loading="lazy"
                            draggable={false}
                            className="absolute inset-0 h-full w-full object-cover"
                            style={{ filter: "saturate(0.92) contrast(1.02)" }}
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        )}
                      </div>
                    </div>
                    {/* engraved brass nameplate */}
                    <div
                      className="mx-auto mt-1.5 w-fit max-w-full rounded-[2px] px-2 py-[3px] text-center"
                      style={{
                        background: PLATE_BG,
                        boxShadow:
                          "inset 0 1px 0 rgba(255,245,210,0.55), inset 0 -1px 0 rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.5)",
                      }}
                    >
                      <div
                        className="font-display overflow-hidden text-[10px] leading-tight font-semibold text-ellipsis whitespace-nowrap"
                        style={{
                          color: "#2b2008",
                          textShadow: "0 1px 0 rgba(255,255,255,0.3)",
                        }}
                      >
                        {pl.a.name}
                      </div>
                      <div
                        className="text-[8.5px] leading-tight tracking-wider tabular-nums"
                        style={{ color: "#41320f" }}
                      >
                        {pl.a.activeStart}–{pl.a.activeEnd}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* ---- date axis ticks (pan with the world, constant screen size) ---- */}
        {data.ticks.map((t, i) => (
          <div
            key={t.year}
            ref={(el) => {
              tickEls.current[i] = el;
            }}
            className="pointer-events-none absolute left-0"
            style={{
              top: "calc(80% + 5px)",
              opacity: t.kind === "c" ? 1 : 0,
              visibility: t.kind === "c" ? "visible" : "hidden",
            }}
          >
            <div
              className="flex flex-col items-center"
              style={{ transform: "translateX(-50%)" }}
            >
              <div
                style={{
                  width: 1,
                  height: t.kind === "c" ? 14 : t.kind === "f" ? 10 : 7,
                  background:
                    t.kind === "c" ? `${GOLD}b3` : "rgba(255,255,255,0.3)",
                }}
              />
              <div
                className="tick-label mt-1 text-[9px] tracking-wider whitespace-nowrap tabular-nums"
                style={{
                  color:
                    t.kind === "c" ? `${GOLD}cc` : "rgba(255,255,255,0.45)",
                  opacity: t.kind === "d" ? 0 : 1,
                }}
              >
                {t.year}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* corridor vignette on top of everything */}
      <div
        className="pointer-events-none absolute inset-0 z-20"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 50%, transparent 60%, rgba(0,0,0,0.45) 100%)",
        }}
      />
    </div>
  );
}
