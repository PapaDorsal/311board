// ChiWardBoard address resolver. Shared by the front page and by
// tools/test-address.mjs, which is why it is a plain script with a CommonJS tail:
// this is the part of the site that can tell a resident the wrong ward, so it
// needs checks that run without a browser.
//
// The ward comes from data/address-points.json, where every address range was
// assigned by a point-in-polygon test on its parcel centroid against the
// unsimplified 2023 ward boundaries. See tools/build-address-points.mjs. Nothing
// here infers a ward from a street name or a block number, which is what the
// 311-derived text index this replaces used to do: its runs recorded where a
// ward's stretch of a street began and never where it ended, so the last run
// absorbed every number above it and answered confidently for addresses past the
// end of the street or outside the city altogether.
//
// Everything here is pure: it takes a typed string and a prepared index and
// returns one of five states. No DOM, no network, so a typed address never
// leaves the browser.
var ChiAddress = (function () {
  'use strict';

  // The five states every lookup ends in. RESOLVING belongs to the caller (the
  // await is there, not here), but it is named in one place so the render side
  // and the resolver cannot drift into two different vocabularies.
  var STATES = {
    EMPTY: 'EMPTY',
    RESOLVING: 'RESOLVING',
    CONFIRMED: 'CONFIRMED',
    UNCERTAIN: 'UNCERTAIN',
    NOT_FOUND: 'NOT_FOUND',
  };

  // The city writes directions and street types in its own shorthand. Accept the
  // long forms people actually type and fold them onto it.
  var DIRS = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', N: 'N', S: 'S', E: 'E', W: 'W' };
  var TYPES = {
    STREET: 'ST', ST: 'ST', AVENUE: 'AVE', AVE: 'AVE', AV: 'AVE', BOULEVARD: 'BLVD', BLVD: 'BLVD',
    ROAD: 'RD', RD: 'RD', DRIVE: 'DR', DR: 'DR', PLACE: 'PL', PL: 'PL', COURT: 'CT', CT: 'CT',
    LANE: 'LN', LN: 'LN', PARKWAY: 'PKWY', PKWY: 'PKWY', TERRACE: 'TER', TER: 'TER',
    SQUARE: 'SQ', SQ: 'SQ', HIGHWAY: 'HWY', HWY: 'HWY', EXPRESSWAY: 'EXPY', EXPY: 'EXPY',
    CRESCENT: 'CRES', CRES: 'CRES', ROW: 'ROW', PLAZA: 'PLZ', PLZ: 'PLZ', WAY: 'WAY',
  };
  // 53, 53rd and THIRD all mean the same numbered street to a Chicagoan.
  var WORDNUM = {
    FIRST: '1', SECOND: '2', THIRD: '3', FOURTH: '4', FIFTH: '5', SIXTH: '6',
    SEVENTH: '7', EIGHTH: '8', NINTH: '9', TENTH: '10',
  };
  function numberedStreet(word) {
    var w = WORDNUM[word] || word;
    var m = /^(\d+)\s*(ST|ND|RD|TH)?$/.exec(w);
    if (!m) return null;
    var n = Number(m[1]), v = n % 100;
    var suf = ['TH', 'ST', 'ND', 'RD'][(v - 20) % 10] || ['TH', 'ST', 'ND', 'RD'][v] || 'TH';
    return n + suf;
  }

  // One vocabulary, used on both sides. The build runs every parcel's street name
  // through this before keying it, and a typed name goes through the same
  // function, so the index cannot hold a spelling a lookup can never reach. The
  // 311-derived index this replaces had 1,493 keys in mixed case that an
  // uppercasing parser could not see.
  function normalizeName(s) {
    var t = String(s == null ? '' : s).toUpperCase()
      .replace(/[.,]/g, ' ').replace(/['`]/g, '')
      .replace(/\s+/g, ' ').trim();
    if (!t) return '';
    // "100 TH" and "100TH" are the same street written two ways.
    var whole = numberedStreet(t);
    if (whole) return whole;
    var parts = t.split(' ');
    var last = numberedStreet(parts[parts.length - 1]);
    if (last) parts[parts.length - 1] = last;
    return parts.join(' ');
  }

  // People paste what their phone's autocomplete gives them, which is the whole
  // postal address. Strip a trailing city/state/ZIP so "1060 W Addison St,
  // Chicago, IL 60613" resolves the same as "1060 W Addison St".
  var TAIL = [/^\d{5}(-\d{4})?$/, /^IL$/, /^ILLINOIS$/, /^USA?$/, /^UNITED$/, /^STATES$/];
  function stripPostalTail(parts) {
    var p = parts.slice();
    for (;;) {
      var last = p[p.length - 1];
      if (p.length > 2 && last && TAIL.some(function (re) { return re.test(last); })) { p.pop(); continue; }
      // "CHICAGO" only when dropping it still leaves a street to match on, so
      // "123 W Chicago" (the avenue) is not eaten by the city name.
      if (p.length > 2 && last === 'CHICAGO') { p.pop(); continue; }
      return p;
    }
  }

  function parseAddress(raw) {
    var parts = String(raw).toUpperCase().replace(/[.,]/g, ' ').replace(/['`]/g, '')
      .replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    parts = stripPostalTail(parts);
    if (!parts.length) return null;
    var num = /^(\d+)/.exec(parts.shift());
    if (!num) return null;
    var dir = '';
    if (parts.length > 1 && DIRS[parts[0]]) dir = DIRS[parts.shift()];
    var type = '';
    if (parts.length > 1 && TYPES[parts[parts.length - 1]]) type = TYPES[parts.pop()];
    // a trailing direction ("2100 W NORTH AVE" vs "500 N MAIN N") is part of the name
    if (!parts.length) return null;
    return { number: Number(num[1]), dir: dir, type: type, name: normalizeName(parts.join(' ')) };
  }

  // Small edit distance, capped: enough to forgive a slip or a doubled letter,
  // not enough to turn one real street into a different real street.
  function within(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return false;
    var prev = Array.from({ length: b.length + 1 }, function (_, i) { return i; });
    for (var i = 1; i <= a.length; i++) {
      var cur = [i], best = i;
      for (var j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        best = Math.min(best, cur[j]);
      }
      if (best > max) return false;
      prev = cur;
    }
    return prev[b.length] <= max;
  }
  // Unbounded, for ordering suggestions already known to be close.
  function distance(a, b) {
    var prev = Array.from({ length: b.length + 1 }, function (_, i) { return i; });
    for (var i = 1; i <= a.length; i++) {
      var cur = [i];
      for (var j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }
  function sharedPrefix(a, b) {
    var i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  }

  // Index keys are "DIR|NAME|TYPE|SUF|SIDE". Derive the lookups the resolver needs
  // once, at load, rather than scanning every key per keystroke. `variants` is the
  // list of shapes each name is actually filed under, which is what lets a lookup
  // widen into the parts the visitor left blank without guessing.
  function prepare(ix) {
    var names = [], seen = Object.create(null), variants = Object.create(null);
    var keys = Object.keys(ix.streets);
    for (var i = 0; i < keys.length; i++) {
      var p = keys[i].split('|');
      var name = p[1];
      if (!seen[name]) { seen[name] = 1; names.push(name); }
      var shape = p[0] + '|' + p[2] + '|' + p[3];
      if (!variants[name]) variants[name] = [];
      if (variants[name].indexOf(shape) < 0) variants[name].push(shape);
    }
    // "LaSalle" and "La Salle" are the same street written two ways, not a typo,
    // and so are Van Buren, South Shore and every Mc name people close up. Spacing
    // is matched separately from spelling so those resolve rather than asking.
    var squash = Object.create(null);
    for (var n = 0; n < names.length; n++) {
      var flat = names[n].replace(/ /g, '');
      if (!squash[flat]) squash[flat] = [];
      if (squash[flat].indexOf(names[n]) < 0) squash[flat].push(names[n]);
    }
    ix.names = names;
    ix.nameSet = new Set(names);
    ix.variants = variants;
    ix.squash = squash;
    return ix;
  }

  function dedupe(list) {
    return list.filter(function (v, i, s) { return s.indexOf(v) === i; });
  }
  function sideOf(n) { return n % 2 ? 'O' : 'E'; }

  // Where a house number sits against one side of one street.
  //
  // The index is a flat [block, ward, block, ward, ...] list, where a block is
  // floor(houseNumber/100) and a ward is a number, or an array of numbers where
  // that block face carries parcels in more than one ward.
  //
  //   hit    the block face is in one ward, so the number is in that ward. The
  //          number needs no parcel of its own: the Chicago grid makes a block
  //          face the unit, and a ward boundary runs along streets rather than
  //          through the middle of one.
  //   split  a boundary cuts this block face, and the number falls between its
  //          parcel ranges rather than inside one. Which side it is on is not
  //          something the number can say, so it is a question.
  //   out    no parcel anywhere on this block face. Not a Chicago address on this
  //          street, which is what ends the confident answers for numbers past
  //          the end of a street or outside the city.
  //
  // A cut block face carries its parcel ranges instead of a single ward, so a
  // number on one still resolves exactly when a parcel covers it.
  function onBlocks(blocks, n) {
    if (!blocks || !blocks.length) return null;
    var want = Math.floor(n / 100);
    var lo = 0, hi = blocks.length / 2 - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1, b = blocks[mid * 2];
      if (b === want) {
        var w = blocks[mid * 2 + 1];
        if (typeof w === 'number') return { kind: 'hit', ward: w };
        // Ranges are stored narrowest first, so the most specific one that covers
        // this number wins. A wider range that also covers it describes a bigger
        // lot, not a better answer.
        for (var i = 0; i < w.length; i += 3) {
          if (n >= w[i] && n <= w[i + 1]) return { kind: 'hit', ward: w[i + 2] };
        }
        var wards = [];
        for (var j = 2; j < w.length; j += 3) if (wards.indexOf(w[j]) < 0) wards.push(w[j]);
        return { kind: 'split', wards: wards };
      }
      if (b < want) lo = mid + 1; else hi = mid - 1;
    }
    return { kind: 'out' };
  }

  // Every shape of this street name that has something to say about this number,
  // each tagged with whether it is what the visitor actually typed.
  //
  // `exact` is the distinction that keeps a guess from reading as an answer. What
  // the visitor leaves blank cannot be wrong, so a missing suffix or direction
  // widens and still resolves. What they write must match, so "1060 W Addison Ave"
  // names a type Chicago does not use for that street and comes back as a question
  // offering W Addison St, never as Ward 44.
  function resolve(ix, a, name) {
    var shapes = ix.variants[name] || [];
    var out = [];
    for (var i = 0; i < shapes.length; i++) {
      var p = shapes[i].split('|');
      var d = p[0], t = p[1], sf = p[2];
      if (a.dir && d !== a.dir) continue;
      if (a.type && t !== a.type) continue;
      var isExact = (!a.type || t === a.type) && (!a.dir || d === a.dir);
      // The side the house number is on decides it. The other side of the street
      // is consulted only when this one has no parcel at all, and never
      // confidently: a ward boundary commonly runs down the middle of a street,
      // so the opposite kerb is a different ward often enough that answering from
      // it is a guess. "3101 W 65th St" has no odd-side parcel, and the even side
      // across from it is a different ward.
      var own = sideOf(a.number), other = own === 'O' ? 'E' : 'O';
      var key = d + '|' + name + '|' + t + '|' + sf + '|';
      var r = onBlocks(ix.streets[key + own], a.number);
      var crossed = false;
      if (!r || r.kind === 'out') {
        r = onBlocks(ix.streets[key + other], a.number);
        crossed = true;
      }
      if (!r || r.kind === 'out') continue;
      if (r.wards) {
        for (var k = 0; k < r.wards.length; k++) {
          out.push({ ward: r.wards[k], dir: d, type: t, suf: sf, exact: isExact, split: true });
        }
      } else {
        out.push({ ward: r.ward, dir: d, type: t, suf: sf, exact: isExact && !crossed, crossed: crossed });
      }
    }
    return out;
  }

  // The same widening, but ignoring what the visitor wrote, so a wrong suffix or
  // direction still has something to offer.
  function resolveLoose(ix, a, name) {
    return resolve(ix, { number: a.number, dir: '', type: '', name: name }, name);
  }

  function titleCase(s) {
    return String(s).split(' ').map(function (w) {
      return w.charAt(0) + w.slice(1).toLowerCase();
    }).join(' ');
  }
  // What to show the resident: the address as this city spells it.
  function label(a, name, hit) {
    return [a.number, hit.dir, titleCase(name), titleCase(hit.type), hit.suf]
      .filter(Boolean).join(' ');
  }
  // Distinct labels for the confirmation step, in the order they were found.
  function offer(a, name, hits) {
    var out = [];
    for (var i = 0; i < hits.length; i++) {
      var lb = label(a, name, hits[i]);
      // Where a boundary cuts the block face, two hits carry the same address and
      // different wards. Offering the typed address twice is not a choice, so the
      // ward is named: it is the only thing that actually differs.
      if (hits[i].split) lb += ' (Ward ' + hits[i].ward + ')';
      else if (hits[i].crossed) lb += ' (Ward ' + hits[i].ward + ', from across the street)';
      if (!out.some(function (c) { return c.label === lb; })) out.push({ ward: hits[i].ward, label: lb });
    }
    return out;
  }

  // The top of the Chicago address grid. Numbering reaches 13800 S at the far
  // south end, so this is the ceiling with a block of headroom. The runs would
  // refuse anything higher anyway; the cap exists so an absurd number gets a
  // message about the number rather than one about the street.
  var MAX_HOUSE = 13999;
  var OUTSIDE_MSG = function (raw) {
    return 'No Chicago address matches "' + raw + '". It may be outside the city, '
      + 'or past the end of that street. Check the number, or use your location.';
  };
  var NO_STREET_MSG = function (raw) {
    return 'No Chicago street matches "' + raw + '". Check the street name, or use your location.';
  };

  // The one entry point. Returns exactly one of the five states, and the only
  // state that carries a ward is CONFIRMED: an uncertain match is a question for
  // the resident, never an answer rendered on their behalf.
  function lookup(raw, ix) {
    if (!ix) {
      return { state: STATES.NOT_FOUND,
        message: 'The address data did not load. Use your location, or click a ward on the map.' };
    }
    var a = parseAddress(raw);
    if (!a) {
      return { state: STATES.NOT_FOUND, typed: raw,
        message: 'Type a house number and street, like "1060 W Addison St".' };
    }
    if (a.number < 1) {
      return { state: STATES.NOT_FOUND, typed: raw,
        message: 'Chicago house numbers start at 1. Check the number, or use your location.' };
    }
    if (a.number > MAX_HOUSE) {
      return { state: STATES.NOT_FOUND, typed: raw,
        message: 'Chicago house numbers stop at ' + MAX_HOUSE + '. Check the number, or use your location.' };
    }

    // Is this a street the city has? Spacing does not count against the spelling,
    // so the typed name resolves to the city's own spelling first.
    var names = ix.nameSet.has(a.name) ? [a.name] : (ix.squash[a.name.replace(/ /g, '')] || []);
    if (names.length) {
      var hits = [], ni;
      for (ni = 0; ni < names.length; ni++) hits = hits.concat(resolve(ix, a, names[ni]));
      var canon = names.length === 1 ? names[0] : a.name;
      var exact = hits.filter(function (h) { return h.exact; });
      if (exact.length) {
        var wards = dedupe(exact.map(function (h) { return h.ward; }));
        if (wards.length === 1) {
          return { state: STATES.CONFIRMED, ward: wards[0], matched: label(a, canon, exact[0]) };
        }
        // Either two streets of this name that the visitor did not disambiguate,
        // or a block face that a ward boundary cuts through.
        return { state: STATES.UNCERTAIN, typed: raw, candidates: offer(a, canon, exact) };
      }
      // The street exists but not in the shape that was typed, or the number is on
      // no block face of it. Offer whatever the city does file at that number.
      var loose = [];
      for (ni = 0; ni < names.length; ni++) loose = loose.concat(resolveLoose(ix, a, names[ni]));
      if (loose.length) {
        return { state: STATES.UNCERTAIN, typed: raw, candidates: offer(a, canon, loose) };
      }
      return { state: STATES.NOT_FOUND, typed: raw, message: OUTSIDE_MSG(raw) };
    }

    // No street is spelled that way. Anything found from here is a guess about
    // what the visitor meant, so it is offered and never substituted.
    var max = a.name.length <= 5 ? 1 : 2;
    var cands = [];
    for (var i = 0; i < ix.names.length; i++) {
      var n = ix.names[i];
      if (n === a.name || !within(a.name, n, max)) continue;
      var found = resolve(ix, a, n);
      for (var j = 0; j < found.length; j++) {
        var lb = label(a, n, found[j]);
        if (cands.some(function (c) { return c.label === lb; })) continue;
        cands.push({ ward: found[j].ward, label: lb, name: n,
          d: distance(a.name, n), p: sharedPrefix(a.name, n) });
      }
    }
    if (!cands.length) return { state: STATES.NOT_FOUND, typed: raw, message: NO_STREET_MSG(raw) };
    // Closest edit first, then the longest shared opening: people mistype the
    // middle of a word more often than its first letter, so "Adison" is likelier
    // to be Addison than Madison. This only orders the choices. It never makes
    // one of them for the resident.
    cands.sort(function (x, y) { return x.d - y.d || y.p - x.p || x.label.localeCompare(y.label); });
    return { state: STATES.UNCERTAIN, typed: raw, candidates: cands.slice(0, 4) };
  }

  return {
    STATES: STATES, lookup: lookup, prepare: prepare, parseAddress: parseAddress,
    normalizeName: normalizeName, within: within, titleCase: titleCase,
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ChiAddress;
