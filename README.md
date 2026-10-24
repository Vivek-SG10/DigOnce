# DigOnce — One trench. One repair. One disruption.

A ward-level road-cut coordination tool for Bengaluru permit officers. DigOnce reads messy utility work notices (English, Kannada, Hindi, mixed), maps them onto real OSM ward streets, detects works that overlap in space and time, proposes a shared dig window, estimates cost and disruption savings, and flags cuts on recently resurfaced roads.

---

## Problem

Bengaluru's roads are dug multiple times by different utility agencies — BWSSB (water), BESCOM (power), GAIL (gas), Telecom companies, and BBMP (drains) — often weeks apart on the same street. Each dig means a separate restoration, separate citizen disruption, and separate permit overhead. A 2020 BBMP audit estimated ₹50 crore in avoidable road restoration annually in the city.

---

## How it works

1. **Intake** — Paste a raw work notice in any language. The parse chain tries:
   - **AI (Gemini)**: structured extraction with Kannada/Hindi/Hinglish understanding, confidence scores, fuzzy street matching, and PII redaction before the API call.
   - **Fallback parser**: pure regex + Levenshtein offline parser (no API needed).
   - **Cached parse**: for the 5 sample notices bundled with the demo.

2. **Engine** (pure functions, no AI):
   - `loadRoads`: parses OSM GeoJSON into a name → feature map.
   - `overlapSpace`: checks shared segment name or buffered geometric intersection (default 30 m buffer).
   - `overlapTime`: checks if starts are within the coordination window (default 60 days).
   - `buildClusters`: union-find over all overlapping pairs → clusters of 2+ works.
   - `planCluster`: computes shared window (earliest emergency start, or latest start for non-emergency), calculates restoration savings and disruption-days saved.
   - `freshRoadAlerts`: flags works on roads resurfaced within the protection period.

3. **Map** — react-leaflet on dark CartoDB tiles. Works coloured by agency; conflict clusters drawn red/dashed; fresh-road violations orange.

4. **Coordination memo** — one-click plain-text memo generated locally (no AI) for each cluster, ready to copy and send.

---

## How to run

### Prerequisites
- Node.js 18+
- (Optional) Gemini API key for AI parsing

### Setup

```bash
# Clone / unzip the project
cd digonce

# Install dependencies
npm install

# Configure environment (optional — app works offline without it)
cp .env.example .env
# Edit .env and set GEMINI_API_KEY and GEMINI_MODEL

# Start dev server (includes /api/parse middleware)
npm run dev
```

Open http://localhost:5173

### Deploy to Vercel

```bash
npm i -g vercel
vercel --prod
# Set GEMINI_API_KEY and GEMINI_MODEL in Vercel project settings
```

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | No | — | Gemini REST API key. Without it, the app uses the fallback parser. |
| `GEMINI_MODEL` | No | `gemini-1.5-flash` | Gemini model name. |

---

## Data notes

- **Works**: All works shown on first load are **synthetic**, generated at runtime from the real street list.
- **Streets**: Street names and geometries come from a real **OpenStreetMap Overpass Turbo** export for the selected Bengaluru ward (`public/data/roads.geojson`).
- **Resurfacing dates**: Synthetic, chosen so that `streetNames[3]` triggers a Fresh-Road Guard alert.
- All data is stored in `localStorage` only — no database, no server state.

---

## Configurable assumptions

All cost and time parameters are editable in the UI. They are **not official rates**.

| Parameter | Default | Meaning |
|-----------|---------|---------|
| Restoration cost | ₹1,500/m² | Per-square-metre road restoration cost |
| Coordination window | 60 days | Works starting within this many days are considered time-overlapping |
| Spatial buffer | 30 m | Works within this distance of each other are considered space-overlapping |
| Fresh-road protection | 12 months | Cuts within this period after resurfacing trigger a warning |

---

## Limitations

- **One ward**: The GeoJSON covers one exported ward area. Extend by replacing `public/data/roads.geojson`.
- **Whole-segment matching**: A "work on Brigade Road" is matched to the entire Brigade Road geometry. Sub-segment precision requires richer input data.
- **Simplified cost model**: The savings formula is `(n-1) × min_area × cost_per_sqm`. Real restoration costs depend on pavement type, depth, compaction method, and vendor rates.
- **No authentication**: Designed for a single-officer demo. Production use would need identity and audit trails.
- **AI parsing accuracy**: Depends on Gemini's ability to handle mixed-language text. The fallback parser handles common patterns but may miss complex sentence structures.

---

## Context

Commercial platforms like [one.network](https://www.one.network) offer structured works coordination with full permit workflows. **DigOnce's angle** is:
- **Low-cost intake of unstructured mixed-language notices** (English + Kannada + Hindi) via AI with offline fallback.
- **Fresh-road protection alerting** — automatically flags cuts that breach a configurable protection period.
- **Zero infrastructure**: runs entirely in the browser with localStorage, deployable on Vercel free tier.

---

## Tech stack

- React 19 + Vite 6
- Tailwind CSS v4 (via `@tailwindcss/vite`)
- react-leaflet 5 + Leaflet 1.9 + CartoDB dark tiles
- @turf/turf 7 (geometric overlap detection)
- Gemini REST API (no SDK)
- Vercel serverless functions (`api/parse.js`)
