// Follow-up spike: profile additional actionable sr_types and diagnose why
// graffiti days-to-close collapses under 1 day citywide.
// Usage: node tools/spike-311b.mjs ["Type A"] ["Type B"] ...
const BASE = 'https://data.cityofchicago.org/resource/v6vf-nfxy.json';
const T0 = Date.now();
const out = [];
let calls = 0, retries = 0, timeouts = 0, nonOk = [];
const REQ_TIMEOUT_MS = 90000, MAX_ATTEMPTS = 5;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function say(s = '') { console.log(s); out.push(s); }

async function q(params, label) {
  const url = BASE + '?' + new URLSearchParams(params).toString();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    calls++;
    if (attempt > 1) retries++;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(REQ_TIMEOUT_MS) });
      if (res.ok) return res.json();
      const body = await res.text().catch(() => '');
      if (res.status !== 429 && res.status < 500) {
        nonOk.push(`${label}: HTTP ${res.status} :: ${body.slice(0, 200)}`);
        say(`  !! FAILED [${label}] HTTP ${res.status}: ${body.slice(0, 200)}`);
        return null;
      }
      say(`  .. [${label}] HTTP ${res.status} attempt ${attempt}/${MAX_ATTEMPTS}`);
    } catch (e) {
      if (/timeout|abort/i.test(String(e?.name) + String(e?.message))) timeouts++;
      say(`  .. [${label}] ${e?.cause?.code || e?.name} attempt ${attempt}/${MAX_ATTEMPTS}`);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(Math.min(2000 * 2 ** (attempt - 1), 30000));
  }
  nonOk.push(`${label}: exhausted attempts`);
  say(`  !! FAILED [${label}]: exhausted ${MAX_ATTEMPTS} attempts`);
  return null;
}

async function fetchAll(params, label, pageSize = 25000, hardCap = 400000) {
  const rows = [];
  for (let off = 0; ; off += pageSize) {
    const page = await q({ ...params, $limit: String(pageSize), $offset: String(off) }, `${label}#${off}`);
    if (!page) break;
    rows.push(...page);
    if (page.length < pageSize || rows.length >= hardCap) break;
  }
  return rows;
}

const Y = "created_date >= '2025-01-01T00:00:00' AND created_date < '2026-01-01T00:00:00'";
const esc = (s) => s.replace(/'/g, "''");
function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// Types to profile. Default = the two actionable types ranked just below
// Graffiti Removal Request in the step-0 run.
const TYPES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['Abandoned Vehicle Complaint', 'Garbage Cart Maintenance'];

// Headline thresholds. A ward median near zero makes a ratio meaningless, and a
// ward with few rows makes any percentile unstable — both matter most at the
// leaderboard's endpoints, which is exactly where readers look.
const MIN_DENOM_DAYS = 0.05;   // ~72 min; below this a median ratio divides by ~0
const MIN_WARD_N = 200;        // endpoints are drawn only from wards at/above this
const isCompleted = (st) => /^completed/i.test(String(st || ''));

const summary = [];

for (const type of TYPES) {
  say('');
  say('='.repeat(78));
  say(`TYPE: ${type}`);
  say('='.repeat(78));

  // How many 2025 rows, and how many are closed / duplicates?
  const counts = await q({
    $select: 'count(1) as total, sum(case(closed_date IS NOT NULL, 1, true, 0)) as closed, sum(case(duplicate = true, 1, true, 0)) as dupes',
    $where: `${Y} AND sr_type='${esc(type)}'`,
  }, `${type}:counts`);
  if (counts) {
    const c = counts[0];
    say(`2025 rows: ${c.total} | with closed_date: ${c.closed} | flagged duplicate: ${c.dupes}`);
  }

  // Status breakdown — tells us whether "closed" means completed vs cancelled.
  const statuses = await q({
    $select: 'status, count(1) as c', $where: `${Y} AND sr_type='${esc(type)}'`,
    $group: 'status', $order: 'count(1) DESC', $limit: '20',
  }, `${type}:status`);
  if (statuses) say('status breakdown: ' + statuses.map(s => `${s.status}=${s.c}`).join('  '));

  const rows = await fetchAll({
    $select: 'ward, created_date, closed_date, status, duplicate',
    $where: `${Y} AND sr_type='${esc(type)}' AND closed_date IS NOT NULL`,
  }, `${type}:rows`);
  say(`rows fetched: ${rows.length}`);
  if (!rows.length) { summary.push({ type, note: 'no rows' }); continue; }

  const byWard = new Map();
  const all = [];
  let dropNoWard = 0, dropBadDate = 0, dropNeg = 0, dropNotCompleted = 0;
  let sameSecond = 0, midnightCreated = 0, dupRows = 0, timedRows = 0;
  const droppedStatuses = new Map();
  for (const r of rows) {
    // A cancelled request is not a completed service call; its closed_date measures
    // an administrative close, not work done. Timing stats use completions only.
    if (!isCompleted(r.status)) {
      dropNotCompleted++;
      droppedStatuses.set(r.status, (droppedStatuses.get(r.status) || 0) + 1);
      continue;
    }
    timedRows++;
    if (r.duplicate === true || r.duplicate === 'true') dupRows++;
    if (/T00:00:00/.test(r.created_date || '')) midnightCreated++;
    const c = Date.parse(r.created_date), d = Date.parse(r.closed_date);
    if (!Number.isFinite(c) || !Number.isFinite(d)) { dropBadDate++; continue; }
    if (d === c) sameSecond++;
    const days = (d - c) / 86400000;
    if (days < 0) { dropNeg++; continue; }
    all.push(days);
    const w = Number(r.ward);
    if (!Number.isFinite(w) || w === 0) { dropNoWard++; continue; }
    if (!byWard.has(w)) byWard.set(w, []);
    byWard.get(w).push(days);
  }
  say(`EXCLUSIONS: not-completed status=${dropNotCompleted}${droppedStatuses.size ? ' (' + [...droppedStatuses].map(([k, v]) => `${k}=${v}`).join(', ') + ')' : ''}; null/zero ward=${dropNoWard}; unparseable dates=${dropBadDate}; negative durations=${dropNeg}.`);
  say(`Rows used for timing: ${timedRows} of ${rows.length} fetched. No ward excluded from the table for low volume.`);

  // DIAGNOSTIC A: is closed_date a real completion timestamp, or an artifact?
  say('');
  say('-- timestamp sanity (completed rows only) --');
  say(`closed_date identical to created_date (same second): ${sameSecond} (${(100 * sameSecond / timedRows).toFixed(2)}%)`);
  say(`created_date at exactly T00:00:00 (date-only granularity): ${midnightCreated} (${(100 * midnightCreated / timedRows).toFixed(2)}%)`);
  say(`rows flagged duplicate: ${dupRows} (${(100 * dupRows / timedRows).toFixed(2)}%)`);

  // DIAGNOSTIC B: the whole distribution, not just median/p90.
  const sortedAll = all.slice().sort((a, b) => a - b);
  const buckets = [
    ['< 1 hour', x => x < 1 / 24],
    ['1h - 1 day', x => x >= 1 / 24 && x < 1],
    ['1 - 3 days', x => x >= 1 && x < 3],
    ['3 - 7 days', x => x >= 3 && x < 7],
    ['7 - 30 days', x => x >= 7 && x < 30],
    ['30+ days', x => x >= 30],
  ];
  say('');
  say('-- distribution of days-to-close (citywide) --');
  for (const [label, fn] of buckets) {
    const n = all.filter(fn).length;
    say(`  ${label.padEnd(12)} ${String(n).padStart(7)}  ${(100 * n / all.length).toFixed(1).padStart(5)}%`);
  }
  say(`  percentiles: p10=${quantile(sortedAll, 0.1).toFixed(3)} p25=${quantile(sortedAll, 0.25).toFixed(3)} p50=${quantile(sortedAll, 0.5).toFixed(3)} p75=${quantile(sortedAll, 0.75).toFixed(3)} p90=${quantile(sortedAll, 0.9).toFixed(3)} p99=${quantile(sortedAll, 0.99).toFixed(3)} max=${sortedAll[sortedAll.length - 1].toFixed(2)}`);

  // Per-ward stats
  const stats = [...byWard.entries()].map(([w, arr]) => {
    const s = arr.slice().sort((a, b) => a - b);
    return { ward: w, n: s.length, p50: quantile(s, 0.5), p75: quantile(s, 0.75), p90: quantile(s, 0.9) };
  }).sort((a, b) => a.p50 - b.p50);

  say('');
  say(`ward |     n |     p50 |     p75 |     p90   ("!" = n < ${MIN_WARD_N}, percentiles unstable)`);
  for (const s of stats) {
    say(`${String(s.ward).padStart(4)} | ${String(s.n).padStart(5)} | ${s.p50.toFixed(3).padStart(7)} | ${s.p75.toFixed(3).padStart(7)} | ${s.p90.toFixed(3).padStart(7)} ${s.n < MIN_WARD_N ? '!' : ''}`);
  }

  // DIAGNOSTIC C: spread reported in ways a near-zero median cannot distort.
  // Endpoints come from wards with enough rows to support a percentile. The full
  // table above still shows every ward; nothing is hidden, only the headline is guarded.
  const eligible = stats.filter(s => s.n >= MIN_WARD_N);
  const thin = stats.length - eligible.length;
  const pool = eligible.length >= 2 ? eligible : stats;
  const f = pool[0], sl = pool[pool.length - 1];
  const medRatio = f.p50 >= MIN_DENOM_DAYS ? sl.p50 / f.p50 : NaN;
  const absGap = sl.p50 - f.p50;
  const p90EndpointRatio = sl.p90 / f.p90;
  say('');
  if (eligible.length >= 2) {
    say(`Endpoints drawn from the ${eligible.length} wards with n >= ${MIN_WARD_N}; ${thin} thinner ward(s) shown in the table but not used as headline fastest/slowest.`);
  } else {
    say(`WARNING: fewer than 2 wards reach n >= ${MIN_WARD_N}; endpoints fall back to all wards and are unstable.`);
  }
  say(`fastest ward ${f.ward}: p50=${f.p50.toFixed(3)}  p90=${f.p90.toFixed(3)} (n=${f.n})`);
  say(`slowest ward ${sl.ward}: p50=${sl.p50.toFixed(3)}  p90=${sl.p90.toFixed(3)} (n=${sl.n})`);
  say(`median ratio (slowest/fastest p50): ${Number.isFinite(medRatio)
    ? medRatio.toFixed(2)
    : `not meaningful — fastest p50 ${f.p50.toFixed(3)} d is below the ${MIN_DENOM_DAYS} d floor, so this would divide by ~0`}`);
  say(`median ABSOLUTE gap: ${absGap.toFixed(3)} days (${(absGap * 24).toFixed(1)} hours)  <-- the honest headline number`);
  const p90s = eligible.length >= 2 ? eligible.map(s => s.p90).sort((a, b) => a - b) : stats.map(s => s.p90).sort((a, b) => a - b);
  const p90RangeRatio = p90s[p90s.length - 1] / p90s[0];
  say(`p90 ENDPOINT ratio (slowest-ward p90 / fastest-ward p90, both by median): ${p90EndpointRatio.toFixed(2)}`);
  say(`p90 RANGE  ratio (max p90 / min p90 across wards): ${p90s[0].toFixed(2)} to ${p90s[p90s.length - 1].toFixed(2)} days = ${p90RangeRatio.toFixed(2)}`);
  say('');
  say(absGap < 1
    ? '>> The entire ward spread is under 24 hours. A "days to close" leaderboard on this type is not a real story regardless of ratio.'
    : `>> Ward spread is ${absGap.toFixed(1)} days end to end — large enough for a reader to care about.`);

  summary.push({ type, n: all.length, p50Fast: f.p50, p50Slow: sl.p50, absGap, p90EndpointRatio, p90RangeRatio, thin, sameSecondPct: 100 * sameSecond / timedRows });
}

say('');
say('='.repeat(78));
say('CROSS-TYPE SUMMARY');
say('='.repeat(78));
say('type | completed rows | fastest p50 | slowest p50 | abs gap (days) | p90 endpoint ratio | p90 range ratio | same-second closes');
for (const s of summary) {
  if (s.note) { say(`${s.type} — ${s.note}`); continue; }
  say(`${s.type} | ${s.n} | ${s.p50Fast.toFixed(3)} | ${s.p50Slow.toFixed(3)} | ${s.absGap.toFixed(3)} | ${s.p90EndpointRatio.toFixed(2)} | ${s.p90RangeRatio.toFixed(2)} | ${s.sameSecondPct.toFixed(1)}%`);
}
say('');
say(`HTTP attempts: ${calls} (retries ${retries}, timeouts ${timeouts}); non-200: ${nonOk.length}`);
say(`Wall clock: ${((Date.now() - T0) / 1000).toFixed(1)}s`);

const fs = await import('node:fs/promises');
await fs.writeFile(new URL('./311-findings-b.md', import.meta.url).pathname,
  `# Chicago 311 — follow-up spike (additional actionable types)\n\nRun ${new Date(T0).toISOString()}. Live queries only.\nTypes profiled: ${TYPES.join(', ')}\n\n\`\`\`\n${out.join('\n')}\n\`\`\`\n`);
say('');
say('Wrote tools/311-findings-b.md');
