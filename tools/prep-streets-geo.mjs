// Major arterial streets for the ward map.
//
// SOURCE: City of Chicago "Major Streets", resource ueqs-5wr6
//   https://data.cityofchicago.org/d/ueqs-5wr6
//   downloaded as a shapefile from
//   https://data.cityofchicago.org/download/ueqs-5wr6/application/zip
//
// The current "Street Center Lines" view (6imu-meau) cannot be used: its SODA
// endpoint returns null geometry with empty properties, and its GeoJSON export
// returns a truncated FeatureCollection. The Major Streets shapefile is the
// usable source, so it is parsed here directly - no map service, no tile layer,
// no API key, and nothing a visitor's browser ever contacts.
//
// The file is NAD83 / State Plane Illinois East (FIPS 1201), US survey feet, so
// coordinates are inverse-projected to WGS84 before being written.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ZIP = '/tmp/major-streets.zip', DIR = '/tmp/major-streets';
const URL_ = 'https://data.cityofchicago.org/download/ueqs-5wr6/application/zip';

// The streets Chicagoans actually navigate by. Kept deliberately short: enough
// to orient, few enough that the ward numbers stay the loudest thing on the map.
const WANTED = new Map([
  ['WESTERN',    { label: 'Western',    grid: '2400 W' }],
  ['ASHLAND',    { label: 'Ashland',    grid: '1600 W' }],
  ['HALSTED',    { label: 'Halsted',    grid: '800 W'  }],
  ['CICERO',     { label: 'Cicero',     grid: '4800 W' }],
  ['PULASKI',    { label: 'Pulaski',    grid: '4000 W' }],
  ['KEDZIE',     { label: 'Kedzie',     grid: '3200 W' }],
  ['MADISON',    { label: 'Madison',    grid: '0 N/S'  }],
  ['NORTH',      { label: 'North',      grid: '1600 N' }],
  ['BELMONT',    { label: 'Belmont',    grid: '3200 N' }],
  ['IRVING PARK',{ label: 'Irving Park',grid: '4000 N' }],
  ['DEVON',      { label: 'Devon',      grid: '6400 N' }],
  ['ROOSEVELT',  { label: 'Roosevelt',  grid: '1200 S' }],
  ['CERMAK',     { label: 'Cermak',     grid: '2200 S' }],
  ['47TH',       { label: '47th',       grid: '4700 S' }],
  ['63RD',       { label: '63rd',       grid: '6300 S' }],
  ['79TH',       { label: '79th',       grid: '7900 S' }],
  ['95TH',       { label: '95th',       grid: '9500 S' }],
]);

if (!existsSync(`${DIR}/Major_Streets.shp`)) {
  execSync(`curl -sSL --retry 3 --max-time 240 -o ${ZIP} "${URL_}"`, { stdio: 'inherit' });
  execSync(`rm -rf ${DIR} && mkdir -p ${DIR} && cd ${DIR} && unzip -oq ${ZIP}`, { stdio: 'inherit' });
}

// ---- inverse Transverse Mercator, GRS80, per the shapefile's own .prj ----
const FT = 0.3048006096012192, a = 6378137.0, f = 1 / 298.257222101;
const e2 = f * (2 - f), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
const k0 = 0.999975, lon0 = -88.33333333333333 * Math.PI / 180, lat0 = 36.66666666666666 * Math.PI / 180, FE = 984250.0;
function M(phi) {
  return a * ((1 - e2/4 - 3*e2*e2/64 - 5*e2**3/256) * phi
    - (3*e2/8 + 3*e2*e2/32 + 45*e2**3/1024) * Math.sin(2*phi)
    + (15*e2*e2/256 + 45*e2**3/1024) * Math.sin(4*phi)
    - (35*e2**3/3072) * Math.sin(6*phi));
}
function toWGS84(xFt, yFt) {
  const x = (xFt - FE) * FT, y = yFt * FT;
  const Mv = M(lat0) + y / k0;
  const mu = Mv / (a * (1 - e2/4 - 3*e2*e2/64 - 5*e2**3/256));
  const phi1 = mu + (3*e1/2 - 27*e1**3/32) * Math.sin(2*mu)
    + (21*e1*e1/16 - 55*e1**4/32) * Math.sin(4*mu)
    + (151*e1**3/96) * Math.sin(6*mu) + (1097*e1**4/512) * Math.sin(8*mu);
  const s = Math.sin(phi1), c = Math.cos(phi1), t = Math.tan(phi1);
  const ep2 = e2 / (1 - e2), C1 = ep2 * c * c, T1 = t * t;
  const N1 = a / Math.sqrt(1 - e2 * s * s), R1 = a * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5);
  const D = x / (N1 * k0);
  const lat = phi1 - (N1 * t / R1) * (D*D/2 - (5 + 3*T1 + 10*C1 - 4*C1*C1 - 9*ep2) * D**4/24
    + (61 + 90*T1 + 298*C1 + 45*T1*T1 - 252*ep2 - 3*C1*C1) * D**6/720);
  const lon = lon0 + (D - (1 + 2*T1 + C1) * D**3/6
    + (5 - 2*C1 + 28*T1 - 3*C1*C1 + 8*ep2 + 24*T1*T1) * D**5/120) / c;
  return [lon * 180 / Math.PI, lat * 180 / Math.PI];
}

// ---- dbf ----
const dbf = readFileSync(`${DIR}/Major_Streets.dbf`);
const nrec = dbf.readUInt32LE(4), hlen = dbf.readUInt16LE(8), rlen = dbf.readUInt16LE(10);
const fields = []; let off = 32;
while (dbf[off] !== 0x0d) {
  fields.push({ name: dbf.toString('latin1', off, off + 11).replace(/\0.*$/, ''), len: dbf[off + 16] });
  off += 32;
}
const rows = [];
for (let i = 0; i < nrec; i++) {
  let p = hlen + i * rlen + 1, o = {};
  for (const fl of fields) { o[fl.name] = dbf.toString('latin1', p, p + fl.len).trim(); p += fl.len; }
  rows.push(o);
}

// ---- shp polylines ----
const shp = readFileSync(`${DIR}/Major_Streets.shp`);
const parts = []; let p = 100, idx = 0;
while (p < shp.length) {
  const clen = shp.readInt32BE(p + 4) * 2, body = p + 8;
  if (shp.readInt32LE(body) === 3) {
    const nParts = shp.readInt32LE(body + 36), nPts = shp.readInt32LE(body + 40);
    const pStart = body + 44, ptStart = pStart + nParts * 4;
    const starts = []; for (let k = 0; k < nParts; k++) starts.push(shp.readInt32LE(pStart + k * 4));
    const lines = [];
    for (let k = 0; k < nParts; k++) {
      const s = starts[k], e = k + 1 < nParts ? starts[k + 1] : nPts, line = [];
      for (let j = s; j < e; j++) line.push(toWGS84(shp.readDoubleLE(ptStart + j * 16), shp.readDoubleLE(ptStart + j * 16 + 8)));
      if (line.length > 1) lines.push(line);
    }
    parts.push({ idx, lines });
  }
  p = body + clen; idx++;
}

// ---- keep only the wanted arterials, merge their segments ----
const r4 = (x) => Math.round(x * 1e4) / 1e4;

// Arterials are near-straight, so they simplify hard without visible loss.
const TOL = 0.0006;
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let maxD = 0, idx = 0;
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1e-12;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dx * (a[1] - pts[i][1]) - dy * (a[0] - pts[i][0])) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [a, b];
  return [...dp(pts.slice(0, idx + 1), tol).slice(0, -1), ...dp(pts.slice(idx), tol)];
}
// Stitch touching segments so a street is a few long lines, not hundreds of stubs.
function stitch(lines) {
  const key = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const pool = lines.map(l => l.slice()); const out = [];
  while (pool.length) {
    let cur = pool.pop(), grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const c = pool[i];
        if (key(cur[cur.length - 1]) === key(c[0])) { cur = cur.concat(c.slice(1)); pool.splice(i, 1); grew = true; break; }
        if (key(cur[0]) === key(c[c.length - 1])) { cur = c.concat(cur.slice(1)); pool.splice(i, 1); grew = true; break; }
        if (key(cur[cur.length - 1]) === key(c[c.length - 1])) { cur = cur.concat(c.slice().reverse().slice(1)); pool.splice(i, 1); grew = true; break; }
        if (key(cur[0]) === key(c[0])) { cur = c.slice().reverse().concat(cur.slice(1)); pool.splice(i, 1); grew = true; break; }
      }
    }
    out.push(cur);
  }
  return out;
}
const byStreet = new Map();
for (const s of parts) {
  const row = rows[s.idx]; if (!row) continue;
  const nm = (row.STREET_NAM || '').toUpperCase().trim();
  const w = WANTED.get(nm); if (!w) continue;
  if ((row.STATUS || '').toUpperCase() === 'UNBU') continue;      // unbuilt paper streets
  if (!byStreet.has(nm)) byStreet.set(nm, { ...w, lines: [] });
  for (const line of s.lines) byStreet.get(nm).lines.push(line.map(([x, y]) => [r4(x), r4(y)]));
}

const features = [...byStreet.entries()].map(([nm, v]) => {
  const merged = stitch(v.lines)
    .map(l => dp(l, TOL))
    .filter(l => l.length > 1)
    .sort((a, b) => Math.hypot(b[b.length-1][0]-b[0][0], b[b.length-1][1]-b[0][1])
                  - Math.hypot(a[a.length-1][0]-a[0][0], a[a.length-1][1]-a[0][1]))
    .slice(0, 4);                       // keep only the main runs
  return { type: 'Feature', properties: { name: v.label, grid: v.grid },
           geometry: { type: 'MultiLineString', coordinates: merged } };
}).sort((a, b) => a.properties.name.localeCompare(b.properties.name));

const out = JSON.stringify({ type: 'FeatureCollection',
  source: 'City of Chicago Major Streets (ueqs-5wr6), reprojected from State Plane Illinois East to WGS84',
  features });
writeFileSync(new URL('../data/streets.geojson', import.meta.url), out);
console.log(`${features.length} streets, ${(out.length/1024).toFixed(0)} KB -> data/streets.geojson`);
for (const f of features) console.log(`  ${f.properties.name.padEnd(12)} ${String(f.properties.grid).padEnd(8)} ${f.geometry.coordinates.length} segments`);
