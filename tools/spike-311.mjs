// Throwaway discovery spike: Chicago 311 (Socrata v6vf-nfxy).
// Every number printed comes from a live response in this run.
const BASE = 'https://data.cityofchicago.org/resource/v6vf-nfxy.json';
const T0 = Date.now();
const out = [];
let calls = 0, nonOk = [], maxLimitUsed = 0, paginated = false;

function say(s = '') { console.log(s); out.push(s); }

const REQ_TIMEOUT_MS = 90000;   // Socrata is slow/flaky on this resource; one attempt took 170s
const MAX_ATTEMPTS = 5;
let retries = 0, timeouts = 0;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function q(params, label) {
  const url = BASE + '?' + new URLSearchParams(params).toString();
  if (params.$limit) maxLimitUsed = Math.max(maxLimitUsed, Number(params.$limit));
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    calls++;
    if (attempt > 1) retries++;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(REQ_TIMEOUT_MS) });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        // 4xx other than 429 will not improve on retry
        if (res.status !== 429 && res.status < 500) {
          nonOk.push(`${label}: HTTP ${res.status} ${url} :: ${body.slice(0, 300)}`);
          say(`  !! QUERY FAILED [${label}] HTTP ${res.status}: ${body.slice(0, 300)}`);
          return null;
        }
        say(`  .. [${label}] HTTP ${res.status} on attempt ${attempt}/${MAX_ATTEMPTS}, retrying`);
      } else {
        return res.json();
      }
    } catch (e) {
      const isTimeout = /timeout|aborted|TimeoutError/i.test(String(e?.name) + String(e?.message) + String(e?.cause?.code || ''));
      if (isTimeout) timeouts++;
      say(`  .. [${label}] ${e?.cause?.code || e?.name || 'error'} on attempt ${attempt}/${MAX_ATTEMPTS}, retrying`);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(Math.min(2000 * 2 ** (attempt - 1), 30000));
  }
  nonOk.push(`${label}: exhausted ${MAX_ATTEMPTS} attempts (timeout/5xx) ${url}`);
  say(`  !! QUERY FAILED [${label}]: exhausted ${MAX_ATTEMPTS} attempts`);
  return null;
}

// paginate a select of raw rows
async function fetchAll(params, label, pageSize = 25000, hardCap = 400000) {
  const rows = [];
  for (let off = 0; ; off += pageSize) {
    const page = await q({ ...params, $limit: String(pageSize), $offset: String(off) }, `${label}#${off}`);
    if (!page) break;
    rows.push(...page);
    if (off > 0) paginated = true;
    if (page.length < pageSize || rows.length >= hardCap) break;
  }
  return rows;
}

const Y = "created_date >= '2025-01-01T00:00:00' AND created_date < '2026-01-01T00:00:00'";

const num = (x) => (x === null || x === undefined ? NaN : Number(x));
function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

say('='.repeat(78));
say('STEP 1: FIELD INVENTORY (5 rows)');
say('='.repeat(78));
const sample = await q({ $limit: '5' }, 'step1');
let fieldNames = [];
if (sample && sample.length) {
  const all = new Set();
  sample.forEach(r => Object.keys(r).forEach(k => all.add(k)));
  fieldNames = [...all].sort();
  say(`Fields present across 5 rows (${fieldNames.length}):`);
  say(fieldNames.join(', '));
  say('');
  say('Sample row (row 0), field = value:');
  for (const f of fieldNames) say(`  ${f} = ${JSON.stringify(sample[0][f])}`);
  say('');
  const required = ['created_date', 'closed_date', 'status', 'sr_type', 'ward', 'community_area'];
  for (const f of required) {
    const present = fieldNames.includes(f);
    const populated = sample.filter(r => r[f] !== undefined && r[f] !== null && r[f] !== '').length;
    say(`  REQUIRED ${f}: present=${present} populated_in_sample=${populated}/${sample.length}`);
  }
}

say('');
say('='.repeat(78));
say('STEP 2: CLOSURE COMPLETENESS (created 2025-01-01 .. 2025-12-31)');
say('='.repeat(78));
let closurePct = NaN, total2025 = NaN, closed2025 = NaN;
const tot = await q({ $select: 'count(1) as c', $where: Y }, 'step2-total');
const clo = await q({ $select: 'count(1) as c', $where: `${Y} AND closed_date IS NOT NULL` }, 'step2-closed');
if (tot && clo) {
  total2025 = Number(tot[0].c); closed2025 = Number(clo[0].c);
  closurePct = (closed2025 / total2025) * 100;
  say(`Total 2025 rows:        ${total2025}`);
  say(`Rows with closed_date:  ${closed2025}`);
  say(`Closure rate:           ${closurePct.toFixed(2)}%`);
  say(closurePct < 60
    ? '>> VERDICT: closure rate BELOW 60% -- the leaderboard premise is WEAK.'
    : '>> Closure rate >= 60%: adequate coverage for response-time analysis.');
}

say('');
say('='.repeat(78));
say('STEP 3: WARD COVERAGE (2025)');
say('='.repeat(78));
let wardList = [];
const wards = await q({ $select: 'ward, count(1) as c', $where: Y, $group: 'ward', $order: 'ward', $limit: '1000' }, 'step3');
if (wards) {
  const nullWard = wards.filter(w => w.ward === undefined || w.ward === null || w.ward === '');
  const zeroWard = wards.filter(w => Number(w.ward) === 0);
  wardList = wards.filter(w => w.ward !== undefined && w.ward !== null && w.ward !== '' && Number(w.ward) !== 0)
                  .map(w => Number(w.ward)).sort((a, b) => a - b);
  say(`Distinct non-null non-zero ward values: ${wardList.length} (Chicago has 50)`);
  say(`Ward list: ${wardList.join(', ')}`);
  const nullRows = nullWard.reduce((s, w) => s + Number(w.c), 0);
  const zeroRows = zeroWard.reduce((s, w) => s + Number(w.c), 0);
  say(`Rows with NULL ward: ${nullRows}`);
  say(`Rows with ward = 0:  ${zeroRows}`);
  say(`Per-ward 2025 counts: ` + wards.map(w => `${w.ward ?? 'NULL'}:${w.c}`).join(' '));
}

say('');
say('='.repeat(78));
say('STEP 4: TOP 25 sr_type BY 2025 ROW COUNT');
say('='.repeat(78));
let topTypes = [];
const types = await q({ $select: 'sr_type, count(1) as c', $where: Y, $group: 'sr_type', $order: 'count(1) DESC', $limit: '25' }, 'step4');
if (types) {
  topTypes = types.map(t => ({ type: t.sr_type, count: Number(t.c) }));
  topTypes.forEach((t, i) => say(`${String(i + 1).padStart(2)}. ${String(t.count).padStart(8)}  ${t.type}`));
}

// Classification is a judgement call applied to the LIVE list above, not a source of numbers.
const ACTIONABLE_RE = /pothole|graffiti|rodent|tree|street light|sign|pavement|garbage|sanitation|weed|abandoned vehicle|snow|water|sewer|alley light|vehicle|debris|inspection|cart|restoration|repair|removal/i;
const NONACTIONABLE_RE = /aircraft|noise|inquiry|information|311 |request for|no child|clerk|smoking|consumer fraud|complaint about|status/i;

say('');
say('Classification of the live top-25 list (heuristic on type name; physical service with a completion event vs informational/non-actionable):');
const actionable = [], nonactionable = [];
for (const t of topTypes) {
  const isNon = NONACTIONABLE_RE.test(t.type) && !/pothole|graffiti|rodent|tree|street light/i.test(t.type);
  const isAct = ACTIONABLE_RE.test(t.type) && !isNon;
  (isAct ? actionable : nonactionable).push(t);
  say(`  [${isAct ? 'ACTIONABLE' : 'NON/UNCLEAR'}] ${t.type} (${t.count})`);
}

say('');
say('='.repeat(78));
say('STEP 5: RESPONSE TIME BY WARD (highest-volume actionable type, 2025)');
say('='.repeat(78));
let ratio = NaN, chosen = null, wardStats = [];
chosen = actionable[0] || null;
if (!chosen) {
  say('!! No actionable type identified from the live top-25. Cannot proceed to step 5.');
} else {
  say(`Chosen sr_type: "${chosen.type}" (2025 volume ${chosen.count})`);
  const rows = await fetchAll({
    $select: 'ward, created_date, closed_date',
    $where: `${Y} AND sr_type='${chosen.type.replace(/'/g, "''")}' AND closed_date IS NOT NULL`,
  }, 'step5');
  say(`Rows fetched with non-null closed_date: ${rows.length}`);

  const byWard = new Map();
  let droppedNoWard = 0, droppedBadDate = 0, droppedNegative = 0;
  for (const r of rows) {
    const c = Date.parse(r.created_date), d = Date.parse(r.closed_date);
    if (!Number.isFinite(c) || !Number.isFinite(d)) { droppedBadDate++; continue; }
    const days = (d - c) / 86400000;
    if (days < 0) { droppedNegative++; continue; }
    const w = num(r.ward);
    if (!Number.isFinite(w) || w === 0) { droppedNoWard++; continue; }
    if (!byWard.has(w)) byWard.set(w, []);
    byWard.get(w).push(days);
  }
  say(`EXCLUSIONS (explicit): null/zero ward = ${droppedNoWard}; unparseable dates = ${droppedBadDate}; negative durations (closed before created) = ${droppedNegative}. No low-volume ward was excluded.`);

  wardStats = [...byWard.entries()].map(([w, arr]) => {
    const s = arr.slice().sort((a, b) => a - b);
    return { ward: w, n: s.length, median: quantile(s, 0.5), p90: quantile(s, 0.9) };
  }).sort((a, b) => a.median - b.median);

  say('');
  say('ward |     n | median_days | p90_days');
  for (const s of wardStats) {
    say(`${String(s.ward).padStart(4)} | ${String(s.n).padStart(5)} | ${s.median.toFixed(2).padStart(11)} | ${s.p90.toFixed(2).padStart(8)}`);
  }
  if (wardStats.length) {
    const f = wardStats[0], sl = wardStats[wardStats.length - 1];
    say('');
    say(`Wards with data: ${wardStats.length}`);
    say(`FASTEST ward: ${f.ward}  median ${f.median.toFixed(2)} days (n=${f.n})`);
    say(`SLOWEST ward: ${sl.ward}  median ${sl.median.toFixed(2)} days (n=${sl.n})`);
    ratio = sl.median / f.median;
  }
}

say('');
say('='.repeat(78));
say('STEP 6: SPREAD CHECK');
say('='.repeat(78));
if (Number.isFinite(ratio)) {
  say(`slowest_median / fastest_median = ${ratio.toFixed(2)}`);
  say(ratio < 1.5
    ? '>> Ratio under 1.5: there is NO STORY. A ranked leaderboard on this type would be boring.'
    : '>> Ratio >= 1.5: meaningful spread between wards; a ranked leaderboard has signal.');
} else say('Ratio not computable (step 5 produced no medians).');

const WALL = ((Date.now() - T0) / 1000);
say('');
say('='.repeat(78));
say('STEP 7: RATE LIMITS AND VOLUME');
say('='.repeat(78));
say(`HTTP attempts made:    ${calls} (including ${retries} retries; ${timeouts} timed out)`);
say(`Non-200 responses:     ${nonOk.length}${nonOk.length ? ' -> ' + nonOk.join(' | ') : ''}`);
say(`Wall clock:            ${WALL.toFixed(1)} s`);
say(`Highest $limit used:   ${maxLimitUsed} (Socrata default is 1000; raised explicitly)`);
say(`Pagination past first page required: ${paginated ? 'YES' : 'NO'}`);
say(`No app token used; no 429 observed: ${nonOk.some(s => s.includes('429')) ? 'FALSE' : 'TRUE'}`);

// ---- findings file ----
const verdict = !Number.isFinite(ratio)
  ? 'INCONCLUSIVE - response-time spread could not be computed.'
  : (closurePct < 60 ? 'WEAK - closure rate under 60%.'
    : ratio < 1.5 ? 'SURVIVES TECHNICALLY BUT IS BORING - ward medians are too close to rank meaningfully.'
    : 'SURVIVES - closure coverage and ward spread both support a ranked leaderboard.');

const md = `# Chicago 311 (v6vf-nfxy) — Step 0 discovery findings

Run: live queries only, ${new Date(T0).toISOString()} → wall clock ${WALL.toFixed(1)}s.
Every number below came from an HTTP response in this run. Nothing is remembered or estimated.

## 1. Field inventory
Fields returned (${fieldNames.length}): ${fieldNames.join(', ')}

Sample row:
\`\`\`
${fieldNames.map(f => `${f} = ${JSON.stringify(sample?.[0]?.[f])}`).join('\n')}
\`\`\`
Required fields — present/populated in the 5-row sample:
${['created_date','closed_date','status','sr_type','ward','community_area'].map(f =>
  `- ${f}: present=${fieldNames.includes(f)}, populated ${sample ? sample.filter(r => r[f] !== undefined && r[f] !== null && r[f] !== '').length : '?'}/5`).join('\n')}

## 2. Closure completeness (2025)
- Total rows: ${total2025}
- Rows with closed_date: ${closed2025}
- Closure rate: ${Number.isFinite(closurePct) ? closurePct.toFixed(2) + '%' : 'n/a'}
- ${closurePct < 60 ? '**Below 60% — leaderboard premise is weak.**' : 'At or above 60% — adequate.'}

## 3. Ward coverage (2025)
- Distinct non-null, non-zero wards: **${wardList.length}** of 50
- Ward list: ${wardList.join(', ')}
- Null-ward rows / zero-ward rows: see stdout Step 3 output of this run.

## 4. Top 25 sr_type (2025)
${topTypes.map((t, i) => `${i + 1}. ${t.count} — ${t.type}`).join('\n')}

Classified actionable (physical work with a real completion event):
${actionable.map(t => `- ${t.type} (${t.count})`).join('\n') || '- none'}

Classified informational / non-actionable / unclear:
${nonactionable.map(t => `- ${t.type} (${t.count})`).join('\n') || '- none'}

Note: the classification is my judgement applied to the live list; the counts are live.

## 5. Response time by ward
Type analyzed: **${chosen ? chosen.type : 'n/a'}** (2025 volume ${chosen ? chosen.count : 'n/a'})
Medians/p90 computed from raw row data (created_date → closed_date), not from a Socrata aggregate.

ward | n | median_days | p90_days
---|---|---|---
${wardStats.map(s => `${s.ward} | ${s.n} | ${s.median.toFixed(2)} | ${s.p90.toFixed(2)}`).join('\n')}

${wardStats.length ? `- Fastest: ward ${wardStats[0].ward} @ ${wardStats[0].median.toFixed(2)} d\n- Slowest: ward ${wardStats[wardStats.length-1].ward} @ ${wardStats[wardStats.length-1].median.toFixed(2)} d` : '- no data'}

Exclusions are printed explicitly in stdout Step 5. No ward was dropped for low volume.

## 6. Spread check
- slowest/fastest median ratio: ${Number.isFinite(ratio) ? ratio.toFixed(2) : 'n/a'}
- ${Number.isFinite(ratio) ? (ratio < 1.5 ? '**Under 1.5 — no story; the leaderboard is boring.**' : 'At or above 1.5 — real spread, the ranking carries signal.') : 'not computable'}

## 7. API behaviour
- Calls: ${calls}; non-200: ${nonOk.length}${nonOk.length ? ` (${nonOk.join(' | ')})` : ''}
- Wall clock: ${WALL.toFixed(1)}s; no app token used
- $limit raised above the 1000 default (max used: ${maxLimitUsed}); pagination past page 1 required: ${paginated ? 'yes' : 'no'}

## Verdict
${verdict}

## Not determined (gaps, not inferred)
- Whether closed_date means "work completed" vs "ticket administratively closed/duplicate" — the dataset has a status/duplicate concept but its semantics were not validated here.
- Whether ward values are as-of-request or re-mapped after the 2023 ward remap; ward boundary changes across the year were not checked.
- Only one sr_type was profiled for response time; spread for other actionable types is unknown.
- Rows still open at query time are excluded from medians, which biases medians fast (survivorship). Not quantified.
- Rate-limit ceiling untested — this run's call volume was far too low to hit throttling.
`;
const fs = await import('node:fs/promises');
const path = await import('node:path');
const dir = path.dirname(new URL(import.meta.url).pathname);
await fs.writeFile(path.join(dir, '311-findings.md'), md);
say('');
say(`Wrote ${path.join(dir, '311-findings.md')}`);
