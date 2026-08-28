// Build-time data snapshot for the 311board front page.
// Fetches 2025 Abandoned Vehicle Complaint rows live from Socrata and writes
// data/leaderboard.json. Every number the page shows comes from this run.
// Usage: node tools/build-data.mjs
const BASE = 'https://data.cityofchicago.org/resource/v6vf-nfxy.json';
const TYPE = 'Abandoned Vehicle Complaint';
const YEAR = 2025;
const Y = `created_date >= '${YEAR}-01-01T00:00:00' AND created_date < '${YEAR + 1}-01-01T00:00:00'`;
const MIN_WARD_N = 200;      // headline endpoints only from wards at/above this
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

async function fetchAll(params, label, pageSize = 25000) {
  const rows = [];
  for (let off = 0; ; off += pageSize) {
    const page = await q({ ...params, $limit: String(pageSize), $offset: String(off) }, `${label}#${off}`);
    rows.push(...page);
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

// Totals and status breakdown for the methodology block.
const totals = await q({
  $select: 'count(1) as total, sum(case(closed_date IS NOT NULL, 1, true, 0)) as closed',
  $where: `${Y} AND sr_type='${esc(TYPE)}'`,
}, 'totals');
const statuses = await q({
  $select: 'status, count(1) as c', $where: `${Y} AND sr_type='${esc(TYPE)}'`,
  $group: 'status', $order: 'count(1) DESC', $limit: '20',
}, 'statuses');

const rows = await fetchAll({
  $select: 'ward, created_date, closed_date, status, duplicate',
  $where: `${Y} AND sr_type='${esc(TYPE)}' AND closed_date IS NOT NULL`,
}, 'rows');

const byWard = new Map();
let dropNotCompleted = 0, dropNoWard = 0, dropBadDate = 0, dropNeg = 0, dupRows = 0, sameSecond = 0, timed = 0;
for (const r of rows) {
  if (!/^completed/i.test(String(r.status || ''))) { dropNotCompleted++; continue; }
  const c = Date.parse(r.created_date), d = Date.parse(r.closed_date);
  if (!Number.isFinite(c) || !Number.isFinite(d)) { dropBadDate++; continue; }
  if (d === c) sameSecond++;
  const days = (d - c) / 86400000;
  if (days < 0) { dropNeg++; continue; }
  if (r.duplicate === true || r.duplicate === 'true') dupRows++;
  const w = Number(r.ward);
  if (!Number.isFinite(w) || w === 0) { dropNoWard++; continue; }
  timed++;
  if (!byWard.has(w)) byWard.set(w, []);
  byWard.get(w).push(days);
}

const wards = [...byWard.entries()].map(([w, arr]) => {
  const s = arr.slice().sort((a, b) => a - b);
  return {
    ward: w, n: s.length,
    p50: r2(quantile(s, 0.5)), p75: r2(quantile(s, 0.75)), p90: r2(quantile(s, 0.9)),
    thin: s.length < MIN_WARD_N,
  };
}).sort((a, b) => a.p50 - b.p50);

const eligible = wards.filter(w => !w.thin);
if (eligible.length < 2) throw new Error('fewer than 2 eligible wards; refusing to write a headline');
const fastest = eligible[0], slowest = eligible[eligible.length - 1];

const out = {
  generatedAt: new Date(T0).toISOString(),
  source: { dataset: 'v6vf-nfxy', api: BASE, portal: 'https://data.cityofchicago.org/Service-Requests/311-Service-Requests/v6vf-nfxy' },
  type: { official: TYPE, plain: 'abandoned vehicles' },
  year: YEAR,
  minWardN: MIN_WARD_N,
  totals: {
    requests: Number(totals[0].total),
    withClosedDate: Number(totals[0].closed),
    statuses: Object.fromEntries(statuses.map(s => [s.status, Number(s.c)])),
  },
  exclusions: {
    notCompleted: dropNotCompleted, nullOrZeroWard: dropNoWard,
    unparseableDates: dropBadDate, negativeDurations: dropNeg,
  },
  diagnostics: { sameSecondCloses: sameSecond, duplicateFlagged: dupRows, rowsTimed: timed },
  headline: {
    fastest: { ward: fastest.ward, p50: fastest.p50, n: fastest.n },
    slowest: { ward: slowest.ward, p50: slowest.p50, n: slowest.n },
    gapDays: r2(slowest.p50 - fastest.p50),
  },
  wards,
  run: { httpAttempts: calls, retries, timeouts, wallSeconds: r2((Date.now() - T0) / 1000) },
};

const fs = await import('node:fs/promises');
await fs.mkdir(new URL('../data/', import.meta.url), { recursive: true });
await fs.writeFile(new URL('../data/leaderboard.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`wards=${wards.length} eligible=${eligible.length} fastest=${fastest.ward}@${fastest.p50}d slowest=${slowest.ward}@${slowest.p50}d gap=${out.headline.gapDays}d`);
console.log(`attempts=${calls} retries=${retries} wall=${out.run.wallSeconds}s -> data/leaderboard.json`);
