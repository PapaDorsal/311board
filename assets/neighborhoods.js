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
// 1. These are Chicago's 77 official community areas, not the neighborhood
// names people actually type. "Pilsen" is not one of them - it is part of the
// community area named "Lower West Side" - and this file does not guess at
// that translation. A search for a colloquial name a resident would use finds
// nothing here rather than a wrong answer.
//
// 2. A ward's minor community areas, the ones under the 8 percent cutoff, are
// not in the source file at all, so this cannot find them either.
//
// Both are silent misses, not wrong answers: a name outside this list falls
// through to the resolver's ordinary NOT_FOUND, same as it did before this
// file existed.
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

  // null when raw matches no known community area name. Otherwise the
  // official name as the build data spells it, and the wards it appears
  // under, busiest first.
  function lookup(raw, index) {
    var key = normalize(raw);
    if (!key || !index) return null;
    var hit = index[key];
    if (!hit) return null;
    return { name: hit.name, wards: hit.wards };
  }

  return { buildIndex: buildIndex, lookup: lookup, normalize: normalize };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ChiNeighborhoods;
