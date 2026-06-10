// Probe candidate painting titles: prints which would survive ingestion.
const UA = { headers: { "User-Agent": "TimelineMuseum/1.0 (pat@persimmons.studio)" } };
const API = "https://en.wikipedia.org/w/api.php";

const CANDIDATES = {
  Duccio: [
    "The Calling of the Apostles Peter and Andrew",
    "Nativity with the Prophets Isaiah and Ezekiel",
    "Temptation of Christ (Duccio)",
    "Madonna and Child (Duccio)",
    "Polyptych No. 47",
    "The Raising of Lazarus (Duccio)",
    "Pentecost (Duccio)",
  ],
  "Egon Schiele": [
    "Self-Portrait with Chinese Lantern Plant",
    "Sitting Woman with Legs Drawn Up",
    "The Embrace (Schiele)",
    "Portrait of Albert Paris von Gütersloh",
    "Dead Mother I",
    "Cardinal and Nun (Caress)",
    "Krumau on the Molde",
    "Setting Sun (Egon Schiele)",
  ],
  "Fernand Léger": [
    "The City (Léger)",
    "Three Women (Léger)",
    "Woman with a Book",
    "The Builders (Léger)",
    "Railway Crossing (Léger)",
    "The Mechanic (Léger)",
    "Propellers (Léger)",
    "Composition with Hand and Hats",
  ],
  "Willem de Kooning": [
    "Woman VI",
    "Easter Monday (painting)",
    "Gotham News",
    "Pink Angels",
    "Door to the River",
    "A Tree in Naples",
    "Woman, Sag Harbor",
    "Two Women in the Country",
  ],
  "Jasper Johns": [
    "Target with Plaster Casts",
    "Numbers in Color",
    "0 through 9",
    "Periscope (Hart Crane)",
    "Diver (Johns)",
    "Usuyuki",
    "Savarin (Jasper Johns)",
    "Watchman (Jasper Johns)",
  ],
  "David Hockney": [
    "We Two Boys Together Clinging",
    "My Parents (Hockney)",
    "Bigger Trees Near Warter",
    "Pearblossom Hwy., 11-18th April 1986, No. 2",
    "Nichols Canyon (painting)",
    "Christopher Isherwood and Don Bachardy",
    "Beverly Hills Housewife",
    "Domestic Scene, Los Angeles",
    "The Arrival of Spring in Woldgate, East Yorkshire in 2011 (twenty eleven)",
  ],
  "Keith Haring": [
    "Crack is Wack",
    "Tuttomondo",
    "Todos juntos podemos parar el sida",
    "We the Youth",
    "Boys Club Mural",
    "Once Upon a Time (Haring)",
    "The Ten Commandments (Haring)",
    "Untitled (Haring, 1982)",
  ],
};

async function probe(title) {
  const s = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replaceAll(" ", "_"))}?redirect=true`,
    UA
  ).then((r) => (r.ok ? r.json() : null));
  if (!s || s.type === "disambiguation") return `404/disambig`;
  let img = s.originalimage?.source;
  if (!img) {
    const pi = await fetch(
      `${API}?action=query&prop=pageimages&piprop=original&pilicense=any&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(s.title ?? title)}`,
      UA
    ).then((r) => r.json());
    img = pi?.query?.pages?.[0]?.original?.source;
  }
  if (!img) return "NO IMAGE";
  if (!/\.(jpe?g|png)$/i.test(img)) return `bad ext: ${img.slice(-10)}`;
  if ((s.extract ?? "").length < 120) return "thin extract";
  return `OK (${s.title})`;
}

for (const [artist, titles] of Object.entries(CANDIDATES)) {
  console.log(`\n${artist}:`);
  for (const t of titles) {
    console.log(`  ${t} → ${await probe(t)}`);
    await new Promise((r) => setTimeout(r, 120));
  }
}
