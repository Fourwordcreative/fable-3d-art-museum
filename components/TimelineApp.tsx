"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { TimelineFilter, TimelinePeriod } from "@/lib/types";
import FilterDropdown from "./FilterDropdown";
import ArtistCard from "./ArtistCard";

const variants = {
  constellation: dynamic(() => import("./timeline/ConstellationTimeline"), {
    ssr: false,
  }),
} as const;

type VariantKey = keyof typeof variants;

const VARIANT_META: { key: VariantKey; label: string; title: string }[] = [
  { key: "constellation", label: "B", title: "Constellation" },
];

export default function TimelineApp({ periods }: { periods: TimelinePeriod[] }) {
  const [variant] = useState<VariantKey>("constellation");
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
