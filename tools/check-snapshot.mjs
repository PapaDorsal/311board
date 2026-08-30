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

if (!Array.isArray(d.types) || d.types.length !== 10) fail.push(`expected 10 types, got ${d.types?.length}`);
if (!d.window?.from || !d.window?.to) fail.push('window missing');
if (!d.generatedAt) fail.push('generatedAt missing');
if (Object.keys(d.aldermen || {}).length < 50) fail.push(`expected 50 ward offices, got ${Object.keys(d.aldermen || {}).length}`);

for (const t of d.types || []) {
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
  if (!(t.citywide?.p50 >= 0)) fail.push(`${tag}: citywide p50 missing`);
  if (!(t.diagnostics?.rowsTimed > 0)) fail.push(`${tag}: nothing timed`);
}

// Volume should not lurch between refreshes. A rolling 12-month window loses a
// month and gains a month, so some movement is expected; an order of magnitude
// is a fetch that half-failed rather than a real change in the city.
if (prev) {
  const pm = new Map((prev.types || []).map((t) => [t.key, t]));
  for (const t of d.types || []) {
    const p = pm.get(t.key); if (!p) { warn.push(`${t.key}: new type, no baseline`); continue; }
    const a = t.diagnostics.rowsTimed, b = p.diagnostics.rowsTimed;
    if (b > 0 && (a < b * 0.5 || a > b * 2)) fail.push(`${t.key}: timed rows moved ${b} -> ${a}, more than a doubling or halving`);
  }
}

for (const w of warn) console.log(`warn: ${w}`);
if (fail.length) { for (const f of fail) console.error(`FAIL: ${f}`); process.exit(1); }
console.log(`ok: ${file} - ${d.types.length} types, ${d.window.label}, generated ${d.generatedAt.slice(0, 10)}`);
