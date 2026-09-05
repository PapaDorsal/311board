// The requests nobody came for: individual 311 tickets on public infrastructure
// that have been open more than a year, with an address and a case number.
//
// WHY THIS EXISTS. The rest of the site deals in aggregates, and an aggregate
// persuades an analyst. "Ward 42 leaves 60% of its sidewalk requests unfinished"
// is true and checkable and lands on nobody in particular. "3018 W 87TH ST,
// street light out, reported May 2023, still open" is the same fact with an
// address on it, and it is the version a person recognises as their own street.
//
// WHY IT KEEPS A HISTORY. A snapshot says a ticket is old. It cannot say the
// city has been asked and asked. So every refresh records which tickets it saw
// still open, and the count of those observations accumulates in
// data/stuck-history.json - after a year the page can say a request has sat
// through twelve monthly checks, which is a claim only something that kept
// watching can make. It also catches the payoff: a ticket that disappears from
// the stuck list has been closed, and the archive knows how long it took.
//
// THE PUBLIC-WAY RULE, WHICH IS NOT NEGOTIABLE. Only request types about
// infrastructure the city owns are eligible. A pothole, a street light, a
// sidewalk, tree debris in the parkway - the complaint is against the city, and
// naming the address names a place. Sanitation Code Violation and Building
// Violation are complaints against a private owner at their own home; publishing
// "this house has an open complaint against it" is a different act with a
// different target, and this site does not do it. Adding a type here means
// checking it against that line first.
//
// SELECTION IS A RULE, NOT AN EDITOR. Oldest first, every time. The site's
// standing is that anyone can re-run the query and get the same list; "ones we
// found interesting" would invite the question of what was left out.
//
// Usage: node tools/build-stuck.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE = 'https://data.cityofchicago.org/resource/v6vf-nfxy.json';
const HISTORY = 'data/stuck-history.json';
const OUT = 'data/stuck.json';

// Infrastructure the city owns. See the public-way rule above before adding.
const PUBLIC_WAY = [
  { official: 'Sidewalk Inspection Request', plain: 'Sidewalk repair' },
  { official: 'Street Light Out Complaint', plain: 'Street light out' },
  { official: 'Pothole in Street Complaint', plain: 'Pothole' },
  { official: 'Abandoned Vehicle Complaint', plain: 'Abandoned vehicle' },
  { official: 'Tree Debris Clean-Up Request', plain: 'Tree debris' },
  { official: 'Fly Dumping Complaint', plain: 'Illegal dumping' },
  { official: 'Alley Light Out Complaint', plain: 'Alley light out' },
  { official: 'Street Light Pole Damage Complaint', plain: 'Damaged light pole' },
  { official: 'Protected Bike Lane - Debris Removal', plain: 'Bike lane debris' },
  { official: 'Sign Repair Request - Stop Sign', plain: 'Stop sign repair' },
];
const PLAIN = Object.fromEntries(PUBLIC_WAY.map((t) => [t.official, t.plain]));

const STUCK_DAYS = 365;      // open longer than this to qualify
const WARD_MAP_FROM = '2023-05-01';   // the current ward boundaries
const PER_WARD = 6;          // how many to show on a ward page
const CITYWIDE = 30;         // how many on the citywide page
const CLOSED_KEEP_DAYS = 400; // prune resolved tickets from the archive after this

const esc = (s) => s.replace(/'/g, "''");
const day = (d) => d.toISOString().slice(0, 10);

async function q(params, label) {
  const url = BASE + '?' + new URLSearchParams(params);
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (r.ok) return r.json();
      if (r.status < 500 && r.status !== 429) throw new Error(`HTTP ${r.status} [${label}]`);
    } catch (e) {
      if (String(e.message).startsWith('HTTP ')) throw e;
      console.error(`.. [${label}] ${e.name} attempt ${attempt}/5`);
    }
    await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** (attempt - 1), 30000)));
  }
  throw new Error(`gave up [${label}]`);
}
async function qAll(params, label, page = 25000) {
  const out = [];
  for (let off = 0; ; off += page) {
    const pg = await q({ ...params, $order: ':id', $limit: String(page), $offset: String(off) }, `${label}#${off}`);
    out.push(...pg);
    if (pg.length < page) break;
  }
  return out;
}

const now = new Date();
const TODAY = day(now);
const cutoff = day(new Date(now.getTime() - STUCK_DAYS * 86400000));
const typeClause = PUBLIC_WAY.map((t) => `sr_type='${esc(t.official)}'`).join(' OR ');

// Everything on a city-owned asset that has been open longer than a year.
const rows = await qAll({
  $select: 'sr_number, sr_type, status, created_date, street_address, ward, latitude, longitude, owner_department',
  $where: `(${typeClause}) AND status like 'Open%' AND ward IS NOT NULL` +
    ` AND created_date < '${cutoff}T00:00:00' AND created_date > '${WARD_MAP_FROM}T00:00:00'` +
    ` AND (duplicate IS NULL OR duplicate = false)`,
}, 'stuck');
console.log(`open over ${STUCK_DAYS} days on city-owned assets: ${rows.length}`);

// ---- the archive ----
// { sr: { f: first seen still open, l: last seen still open, c: observations,
//         d: closed on (once it goes), w: days it took } }
const history = existsSync(HISTORY) ? JSON.parse(readFileSync(HISTORY, 'utf8')) : { started: TODAY, tickets: {} };
const H = history.tickets;
const seenNow = new Set();

for (const r of rows) {
  const id = r.sr_number;
  if (!id) continue;
  seenNow.add(id);
  const h = H[id];
  if (h) {
    // One observation per calendar day, so re-running a build by hand does not
    // inflate the count into a claim the site cannot back.
    if (h.l !== TODAY) { h.c = (h.c || 1) + 1; h.l = TODAY; }
    delete h.d; delete h.w;   // it is open again; drop any stale resolution
  } else {
    H[id] = { f: TODAY, l: TODAY, c: 1 };
  }
}

// Anything the archive was watching that is no longer in the stuck set has
// either been closed or has aged out. Ask the records which, in batches, so a
// resolved ticket can be reported as resolved rather than quietly vanishing.
const gone = Object.keys(H).filter((id) => !seenNow.has(id) && !H[id].d);
let resolved = 0;
for (let i = 0; i < gone.length; i += 150) {
  const batch = gone.slice(i, i + 150);
  const list = batch.map((id) => `'${esc(id)}'`).join(',');
  const found = await q({
    $select: 'sr_number, status, created_date, closed_date, sr_type, street_address, ward',
    $where: `sr_number in (${list})`, $limit: '200',
  }, `resolve#${i}`);
  for (const r of found) {
    const h = H[r.sr_number];
    if (!h) continue;
    if (/^completed/i.test(String(r.status || '')) && r.closed_date) {
      h.d = r.closed_date.slice(0, 10);
      h.w = Math.round((Date.parse(r.closed_date) - Date.parse(r.created_date)) / 86400000);
      h.t = PLAIN[r.sr_type] || r.sr_type;
      h.a = r.street_address || null;
      h.wd = Number(r.ward) || null;
      resolved++;
    } else {
      // Cancelled, or otherwise no longer open without being completed. Recorded
      // as gone rather than as finished work: the difference matters.
      h.d = TODAY; h.w = null; h.t = PLAIN[r.sr_type] || r.sr_type;
      h.a = r.street_address || null; h.wd = Number(r.ward) || null;
    }
  }
}
console.log(`no longer stuck: ${gone.length} (${resolved} completed since we started watching)`);

// Keep the archive bounded: a ticket resolved long ago has told its story.
const pruneBefore = day(new Date(now.getTime() - CLOSED_KEEP_DAYS * 86400000));
let pruned = 0;
for (const [id, h] of Object.entries(H)) if (h.d && h.d < pruneBefore) { delete H[id]; pruned++; }

history.tickets = H;
history.lastRun = TODAY;
writeFileSync(HISTORY, JSON.stringify(history) + '\n');

// ---- what the site reads ----
const ticket = (r) => {
  const h = H[r.sr_number] || {};
  const created = r.created_date.slice(0, 10);
  const lat = Number(r.latitude), lon = Number(r.longitude);
  return {
    sr: r.sr_number,
    type: PLAIN[r.sr_type] || r.sr_type,
    address: r.street_address || null,
    ward: Number(r.ward),
    created,
    days: Math.round((now - Date.parse(r.created_date)) / 86400000),
    dept: r.owner_department || null,
    // Observations, not months: the site says what it actually counted.
    checks: h.c || 1,
    watchedSince: h.f || TODAY,
    // Coordinates, not a built URL: the page turns these into a plain Street
    // View link, which needs no API key and no billing. A link, never an embed -
    // an embed would load Google on every ward page and hand them the visitor.
    ll: Number.isFinite(lat) && Number.isFinite(lon) ? [Number(lat.toFixed(6)), Number(lon.toFixed(6))] : null,
  };
};

const oldestFirst = (a, b) => Date.parse(a.created_date) - Date.parse(b.created_date);
const sorted = rows.slice().sort(oldestFirst);

const byWard = {};
for (let w = 1; w <= 50; w++) {
  const mine = sorted.filter((r) => Number(r.ward) === w);
  byWard[w] = { total: mine.length, tickets: mine.slice(0, PER_WARD).map(ticket) };
}

// The payoff: things that were stuck when we started watching and are not now.
const closed = Object.entries(H)
  .filter(([, h]) => h.d && h.w !== null && h.w !== undefined)
  .sort((a, b) => (b[1].d < a[1].d ? -1 : 1))
  .slice(0, 20)
  .map(([sr, h]) => ({ sr, type: h.t, address: h.a, ward: h.wd, closedOn: h.d, days: h.w, checks: h.c || 1 }));

const byType = {};
for (const r of rows) { const k = PLAIN[r.sr_type] || r.sr_type; byType[k] = (byType[k] || 0) + 1; }

const out = {
  generatedAt: now.toISOString(),
  watchingSince: history.started,
  rule: `Requests on city-owned infrastructure still open more than ${STUCK_DAYS} days, oldest first. Complaints about private property are never listed.`,
  stuckDays: STUCK_DAYS,
  types: PUBLIC_WAY.map((t) => t.plain),
  citywide: { total: rows.length, byType, oldest: sorted.slice(0, CITYWIDE).map(ticket) },
  closed,
  wards: byWard,
};
writeFileSync(OUT, JSON.stringify(out) + '\n');

const withWard = Object.values(byWard).filter((w) => w.total > 0).length;
console.log(`archive: ${Object.keys(H).length} tickets tracked, ${pruned} pruned, watching since ${history.started}`);
console.log(`${rows.length} stuck across ${withWard} wards, ${closed.length} resolved on record -> ${OUT}`);
