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
// (street_number, street_direction, street_name, street_type) AND the ward the
// city's own geocoder assigned. Grouping those by hundred-block gives, for
// every block in the city, the ward it sits in - built from the same authority
// the rest of the board uses. A block is a far better unit than a house number:
// a block lies in one ward, and one 311 record anywhere on it places the whole
// block. Blocks are then run-length encoded per street, since a street runs
// through a ward for a long stretch before crossing into the next one.
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
//  - Block granularity. A block split between two wards by a boundary running
//    down its middle resolves to whichever ward holds more of its records.
//    Those blocks are counted and reported by this script.
//  - Coverage is limited to blocks that have at least one 311 record with a
//    ward. A block nobody has ever called about is not in the index.
//  - Boundary assignment is the city's own, inherited warts and all.
//  - House numbers with a letter suffix (7607S) are excluded from the build.
const BASE = 'https://data.cityofchicago.org/resource/v6vf-nfxy.json';
const OUT = 'data/address-index.json';
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
  'ward IS NOT NULL',
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
      `substring(street_number,1,length(street_number)-2) AS b, ward AS w, count(1) AS c ` +
      `WHERE ${WHERE} GROUP BY d,n,t,b,w ORDER BY d,n,t,b,w LIMIT ${PAGE} OFFSET ${off}`,
  });
  const page = await get(`${BASE}?${q}`, `blocks@${off}`);
  rows.push(...page);
  process.stdout.write(`\rfetched ${rows.length} block/ward groups`);
  if (page.length < PAGE) break;
}
console.log('');

// Collapse each block to the ward that holds most of its records, and note how
// often that was a real contest rather than a unanimous block.
const blocks = new Map();   // "D|NAME|T|B" -> Map(ward -> count)
let dropped = 0;
for (const r of rows) {
  const w = Number(r.w), c = Number(r.c);
  if (!Number.isFinite(w) || w < 1 || w > 50) { dropped++; continue; }
  const key = `${r.d || ''}|${r.n}|${r.t || ''}|${r.b}`;
  if (!blocks.has(key)) blocks.set(key, new Map());
  const m = blocks.get(key);
  m.set(w, (m.get(w) || 0) + c);
}

const streets = new Map();  // "D|NAME|T" -> [[blockStart, ward], ...]
let split = 0, thin = 0;
for (const [key, m] of blocks) {
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  if (total < MIN_BLOCK_N) { thin++; continue; }
  const ranked = [...m.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[1][1] / total >= 0.2) split++;
  const i = key.lastIndexOf('|');
  const st = key.slice(0, i), b = Number(key.slice(i + 1));
  if (!Number.isFinite(b)) continue;
  if (!streets.has(st)) streets.set(st, []);
  streets.get(st).push([b, ranked[0][0]]);
}

// Run-length encode: a street usually holds one ward for many blocks, so only
// the blocks where the ward actually changes need to be stored.
const out = {};
let breakpoints = 0;
for (const [st, list] of streets) {
  list.sort((a, b) => a[0] - b[0]);
  const runs = [];
  for (const [b, w] of list) {
    if (!runs.length || runs[runs.length - 1][1] !== w) { runs.push([b, w]); }
  }
  breakpoints += runs.length;
  out[st] = runs.flat();
}

const payload = {
  built: new Date().toISOString().slice(0, 10),
  source: 'https://data.cityofchicago.org/Service-Requests/311-Service-Requests/v6vf-nfxy',
  note: 'Hundred-block to ward, from the ward the city assigned to 311 records on that block.',
  streets: out,
};
const { writeFileSync } = await import('node:fs');
writeFileSync(OUT, JSON.stringify(payload));

const bytes = JSON.stringify(payload).length;
console.log(`streets: ${streets.size}`);
console.log(`blocks indexed: ${blocks.size - thin} (dropped ${thin} with fewer than ${MIN_BLOCK_N} records)`);
console.log(`blocks where a second ward held 20%+ of the records: ${split}`);
console.log(`rows with an out-of-range ward: ${dropped}`);
console.log(`run-length breakpoints stored: ${breakpoints} (from ${blocks.size} blocks)`);
console.log(`${OUT}: ${(bytes / 1024).toFixed(0)} KB`);
