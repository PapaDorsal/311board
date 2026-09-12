// Named regression checks for the address lookup. One per defect class from the
// September 2026 QA run, plus the parsing cases the resolver already had to get
// right. Run: node tools/test-address.mjs
//
// The resolver is pure, so these run with no browser and no network. The DOM-side
// checks (P2, P3) live in tools/test-finder.mjs, which drives the real page.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../assets/address.js');
const ix = C.prepare(require('../data/address-points.json'));
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
  // 300, not the 400 this used to use: the 400 block of E 53rd has no parcel on
  // either side, so the old text index was the only thing that ever answered it.
  const a = look('300 E 53rd St'), b = look('300 E 53 St');
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

// ---- wrong suffix is not the same case as a missing one ----
check('a wrong street suffix is UNCERTAIN, not CONFIRMED', () => {
  // W Addison is filed as a St. "Ave" is a type this city does not use for it,
  // and answering from W Addison St would decide the visitor meant something
  // other than what they wrote.
  const r = look('1060 W Addison Ave');
  if (r.state !== S.UNCERTAIN) return `state ${r.state}, wanted UNCERTAIN`;
  if ('ward' in r) return 'an UNCERTAIN result carried a ward';
});
check('a wrong suffix offers the suffix the city uses', () => {
  const r = look('1060 W Addison Ave');
  if (!r.candidates.some((c) => c.label === '1060 W Addison St')) {
    return `offered ${r.candidates.map((c) => c.label).join(', ')}`;
  }
});
check('a missing suffix still resolves, a wrong one does not', () => {
  // The pair that must not share a path.
  const missing = look('1060 W Addison'), wrong = look('1060 W Addison Ave');
  if (missing.state !== S.CONFIRMED) return `missing suffix gave ${missing.state}`;
  if (wrong.state === S.CONFIRMED) return `wrong suffix gave CONFIRMED ${wrong.ward}`;
});
check('a wrong direction is UNCERTAIN, not CONFIRMED', () => {
  // There is no E LaSalle. This used to answer Lincoln Park, then the Loop.
  const r = look('102 E Lasalle Dr');
  if (r.state === S.CONFIRMED) return `CONFIRMED ward ${r.ward}`;
});
check('a missing direction still resolves', () => {
  const r = look('1060 Addison St');
  if (r.state !== S.CONFIRMED) return `state ${r.state}: ${r.message || ''}`;
});
check('no suggestion is offered without a street suffix', () => {
  // The index carries sparse suffix-less rows; an address shown without one
  // reads as broken.
  for (const q of ['1060 W Addison Ave', '102 E Lasalle Dr', '8102 S Lasalle Ave']) {
    const r = look(q);
    const bare = (r.candidates || []).filter((c) => !/ (St|Ave|Blvd|Rd|Dr|Pl|Ct|Ln|Pkwy|Ter|Sq|Hwy|Expy|Cres|Row|Plz|Way)$/.test(c.label));
    if (bare.length) return `${q} offered ${bare.map((c) => c.label).join(', ')}`;
  }
});

// ---- house numbers off the end of the grid ----
// The runs record where each ward's stretch of a street starts and nothing about
// where it stops, so without a cap the last run absorbs every number above it.
check('an absurd house number is never CONFIRMED', () => {
  const r = look('9999999 W Addison St');
  if (r.state === S.CONFIRMED) return `CONFIRMED ward ${r.ward}`;
  if (r.state !== S.NOT_FOUND) return `state ${r.state}, wanted NOT_FOUND`;
});
check('an out-of-range number says so instead of naming the street', () => {
  const r = look('9999999 W Addison St');
  if (!/house numbers stop at/.test(r.message)) return `message "${r.message}"`;
});
check('the first number past the grid is rejected', () => {
  const r = look('14000 W Addison St');
  if (r.state === S.CONFIRMED) return `CONFIRMED ward ${r.ward}`;
});
check('the top of the grid still resolves', () => {
  // The far south end of the city numbering. 13800 S Leyden, which this check
  // used to assert on, has no parcel: the street stops at 13790. The old index
  // answered it anyway, from a run with no end.
  const r = look('13701 S Leyden Ave');
  if (r.state !== S.CONFIRMED) return `state ${r.state}: ${r.message || ''}`;
});
check('a house number of zero is rejected', () => {
  const r = look('0 W Addison St');
  if (r.state === S.CONFIRMED) return `CONFIRMED ward ${r.ward}`;
  if (!/start at 1/.test(r.message)) return `message "${r.message}"`;
});
check('an address outside the city is not claimed for a ward', () => {
  // 27400 S Perry is in Dolton. It reached the old index as a stray 311 record
  // and used to resolve to Ward 6.
  const r = look('27400 S Perry Ave');
  if (r.state === S.CONFIRMED) return `CONFIRMED ward ${r.ward}`;
});
check('the cap does not block a fuzzy match in range', () => {
  const r = look('1060 W Adison St');
  if (r.state !== S.UNCERTAIN) return `state ${r.state}`;
});
check('an out-of-range number is not offered as a suggestion either', () => {
  const r = look('9999999 W Adison St');
  if (r.state === S.CONFIRMED || r.state === S.UNCERTAIN) return `state ${r.state}`;
});

// ---- the state contract itself ----
check('only CONFIRMED ever carries a ward', () => {
  const probes = ['1060 W Addison St', '1060 W Adison St', 'hello', '100 W Zyzzyxqq St',
    '1060 W Addison', '1060 W Addison St, Chicago, IL 60613',
    '9999999 W Addison St', '0 W Addison St', '14000 W Addison St',
    '1060 W Addison Ave', '102 E Lasalle Dr', '13900 S Torrence Ave', '7300 W Addison St'];
  for (const s of probes) {
    const r = look(s);
    if (!Object.values(S).includes(r.state)) return `${s} gave unknown state ${r.state}`;
    if (r.ward !== undefined && r.state !== S.CONFIRMED) return `${s}: ${r.state} carried a ward`;
  }
});

// ---- the class the point index exists to close ----
// These three were confident wrong answers for as long as the ward came from a
// text index: its runs recorded where a ward's stretch of a street began and
// never where it ended, so the last run absorbed every number above it. The ward
// now comes from a point-in-polygon test on a real parcel, and a block face the
// city has no parcel on is not an address.
//
// 7300 W Addison St is deliberately not here. It was reported as outside the
// city, but the city's parcel file has 120 parcels on that stretch and they fall
// in ward 38, which is Dunning. West of Harlem is not automatically outside
// Chicago. It is asserted below as a correct answer.
check('a number past the end of a street is not a ward', () => {
  const r = look('9999 W Addison St');
  if (r.state === S.CONFIRMED) return `CONFIRMED ward ${r.ward}`;
  if (r.state !== S.NOT_FOUND) return `state ${r.state}, wanted NOT_FOUND`;
});
check('an address past the south city limit is not a ward', () => {
  const r = look('13900 S Torrence Ave');
  if (r.state === S.CONFIRMED) return `CONFIRMED ward ${r.ward}`;
  if (r.state !== S.NOT_FOUND) return `state ${r.state}, wanted NOT_FOUND`;
});
check('the same street inside the limit still resolves', () => {
  const r = look('10102 S Torrence Ave');
  if (r.state !== S.CONFIRMED) return `state ${r.state}: ${r.message || ''}`;
});
check('7300 W Addison St is in the city and resolves', () => {
  // Reported as a defect. It is not one: 120 real parcels, ward 38.
  const r = look('7300 W Addison St');
  if (r.state !== S.CONFIRMED) return `state ${r.state}: ${r.message || ''}`;
  if (r.ward !== 38) return `ward ${r.ward}, wanted 38`;
});
check('an out-of-range message names the address, not the street name', () => {
  const r = look('9999 W Addison St');
  if (/check the street name/i.test(r.message || '')) return r.message;
});

// ---- one vocabulary ----
check('spacing in a street name is not treated as a typo', () => {
  // The city files La Salle with a space. Most people type LaSalle. That is the
  // same street, not a misspelling, so it must not become a confirmation step.
  const a = look('121 N LaSalle St'), b = look('121 N La Salle St');
  if (a.state !== S.CONFIRMED) return `LaSalle gave ${a.state}`;
  if (b.state !== S.CONFIRMED) return `La Salle gave ${b.state}`;
  if (a.ward !== b.ward) return `wards differ: ${a.ward} vs ${b.ward}`;
});
check('both sides of a boundary street resolve to their own ward', () => {
  // A ward line runs down S Torrence at the 10100 block, so the even and odd
  // sides are different wards. A block-level answer would get one of them wrong.
  const e = look('10102 S Torrence Ave'), o = look('10101 S Torrence Ave');
  if (e.state !== S.CONFIRMED || o.state !== S.CONFIRMED) return `${e.state} / ${o.state}`;
  if (e.ward === o.ward) return `both sides gave ward ${e.ward}`;
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
