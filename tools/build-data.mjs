// Build-time data snapshot for chiwardboard.
// Fetches the year's rows for each profiled request type live from Socrata and
// writes data/leaderboard.json. Every number the page shows comes from this run.
// Rows the city flags as duplicates are excluded from every timed figure.
// Usage: node tools/build-data.mjs
const BASE = 'https://data.cityofchicago.org/resource/v6vf-nfxy.json';
// Rolling 12 months ending at the most recent COMPLETE month, so the board never
// mixes a part-filled month into a median. The city's own published median dataset
// (u6fz-87ei) uses the same rolling-12-month shape.
const WINDOW_FROM = process.env.WINDOW_FROM || '2025-08-01';
const WINDOW_TO   = process.env.WINDOW_TO   || '2026-08-01';   // exclusive
const YEAR = Number(WINDOW_FROM.slice(0, 4));
const Y = `created_date >= '${WINDOW_FROM}T00:00:00' AND created_date < '${WINDOW_TO}T00:00:00'`;
const MIN_WARD_N = 200;      // headline endpoints only from wards at/above this

// The suite. Featured first. plain = how the page says it; official = the record's term.
const TYPES = [
  { key: 'abandoned-vehicle', official: 'Abandoned Vehicle Complaint', plain: 'abandoned vehicles' },
  { key: 'pothole', official: 'Pothole in Street Complaint', plain: 'potholes' },
  { key: 'rodent', official: 'Rodent Baiting/Rat Complaint', plain: 'rat complaints' },
  { key: 'graffiti', official: 'Graffiti Removal Request', plain: 'graffiti' },
  { key: 'garbage-cart', official: 'Garbage Cart Maintenance', plain: 'garbage carts' },
  { key: 'street-light', official: 'Street Light Out Complaint', plain: 'street lights out' },
  { key: 'tree-debris', official: 'Tree Debris Clean-Up Request', plain: 'tree debris' },
  { key: 'sanitation', official: 'Sanitation Code Violation', plain: 'sanitation violations' },
  { key: 'fly-dumping', official: 'Fly Dumping Complaint', plain: 'fly dumping' },
  { key: 'missed-pickup', official: 'Missed Garbage Pick-Up Complaint', plain: 'missed pickups' },
];

const T0 = Date.now();
let calls = 0, retries = 0, timeouts = 0;
const REQ_TIMEOUT_MS = 90000, MAX_ATTEMPTS = 5;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const esc = (s) => s.replace(/'/g, "''");

async function q(params, label) {
  const url = BASE + '?' + new URLSearchParams(params).toString();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    calls++;
    if (attempt > 1) retries++;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(REQ_TIMEOUT_MS) });
      if (res.ok) return res.json();
      if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status} [${label}]`);
      console.error(`.. [${label}] HTTP ${res.status} attempt ${attempt}/${MAX_ATTEMPTS}`);
    } catch (e) {
      if (e.message?.startsWith('HTTP ')) throw e;
      if (/timeout|abort/i.test(String(e?.name) + String(e?.message))) timeouts++;
      console.error(`.. [${label}] ${e?.cause?.code || e?.name} attempt ${attempt}/${MAX_ATTEMPTS}`);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(Math.min(2000 * 2 ** (attempt - 1), 30000));
  }
  throw new Error(`exhausted ${MAX_ATTEMPTS} attempts [${label}]`);
}

// Paging MUST carry an explicit order. Socrata does not guarantee a stable row
// order across $offset pages without one, and on a bad draw it returns the same
// rows twice while silently skipping others: an observed run duplicated 4,468 of
// 40,819 tree-debris rows, which moved per-ward counts and medians. Ordering by
// the row id makes the page boundary deterministic. The duplicate check below is
// belt and braces - if the invariant ever breaks again it should fail loudly
// rather than quietly publish wrong numbers.
async function fetchAll(params, label, pageSize = 25000) {
  const rows = [];
  const seen = new Set();
  for (let off = 0; ; off += pageSize) {
    const page = await q({ ...params, $order: ':id', $limit: String(pageSize), $offset: String(off) }, `${label}#${off}`);
    for (const r of page) {
      if (r[':id'] !== undefined) {
        if (seen.has(r[':id'])) throw new Error(`paging returned a duplicate row [${label}] - refusing to publish`);
        seen.add(r[':id']);
      }
      rows.push(r);
    }
    if (page.length < pageSize) break;
  }
  return rows;
}

function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
const r2 = (x) => Math.round(x * 100) / 100;

async function profile({ key, official, plain }) {
  const totals = await q({
    $select: 'count(1) as total, sum(case(closed_date IS NOT NULL, 1, true, 0)) as closed, ' +
      'sum(case(duplicate = true, 1, true, 0)) as dupes',
    $where: `${Y} AND sr_type='${esc(official)}'`,
  }, `${key}:totals`);
  const statuses = await q({
    $select: 'status, count(1) as c', $where: `${Y} AND sr_type='${esc(official)}'`,
    $group: 'status', $order: 'count(1) DESC', $limit: '20',
  }, `${key}:statuses`);

  const rows = await fetchAll({
    $select: ':id, ward, created_date, closed_date, status, duplicate',
    $where: `${Y} AND sr_type='${esc(official)}'`,
  }, `${key}:rows`);
  // The extract is only as current as the newest row in it. Open requests are
  // censored at that moment, not at wall-clock now.
  const asOfRow = await q({ $select: 'max(last_modified_date) as t' }, `${key}:asof`);
  const AS_OF = Date.parse(asOfRow[0].t);

  const byWard = new Map();
  const all = [];
  let dropNotCompleted = 0, dropNoWard = 0, dropBadDate = 0, dropNeg = 0, dupRows = 0, sameSecond = 0, timed = 0;
  let openRows = 0, canceledRows = 0;
  for (const r of rows) {
    // Duplicates are excluded from every figure. A duplicate report is the same
    // physical problem reported twice, so counting it twice both inflates volume
    // and re-times one repair as if it were two. The city excludes them in its
    // own Open311 tooling; including them made us the outlier.
    if (r.duplicate === true || r.duplicate === 'true') { dupRows++; continue; }
    const st = String(r.status || '');
    const done = /^completed/i.test(st);
    const c = Date.parse(r.created_date);
    if (!Number.isFinite(c)) { dropBadDate++; continue; }
    // An open request is not missing data, it is a request that has not finished
    // yet: we know its wait is AT LEAST this long. Dropping it was survivor bias -
    // the slowest cases were simply absent from the denominator. It is carried as
    // a censored observation instead. A cancelled request is censored the same way
    // at its close: the work did not happen, so its true wait is unknown.
    let days, event;
    if (done) {
      const d = Date.parse(r.closed_date);
      if (!Number.isFinite(d)) { dropBadDate++; continue; }
      if (d === c) sameSecond++;
      days = (d - c) / 86400000; event = true;
      if (days < 0) { dropNeg++; continue; }
    } else if (/^open/i.test(st)) {
      days = (AS_OF - c) / 86400000; event = false; openRows++;
      if (days < 0) { dropNeg++; continue; }
    } else if (/^cancel/i.test(st)) {
      const d = Date.parse(r.closed_date);
      if (!Number.isFinite(d)) { dropNotCompleted++; continue; }
      days = (d - c) / 86400000; event = false; canceledRows++;
      if (days < 0) { dropNeg++; continue; }
    } else { dropNotCompleted++; continue; }
    const w = Number(r.ward);
    if (!Number.isFinite(w) || w === 0) { dropNoWard++; continue; }
    if (event) timed++;
    all.push([days, event]);
    if (!byWard.has(w)) byWard.set(w, []);
    byWard.get(w).push([days, event]);
  }

  // Kaplan-Meier: the share still waiting after t days, given that some requests
  // are still waiting when the data was pulled. The quantile is the first day the
  // curve crosses (1 - p). With no censoring this reduces to the plain quantile,
  // so the fast types read exactly as they did before.
  function kmQuantile(obs, p) {
    const s = obs.slice().sort((a, b) => a[0] - b[0] || (a[1] ? 1 : 0) - (b[1] ? 1 : 0));
    let atRisk = s.length, surv = 1, i = 0;
    while (i < s.length) {
      const t = s[i][0];
      let events = 0, tied = 0;
      while (i + tied < s.length && s[i + tied][0] === t) { if (s[i + tied][1]) events++; tied++; }
      if (events > 0) {
        surv *= (1 - events / atRisk);
        if (surv <= 1 - p) return t;
      }
      atRisk -= tied; i += tied;
    }
    return null;   // the curve never gets there: more than (1-p) never closed
  }

  const wards = [...byWard.entries()].map(([w, arr]) => {
    const closed = arr.filter((o) => o[1]).length;
    const p50 = kmQuantile(arr, 0.5), p75 = kmQuantile(arr, 0.75), p90 = kmQuantile(arr, 0.9);
    return {
      ward: w, n: closed, nAll: arr.length,
      openShare: r2(100 * (arr.length - closed) / arr.length),
      p50: p50 === null ? null : r2(p50), p75: p75 === null ? null : r2(p75), p90: p90 === null ? null : r2(p90),
      // A ward whose curve never reaches the median cannot be ranked on it.
      thin: closed < MIN_WARD_N || p50 === null,
    };
  }).sort((a, b) => (a.p50 === null) - (b.p50 === null) || a.p50 - b.p50);

  const sortedAll = all;
  const eligible = wards.filter(w => !w.thin);
  const f = eligible[0], sl = eligible[eligible.length - 1];
  const headline = eligible.length >= 2 ? {
    fastest: { ward: f.ward, p50: f.p50, n: f.n },
    slowest: { ward: sl.ward, p50: sl.p50, n: sl.n },
    gapDays: r2(sl.p50 - f.p50),
  } : null;

  console.log(`${key}: rows=${rows.length} timed=${timed} wards=${wards.length} eligible=${eligible.length}` +
    (headline ? ` gap=${headline.gapDays}d (${f.ward}@${f.p50} .. ${sl.ward}@${sl.p50})` : ''));

  return {
    key, official, plain,
    totals: {
      requests: Number(totals[0].total),
      withClosedDate: Number(totals[0].closed),
      duplicates: Number(totals[0].dupes),
      statuses: Object.fromEntries(statuses.map(s => [s.status, Number(s.c)])),
    },
    exclusions: { duplicates: dupRows, notCompleted: dropNotCompleted, nullOrZeroWard: dropNoWard, unparseableDates: dropBadDate, negativeDurations: dropNeg },
    diagnostics: { sameSecondCloses: sameSecond, duplicateFlagged: dupRows, rowsTimed: timed,
                   stillOpen: openRows, canceled: canceledRows, censored: openRows + canceledRows },
    citywide: { p50: r2(kmQuantile(sortedAll, 0.5)), p75: r2(kmQuantile(sortedAll, 0.75)), p90: r2(kmQuantile(sortedAll, 0.9)) },
    headline, wards,
  };
}

const types = [];
for (const t of TYPES) types.push(await profile(t));

// Who runs each ward - the city's Ward Offices dataset. "Last, First" -> "First Last".
const OFFICES = 'https://data.cityofchicago.org/resource/htai-wnw4.json';
const offRes = await fetch(`${OFFICES}?$limit=60`, { signal: AbortSignal.timeout(60000) });
const offices = offRes.ok ? await offRes.json() : [];
const aldermen = Object.fromEntries(offices.map((o) => {
  const name = String(o.alderman || '').split(',').map((x) => x.trim()).reverse().join(' ').trim();
  const line2 = [o.city, o.state].filter(Boolean).join(', ') + (o.zipcode ? ' ' + o.zipcode : '');
  const chLine2 = [o.city_hall_city, o.city_hall_state].filter(Boolean).join(', ') + (o.city_hall_zipcode ? ' ' + o.city_hall_zipcode : '');
  return [Number(o.ward), {
    name,
    email: o.email || null,
    website: o.website?.url || null,
    phone: o.ward_phone || null,
    address: o.address ? { line1: o.address, line2: line2.trim() || null } : null,
    cityHall: o.city_hall_address ? { line1: o.city_hall_address, line2: chLine2.trim() || null, phone: o.city_hall_phone || null } : null,
  }];
}));
console.log(`ward offices: ${Object.keys(aldermen).length}`);

const out = {
  generatedAt: new Date(T0).toISOString(),
  source: { dataset: 'v6vf-nfxy', api: BASE, portal: 'https://data.cityofchicago.org/Service-Requests/311-Service-Requests/v6vf-nfxy' },
  year: YEAR,
  window: { from: WINDOW_FROM, to: WINDOW_TO,
            label: new Date(WINDOW_FROM + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
              + ' to ' + new Date(new Date(WINDOW_TO + 'T00:00:00Z').getTime() - 86400000).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) },
  minWardN: MIN_WARD_N,
  featured: 'abandoned-vehicle',
  aldermen,
  types,
  run: { httpAttempts: calls, retries, timeouts, wallSeconds: r2((Date.now() - T0) / 1000) },
};

const fs = await import('node:fs/promises');
await fs.writeFile(new URL('../data/leaderboard.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`types=${types.length} attempts=${calls} retries=${retries} wall=${out.run.wallSeconds}s -> data/leaderboard.json`);
