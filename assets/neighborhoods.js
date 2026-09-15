// Neighborhood name lookup for the address box. Answers "what ward is Uptown
// in", a different question from the address resolver in assets/address.js,
// which that file is not touched to answer: it works from a parcel centroid, a
// neighborhood has no single point.
//
// The source is data/ward-neighborhoods.json, already fetched by app.js on
// every page load for the ward map's hover text. It records, per ward, the
// community areas that make up at least 8 percent of that ward's 311 requests
// (top three shown). Reused here rather than duplicated: the same names a
// visitor already sees on the map are the ones this answers for.
//
// Two limits worth naming, because they change what a match means:
//
// 1. The source data names Chicago's 77 official community areas, not the
// neighborhood names people actually type - "Pilsen" is not one of them, it
// is part of the community area named "Lower West Side". ALIASES below is a
// curated translation from the colloquial name to the official one it sits
// in, hand-maintained rather than derived, because there is no data file that
// ships that mapping. Add to it when a real search comes up empty for a name
// residents actually use; do not guess at one to fill it out.
//
// 2. A ward's minor community areas, the ones under the 8 percent cutoff, are
// not in the source file at all, so this cannot find them either, alias or
// not.
//
// Both are silent misses, not wrong answers: a name this file does not know,
// by either path, falls through to the resolver's ordinary NOT_FOUND, same as
// it did before this file existed.
//
// A community area is not a point, and most of them cross ward lines - 39 of
// the 69 names in the current data appear under more than one ward. So a match
// is never rendered as a ward, only offered as one or more candidates for the
// resident to pick, the same UNCERTAIN contract address.js already uses for a
// misspelled street. One candidate is still a candidate, never a silent
// confirmation: the share a community area gives a ward is not a boundary, and
// the resident may live in the sliver of it that lands somewhere else.
var ChiNeighborhoods = (function () {
  'use strict';

  // Same vocabulary the address resolver uses for a typed street, reused so
  // "Uptown", "UPTOWN" and "uptown " all land on one key. ChiAddress is loaded
  // before this file everywhere it is loaded at all: index.html and
  // tools/test-neighborhoods.mjs both load address.js first.
  var normalize = (typeof ChiAddress !== 'undefined')
    ? ChiAddress.normalizeName
    : function (s) { return String(s == null ? '' : s).toUpperCase().replace(/[.,]/g, ' ').replace(/['`]/g, '').replace(/\s+/g, ' ').trim(); };

  // Colloquial name -> the official community area name(s) it sits in, as
  // data/ward-neighborhoods.json spells them. Hand-maintained: nothing here
  // came from a build step, so it only grows when a real search for a real
  // name comes up empty, checked against an actual map of Chicago's community
  // areas rather than guessed at. A name mapped to more than one official area
  // (Bronzeville, South Loop) is a colloquial name that genuinely spans them;
  // the wards offered are the union, busiest first, not a new estimate - each
  // ward still comes from the same 311-request-share data as everywhere else
  // in this file.
  var ALIASES = {
    'PILSEN': { display: 'Pilsen', targets: ['Lower West Side'] },
    'LITTLE VILLAGE': { display: 'Little Village', targets: ['South Lawndale'] },
    'BACK OF THE YARDS': { display: 'Back of the Yards', targets: ['New City'] },
    'BRONZEVILLE': { display: 'Bronzeville', targets: ['Grand Boulevard', 'Douglas'] },
    'WICKER PARK': { display: 'Wicker Park', targets: ['West Town'] },
    'BUCKTOWN': { display: 'Bucktown', targets: ['West Town'] },
    'UKRAINIAN VILLAGE': { display: 'Ukrainian Village', targets: ['West Town'] },
    'EAST VILLAGE': { display: 'East Village', targets: ['West Town'] },
    'NOBLE SQUARE': { display: 'Noble Square', targets: ['West Town'] },
    'BOYSTOWN': { display: 'Boystown', targets: ['Lake View'] },
    'WRIGLEYVILLE': { display: 'Wrigleyville', targets: ['Lake View'] },
    'ANDERSONVILLE': { display: 'Andersonville', targets: ['Edgewater'] },
    'RAVENSWOOD': { display: 'Ravenswood', targets: ['Lincoln Square'] },
    'OLD TOWN': { display: 'Old Town', targets: ['Near North Side'] },
    'GOLD COAST': { display: 'Gold Coast', targets: ['Near North Side'] },
    'STREETERVILLE': { display: 'Streeterville', targets: ['Near North Side'] },
    'RIVER NORTH': { display: 'River North', targets: ['Near North Side'] },
    'WEST LOOP': { display: 'West Loop', targets: ['Near West Side'] },
    'FULTON MARKET': { display: 'Fulton Market', targets: ['Near West Side'] },
    'LITTLE ITALY': { display: 'Little Italy', targets: ['Near West Side'] },
    'UNIVERSITY VILLAGE': { display: 'University Village', targets: ['Near West Side'] },
    'GREEKTOWN': { display: 'Greektown', targets: ['Near West Side'] },
    'CHINATOWN': { display: 'Chinatown', targets: ['Armour Square'] },
    'SOUTH LOOP': { display: 'South Loop', targets: ['Near South Side', 'Loop'] },
  };

  // NB is the wards object from data/ward-neighborhoods.json:
  // { "27": { names: ["West Town", "Logan Square"], shares: [58.1, 41.9] }, ... }
  // Returns a map from a normalized name to every ward that lists it, sorted
  // by that ward's share of the name descending, so the busiest ward for a
  // split neighborhood sorts first.
  function buildIndex(NB) {
    var byName = {};
    Object.keys(NB || {}).forEach(function (wardKey) {
      var entry = NB[wardKey] || {};
      var names = entry.names || [];
      var shares = entry.shares || [];
      var ward = Number(wardKey);
      names.forEach(function (name, i) {
        var key = normalize(name);
        if (!key) return;
        if (!byName[key]) byName[key] = { name: name, wards: [] };
        byName[key].wards.push({ ward: ward, share: shares[i] });
      });
    });
    Object.keys(byName).forEach(function (key) {
      byName[key].wards.sort(function (a, b) { return (b.share || 0) - (a.share || 0); });
    });
    return byName;
  }

  // null when raw matches no known community area name and no alias for one.
  // Otherwise a display name - the official name as the build data spells it,
  // or the typed colloquial name for an alias hit - and the wards it appears
  // under, busiest first.
  function lookup(raw, index) {
    var key = normalize(raw);
    if (!key || !index) return null;
    var hit = index[key];
    if (hit) return { name: hit.name, wards: hit.wards };

    var alias = ALIASES[key];
    if (!alias) return null;
    // Union of whatever official targets the source data actually has. A
    // target absent from a given ward map (its official area never cleared
    // the 8 percent cutoff anywhere) is skipped rather than invented.
    var byWard = {};
    alias.targets.forEach(function (target) {
      var t = index[normalize(target)];
      if (!t) return;
      t.wards.forEach(function (w) {
        if (!byWard[w.ward] || (w.share || 0) > byWard[w.ward].share) byWard[w.ward] = w;
      });
    });
    var wards = Object.keys(byWard).map(function (k) { return byWard[k]; })
      .sort(function (a, b) { return (b.share || 0) - (a.share || 0); });
    if (!wards.length) return null;
    return { name: alias.display, wards: wards };
  }

  return { buildIndex: buildIndex, lookup: lookup, normalize: normalize, ALIASES: ALIASES };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ChiNeighborhoods;
