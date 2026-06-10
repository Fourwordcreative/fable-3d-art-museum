// Shared data contract between the server queries and all timeline variants.

export type TimelineArtist = {
  id: number;
  slug: string;
  name: string;
  birthYear: number | null;
  deathYear: number | null;
  activeStart: number;
  activeEnd: number;
  portraitUrl: string | null;
  nationality: string | null; // Wikipedia short description, e.g. "Italian painter (1571–1610)"
  bio: string;
  wikiUrl: string;
  paintingCount: number;
  periodSlug: string;
};

export type TimelinePeriod = {
  id: number;
  slug: string;
  name: string;
  startYear: number;
  endYear: number;
  color: string;
  sort: number;
  artists: TimelineArtist[];
};

export type TimelineFilter = {
  periodSlug: string | null;
  artistSlug: string | null;
};

export type TimelineVariantProps = {
  periods: TimelinePeriod[];
  filter: TimelineFilter;
  onSelectArtist: (slug: string) => void;
};

export type PaintingData = {
  id: number;
  title: string;
  yearText: string | null;
  yearNum: number | null;
  imageUrl: string;
  thumbUrl: string | null;
  story: string;
  facts: string[];
  wikiUrl: string;
  width: number | null;
  height: number | null;
};

export type MuseumData = {
  artist: TimelineArtist & { periodName: string; periodColor: string };
  paintings: PaintingData[];
};
