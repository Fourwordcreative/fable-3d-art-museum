// Wikipedia → Neon ingestion.
// Sources: en.wikipedia REST summaries, action API (extracts, categorymembers),
// Wikidata (birth/death dates). No content is authored here — stories and facts
// are verbatim paragraphs/sentences from each painting's Wikipedia article.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { PERIODS } from "./seed-data.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL missing from .env.local");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const UA = "TimelineMuseum/1.0 (pat@persimmons.studio) educational art history project";
const API = "https://en.wikipedia.org/w/api.php";
const MIN_PAINTINGS = 8;
const MAX_PAINTINGS = 12;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastFetch = 0;

async function fetchJson(url, attempt = 0) {
  // politeness: ≥120ms between requests to avoid throttling
  const wait = lastFetch + 120 - Date.now();
  if (wait > 0) await sleep(wait);
  lastFetch = Date.now();
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        return fetchJson(url, attempt + 1);
      }
      return null;
    }
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      return fetchJson(url, attempt + 1);
    }
    console.error(`  fetch failed: ${url.slice(0, 120)} — ${e.message}`);
    return null;
  }
}

const summary = (title) =>
  fetchJson(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      title.replaceAll(" ", "_")
    )}?redirect=true`
  );

async function fullExtract(title) {
  const data = await fetchJson(
    `${API}?action=query&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(title)}`
  );
  return data?.query?.pages?.[0]?.extract ?? null;
}

async function categoryMembers(category, depth = 1) {
  const fetchNs = async (ns) => {
    const data = await fetchJson(
      `${API}?action=query&list=categorymembers&cmtitle=${encodeURIComponent(category)}&cmnamespace=${ns}&cmlimit=200&format=json&formatversion=2`
    );
    return (data?.query?.categorymembers ?? []).map((m) => m.title);
  };
  const titles = (await fetchNs(0)).filter(
    (t) =>
      !/^list of/i.test(t) &&
      !t.includes("disambiguation") &&
      !/catalogue|exhibition|attributed/i.test(t)
  );
  if (depth > 0) {
    for (const sub of await fetchNs(14)) {
      for (const t of await categoryMembers(sub, depth - 1)) {
        if (!titles.includes(t)) titles.push(t);
      }
    }
  }
  return titles;
}

async function wikidataYears(qid) {
  if (!qid) return { birth: null, death: null };
  const data = await fetchJson(
    `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&format=json`
  );
  const claims = data?.claims ?? {};
  const year = (prop) => {
    const t = claims[prop]?.[0]?.mainsnak?.datavalue?.value?.time;
    const m = t?.match(/^[+-](\d{4})/);
    return m ? parseInt(m[1], 10) : null;
  };
  return { birth: year("P569"), death: year("P570") };
}

// Build a resized Wikimedia thumb URL from an original upload URL.
// Wikimedia only renders a fixed set of thumb widths; snap to an allowed bucket.
const THUMB_BUCKETS = [500, 960, 1280, 1920];
function thumbUrl(original, originalWidth, target = 1280) {
  target = THUMB_BUCKETS.filter((b) => b <= target).pop() ?? 500;
  if (!original || originalWidth <= target) return original;
  const m = original.match(
    /^https:\/\/upload\.wikimedia\.org\/wikipedia\/(commons|en)\/(.\/..)\/(.+)$/
  );
  if (!m) return original;
  return `https://upload.wikimedia.org/wikipedia/${m[1]}/thumb/${m[2]}/${m[3]}/${target}px-${m[3]}`;
}

const OK_EXT = /\.(jpe?g|png)$/i;

// Split a plaintext extract into { lead, sections: [{heading, text}] }.
function parseExtract(text) {
  const lines = text.split("\n");
  const sections = [];
  let current = { heading: null, text: "" };
  for (const line of lines) {
    const h = line.match(/^==+\s*(.+?)\s*==+$/);
    if (h) {
      sections.push(current);
      current = { heading: h[1], text: "" };
    } else {
      current.text += line + "\n";
    }
  }
  sections.push(current);
  const lead = sections.shift()?.text.trim() ?? "";
  return { lead, sections: sections.filter((s) => s.text.trim().length > 0) };
}

const SKIP_SECTIONS =
  /references|external links|further reading|see also|sources|notes|bibliography|footnotes|citations/i;

function sentencesOf(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z“"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 60 && s.length <= 320 && !/^==/.test(s));
}

function pickFacts(sections, exclude) {
  const facts = [];
  for (const s of sections) {
    if (facts.length >= 5) break;
    if (!s.heading || SKIP_SECTIONS.test(s.heading)) continue;
    const sentences = sentencesOf(s.text);
    for (const sent of sentences) {
      if (facts.length >= 5) break;
      if (exclude.includes(sent)) continue;
      facts.push(sent);
      break; // max one fact per section for variety
    }
  }
  return facts;
}

function yearFrom(summaryDesc, lead) {
  const inText = (t) => {
    if (!t) return null;
    const m =
      t.match(/\b(?:painted|completed|created|executed|dating|dated|begun)\b[^.]{0,40}?\b(1[0-9]{3}|20[0-2][0-9])\b/i) ||
      t.match(/\b(?:c\.|circa|from|in)\s+(1[0-9]{3}|20[0-2][0-9])\b/) ||
      t.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
    return m ? parseInt(m[1], 10) : null;
  };
  return inText(summaryDesc) ?? inText(lead?.slice(0, 600));
}

async function ingestPainting(title, artistName) {
  const s = await summary(title);
  if (!s || s.type === "disambiguation") return null;
  let img = s.originalimage;
  if (!img?.source) {
    // REST summaries omit non-free images (modern/contemporary works);
    // the action API returns Wikipedia's own fair-use page image.
    const pi = await fetchJson(
      `${API}?action=query&prop=pageimages&piprop=original&pilicense=any&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(s.title ?? title)}`
    );
    const orig = pi?.query?.pages?.[0]?.original;
    if (orig?.source) img = { source: orig.source, width: orig.width, height: orig.height };
  }
  if (!img?.source || !OK_EXT.test(img.source)) return null;
  const text = await fullExtract(s.title ?? title);
  if (!text) return null;
  const { lead, sections } = parseExtract(text);
  if (lead.length < 100) return null;
  const storyParas = lead.split(/\n+/).filter((p) => p.trim().length > 40);
  const story = storyParas.slice(0, 3).join("\n\n").slice(0, 2200);
  const facts = pickFacts(sections, storyParas);
  const yearNum = yearFrom(s.description, lead);
  // Reject pages that are clearly not a painting by this artist (e.g. a person,
  // a film). Heuristic: artist surname or "painting"/"canvas"/"oil"/"mural" in lead.
  const surname = artistName.split(" ").pop();
  if (
    !new RegExp(`\\b(painting|canvas|oil|fresco|mural|panel|triptych|altarpiece|portrait|drawing|pastel|watercolou?r)\\b`, "i").test(
      lead.slice(0, 700)
    ) &&
    !lead.slice(0, 400).includes(surname)
  )
    return null;
  return {
    title: s.title ?? title,
    year_text: yearNum ? String(yearNum) : null,
    year_num: yearNum,
    image_url: img.source,
    thumb_url: thumbUrl(img.source, img.width, 1280),
    story,
    facts,
    wiki_url: s.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    width: img.width,
    height: img.height,
  };
}

const slugify = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// --artists "Name1,Name2" → re-ingest only those artists (delete + reinsert),
// keeping everything else in place. Without it: full truncate + rebuild.
const onlyArtists = (() => {
  const i = process.argv.indexOf("--artists");
  return i >= 0 ? process.argv[i + 1].split(",").map((s) => s.trim()) : null;
})();

async function main() {
  console.log("Creating schema…");
  await sql`CREATE TABLE IF NOT EXISTS periods (
    id serial PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL,
    start_year int NOT NULL, end_year int NOT NULL, blurb text NOT NULL DEFAULT '',
    color text NOT NULL, sort int NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS artists (
    id serial PRIMARY KEY, slug text UNIQUE NOT NULL,
    period_id int NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
    name text NOT NULL, birth_year int, death_year int, active_start int, active_end int,
    portrait_url text, bio text NOT NULL DEFAULT '', wiki_url text NOT NULL DEFAULT '',
    nationality text
  )`;
  await sql`CREATE TABLE IF NOT EXISTS paintings (
    id serial PRIMARY KEY,
    artist_id int NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    title text NOT NULL, year_text text, year_num int,
    image_url text NOT NULL, thumb_url text, story text NOT NULL DEFAULT '',
    facts jsonb NOT NULL DEFAULT '[]', wiki_url text NOT NULL DEFAULT '',
    width int, height int,
    UNIQUE (artist_id, title)
  )`;
  if (!onlyArtists) {
    await sql`TRUNCATE paintings, artists, periods RESTART IDENTITY CASCADE`;
  }

  let totals = { artists: 0, paintings: 0 };
  for (const [i, period] of PERIODS.entries()) {
    const periodArtists = period.artists.filter(
      (a) => !onlyArtists || onlyArtists.includes(a.title)
    );
    if (periodArtists.length === 0) continue;
    console.log(`\n=== ${period.name} (${period.start}–${period.end}) ===`);
    const [p] = await sql`
      INSERT INTO periods (slug, name, start_year, end_year, color, sort)
      VALUES (${period.slug}, ${period.name}, ${period.start}, ${period.end}, ${period.color}, ${i})
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name,
        start_year = EXCLUDED.start_year, end_year = EXCLUDED.end_year
      RETURNING id`;

    for (const a of periodArtists) {
      if (onlyArtists) {
        await sql`DELETE FROM artists WHERE name = ${a.title} OR slug = ${slugify(a.title)}`;
      }
      const s = await summary(a.title);
      if (!s) {
        console.log(`  !! no summary for ${a.title}, skipping`);
        continue;
      }
      if (onlyArtists && s.title && s.title !== a.title) {
        await sql`DELETE FROM artists WHERE name = ${s.title} OR slug = ${slugify(s.title)}`;
      }
      const { birth, death } = await wikidataYears(s.wikibase_item);

      const candidates = [];
      const cat = a.category ?? `Category:Paintings by ${s.title ?? a.title}`;
      candidates.push(...(await categoryMembers(cat)));
      if (candidates.length < MIN_PAINTINGS && !a.category) {
        candidates.push(...(await categoryMembers(`Category:Works by ${s.title ?? a.title}`)));
      }
      for (const t of a.extraPaintings ?? []) {
        if (!candidates.includes(t)) candidates.push(t);
      }

      const paintings = [];
      for (const t of candidates) {
        if (paintings.length >= MAX_PAINTINGS) break;
        const r = await ingestPainting(t, s.title ?? a.title);
        if (r && !paintings.some((q) => q.title === r.title)) paintings.push(r);
      }

      if (paintings.length < MIN_PAINTINGS) {
        console.log(
          `  !! ${a.title}: only ${paintings.length} usable paintings (of ${candidates.length} candidates) — keeping anyway, flagged`
        );
      }
      if (paintings.length === 0) {
        console.log(`  !! ${a.title}: zero paintings, skipping artist`);
        continue;
      }

      const years = paintings.map((x) => x.year_num).filter(Boolean);
      const activeStart =
        birth != null ? birth + 18 : years.length ? Math.min(...years) : period.start;
      const activeEnd =
        death ?? (years.length ? Math.max(...years, birth ? birth + 18 : 0) : period.end);

      const bioParas = (s.extract ?? "").split(/\n+/).filter((x) => x.trim());
      const [artistRow] = await sql`
        INSERT INTO artists (slug, period_id, name, birth_year, death_year, active_start, active_end, portrait_url, bio, wiki_url, nationality)
        VALUES (${slugify(s.title ?? a.title)}, ${p.id}, ${s.title ?? a.title}, ${birth}, ${death},
                ${activeStart}, ${activeEnd}, ${s.originalimage?.source ? thumbUrl(s.originalimage.source, s.originalimage.width, 960) : s.thumbnail?.source ?? null},
                ${bioParas.slice(0, 2).join("\n\n").slice(0, 1500)},
                ${s.content_urls?.desktop?.page ?? ""}, ${s.description ?? null})
        RETURNING id`;

      for (const pt of paintings) {
        await sql`
          INSERT INTO paintings (artist_id, title, year_text, year_num, image_url, thumb_url, story, facts, wiki_url, width, height)
          VALUES (${artistRow.id}, ${pt.title}, ${pt.year_text}, ${pt.year_num}, ${pt.image_url},
                  ${pt.thumb_url}, ${pt.story}, ${JSON.stringify(pt.facts)}, ${pt.wiki_url}, ${pt.width}, ${pt.height})
          ON CONFLICT (artist_id, title) DO NOTHING`;
      }
      totals.artists++;
      totals.paintings += paintings.length;
      console.log(
        `  ✓ ${s.title ?? a.title} (${birth ?? "?"}–${death ?? "now"}): ${paintings.length} paintings`
      );
    }
  }
  console.log(`\nDone. ${totals.artists} artists, ${totals.paintings} paintings.`);

  const low = await sql`
    SELECT a.name, count(p.id) AS n FROM artists a
    LEFT JOIN paintings p ON p.artist_id = a.id
    GROUP BY a.name HAVING count(p.id) < ${MIN_PAINTINGS} ORDER BY n`;
  if (low.length) {
    console.log("\nArtists below painting minimum:");
    for (const r of low) console.log(`  ${r.name}: ${r.n}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
