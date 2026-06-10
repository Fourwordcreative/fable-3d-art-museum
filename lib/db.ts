import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

export const sql = neon(process.env.DATABASE_URL);

export type Period = {
  id: number;
  slug: string;
  name: string;
  start_year: number;
  end_year: number;
  blurb: string;
  color: string;
  sort: number;
};

export type Artist = {
  id: number;
  slug: string;
  period_id: number;
  name: string;
  birth_year: number | null;
  death_year: number | null;
  active_start: number | null;
  active_end: number | null;
  portrait_url: string | null;
  bio: string;
  wiki_url: string;
  nationality: string | null;
};

export type Painting = {
  id: number;
  artist_id: number;
  title: string;
  year_text: string | null;
  year_num: number | null;
  image_url: string;
  thumb_url: string | null;
  story: string;
  facts: string[];
  wiki_url: string;
  width: number | null;
  height: number | null;
};
