// ChiWardBoard address resolver. Shared by the front page and by
// tools/test-address.mjs, which is why it is a plain script with a CommonJS
// tail rather than part of app.js: the resolver is the part of this site that
// can tell a resident the wrong ward, so it needs checks that run without a
// browser.
//
// Everything here is pure: it takes a typed string and a prepared index and
// returns one of five states. It touches no DOM and makes no network calls, so
// a typed address still never leaves the browser.
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

  // The city writes street types and directions in its own shorthand. Accept the
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
    var m = /^(\d+)(ST|ND|RD|TH)?$/.exec(w);
    if (!m) return null;
    var n = Number(m[1]), v = n % 100;
    var suf = ['TH', 'ST', 'ND', 'RD'][(v - 20) % 10] || ['TH', 'ST', 'ND', 'RD'][v] || 'TH';
    return n + suf;
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
    var name = parts.map(function (p, i) {
      return i === parts.length - 1 ? (numberedStreet(p) || p) : p;
    }).join(' ');
    return { number: Number(num[1]), dir: dir, type: type, name: numberedStreet(name) || name };
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
  // Unbounded distance, for ordering suggestions that are already known to be close.
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

  // Sides of the street are indexed separately, because a ward boundary often
  // runs down the middle of one. Prefer the side the house number is actually on
  // and fall back to the other, which is right except on a boundary street.
  function sidesFor(number) { return number % 2 ? ['O', 'E'] : ['E', 'O']; }

  // Runs are [blockStart, ward, blockStart, ward, ...] ascending; the ward for a
  // block is the one whose run starts at or before it.
  function wardOnStreet(runs, block) {
    var lo = 0, hi = runs.length / 2 - 1, hit = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (runs[mid * 2] <= block) { hit = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return hit < 0 ? null : runs[hit * 2 + 1];
  }

  // Index keys are "DIR|NAME|TYPE|SIDE". Derive the three lookups the resolver
  // needs once, at load, rather than scanning 8,000 keys per keystroke.
  function prepare(ix) {
    var keys = Object.keys(ix.streets);
    var names = [], seen = Object.create(null);
    var typesFor = Object.create(null), dirsFor = Object.create(null);
    for (var i = 0; i < keys.length; i++) {
      var p = keys[i].split('|');
      if (!seen[p[1]]) { seen[p[1]] = 1; names.push(p[1]); }
      var g = p[0] + '|' + p[1];
      if (!typesFor[g]) typesFor[g] = [];
      if (typesFor[g].indexOf(p[2]) < 0) typesFor[g].push(p[2]);
      if (!dirsFor[p[1]]) dirsFor[p[1]] = [];
      if (dirsFor[p[1]].indexOf(p[0]) < 0) dirsFor[p[1]].push(p[0]);
    }
    ix.names = names;
    ix.nameSet = new Set(names);
    ix.typesFor = typesFor;
    ix.dirsFor = dirsFor;
    return ix;
  }

  function dedupe(list) {
    return list.filter(function (v, i, s) { return s.indexOf(v) === i; });
  }

  // Every (direction, type) pair under one street name that covers this block.
  // More than one distinct ward coming back means the name alone does not decide
  // the answer, and the caller must ask rather than pick.
  //
  // Directions are tried most-specific first and the search stops at the first
  // direction that answers: a wrong "W" for an "N" should not silently outvote
  // the street the visitor actually named.
  function resolve(ix, a, name, block) {
    // What the visitor left out is widened to what the city actually files under
    // this name, because the typeless and directionless index entries are sparse:
    // "W|ADDISON||E" exists but covers blocks 21 to 35, so "1060 W Addison" used
    // to match a key, find no ward for block 10, and give up without ever trying
    // "W|ADDISON|ST". Widening is what makes an unambiguous partial resolve.
    var dirs = dedupe((a.dir ? [a.dir, ''] : ['']).concat(ix.dirsFor[name] || []));
    var all = [];
    for (var di = 0; di < dirs.length; di++) {
      var d = dirs[di];
      var types = dedupe([a.type, ''].concat(ix.typesFor[d + '|' + name] || []));
      var out = [];
      for (var ti = 0; ti < types.length; ti++) {
        var t = types[ti];
        var sides = sidesFor(a.number);
        for (var si = 0; si < sides.length; si++) {
          var runs = ix.streets[d + '|' + name + '|' + t + '|' + sides[si]];
          if (!runs) continue;
          var w = wardOnStreet(runs, block);
          if (w) { out.push({ ward: w, dir: d, type: t }); break; }
        }
        // The visitor named a type and that type answered. Nothing less specific
        // can improve on it, so stop rather than manufacture ambiguity.
        if (out.length && a.type && t === a.type) break;
      }
      // Same for a direction they named: a wrong "W" for an "N" must not silently
      // outvote the street they actually typed.
      if (out.length && a.dir && d === a.dir) return out;
      all = all.concat(out);
    }
    // Nothing was named, so every direction had a say. If they disagree the name
    // alone does not decide the answer, and lookup() will ask instead of picking.
    return all;
  }

  function titleCase(s) {
    return String(s).split(' ').map(function (w) {
      return w.charAt(0) + w.slice(1).toLowerCase();
    }).join(' ');
  }
  // What to show the resident: the address as this city spells it.
  function label(a, name, hit) {
    return [a.number, hit.dir, titleCase(name), titleCase(hit.type)]
      .filter(Boolean).join(' ');
  }

  // The top of the Chicago address grid, with a block of headroom. 13800 S is the
  // far south end of the numbering; nothing in the city is numbered above this.
  var MAX_HOUSE = 13999;

  var NOT_FOUND_MSG = function (raw) {
    return 'No Chicago block matches "' + raw + '". Check the street name, or use your location.';
  };

  // The one entry point. Returns exactly one of the five states, and the only
  // state that carries a ward is CONFIRMED: an uncertain match is a question for
  // the resident, never an answer rendered on their behalf.
  function lookup(raw, ix) {
    if (!ix) {
      return { state: STATES.NOT_FOUND,
        message: 'The address index did not load. Use your location, or click a ward on the map.' };
    }
    var a = parseAddress(raw);
    if (!a) {
      return { state: STATES.NOT_FOUND, typed: raw,
        message: 'Type a house number and street, like "1060 W Addison St".' };
    }
    // A house number off the end of the grid used to answer with full confidence:
    // the runs record where each ward's stretch of a street starts and nothing
    // about where it stops, so the last run absorbs everything above it and
    // "9999999 W Addison St" came back as Ward 38.
    //
    // The cap is the city grid, not the street. Per-street extents are not usable
    // here: the index is built from observed 311 records, so it under-reports a
    // street's outer blocks. W Addison is indexed only to block 56 while the
    // street really runs to about 8700 W, and capping per street would refuse
    // real addresses. The grid bound is a fact about Chicago instead of a fact
    // about what got reported: addresses run to 13800 S at the far south end, and
    // the one index entry above that (27400 S Perry) is in Dolton, not the city.
    if (a.number < 1) {
      return { state: STATES.NOT_FOUND, typed: raw,
        message: 'Chicago house numbers start at 1. Check the number, or use your location.' };
    }
    if (a.number > MAX_HOUSE) {
      return { state: STATES.NOT_FOUND, typed: raw,
        message: 'Chicago house numbers stop at ' + MAX_HOUSE + '. Check the number, or use your location.' };
    }
    var block = Math.floor(a.number / 100);

    // The question that decides confidence is whether this city has a street
    // spelled the way the visitor spelled it. Asking instead whether some key
    // happened to resolve is what let "1060 W Adison St" answer with Madison's
    // ward and no warning at all.
    if (ix.nameSet.has(a.name)) {
      var hits = resolve(ix, a, a.name, block);
      var wards = dedupe(hits.map(function (h) { return h.ward; }));
      if (wards.length === 1) {
        return { state: STATES.CONFIRMED, ward: wards[0], matched: label(a, a.name, hits[0]) };
      }
      if (wards.length > 1) {
        // Two streets spelled the same way, differing only in direction or type,
        // both carry this block number. The spelling cannot choose between them.
        var seen = [];
        for (var hi = 0; hi < hits.length; hi++) {
          var lb = label(a, a.name, hits[hi]);
          if (!seen.some(function (c) { return c.label === lb; })) {
            seen.push({ ward: hits[hi].ward, label: lb });
          }
        }
        return { state: STATES.UNCERTAIN, typed: raw, candidates: seen };
      }
      return { state: STATES.NOT_FOUND, typed: raw, message: NOT_FOUND_MSG(raw) };
    }

    // No street is spelled that way. Anything found from here is a guess about
    // what the visitor meant, so it is offered and never substituted.
    var max = a.name.length <= 5 ? 1 : 2;
    var cands = [];
    for (var i = 0; i < ix.names.length; i++) {
      var n = ix.names[i];
      if (n === a.name || !within(a.name, n, max)) continue;
      var found = resolve(ix, a, n, block);
      for (var j = 0; j < found.length; j++) {
        var lab = label(a, n, found[j]);
        if (cands.some(function (c) { return c.label === lab; })) continue;
        cands.push({ ward: found[j].ward, label: lab, name: n,
          d: distance(a.name, n), p: sharedPrefix(a.name, n) });
      }
    }
    if (!cands.length) return { state: STATES.NOT_FOUND, typed: raw, message: NOT_FOUND_MSG(raw) };
    // Closest edit first, then the longest shared opening: people mistype the
    // middle of a word far more often than its first letter, so "Adison" is
    // likelier to be Addison than Madison. This only orders the choices. It
    // never makes one of them for the resident.
    cands.sort(function (x, y) { return x.d - y.d || y.p - x.p || x.label.localeCompare(y.label); });
    return { state: STATES.UNCERTAIN, typed: raw, candidates: cands.slice(0, 4) };
  }

  return {
    STATES: STATES, lookup: lookup, prepare: prepare, parseAddress: parseAddress,
    within: within, titleCase: titleCase,
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ChiAddress;
