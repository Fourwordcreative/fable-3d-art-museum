# Timeline Museum — a 3D art museum you can walk through

An explorable 3D museum of famous paintings, built one-shot by **Claude Fable 5** for a head-to-head model-comparison video. Wander a gallery in first person; the works are pulled from Wikipedia/Wikimedia and arranged on a timeline you can walk down.

Built with Next.js + Three.js. Painting data is ingested from the Wikimedia Commons API into a Postgres (Neon) database.

## Run it locally

```bash
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev                  # http://localhost:3000
```

### Environment variables
- `DATABASE_URL` — Postgres connection string (a [Neon](https://neon.tech) free database works). Required — the gallery reads its paintings from here.
- `SITE_PASSWORD` — optional. If set, the whole site is gated behind HTTP Basic Auth (see `middleware.ts`). Leave it unset to run fully open.

### Populating the gallery
The ingest scripts pull painting metadata + images from Wikimedia Commons into the database. See `lib/` and the `ingest*.ts` scripts for the pipeline.

## Notes
This is a one-shot AI build captured for a video, not a maintained product — expect rough edges. Shared as-is for anyone who asked to see the code.
