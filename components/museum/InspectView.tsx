"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { PaintingData } from "@/lib/types";

export default function InspectView({
  painting,
  onClose,
}: {
  painting: PaintingData;
  onClose: () => void;
}) {
  // Prefer a 1920px Wikimedia render over the raw original (originals can be
  // 50MB+ scans); fall back to the original for non-thumb URLs.
  const [src, setSrc] = useState<string>(() => {
    if (painting.thumbUrl?.includes("/1280px-")) {
      return painting.thumbUrl.replace("/1280px-", "/1920px-");
    }
    return painting.imageUrl || painting.thumbUrl || "";
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const imgWrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const paragraphs = useMemo(
    () =>
      painting.story
        .split(/\n{2,}/)
        .map((s) => s.trim())
        .filter(Boolean),
    [painting.story]
  );

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // GSAP entrance — image scales up from 0.96, panel slides in
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        rootRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.3, ease: "power2.out" }
      );
      gsap.fromTo(
        imgWrapRef.current,
        { opacity: 0, scale: 0.96 },
        { opacity: 1, scale: 1, duration: 0.55, ease: "power3.out", delay: 0.05 }
      );
      gsap.fromTo(
        panelRef.current,
        { opacity: 0, x: 42 },
        { opacity: 1, x: 0, duration: 0.55, ease: "power3.out", delay: 0.12 }
      );
    });
    return () => ctx.revert();
  }, []);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[60] flex bg-black/85 backdrop-blur-md"
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-5 z-10 text-2xl leading-none text-white/55 transition-colors hover:text-white"
      >
        ✕
      </button>

      {/* the painting, large */}
      <div
        ref={imgWrapRef}
        className="flex min-w-0 flex-1 items-center justify-center p-8 md:p-12"
      >
        {src ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={src}
            alt={painting.title}
            draggable={false}
            className="max-h-[75vh] max-w-full rounded-sm object-contain shadow-[0_30px_80px_rgba(0,0,0,0.7)]"
            onError={() => {
              if (painting.thumbUrl && src !== painting.thumbUrl) {
                setSrc(painting.thumbUrl);
              } else {
                setSrc("");
              }
            }}
          />
        ) : (
          <div className="flex h-[50vh] w-full max-w-md items-center justify-center border border-white/10 text-sm tracking-wide text-white/40">
            Image unavailable
          </div>
        )}
      </div>

      {/* info panel */}
      <aside
        ref={panelRef}
        className="w-[420px] max-w-[44vw] shrink-0 overflow-y-auto border-l border-white/10 bg-[#0d0b09]/70 px-9 py-12"
      >
        {painting.yearText && (
          <p className="text-[11px] tracking-[0.35em] text-[var(--gold)] uppercase">
            {painting.yearText}
          </p>
        )}
        <h2 className="font-display mt-2 text-3xl leading-tight text-white">
          {painting.title}
        </h2>

        <div className="mt-6 space-y-4">
          {paragraphs.map((p, i) => (
            <p key={i} className="text-[15px] leading-relaxed text-white/70">
              {p}
            </p>
          ))}
        </div>

        {painting.facts.length > 0 && (
          <div className="mt-9 border-t border-white/10 pt-6">
            <p className="text-[11px] tracking-[0.3em] text-white/45 uppercase">
              From Wikipedia
            </p>
            <ul className="mt-3 space-y-2.5">
              {painting.facts.map((f, i) => (
                <li
                  key={i}
                  className="flex gap-2.5 text-sm leading-relaxed text-white/60"
                >
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--gold)]/70" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <a
          href={painting.wikiUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-9 inline-block text-sm tracking-wide text-[var(--gold)] underline-offset-4 hover:underline"
        >
          Read on Wikipedia →
        </a>

        <p className="mt-8 text-xs text-white/30">
          Esc or ✕ to return to the gallery
        </p>
      </aside>
    </div>
  );
}
