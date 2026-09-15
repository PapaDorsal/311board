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
  // Known, documented gap: colloquial names outside the official 77 community
  // areas are not aliased here. This is not a bug to fix quietly - it is the
  // boundary of what this file promises, and a check exists so a future change
  // does not accidentally start guessing.
  check('a colloquial name outside the official list finds nothing', !ChiNeighborhoods.lookup('Pilsen', IX));
  check('a colloquial name outside the official list finds nothing (Bronzeville)', !ChiNeighborhoods.lookup('Bronzeville', IX));
  check('gibberish finds nothing', !ChiNeighborhoods.lookup('Xyzzy Heights', IX));
  check('an address string finds nothing', !ChiNeighborhoods.lookup('1060 W Addison St', IX));
  check('an empty string finds nothing', !ChiNeighborhoods.lookup('', IX));
  check('a bare number finds nothing', !ChiNeighborhoods.lookup('46', IX));
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
