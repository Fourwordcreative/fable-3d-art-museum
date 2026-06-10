"use client";

import dynamic from "next/dynamic";
import type { MuseumData } from "@/lib/types";

const GalleryScene = dynamic(() => import("./GalleryScene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-black">
      <div className="text-center">
        <p className="font-display text-2xl tracking-[0.25em] text-[var(--gold)] uppercase">
          Preparing the gallery
        </p>
        <p className="mt-2 text-sm text-white/40">hanging the paintings…</p>
      </div>
    </div>
  ),
});

export default function MuseumClient({ data }: { data: MuseumData }) {
  return <GalleryScene data={data} />;
}
