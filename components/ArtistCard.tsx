"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import gsap from "gsap";
import type { TimelineArtist, TimelinePeriod } from "@/lib/types";

// Museum-placard artist card: ivory stock, engraved type, gold rule.
export default function ArtistCard({
  artist,
  period,
  onClose,
}: {
  artist: TimelineArtist;
  period: TimelinePeriod | null;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const tl = gsap.timeline();
    tl.fromTo(scrimRef.current, { opacity: 0 }, { opacity: 1, duration: 0.35 })
      .fromTo(
        cardRef.current,
        { y: 46, opacity: 0, rotateX: 8, transformPerspective: 900 },
        { y: 0, opacity: 1, rotateX: 0, duration: 0.55, ease: "power3.out" },
        "-=0.15"
      )
      .fromTo(
        cardRef.current!.querySelectorAll("[data-stagger]"),
        { y: 14, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.4, stagger: 0.06, ease: "power2.out" },
        "-=0.25"
      );
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artist.slug]);

  const close = () => {
    gsap.to(cardRef.current, {
      y: 30,
      opacity: 0,
      duration: 0.25,
      ease: "power2.in",
    });
    gsap.to(scrimRef.current, {
      opacity: 0,
      duration: 0.3,
      onComplete: onClose,
    });
  };

  const enter = () => {
    gsap.to(cardRef.current, { scale: 1.04, opacity: 0, duration: 0.4, ease: "power2.in" });
    gsap.to(scrimRef.current, { opacity: 1, backgroundColor: "#000", duration: 0.5 });
    setTimeout(() => router.push(`/museum/${artist.slug}`), 420);
  };

  const dates = `${artist.birthYear ?? "?"} – ${artist.deathYear ?? "present"}`;
  // Wikipedia descriptors often end with "(1606–1669)" — we already show dates.
  const descriptor = artist.nationality?.replace(/\s*\([^)]*\d{4}[^)]*\)\s*$/, "");
  const bioLines = artist.bio.split(/\n+/).slice(0, 2);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-6">
      <div
        ref={scrimRef}
        onClick={close}
        className="absolute inset-0 bg-black/65 backdrop-blur-[6px]"
      />
      <div
        ref={cardRef}
        className="relative w-full max-w-xl overflow-hidden rounded-sm shadow-[0_40px_120px_rgba(0,0,0,0.7)]"
        style={{ background: "linear-gradient(175deg, #f7f2e7 0%, #efe7d6 100%)" }}
      >
        {/* gold bevel edge */}
        <div className="absolute inset-0 rounded-sm border border-[#c9a35c]/60" />
        <div className="absolute inset-[6px] rounded-[1px] border border-[#c9a35c]/30" />

        <div className="relative flex gap-6 p-8">
          {artist.portraitUrl && (
            <div data-stagger className="shrink-0">
              <div className="h-44 w-32 overflow-hidden border-[3px] border-[#2a241c] shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={artist.portraitUrl}
                  alt={artist.name}
                  className="h-full w-full object-cover"
                  style={{ filter: "sepia(0.18) contrast(1.04)" }}
                />
              </div>
            </div>
          )}

          <div className="min-w-0 text-[#241e16]">
            <p
              data-stagger
              className="text-[10px] font-semibold tracking-[0.34em] uppercase"
              style={{ color: period?.color ?? "#8a6d3b" }}
            >
              {period?.name ?? artist.periodSlug}
            </p>
            <h2
              data-stagger
              className="font-display mt-1 text-[2rem] leading-tight font-semibold tracking-wide"
            >
              {artist.name}
            </h2>
            <p data-stagger className="mt-0.5 text-sm tracking-[0.22em] text-[#6b5d49]">
              {dates}
              {descriptor ? ` · ${descriptor}` : ""}
            </p>
            <div
              data-stagger
              className="my-3 h-px w-24"
              style={{ background: "linear-gradient(90deg,#c9a35c,transparent)" }}
            />
            <p data-stagger className="line-clamp-6 text-[15px] leading-relaxed text-[#3a3228]">
              {bioLines.join(" ")}
            </p>
          </div>
        </div>

        <div className="relative flex items-center justify-between border-t border-[#c9a35c]/35 bg-[#241e16] px-8 py-4">
          <span className="text-[11px] tracking-[0.28em] text-[#c9a35c]/80 uppercase">
            {artist.paintingCount} works on view
          </span>
          <button
            onClick={enter}
            className="group flex items-center gap-2 rounded-sm border border-[#c9a35c] px-5 py-2 text-sm font-semibold tracking-[0.2em] text-[#f0e6cf] uppercase transition-all hover:bg-[#c9a35c] hover:text-[#1a1410]"
          >
            Enter the Gallery
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}
