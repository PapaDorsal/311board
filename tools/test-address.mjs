// Named regression checks for the address lookup. One per defect class from the
// September 2026 QA run, plus the parsing cases the resolver already had to get
// right. Run: node tools/test-address.mjs
//
// The resolver is pure, so these run with no browser and no network. The DOM-side
// checks (P2, P3) live in tools/test-finder.mjs, which drives the real page.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../assets/address.js');
const ix = C.prepare(require('../data/address-index.json'));
const S = C.STATES;

let failed = 0;
function check(name, fn) {
  try {
    const why = fn();
    if (why) { console.log(`FAIL  ${name}\n      ${why}`); failed++; }
    else console.log(`ok    ${name}`);
  } catch (e) { console.log(`ERROR ${name}\n      ${e.message}`); failed++; }
}
const look = (s) => C.lookup(s, ix);

// ---- P0: a typo must never resolve to a ward with full confidence ----
check('P0 a misspelled street is UNCERTAIN, not a ward', () => {
  const r = look('1060 W Adison St');
  if (r.state !== S.UNCERTAIN) return `state ${r.state}, wanted UNCERTAIN`;
  if ('ward' in r) return 'an UNCERTAIN result carried a ward';
});
check('P0 the real street is offered as a candidate', () => {
  const r = look('1060 W Adison St');
  const hit = r.candidates.find((c) => c.label === '1060 W Addison St');
  if (!hit) return `candidates were ${r.candidates.map((c) => c.label).join(', ')}`;
  if (hit.ward !== 44) return `offered ward ${hit.ward} for Addison, wanted 44`;
});
check('P0 the wrong-ward street does not outrank the right one', () => {
  const r = look('1060 W Adison St');
  if (r.candidates[0].label !== '1060 W Addison St') {
    return `first candidate was ${r.candidates[0].label}`;
  }
});
check('P0 no single candidate is silently substituted', () => {
  // One candidate is still a guess. The old code reported exactly this case and
  // rendered the card anyway; the new one must still refuse to.
  const r = look('1060 W Adisonn St');
  if (r.state === S.CONFIRMED) return 'a fuzzy match came back CONFIRMED';
});
check('P0 a correctly spelled street is CONFIRMED with its own ward', () => {
  const a = look('1060 W Addison St'), b = look('1060 W Madison St');
  if (a.state !== S.CONFIRMED || a.ward !== 44) return `Addison gave ${a.state} ${a.ward}`;
  if (b.state !== S.CONFIRMED || b.ward !== 34) return `Madison gave ${b.state} ${b.ward}`;
});

// ---- P1: an unambiguous partial address must resolve ----
check('P1 a street with no suffix resolves to the same ward', () => {
  const full = look('1060 W Addison St'), part = look('1060 W Addison');
  if (part.state !== S.CONFIRMED) return `state ${part.state}: ${part.message || ''}`;
  if (part.ward !== full.ward) return `ward ${part.ward}, full form gave ${full.ward}`;
});
check('P1 the suffix the city uses is shown back', () => {
  const r = look('1060 W Addison');
  if (r.matched !== '1060 W Addison St') return `matched "${r.matched}"`;
});
check('P1 a partial is not told to check a correct street name', () => {
  const r = look('1060 W Addison');
  if (r.message && /check the street name/i.test(r.message)) return r.message;
});
check('P1 a partial with no direction still resolves', () => {
  const r = look('1060 Addison St');
  if (r.state !== S.CONFIRMED) return `state ${r.state}: ${r.message || ''}`;
});

// ---- parsing cases the resolver already owned ----
check('a pasted postal address resolves like the plain one', () => {
  const a = look('1060 W Addison St, Chicago, IL 60613'), b = look('1060 W Addison St');
  if (a.state !== S.CONFIRMED || a.ward !== b.ward) return `${a.state} ${a.ward} vs ${b.ward}`;
});
check('the city name is not eaten off a street called Chicago', () => {
  const r = look('123 W Chicago Ave');
  if (r.state === S.NOT_FOUND) return r.message;
});
check('a numbered street resolves however it is written', () => {
  const a = look('400 E 53rd St'), b = look('400 E 53 St');
  if (a.state !== S.CONFIRMED) return `53rd gave ${a.state}`;
  if (b.state !== S.CONFIRMED || b.ward !== a.ward) return `53 gave ${b.state} ${b.ward}`;
});
check('garbage is NOT_FOUND and says what to type', () => {
  const r = look('hello');
  if (r.state !== S.NOT_FOUND) return `state ${r.state}`;
  if (!/house number/.test(r.message)) return `message "${r.message}"`;
});
check('an unknown street with no near match is NOT_FOUND', () => {
  const r = look('100 W Zyzzyxqq St');
  if (r.state !== S.NOT_FOUND) return `state ${r.state}`;
});
check('a missing index is NOT_FOUND, never a ward', () => {
  const r = C.lookup('1060 W Addison St', null);
  if (r.state !== S.NOT_FOUND) return `state ${r.state}`;
});

// ---- the state contract itself ----
check('only CONFIRMED ever carries a ward', () => {
  const probes = ['1060 W Addison St', '1060 W Adison St', 'hello', '100 W Zyzzyxqq St',
    '1060 W Addison', '1060 W Addison St, Chicago, IL 60613'];
  for (const s of probes) {
    const r = look(s);
    if (!Object.values(S).includes(r.state)) return `${s} gave unknown state ${r.state}`;
    if (r.ward !== undefined && r.state !== S.CONFIRMED) return `${s}: ${r.state} carried a ward`;
  }
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
