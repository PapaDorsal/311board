// Fetch Chicago ward boundaries (2023 map, p293-wvbd) and simplify for the
// front-page choropleth: Douglas-Peucker at ~30m, coordinates to 4 decimals.
// Writes data/wards.geojson. Usage: node tools/prep-wards-geo.mjs
const URL_ = 'https://data.cityofchicago.org/api/geospatial/p293-wvbd?method=export&format=GeoJSON';
const TOL = 0.00008; // degrees, ~9m — ward shapes stay faithful, size drops ~6x

function dp(points, tol) {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  let maxD = 0, idx = 0;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-12;
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs(dx * (a[1] - points[i][1]) - dy * (a[0] - points[i][0])) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [a, b];
  return [...dp(points.slice(0, idx + 1), tol).slice(0, -1), ...dp(points.slice(idx), tol)];
}
const r4 = (x) => Math.round(x * 1e4) / 1e4;

// A closed ring's endpoints coincide, which zeroes the baseline dp works
// against — split at the point farthest from the start and simplify each arc.
function simplifyRing(ring, tol) {
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
  if (pts.length < 4) return ring;
  let far = 1, maxD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > maxD) { maxD = d; far = i; }
  }
  const a = dp(pts.slice(0, far + 1), tol);
  const b = dp([...pts.slice(far), pts[0]], tol);
  return [...a.slice(0, -1), ...b];
}

const res = await fetch(URL_, { signal: AbortSignal.timeout(120000) });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const gj = await res.json();

const features = gj.features.map((f) => {
  const ward = Number(f.properties.ward);
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const simp = polys.map((rings) => rings
    .map((ring) => simplifyRing(ring, TOL).map(([x, y]) => [r4(x), r4(y)]))
    .filter((ring) => ring.length >= 4));
  // label point: centroid of the largest ring (good enough for a number label)
  let best = null, bestN = -1;
  for (const rings of simp) if (rings[0] && rings[0].length > bestN) { bestN = rings[0].length; best = rings[0]; }
  const cx = r4(best.reduce((a, p) => a + p[0], 0) / best.length);
  const cy = r4(best.reduce((a, p) => a + p[1], 0) / best.length);
  return {
    type: 'Feature',
    properties: { ward, label: [cx, cy] },
    geometry: { type: 'MultiPolygon', coordinates: simp },
  };
}).sort((a, b) => a.properties.ward - b.properties.ward);

if (features.length !== 50) throw new Error(`expected 50 wards, got ${features.length}`);
const out = JSON.stringify({ type: 'FeatureCollection', source: 'p293-wvbd (City of Chicago, 2023 ward map)', features });
const fs = await import('node:fs/promises');
await fs.writeFile(new URL('../data/wards.geojson', import.meta.url), out);
console.log(`50 wards, ${(out.length / 1024).toFixed(0)} KB -> data/wards.geojson`);
