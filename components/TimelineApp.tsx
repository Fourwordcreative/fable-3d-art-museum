"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { TimelineFilter, TimelinePeriod } from "@/lib/types";
import FilterDropdown from "./FilterDropdown";
import ArtistCard from "./ArtistCard";

const variants = {
  river: dynamic(() => import("./timeline/RiverTimeline"), { ssr: false }),
  constellation: dynamic(() => import("./timeline/ConstellationTimeline"), {
    ssr: false,
  }),
  strip: dynamic(() => import("./timeline/GalleryStripTimeline"), {
    ssr: false,
  }),
} as const;

type VariantKey = keyof typeof variants;

const VARIANT_META: { key: VariantKey; label: string; title: string }[] = [
  { key: "river", label: "A", title: "River of Time" },
  { key: "constellation", label: "B", title: "Constellation" },
  { key: "strip", label: "C", title: "Gallery Strip" },
];

export default function TimelineApp({ periods }: { periods: TimelinePeriod[] }) {
  const [variant, setVariant] = useState<VariantKey>("river");
  const [filter, setFilter] = useState<TimelineFilter>({
    periodSlug: null,
    artistSlug: null,
  });
  const [cardArtist, setCardArtist] = useState<string | null>(null);

  const Variant = variants[variant];
  const allArtists = useMemo(
    () => periods.flatMap((p) => p.artists),
    [periods]
  );
  const selected = useMemo(
    () => allArtists.find((a) => a.slug === cardArtist) ?? null,
    [allArtists, cardArtist]
  );
  const selectedPeriod = useMemo(
    () => periods.find((p) => p.slug === selected?.periodSlug) ?? null,
    [periods, selected]
  );

  const onSelectArtist = useCallback((slug: string) => setCardArtist(slug), []);

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <Variant periods={periods} filter={filter} onSelectArtist={onSelectArtist} />

      {/* Header chrome */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between p-5">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-[0.18em] text-[var(--parchment)] uppercase">
            The Timeline Museum
          </h1>
          <p className="mt-0.5 text-xs tracking-[0.3em] text-[var(--gold)] uppercase">
            A walkable history of art · built from Wikipedia
          </p>
        </div>

        <div className="pointer-events-auto flex items-center gap-3">
          <FilterDropdown
            periods={periods}
            filter={filter}
            onChange={setFilter}
          />
          <div className="flex overflow-hidden rounded-full border border-white/15 bg-black/40 backdrop-blur-md">
            {VARIANT_META.map((v) => (
              <button
                key={v.key}
                onClick={() => setVariant(v.key)}
                title={v.title}
                className={`px-4 py-2 text-sm tracking-widest transition-colors ${
                  variant === v.key
                    ? "bg-[var(--gold)] font-semibold text-black"
                    : "text-white/70 hover:text-white"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-between p-4 text-[11px] tracking-[0.2em] text-white/35 uppercase">
        <span>
          {VARIANT_META.find((v) => v.key === variant)?.title} — scroll to zoom ·
          drag to pan · click an artist
        </span>
        <span>All text & images from Wikipedia / Wikimedia Commons</span>
      </footer>

      {selected && (
        <ArtistCard
          artist={selected}
          period={selectedPeriod}
          onClose={() => setCardArtist(null)}
        />
      )}
    </main>
  );
}
