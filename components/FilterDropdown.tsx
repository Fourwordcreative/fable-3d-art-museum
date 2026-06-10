"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import type { TimelineFilter, TimelinePeriod } from "@/lib/types";

// The filter is meant to be a small theatrical moment: the trigger blooms into a
// panel, and switching Periods ↔ Artists swaps content with a staggered cascade.
export default function FilterDropdown({
  periods,
  filter,
  onChange,
}: {
  periods: TimelinePeriod[];
  filter: TimelineFilter;
  onChange: (f: TimelineFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"periods" | "artists">("periods");
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    gsap.fromTo(
      panelRef.current,
      { opacity: 0, y: -14, scaleY: 0.85, transformOrigin: "top right" },
      { opacity: 1, y: 0, scaleY: 1, duration: 0.4, ease: "power3.out" }
    );
    animateItems();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const animateItems = () => {
    if (!listRef.current) return;
    gsap.fromTo(
      listRef.current.children,
      { opacity: 0, x: 18 },
      { opacity: 1, x: 0, duration: 0.32, stagger: 0.025, ease: "power2.out" }
    );
  };

  const swapTab = (next: "periods" | "artists") => {
    if (next === tab || !listRef.current) return;
    gsap.to(listRef.current.children, {
      opacity: 0,
      x: -14,
      duration: 0.18,
      stagger: 0.012,
      ease: "power1.in",
      onComplete: () => {
        setTab(next);
        requestAnimationFrame(animateItems);
      },
    });
  };

  const active =
    filter.artistSlug
      ? periods.flatMap((p) => p.artists).find((a) => a.slug === filter.artistSlug)?.name
      : filter.periodSlug
        ? periods.find((p) => p.slug === filter.periodSlug)?.name
        : null;

  const pick = (f: TimelineFilter) => {
    onChange(f);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm tracking-wider backdrop-blur-md transition-colors ${
          active
            ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold)]"
            : "border-white/15 bg-black/40 text-white/80 hover:text-white"
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
        </svg>
        {active ?? "Filter"}
        {active && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              pick({ periodSlug: null, artistSlug: null });
            }}
            className="ml-1 rounded-full px-1 text-white/50 hover:text-white"
          >
            ✕
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute top-12 right-0 z-50 w-72 overflow-hidden rounded-lg border border-white/12 bg-[#11120f]/95 shadow-[0_30px_80px_rgba(0,0,0,0.6)] backdrop-blur-xl"
        >
          <div className="flex border-b border-white/10">
            {(["periods", "artists"] as const).map((t) => (
              <button
                key={t}
                onClick={() => swapTab(t)}
                className={`relative flex-1 py-3 text-xs font-semibold tracking-[0.25em] uppercase transition-colors ${
                  tab === t ? "text-[var(--gold)]" : "text-white/45 hover:text-white/75"
                }`}
              >
                {t}
                {tab === t && (
                  <span className="absolute inset-x-8 bottom-0 h-px bg-[var(--gold)]" />
                )}
              </button>
            ))}
          </div>

          <div ref={listRef} className="max-h-[55vh] overflow-y-auto p-2">
            {tab === "periods"
              ? periods.map((p) => (
                  <button
                    key={p.slug}
                    onClick={() => pick({ periodSlug: p.slug, artistSlug: null })}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/8 ${
                      filter.periodSlug === p.slug ? "bg-white/10" : ""
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: p.color }}
                      />
                      {p.name}
                    </span>
                    <span className="text-xs text-white/35">
                      {p.startYear}–{p.endYear}
                    </span>
                  </button>
                ))
              : periods.flatMap((p) =>
                  p.artists.map((a) => (
                    <button
                      key={a.slug}
                      onClick={() => pick({ periodSlug: null, artistSlug: a.slug })}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-white/8 ${
                        filter.artistSlug === a.slug ? "bg-white/10" : ""
                      }`}
                    >
                      <span>{a.name}</span>
                      <span
                        className="text-[10px] tracking-wider uppercase"
                        style={{ color: p.color }}
                      >
                        {p.name.split(" ")[0]}
                      </span>
                    </button>
                  ))
                )}
          </div>
        </div>
      )}
    </div>
  );
}
