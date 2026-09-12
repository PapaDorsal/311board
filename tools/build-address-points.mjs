// Builds data/address-points.json: every Chicago address range mapped to the ward
// its parcel point actually falls in.
//
// Two sources, both on the city's ArcGIS server, both published natively in
// EPSG:3435 (Illinois State Plane East, US survey feet). That shared projection is
// why there is no reprojection step here: the points and the polygons are already
// in the same coordinate system, so the point-in-polygon test runs on the numbers
// as published.
//
//   Parcel Addresses  ExternalApps/operational/MapServer/1
//     605k parcels with L_ADDR/H_ADDR ranges and X_COORD/Y_COORD centroids. The
//     centroid is an attribute, so no geometry is downloaded.
//   WARDS             ExternalApps/Wards/MapServer/0
//     The unsimplified 2023 boundaries, ~89k vertices over 52 rings. NOT the
//     4,940-vertex copy in data/wards.geojson, which is a rendering simplification
//     for the map and flattens away the detached parts of wards 19 and 41.
//
// The ward is decided by the polygon. Nothing in this file infers a ward from a
// street name or a block number.
//
// Run: node tools/build-address-points.mjs [--cache DIR]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ChiAddress = require('../assets/address.js');

const HOST = 'https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps';
const ADDR = `${HOST}/operational/MapServer/1/query`;
const WARD = `${HOST}/Wards/MapServer/0/query`;
const OUT = new URL('../data/address-points.json', import.meta.url).pathname;
const PAGE = 2000;

const cacheDir = (() => {
  const i = process.argv.indexOf('--cache');
  return i > 0 ? process.argv[i + 1] : null;
})();
const cached = (name) => (cacheDir ? path.join(cacheDir, name) : null);

async function getJson(url, tries = 4) {
  for (let t = 0; ; t++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('http ' + r.status);
      const j = await r.json();
      if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 160));
      return j;
    } catch (e) {
      if (t >= tries - 1) throw e;
      await new Promise((s) => setTimeout(s, 1000 * 2 ** t));
    }
  }
}

async function loadParcels() {
  const c = cached('addr-raw.json');
  if (c && fs.existsSync(c)) {
    console.error('parcels: using cache', c);
    return JSON.parse(fs.readFileSync(c, 'utf8'));
  }
  const fields = 'OBJECTID,L_ADDR,H_ADDR,PRE_DIR,ST_NAME,ST_TYPE,SUF_DIR,X_COORD,Y_COORD';
  const rows = [];
  // orderByFields is required for stable paging: without it the server is free to
  // return rows in a different order per request and resultOffset silently skips.
  for (let offset = 0, page = 0; ; offset += PAGE, page++) {
    const j = await getJson(`${ADDR}?where=1%3D1&outFields=${fields}&returnGeometry=false`
      + `&orderByFields=OBJECTID&resultOffset=${offset}&resultRecordCount=${PAGE}&f=json`);
    const f = j.features || [];
    for (const x of f) rows.push(x.attributes);
    if (page % 40 === 0) console.error(`  parcels ${rows.length}...`);
    if (f.length < PAGE) break;
    if (page > 500) throw new Error('paging guard hit; the layer grew unexpectedly');
  }
  console.error('parcels:', rows.length);
  return rows;
}

async function loadWards() {
  const c = cached('wards-raw.json');
  if (c && fs.existsSync(c)) {
    console.error('wards: using cache', c);
    return JSON.parse(fs.readFileSync(c, 'utf8'));
  }
  return getJson(`${WARD}?where=1%3D1&outFields=WARD&returnGeometry=true&f=json`);
}

// ---- normalization ----
// The parcel extract is dirtier than it looks. SUF_DIR holds a single space in
// 52k rows rather than null, spells directions out, and carries transit codes
// (inbound, outbound, ramps) that are not part of any address a resident types.
const SUF = { W: 'W', E: 'E', N: 'N', S: 'S', WEST: 'W', EAST: 'E', NORTH: 'N', SOUTH: 'S' };
function normSuffix(v) {
  const s = String(v ?? '').trim().toUpperCase();
  return SUF[s] || '';
}
const clean = (v) => String(v ?? '').trim().toUpperCase();

function main(rows, wj) {
  // Rings with bounding boxes. The bbox reject is what makes 605k by 52 tractable.
  const rings = [];
  for (const f of wj.features) {
    const ward = Number(f.attributes.WARD);
    if (!Number.isInteger(ward) || ward < 1 || ward > 50) throw new Error('bad ward ' + f.attributes.WARD);
    for (const r of f.geometry.rings) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of r) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      rings.push({ ward, r, x0, y0, x1, y1 });
    }
  }
  const wardCount = new Set(rings.map((g) => g.ward)).size;
  if (wardCount !== 50) throw new Error(`expected 50 wards, got ${wardCount}`);
  console.error(`wards: ${wardCount} over ${rings.length} rings, `
    + `${rings.reduce((n, g) => n + g.r.length, 0)} vertices`);

  function wardAt(x, y) {
    for (const g of rings) {
      if (x < g.x0 || x > g.x1 || y < g.y0 || y > g.y1) continue;
      const r = g.r;
      let inside = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return g.ward;
    }
    return null;
  }

  const stat = { outside: 0, noCoord: 0, noAddr: 0, placed: 0, impossible: 0 };
  const byKey = new Map();
  for (const r of rows) {
    if (r.X_COORD == null || r.Y_COORD == null) { stat.noCoord++; continue; }
    const name = ChiAddress.normalizeName(r.ST_NAME);
    if (r.L_ADDR == null || !name) { stat.noAddr++; continue; }
    const w = wardAt(r.X_COORD, r.Y_COORD);
    if (w == null) { stat.outside++; continue; }
    stat.placed++;
    const lo = Math.min(r.L_ADDR, r.H_ADDR ?? r.L_ADDR);
    const hi = Math.max(r.L_ADDR, r.H_ADDR ?? r.L_ADDR);
    // A range wider than a block face cannot describe one location, so it cannot
    // place a point. Some are plainly corrupt: one N Halsted record runs 2950 to
    // 809, another on W Belmont runs 4444 to 6444. Left in, a single such record
    // can be the only thing covering a number and will answer for it.
    if (hi - lo >= 100) { stat.impossible++; continue; }
    // Sides are kept apart because a ward boundary often runs down the middle of
    // a street, so the even and odd sides of one block can be different wards.
    const k = [clean(r.PRE_DIR), name, clean(r.ST_TYPE), normSuffix(r.SUF_DIR), lo % 2 ? 'O' : 'E'].join('|');
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push([lo, hi, w]);
  }

  // Reduce to hundred-blocks, which is the unit the Chicago grid actually
  // guarantees: 1000-1098 even is one block face, and a ward boundary runs along
  // streets rather than through the middle of a block face. So the ward of any
  // parcel on a block face is the ward of the whole face, which is what lets a
  // house number with no parcel of its own resolve.
  //
  // An earlier pass merged same-ward neighbours across any gap instead. That was
  // wrong: it made the span between the last parcel of one ward and the first of
  // the next a single gap, which put 1.6 million house numbers into spans that
  // were nowhere near a boundary. A block face is a bound the grid supports.
  //
  // A block absent from a street is not an address on that street. That is what
  // ends the confident answers for numbers past the end of a street or outside
  // the city: there is no parcel, so there is no block, so there is no ward.
  // Most block faces sit wholly in one ward, and for those the block alone is the
  // answer, which is what keeps this file small. The few that a boundary cuts keep
  // their parcel ranges instead, so a number on one of them resolves exactly
  // rather than becoming a question the resident cannot answer. Precision where
  // the boundary is, compactness everywhere else.
  let split = 0, blocks = 0, wideDropped = 0;
  const streets = {};
  for (const [k, list] of byKey) {
    const onBlock = new Map();
    for (const [lo, hi, w] of list) {
      for (let b = Math.floor(lo / 100); b <= Math.floor(hi / 100); b++) {
        if (!onBlock.has(b)) onBlock.set(b, []);
        onBlock.get(b).push([Math.max(lo, b * 100), Math.min(hi, b * 100 + 99), w]);
      }
    }
    const out = [];
    for (const b of [...onBlock.keys()].sort((x, y) => x - y)) {
      let parts = onBlock.get(b);
      blocks++;
      // A handful of records (141 citywide) carry an address range covering a whole
      // block face or half of one. Where real parcels sit on the same face, such a
      // record is a placeholder whose range and location disagree: one claiming
      // 2600-2699 N Ashland sits in ward 47, which is Lincoln Square, while every
      // individual parcel on that face is ward 32, which is where 2600 N Ashland
      // actually is. Left in, one bad record decides the whole face.
      const narrow = parts.filter((p) => p[1] - p[0] < 50);
      if (narrow.length && narrow.length < parts.length) { wideDropped += parts.length - narrow.length; parts = narrow; }
      const wards = [...new Set(parts.map((p) => p[2]))];
      if (wards.length === 1) { out.push(b, wards[0]); continue; }
      split++;
      // Narrowest first, so a lookup takes the most specific range that covers the
      // number rather than whichever happens to come first.
      parts.sort((x, y) => (x[1] - x[0]) - (y[1] - y[0]) || x[0] - y[0]);
      const seen = [];
      for (const [lo, hi, w] of parts) {
        if (!seen.some((q) => q[0] === lo && q[1] === hi && q[2] === w)) seen.push([lo, hi, w]);
      }
      out.push(b, seen.flat());
    }
    streets[k] = out;
  }

  const doc = {
    built: new Date().toISOString().slice(0, 10),
    source: 'City of Chicago ArcGIS: ExternalApps/operational/MapServer/1 (Parcel '
      + 'Addresses) for the points, ExternalApps/Wards/MapServer/0 (2023 wards, '
      + 'unsimplified) for the boundaries. Both EPSG:3435.',
    note: 'Each street is a flat [block, ward, block, ward, ...] list where block '
      + 'is floor(houseNumber/100) and ward is a number, or, where a ward boundary '
      + 'cuts that block face, a flat [low, high, ward, ...] list of its parcel '
      + 'ranges so a number on it resolves exactly. Every ward '
      + 'came from a point-in-polygon test on a parcel centroid, never from the '
      + 'street name or the block number. A block absent from a street is not a '
      + 'Chicago address on that street.',
    streets,
  };
  fs.writeFileSync(OUT, JSON.stringify(doc));
  console.error(`\nplaced ${stat.placed} of ${rows.length} parcels`);
  console.error(`  outside every ward polygon: ${stat.outside}`);
  console.error(`  no coordinate: ${stat.noCoord}   no usable address: ${stat.noAddr}`);
  console.error(`  address range wider than a block face, so unplaceable: ${stat.impossible}`);
  console.error(`streets ${Object.keys(streets).length}  block faces ${blocks}`
    + `  of which a boundary cuts ${split}`);
  console.error(`dropped ${wideDropped} whole-face placeholder ranges that real parcels contradict`);
  console.error(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}

main(await loadParcels(), await loadWards());
