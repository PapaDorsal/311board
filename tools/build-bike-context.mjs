// Per-ward cycling context for the ward report cards: how many people have been
// hit on a bike here, and how much bike lane the ward has.
//
// WHY THIS IS CONTEXT AND NOT A RANKING. The board ranks wards on how fast the
// city closes what residents report. Crash counts are not that. Ward 42 leads
// the city on bike crashes because the Loop is where people ride, not because
// its alderperson is negligent - the count tracks how much cycling happens and
// what kind of streets carry it. Ranking wards on it would blame them for having
// bike traffic. Correcting for that needs ridership per ward, which nobody
// publishes, so these figures are printed as facts about a place and never
// sorted into a leaderboard.
//
// Neither dataset carries a ward, so both are assigned here by point-in-polygon
// against the same data/wards.geojson the site already ships. Doing it at build
// time keeps the ward pages free of any live call.
//
// Sources, both City of Chicago open data:
//   Traffic Crashes - Crashes   85ca-t3if   (first_crash_type = PEDALCYCLIST)
//   Bike Routes                 hvv9-38ut   (lane geometry and type)
// Usage: node tools/build-bike-context.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const CRASHES = 'https://data.cityofchicago.org/resource/85ca-t3if.json';
const ROUTES = 'https://data.cityofchicago.org/resource/hvv9-38ut.json';
const YEARS = 2;

const GEO = JSON.parse(readFileSync('data/wards.geojson', 'utf8'));
const r2 = (x) => Math.round(x * 100) / 100;

// Ray cast against the outer ring of each polygon, the same test assets/app.js
// uses for the "find my ward" button.
function wardAt(lon, lat) {
  for (const f of GEO.features) {
    for (const poly of f.geometry.coordinates) {
      let inside = false;
      const ring = poly[0];
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return Number(f.properties.ward);
    }
  }
  return null;
}

async function get(url, params, label) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(url + '?' + new URLSearchParams(params), { signal: AbortSignal.timeout(90000) });
      if (r.ok) return r.json();
      if (r.status < 500 && r.status !== 429) throw new Error(`HTTP ${r.status} [${label}]`);
    } catch (e) {
      if (String(e.message).startsWith('HTTP ')) throw e;
      console.error(`.. [${label}] ${e.name} attempt ${attempt}/4`);
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
  }
  throw new Error(`gave up [${label}]`);
}
async function getAll(url, params, label, page = 20000) {
  const out = [];
  for (let off = 0; ; off += page) {
    const pg = await get(url, { ...params, $order: ':id', $limit: String(page), $offset: String(off) }, `${label}#${off}`);
    out.push(...pg);
    if (pg.length < page) break;
  }
  return out;
}

// Great-circle length in miles, good to well under a percent at city scale.
function miles(a, b) {
  const R = 3958.8, toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR, dLon = (b[0] - a[0]) * toR;
  const lat = ((a[1] + b[1]) / 2) * toR;
  const x = dLon * Math.cos(lat);
  return Math.hypot(x, dLat) * R;
}

const to = new Date();
const TO = `${to.getUTCFullYear()}-${String(to.getUTCMonth() + 1).padStart(2, '0')}-01`;
const FROM = `${to.getUTCFullYear() - YEARS}-${String(to.getUTCMonth() + 1).padStart(2, '0')}-01`;

// ---- crashes ----
const crashRows = await getAll(CRASHES, {
  $select: 'crash_record_id, crash_date, latitude, longitude, injuries_fatal, injuries_incapacitating',
  $where: `first_crash_type='PEDALCYCLIST' AND crash_date >= '${FROM}T00:00:00' AND crash_date < '${TO}T00:00:00' AND latitude IS NOT NULL`,
}, 'crashes');

const byWard = new Map();
const ensure = (w) => { if (!byWard.has(w)) byWard.set(w, { crashes: 0, serious: 0, miles: 0, protectedMiles: 0 }); return byWard.get(w); };
let offMap = 0;
for (const r of crashRows) {
  const w = wardAt(Number(r.longitude), Number(r.latitude));
  if (w === null) { offMap++; continue; }
  const s = ensure(w);
  s.crashes++;
  // "Serious" is the city's own A-injury plus fatality, the two categories that
  // mean someone's life changed. Lumping in every bruise would flatten it.
  s.serious += Number(r.injuries_fatal || 0) + Number(r.injuries_incapacitating || 0);
}

// ---- bike lane miles ----
// Each route is a MultiLineString. Every straight run between two vertices is
// attributed whole to the ward its midpoint falls in, which splits a segment
// that crosses a boundary about where it actually crosses.
const routeRows = await getAll(ROUTES, { $select: 'the_geom, displayrou, street' }, 'routes');
let laneOff = 0, laneTotal = 0;
for (const r of routeRows) {
  const g = r.the_geom;
  if (!g || !g.coordinates) continue;
  const isProtected = /protected/i.test(String(r.displayrou || ''));
  const lines = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      const d = miles(a, b);
      if (!Number.isFinite(d) || d === 0) continue;
      laneTotal += d;
      const w = wardAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (w === null) { laneOff += d; continue; }
      const s = ensure(w);
      s.miles += d;
      if (isProtected) s.protectedMiles += d;
    }
  }
}

const wards = {};
for (let w = 1; w <= 50; w++) {
  const s = byWard.get(w) || { crashes: 0, serious: 0, miles: 0, protectedMiles: 0 };
  wards[w] = {
    crashes: s.crashes, serious: s.serious,
    laneMiles: r2(s.miles), protectedLaneMiles: r2(s.protectedMiles),
  };
}

const out = {
  generatedAt: new Date().toISOString(),
  window: { from: FROM, to: TO, years: YEARS },
  note: 'Context for a ward page, not a ranking: crash counts track how much cycling a ward carries, not how well it is run.',
  sources: {
    crashes: { dataset: '85ca-t3if', portal: 'https://data.cityofchicago.org/Transportation/Traffic-Crashes-Crashes/85ca-t3if', filter: "first_crash_type = 'PEDALCYCLIST'" },
    routes: { dataset: 'hvv9-38ut', portal: 'https://data.cityofchicago.org/Transportation/Bike-Routes/hvv9-38ut' },
  },
  citywide: {
    crashes: crashRows.length - offMap,
    serious: Object.values(wards).reduce((a, b) => a + b.serious, 0),
    laneMiles: r2(Object.values(wards).reduce((a, b) => a + b.laneMiles, 0)),
    protectedLaneMiles: r2(Object.values(wards).reduce((a, b) => a + b.protectedLaneMiles, 0)),
  },
  wards,
};

writeFileSync('data/bike-context.json', JSON.stringify(out) + '\n');
console.log(`crashes: ${crashRows.length} geocoded, ${offMap} outside the ward map`);
console.log(`bike routes: ${routeRows.length} segments, ${r2(laneTotal)} mi total, ${r2(laneOff)} mi outside the ward map`);
console.log(`citywide: ${out.citywide.crashes} crashes, ${out.citywide.serious} serious or fatal, ` +
  `${out.citywide.laneMiles} lane mi (${out.citywide.protectedLaneMiles} protected) -> data/bike-context.json`);
