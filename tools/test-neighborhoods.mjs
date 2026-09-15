// Named checks for the neighborhood lookup in assets/neighborhoods.js.
//
// This is pure logic against the shipped data, same pattern as
// tools/test-address.mjs: no browser, so a wrong ward here fails fast.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../assets/address.js'); // defines the global ChiAddress neighborhoods.js reuses
const ChiNeighborhoods = require('../assets/neighborhoods.js');
const NB = require('../data/ward-neighborhoods.json').wards;

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}${extra ? '  ' + extra : ''}`); } };

console.log('neighborhood lookup');

const IX = ChiNeighborhoods.buildIndex(NB);

{
  const r = ChiNeighborhoods.lookup('Uptown', IX);
  check('a two-ward neighborhood is found', !!r);
  check('a two-ward neighborhood returns both wards', r && r.wards.length === 2, r && JSON.stringify(r.wards));
  check('the wards are 46 and 48', r && r.wards.map((w) => w.ward).sort().join(',') === '46,48', r && JSON.stringify(r.wards));
  check('busiest ward sorts first', r && r.wards[0].share >= r.wards[1].share, r && JSON.stringify(r.wards));
}

{
  const r = ChiNeighborhoods.lookup('Hyde Park', IX);
  check('a one-ward neighborhood is found', !!r);
  check('a one-ward neighborhood still returns an array', r && Array.isArray(r.wards) && r.wards.length === 1, r && JSON.stringify(r.wards));
  check('the one ward is 5', r && r.wards[0].ward === 5, r && JSON.stringify(r.wards));
}

{
  check('case does not matter', !!ChiNeighborhoods.lookup('uptown', IX));
  check('extra space does not matter', !!ChiNeighborhoods.lookup('  Uptown  ', IX));
  check('a name with an apostrophe matches', !!ChiNeighborhoods.lookup("o'hare", IX));
  check("O'Hare's own spelling matches too", !!ChiNeighborhoods.lookup("O'Hare", IX));
}

{
  // A colloquial name in the curated alias table resolves through it to the
  // official community area's own wards - no new ward assignment invented,
  // just a name translated before the same lookup runs.
  const r = ChiNeighborhoods.lookup('Pilsen', IX);
  check('an aliased colloquial name is found', !!r);
  check('the display name is the typed colloquial one, not the official one', r && r.name === 'Pilsen', r && r.name);
  check('Pilsen resolves to Ward 25, same as Lower West Side', r && r.wards.map((w) => w.ward).join(',') === '25', r && JSON.stringify(r.wards));
  check('Pilsen matches through the same alias case-insensitively', !!ChiNeighborhoods.lookup('pilsen', IX));
}

{
  // A colloquial name spanning more than one official area unions their
  // wards rather than picking one arbitrarily.
  const r = ChiNeighborhoods.lookup('Bronzeville', IX);
  check('a multi-target alias is found', !!r);
  const direct = [
    ...ChiNeighborhoods.lookup('Grand Boulevard', IX).wards,
    ...ChiNeighborhoods.lookup('Douglas', IX).wards,
  ];
  const expected = [...new Set(direct.map((w) => w.ward))].sort((a, b) => a - b);
  const got = r ? [...new Set(r.wards.map((w) => w.ward))].sort((a, b) => a - b) : [];
  check('Bronzeville is the union of Grand Boulevard and Douglas wards', JSON.stringify(got) === JSON.stringify(expected), `got ${got}, wanted ${expected}`);
}

{
  // Still a documented boundary, not a promise to guess: a real Chicago
  // micro-neighborhood left out of the curated table on purpose, so this
  // check fails loudly if ALIASES is ever grown by guessing instead of by
  // checking a real map.
  check('an unaliased colloquial name still finds nothing (Sauganash)', !ChiNeighborhoods.lookup('Sauganash', IX));
  check('gibberish finds nothing', !ChiNeighborhoods.lookup('Xyzzy Heights', IX));
  check('an address string finds nothing', !ChiNeighborhoods.lookup('1060 W Addison St', IX));
  check('an empty string finds nothing', !ChiNeighborhoods.lookup('', IX));
  check('a bare number finds nothing', !ChiNeighborhoods.lookup('46', IX));
}

{
  // Every alias target is spelled exactly as the source data spells it, and
  // resolves to at least one real ward - catches a typo in ALIASES itself
  // rather than letting one silently degrade to "finds nothing".
  const broken = [];
  Object.keys(ChiNeighborhoods.ALIASES).forEach((key) => {
    const alias = ChiNeighborhoods.ALIASES[key];
    const resolved = alias.targets.filter((t) => IX[ChiNeighborhoods.normalize(t)]);
    if (!resolved.length) broken.push(alias.display + ': none of ' + alias.targets.join(', ') + ' are in the source data');
  });
  check('every alias resolves to at least one real official name', broken.length === 0, broken.join(' | '));
}

{
  // Every name the map already shows a visitor resolves to at least one real
  // ward number, and every ward number is in range. If this ever fails, either
  // the source data changed shape or the index is dropping something silently.
  let names = 0, bad = [];
  Object.keys(IX).forEach((key) => {
    names++;
    const entry = IX[key];
    if (!entry.wards.length) bad.push(entry.name + ' (no wards)');
    entry.wards.forEach((w) => { if (w.ward < 1 || w.ward > 50) bad.push(entry.name + ' ward ' + w.ward); });
  });
  check('every indexed name has at least one in-range ward', bad.length === 0, bad.join(', '));
  check('the index is not suspiciously small', names >= 60, String(names));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
