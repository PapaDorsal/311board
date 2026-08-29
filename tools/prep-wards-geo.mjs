// Fetch Chicago ward boundaries (2023 map, p293-wvbd) and simplify for the
// front-page choropleth: Douglas-Peucker at ~30m, coordinates to 4 decimals.
// Writes data/wards.geojson. Usage: node tools/prep-wards-geo.mjs
const URL_ = 'https://data.cityofchicago.org/api/geospatial/p293-wvbd?method=export&format=GeoJSON';
const TOL = 0.00004; // degrees, ~4.5m - keeps ward outlines crisp when the map is drawn large

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

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToRing(x, y, ring) {
  let min = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const dx = xj - xi, dy = yj - yi;
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / (dx * dx + dy * dy))) : 0;
    const d = Math.hypot(x - (xi + t * dx), y - (yi + t * dy));
    if (d < min) min = d;
  }
  return min;
}

// Coarse grid then local refinement: the interior point furthest from any edge.
function visualCenter(ring) {
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let best = [(x0 + x1) / 2, (y0 + y1) / 2], bestD = -Infinity, step = Math.max(x1 - x0, y1 - y0) / 24;
  for (let pass = 0; pass < 5; pass++) {
    for (let x = x0; x <= x1; x += step) {
      for (let y = y0; y <= y1; y += step) {
        if (!pointInRing(x, y, ring)) continue;
        const d = distToRing(x, y, ring);
        if (d > bestD) { bestD = d; best = [x, y]; }
      }
    }
    x0 = best[0] - step; x1 = best[0] + step; y0 = best[1] - step; y1 = best[1] + step;
    step /= 4;
  }
  return best;
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
  // Label point: the ring's visual center (pole of inaccessibility), not its
  // centroid - Chicago wards are famously gerrymandered, and a centroid often
  // lands outside its own polygon, putting the number in a neighbouring ward.
  let best = null, bestArea = -1;
  for (const rings of simp) {
    const r = rings[0];
    if (!r) continue;
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * r[i][1]) - (r[i][0] * r[j][1]);
    a = Math.abs(a / 2);
    if (a > bestArea) { bestArea = a; best = r; }
  }
  const [cx, cy] = [r4(visualCenter(best)[0]), r4(visualCenter(best)[1])];
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
