// Round 2: category sizes for potential artist swaps + failure reasons for borderline artists.
const UA = { headers: { "User-Agent": "TimelineMuseum/1.0 (pat@persimmons.studio)" } };
const API = "https://en.wikipedia.org/w/api.php";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function members(cat, ns = 0) {
  const d = await fetch(
    `${API}?action=query&list=categorymembers&cmtitle=${encodeURIComponent(cat)}&cmnamespace=${ns}&cmlimit=200&format=json&formatversion=2`,
    UA
  ).then((r) => r.json());
  return (d.query?.categorymembers ?? []).map((m) => m.title);
}

async function allMembers(cat) {
  const direct = await members(cat, 0);
  for (const sub of await members(cat, 14)) {
    direct.push(...(await members(sub, 0)));
  }
  return [...new Set(direct)].filter((t) => !/^list of/i.test(t));
}

async function reason(title) {
  const s = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replaceAll(" ", "_"))}?redirect=true`,
    UA
  ).then((r) => (r.ok ? r.json() : null));
  if (!s || s.type === "disambiguation") return "404";
  let img = s.originalimage?.source;
  if (!img) {
    const pi = await fetch(
      `${API}?action=query&prop=pageimages&piprop=original&pilicense=any&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(s.title ?? title)}`,
      UA
    ).then((r) => r.json());
    img = pi?.query?.pages?.[0]?.original?.source;
  }
  if (!img) return "NO-IMAGE";
  if (!/\.(jpe?g|png)$/i.test(img)) return "BAD-EXT " + img.slice(-12);
  if ((s.extract ?? "").length < 120) return "THIN-LEAD " + (s.extract ?? "").length;
  return "OK";
}

// 1) Swap candidates: how many usable paintings would each yield?
for (const cat of [
  "Category:Paintings by Jean Metzinger",
  "Category:Paintings by Robert Delaunay",
  "Category:Paintings by Lucian Freud",
  "Category:Paintings by Francis Bacon",
  "Category:Paintings by Robert Rauschenberg",
  "Category:Paintings by Tom Wesselmann",
  "Category:Paintings by James Rosenquist",
  "Category:Works by Keith Haring",
]) {
  const m = await allMembers(cat);
  let ok = 0;
  for (const t of m.slice(0, 16)) {
    if ((await reason(t)) === "OK") ok++;
    await sleep(100);
  }
  console.log(`${cat}: ${m.length} members, ${ok} usable (of first ${Math.min(16, m.length)})`);
}

// 2) Failure reasons for borderline artists' actual candidates
for (const [artist, cat] of [
  ["Duccio", "Category:Paintings by Duccio"],
  ["Egon Schiele", "Category:Paintings by Egon Schiele"],
  ["Willem de Kooning", "Category:Paintings by Willem de Kooning"],
  ["David Hockney", "Category:Paintings by David Hockney"],
  ["Jasper Johns", "Category:Paintings by Jasper Johns"],
]) {
  console.log(`\n${artist}:`);
  for (const t of await allMembers(cat)) {
    console.log(`  ${t} → ${await reason(t)}`);
    await sleep(100);
  }
}
