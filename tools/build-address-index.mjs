// Address -> ward index for the chiwardboard finder.
//
// THE BUG THIS REPLACES: the finder used to match the typed text against the
// free-text `street_address` column with a prefix LIKE. That only works when
// the city happens to hold a 311 record at that exact house number, formatted
// exactly the way the visitor typed it. "5417 N MAGNOLIA AVE" returned nothing
// - not because the address is unknown, but because nobody had filed a request
// at 5417 specifically. Any typo failed for the same reason.
//
// METHOD: the 311 records carry the address already split into components
// (street_number, street_direction, street_name, street_type) AND a latitude and
// longitude. Grouping by hundred-block and taking the MEDIAN coordinate of the
// records on it gives a point on that block; resolving that point against the
// ward polygons the board already ships gives the ward. A block is a far better
// unit than a house number: one 311 record anywhere on it places the whole block.
// Blocks are then run-length encoded per street, since a street runs through a
// ward for a long stretch before crossing into the next one.
//
// WHY NOT THE WARD COLUMN: the obvious build reads the ward the city stamped on
// each record and takes the most common one per block. That was measured at 88.5%
// against the polygons on 400 real addresses - one lookup in ten landed in the
// wrong ward, all of them on boundary streets, because the stamped ward is noisy
// exactly where a boundary runs. The polygons are the authority the map and the
// location button already use, so the index is built from them too.
//
// WHY MEDIAN, AND WHY BY SIDE OF THE STREET: a median ignores the occasional
// record geocoded to an intersection or across town, which an average would not.
// Odd and even house numbers are indexed separately because a boundary often runs
// down the middle of a street, putting the two sides in different wards.
//
// WHY BUILD IT INSTEAD OF QUERYING LIVE: a shipped index means the visitor's
// address never leaves their browser. That is the same promise the GPS finder
// already makes, and it is now the promise for typed addresses too.
//
// WHY NOT A REAL GEOCODER: the city's Street Center Lines dataset (6imu-meau),
// which carries the address ranges a true interpolating geocoder needs, is
// broken on the portal - SODA returns empty objects and the Shapefile export
// returns HTTP 500. Both were retried in this build's development. Every other
// geocoder is a third-party host, which would mean shipping the visitor's
// address off to someone who is not the City of Chicago. Hundred-block
// resolution off the city's own assignments is the honest alternative.
//
// LIMITATIONS, stated because they matter:
//  - Block-side granularity. A boundary that cuts across a block rather than
//    running along it still resolves the whole side to one ward.
//  - Coverage is limited to block sides carrying at least MIN_BLOCK_N records
//    with coordinates. A block nobody has ever called about is not in the index.
//  - The polygons are the city's own 2023 ward map, inherited warts and all.
//  - House numbers with a letter suffix (7607S) are excluded from the build.
const BASE = 'https://data.cityofchicago.org/resource/v6vf-nfxy.json';
const OUT = 'data/address-index.json';
const WARDS = 'data/wards.geojson';
const MIN_BLOCK_N = 2;      // a block needs 2+ records before it is trusted
const DIGITS = ["'0'","'1'","'2'","'3'","'4'","'5'","'6'","'7'","'8'","'9'"].join(',');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, label) {
  for (let a = 1; a <= 5; a++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(120000) }); if (r.ok) return r.json(); }
    catch (e) {}
    if (a < 5) await sleep(Math.min(2000 * 2 ** (a - 1), 30000));
  }
  throw new Error('exhausted ' + label);
}

// street_number is a text column and holds junk like "7607S", so the block is
// taken with string ops and the last two characters are required to be digits.
// Casting to a number instead makes the whole query fail on the first bad row.
const WHERE = [
  'street_name IS NOT NULL',
  'latitude IS NOT NULL',
  'street_number IS NOT NULL',
  'length(street_number) BETWEEN 3 AND 5',
  `substring(street_number,length(street_number),1) IN (${DIGITS})`,
  `substring(street_number,length(street_number)-1,1) IN (${DIGITS})`,
].join(' AND ');

const PAGE = 50000;
const rows = [];
for (let off = 0; ; off += PAGE) {
  const q = new URLSearchParams({
    $query: `SELECT street_direction AS d, street_name AS n, street_type AS t, ` +
      `substring(street_number,1,length(street_number)-2) AS b, ` +
      `substring(street_number,length(street_number),1) IN ('1','3','5','7','9') AS odd, ` +
      `median(latitude) AS la, median(longitude) AS lo, count(1) AS c ` +
      `WHERE ${WHERE} GROUP BY d,n,t,b,odd ORDER BY d,n,t,b,odd LIMIT ${PAGE} OFFSET ${off}`,
  });
  const page = await get(`${BASE}?${q}`, `blocks@${off}`);
  rows.push(...page);
  process.stdout.write(`\rfetched ${rows.length} block/ward groups`);
  if (page.length < PAGE) break;
}
console.log('');

// Resolve each block's median point against the ward polygons - the same ray
// cast, over the same shipped file, that the location button uses.
const { readFileSync, writeFileSync } = await import('node:fs');
const GEO = JSON.parse(readFileSync(WARDS, 'utf8'));
function wardAt(lon, lat) {
  for (const f of GEO.features) {
    for (const poly of f.geometry.coordinates) {
      let inside = false; const o = poly[0];
      for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
        const [xi, yi] = o[i], [xj, yj] = o[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return Number(f.properties.ward);
    }
  }
  return null;
}

const streets = new Map();  // "D|NAME|T|PARITY" -> [[blockStart, ward], ...]
let thin = 0, outside = 0, kept = 0;
for (const r of rows) {
  if (Number(r.c) < MIN_BLOCK_N) { thin++; continue; }
  const b = Number(r.b), la = Number(r.la), lo = Number(r.lo);
  if (!Number.isFinite(b) || !Number.isFinite(la) || !Number.isFinite(lo)) { outside++; continue; }
  const w = wardAt(lo, la);
  if (!w) { outside++; continue; }   // median landed off the ward map entirely
  kept++;
  const p = (r.odd === true || r.odd === 'true') ? 'O' : 'E';
  const st = `${r.d || ''}|${r.n}|${r.t || ''}|${p}`;
  if (!streets.has(st)) streets.set(st, []);
  streets.get(st).push([b, w]);
}

// Run-length encode: a street usually holds one ward for many blocks, so only
// the blocks where the ward actually changes need to be stored.
const out = {};
let breakpoints = 0;
for (const [st, list] of streets) {
  list.sort((a, b) => a[0] - b[0]);
  const runs = [];
  for (const [b, w] of list) {
    if (!runs.length || runs[runs.length - 1][1] !== w) runs.push([b, w]);
  }
  breakpoints += runs.length;
  out[st] = runs.flat();
}

const payload = {
  built: new Date().toISOString().slice(0, 10),
  source: 'https://data.cityofchicago.org/Service-Requests/311-Service-Requests/v6vf-nfxy',
  note: 'Hundred-block and side of street to ward, by resolving the median coordinate of the 311 records on that block against the ward polygons.',
  streets: out,
};
writeFileSync(OUT, JSON.stringify(payload));

const bytes = JSON.stringify(payload).length;
console.log(`streets: ${streets.size}`);
console.log(`block sides indexed: ${kept}`);
console.log(`dropped, fewer than ${MIN_BLOCK_N} records: ${thin}`);
console.log(`dropped, median point outside every ward polygon: ${outside}`);
console.log(`run-length breakpoints stored: ${breakpoints} (from ${kept} block sides)`);
console.log(`${OUT}: ${(bytes / 1024).toFixed(0)} KB`);
