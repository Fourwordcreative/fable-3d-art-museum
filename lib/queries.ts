import { sql } from "./db";
import type { MuseumData, PaintingData, TimelineArtist, TimelinePeriod } from "./types";

export async function getTimeline(): Promise<TimelinePeriod[]> {
  const periods = await sql`SELECT * FROM periods ORDER BY sort`;
  const artists = await sql`
    SELECT a.*, p.slug AS period_slug, count(pt.id)::int AS painting_count
    FROM artists a
    JOIN periods p ON p.id = a.period_id
    LEFT JOIN paintings pt ON pt.artist_id = a.id
    GROUP BY a.id, p.slug
    ORDER BY a.active_start`;

  return periods.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    startYear: p.start_year,
    endYear: p.end_year,
    color: p.color,
    sort: p.sort,
    artists: artists
      .filter((a) => a.period_id === p.id)
      .map(
        (a): TimelineArtist => ({
          id: a.id,
          slug: a.slug,
          name: a.name,
          birthYear: a.birth_year,
          deathYear: a.death_year,
          activeStart: a.active_start ?? p.start_year,
          activeEnd: a.active_end ?? p.end_year,
          portraitUrl: a.portrait_url,
          nationality: a.nationality,
          bio: a.bio,
          wikiUrl: a.wiki_url,
          paintingCount: a.painting_count,
          periodSlug: p.slug,
        })
      ),
  }));
}

export async function getMuseum(slug: string): Promise<MuseumData | null> {
  const rows = await sql`
    SELECT a.*, p.slug AS period_slug, p.name AS period_name, p.color AS period_color
    FROM artists a JOIN periods p ON p.id = a.period_id
    WHERE a.slug = ${slug}`;
  if (rows.length === 0) return null;
  const a = rows[0];
  const paintings = await sql`
    SELECT * FROM paintings WHERE artist_id = ${a.id}
    ORDER BY year_num NULLS LAST, title`;

  return {
    artist: {
      id: a.id,
      slug: a.slug,
      name: a.name,
      birthYear: a.birth_year,
      deathYear: a.death_year,
      activeStart: a.active_start ?? 0,
      activeEnd: a.active_end ?? 0,
      portraitUrl: a.portrait_url,
      nationality: a.nationality,
      bio: a.bio,
      wikiUrl: a.wiki_url,
      paintingCount: paintings.length,
      periodSlug: a.period_slug,
      periodName: a.period_name,
      periodColor: a.period_color,
    },
    paintings: paintings.map(
      (pt): PaintingData => ({
        id: pt.id,
        title: pt.title,
        yearText: pt.year_text,
        yearNum: pt.year_num,
        imageUrl: pt.image_url,
        thumbUrl: pt.thumb_url,
        story: pt.story,
        facts: Array.isArray(pt.facts) ? pt.facts : [],
        wikiUrl: pt.wiki_url,
        width: pt.width,
        height: pt.height,
      })
    ),
  };
}

export async function getArtistSlugs(): Promise<string[]> {
  const rows = await sql`SELECT slug FROM artists ORDER BY slug`;
  return rows.map((r) => r.slug);
}
