// Gate for an unattended data refresh: nothing commits unless the snapshot
// still looks like a snapshot. The refresh runs with no human watching, so the
// failure this guards against is a quietly malformed file going live, not a
// crash - a crash is already loud.
// Usage: node tools/check-snapshot.mjs data/leaderboard.json [previous.json]
import { readFileSync } from 'node:fs';

const [file, prevFile] = process.argv.slice(2);
if (!file) { console.error('usage: check-snapshot.mjs <snapshot.json> [previous.json]'); process.exit(2); }
const d = JSON.parse(readFileSync(file, 'utf8'));
const prev = prevFile ? JSON.parse(readFileSync(prevFile, 'utf8')) : null;
const fail = [], warn = [];

// Ten speed types always; backlog types are extra and can legitimately be absent
// (a snapshot whose lookback would cross the May 2023 ward remap drops them).
const speedTypes = (d.types || []).filter((t) => t.metric !== 'backlog');
const backlogTypes = (d.types || []).filter((t) => t.metric === 'backlog');
if (speedTypes.length !== 10) fail.push(`expected 10 speed types, got ${speedTypes.length}`);
if (!d.window?.from || !d.window?.to) fail.push('window missing');
// The rolling build is the one that must move: pass EXPECT_WINDOW_TO (the first
// of the current month) and a snapshot that stopped rolling is refused rather
// than committed. The monthly refresh once rebuilt the same twelve months for
// a full cycle because the default window was a pair of literal dates.
if (process.env.EXPECT_WINDOW_TO && d.window?.to !== process.env.EXPECT_WINDOW_TO) {
  fail.push(`window ends ${d.window?.to}, expected ${process.env.EXPECT_WINDOW_TO} - the rolling window did not roll`);
}
if (!d.generatedAt) fail.push('generatedAt missing');
if (Object.keys(d.aldermen || {}).length < 50) fail.push(`expected 50 ward offices, got ${Object.keys(d.aldermen || {}).length}`);

for (const t of backlogTypes) {
  const tag = t.key || '(unkeyed)';
  if (!t.official || !t.plain) fail.push(`${tag}: missing official/plain`);
  if (!t.window?.from || !t.window?.to || !(t.window.maturityDays > 0)) fail.push(`${tag}: backlog window incomplete`);
  if (t.window?.from && t.window.from < '2023-05-01') fail.push(`${tag}: window starts ${t.window.from}, before the May 2023 ward map`);
  if (!(t.citywide?.pct >= 0 && t.citywide.pct <= 100)) fail.push(`${tag}: citywide pct out of range: ${t.citywide?.pct}`);
  if (!(t.totals?.mature > 0)) fail.push(`${tag}: nothing mature enough to judge`);
  const wards = t.wards || [];
  if (wards.length !== 50) fail.push(`${tag}: expected 50 wards, got ${wards.length}`);
  const seen = new Set();
  for (const w of wards) {
    if (seen.has(w.ward)) fail.push(`${tag}: ward ${w.ward} appears twice`);
    seen.add(w.ward);
    if (!(w.ward >= 1 && w.ward <= 50)) fail.push(`${tag}: ward out of range: ${w.ward}`);
    if (!(w.pct >= 0 && w.pct <= 100)) fail.push(`${tag}: ward ${w.ward} pct out of range: ${w.pct}`);
    if (!(w.mature >= 0) || !(w.open >= 0)) fail.push(`${tag}: ward ${w.ward} bad counts`);
    if (w.open > w.mature) fail.push(`${tag}: ward ${w.ward} has more open than judged`);
    if (w.mature >= t.minWardN && w.thin) fail.push(`${tag}: ward ${w.ward} has ${w.mature} but is flagged thin`);
  }
  const rankable = wards.filter((w) => !w.thin).length;
  if (rankable < 2) fail.push(`${tag}: only ${rankable} rankable wards, no headline possible`);
  // A backlog type earns its place by having a backlog. If the city starts
  // closing these, the honest move is to drop it, not to rank noise.
  if (t.citywide.pct < 5) warn.push(`${tag}: citywide backlog down to ${t.citywide.pct}% - is this still worth ranking as a backlog?`);
}

for (const t of speedTypes) {
  const tag = t.key || '(unkeyed)';
  if (!t.official || !t.plain) fail.push(`${tag}: missing official/plain`);
  const wards = t.wards || [];
  if (wards.length !== 50) fail.push(`${tag}: expected 50 wards, got ${wards.length}`);
  const seen = new Set();
  for (const w of wards) {
    if (seen.has(w.ward)) fail.push(`${tag}: ward ${w.ward} appears twice`);
    seen.add(w.ward);
    if (!(w.ward >= 1 && w.ward <= 50)) fail.push(`${tag}: ward out of range: ${w.ward}`);
    if (w.p50 === null && !w.thin) fail.push(`${tag}: ward ${w.ward} has no median but is ranked`);
    if (w.p50 !== null && !(w.p50 >= 0 && w.p50 < 3650)) fail.push(`${tag}: ward ${w.ward} p50 implausible: ${w.p50}`);
    if (w.p90 !== null && w.p50 !== null && w.p90 < w.p50) fail.push(`${tag}: ward ${w.ward} p90 below p50`);
    if (!(w.n >= 0)) fail.push(`${tag}: ward ${w.ward} bad n`);
  }
  const ranked = wards.filter((w) => !w.thin).length;
  if (ranked < 2) fail.push(`${tag}: only ${ranked} ranked wards, no headline possible`);
  if (t.headline && !(t.headline.gapDays >= 0)) fail.push(`${tag}: negative gap`);
  if (!(t.citywide?.p50 > 0)) fail.push(`${tag}: citywide p50 missing or zero`);
  if (!(t.diagnostics?.rowsTimed > 0)) fail.push(`${tag}: nothing timed`);
}

// Volume should not lurch between refreshes. A rolling 12-month window loses a
// month and gains a month, so some movement is expected; an order of magnitude
// is a fetch that half-failed rather than a real change in the city.
if (prev) {
  const pm = new Map((prev.types || []).map((t) => [t.key, t]));
  // Each metric is compared on its own volume field, and only against a baseline
  // of the same metric: a backlog type carries no diagnostics.rowsTimed, and
  // reading one off it threw rather than reporting anything useful.
  const volume = (t) => (t.metric === 'backlog' ? t.totals?.mature : t.diagnostics?.rowsTimed);
  for (const t of d.types || []) {
    const p = pm.get(t.key);
    if (!p) { warn.push(`${t.key}: new type, no baseline`); continue; }
    if ((p.metric || 'speed') !== (t.metric || 'speed')) { warn.push(`${t.key}: metric changed ${p.metric || 'speed'} -> ${t.metric || 'speed'}, skipping volume check`); continue; }
    const a = volume(t), b = volume(p);
    if (!(a > 0)) { fail.push(`${t.key}: nothing to measure`); continue; }
    if (b > 0 && (a < b * 0.5 || a > b * 2)) fail.push(`${t.key}: volume moved ${b} -> ${a}, more than a doubling or halving`);
  }
}

for (const w of warn) console.log(`warn: ${w}`);
if (fail.length) { for (const f of fail) console.error(`FAIL: ${f}`); process.exit(1); }
console.log(`ok: ${file} - ${d.types.length} types, ${d.window.label}, generated ${d.generatedAt.slice(0, 10)}`);
