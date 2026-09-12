// ChiWardBoard front page. Renders the build-time snapshot (data/leaderboard.json)
// and ward map (data/wards.geojson). Every figure comes from the snapshot, and the
// address lookup resolves against a shipped index: the page makes no live calls.
(async function () {
  const $ = (id) => document.getElementById(id);
  const [dataRes, geoRes, nbRes, stRes] = await Promise.all([
    fetch('data/leaderboard.json'), fetch('data/wards.geojson'), fetch('data/ward-neighborhoods.json'),
    fetch('data/streets.geojson')]);
  if (!dataRes.ok || !geoRes.ok) {
    // A blank page says nothing. Name the failure where the hook would be.
    $('hook-line').textContent = 'The data did not load.';
    $('hook-sub').textContent = 'Reload the page. If it keeps happening, the snapshot at data/leaderboard.json is what this page reads.';
    $('hook').hidden = false;
    return;
  }
  const GEO = await geoRes.json();
  // Neighbourhood context is a nicety; the board still works without it.
  const NB = nbRes.ok ? (await nbRes.json()).wards : {};
  // Street context is optional garnish; the map still works if it fails to load.
  const ST = stRes.ok ? (await stRes.json()).features : [];
  const hoods = (w, max) => ((NB[w] || {}).names || []).slice(0, max || 3).join(', ');

  // Windows the board can show. Rolling is the default; the two calendar years
  // are the only complete years that sit entirely inside the current (May 2023)
  // ward map - earlier years would compare different areas under the same ward
  // numbers, so they are not offered.
  const WINDOWS = [
    { key: 'rolling', pill: 'Last 12 months', file: 'data/leaderboard.json' },
    { key: '2024', pill: '2024', file: 'data/leaderboard-2024.json' },
    { key: '2025', pill: '2025', file: 'data/leaderboard-2025.json' },
  ];
  const winCache = new Map([['rolling', await dataRes.json()]]);
  let winKey = 'rolling';
  // D is the active snapshot; every renderer reads through these three.
  let D, WIN, PERIOD;
  function adoptData(d) {
    D = d;
    WIN = d.window || { from: `${d.year}-01-01`, to: `${d.year + 1}-01-01`, label: String(d.year) };
    PERIOD = WIN.label;
  }
  adoptData(winCache.get('rolling'));

  // Whether this visitor has a pointer that can hover. Everything the map says
  // about itself depends on the answer, and it is asked once.
  const CAN_HOVER = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const word = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));

  // Deadpan phrasing per type: what "closing" one of these means in English.
  const VERB = {
    'abandoned-vehicle': 'to deal with an abandoned car', 'pothole': 'to fill a pothole',
    'rodent': 'to bait for rats', 'graffiti': 'to remove graffiti',
    'garbage-cart': 'to fix a garbage cart', 'street-light': 'to fix a street light',
    'tree-debris': 'to clear tree debris', 'sanitation': 'to settle a sanitation complaint',
    'fly-dumping': 'to clear an illegally dumped pile', 'missed-pickup': 'to come back for a missed pickup',
  };
  // A backlog is worth flagging on the board from here up. Below it the share
  // still open is ordinary noise; above it the ward is not merely slow.
  const OPEN_TAG = 20;
  // Sequential blue ramp (light steps 100..600 of the validated palette).
  const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#2a78d6', '#184f95'];
  // Backlog boards get red. Not decoration: blue reads as "how fast", and this
  // axis is not measuring speed at all - it is measuring work the city never
  // came back for. Giving the two metrics one palette let a reader carry the
  // wrong instinct from one board to the next. Same five lightness steps, so
  // the map is read the same way; only the meaning changes.
  const RAMP_BACKLOG = ['#fddcd8', '#f9aca2', '#f2776a', '#dc3f2c', '#a3200f'];
  const rampFor = (T) => (isBacklog(T) ? RAMP_BACKLOG : RAMP);

  // One decimal everywhere a duration is shown, prose included. These lines used
  // to interpolate the raw value, so the same figure read 68.18 in the sentence
  // and 68.2 in the table directly beneath it. A value above zero but under 0.05
  // says so rather than rounding into the wards that genuinely close same-day.
  const d1 = (v) => (v === null || v === undefined ? '-'
    : (v > 0 && v < 0.05 ? '<0.1' : Number(v).toFixed(1)));

  // Days, then weeks, then months: "about nine weeks" is a figure nobody says
  // out loud, and the brief's own example is "a month and a half".
  function human(days) {
    if (days < 1) return 'under a day';
    if (days < 6) { const d = Math.round(days); return d === 1 ? 'about a day' : `about ${word(d)} days`; }
    if (days < 40) { const w = Math.round(days / 7); return w <= 1 ? 'about a week' : `about ${word(w)} weeks`; }
    const m = days / 30.44;
    if (m < 1.75) return 'about a month and a half';
    const n = Math.round(m);
    return n < WORDS.length ? `about ${word(n)} months` : `about ${n} months`;
  }

  // ---- map projection: equirectangular over the wards' bounding box ----
  const W = 400, H = 520, PAD = 8;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  const midLat = 41.85, kx = Math.cos(midLat * Math.PI / 180);
  for (const f of GEO.features) for (const poly of f.geometry.coordinates) for (const ring of poly) for (const [lon, lat] of ring) {
    const x = lon * kx, y = lat;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const scale = Math.min((W - 2 * PAD) / (maxX - minX), (H - 2 * PAD) / (maxY - minY));
  // Trim the viewBox to the city's own aspect on BOTH axes. Chicago is width-limited
  // here, so leaving the box at full height letterboxed the map with dead space.
  const usedW = (maxX - minX) * scale + 2 * PAD;
  const usedH = (maxY - minY) * scale + 2 * PAD;
  const mapEl = document.getElementById('map');
  mapEl.setAttribute('viewBox', `0 0 ${Math.ceil(usedW)} ${Math.ceil(usedH)}`);
  // Give the element a definite ratio: a percentage width on an SVG does not resolve
  // during intrinsic sizing, which let the map demand more width than its grid track.
  mapEl.style.aspectRatio = `${Math.ceil(usedW)} / ${Math.ceil(usedH)}`;
  const px = (lon) => PAD + (lon * kx - minX) * scale;
  const py = (lat) => usedH - PAD - (lat - minY) * scale;
  const wardPath = new Map();
  const wardBox = new Map();   // projected bbox per ward, for deciding if a label fits
  for (const f of GEO.features) {
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    const d = f.geometry.coordinates.map((poly) => poly.map((ring) =>
      'M' + ring.map(([lon, lat]) => {
        const X = px(lon), Y = py(lat);
        if (X < bx0) bx0 = X; if (X > bx1) bx1 = X;
        if (Y < by0) by0 = Y; if (Y > by1) by1 = Y;
        return `${X.toFixed(1)},${Y.toFixed(1)}`;
      }).join('L') + 'Z').join('')).join('');
    wardPath.set(f.properties.ward, d);
    wardBox.set(f.properties.ward, { w: bx1 - bx0, h: by1 - by0 });
  }

  // ---- state ----
  // Hash carries both facets: #pothole is the rolling default, #pothole-2025
  // pins the window, so a shared link reproduces what the sender saw.
  let typeKey = (location.hash || '').slice(1);
  const hm = /^(.*)-(\d{4})$/.exec(typeKey);
  if (hm && WINDOWS.some((w) => w.key === hm[2])) { typeKey = hm[1]; winKey = hm[2]; }
  if (!D.types.some((t) => t.key === typeKey)) typeKey = D.featured;
  const hashFor = () => (winKey === 'rolling' ? `#${typeKey}` : `#${typeKey}-${winKey}`);
  // A located ward rides in the URL so that Back and reload keep it, and so the
  // result is shareable. Only the ward number goes in: the typed address stays
  // out on purpose, because a query string is sent to the server on the next
  // navigation and this page promises a typed address never leaves the browser.
  const urlFor = () => `${location.pathname}${myWard ? `?ward=${myWard}` : ''}${hashFor()}`;
  // A ward page reads its own period from #<winKey>, so a link made while 2024
  // is selected has to carry it - otherwise the report card answers with the
  // rolling year and silently contradicts the row that was just clicked.
  const wardHref = (w) => `ward-${w}.html${winKey === 'rolling' ? '' : `#${winKey}`}`;
  let myWard = null;

  // Not every window carries every type: a backlog type is dropped from any
  // snapshot whose lookback would cross the May 2023 ward remap, so 2024 has no
  // sidewalk board. Switching to that year with sidewalk selected must land on
  // something rather than on undefined.
  function type() {
    return D.types.find((t) => t.key === typeKey) || D.types.find((t) => t.key === D.featured) || D.types[0];
  }
  // Not every type exists in every period - a backlog type is dropped from any
  // snapshot whose lookback would cross the May 2023 ward remap, so there is no
  // 2024 sidewalk board. Falling back to the featured type is right; doing it
  // without a word is not, because the switcher just loses the button the reader
  // was standing on and the board answers about something else.
  let switchedFrom = null;
  function reconcileType() {
    const want = typeKey;
    const t = type();
    if (t && t.key !== typeKey) {
      const gone = (D.types || []).find((x) => x.key === want);
      switchedFrom = { from: gone ? gone.plain : want.replace(/-/g, ' '), to: t.plain, win: winKey };
      typeKey = t.key;
      history.replaceState(null, '', urlFor());
    } else switchedFrom = null;
  }

  function renderSwitchNote() {
    const el = $('switch-note');
    if (!el) return;
    if (!switchedFrom) { el.hidden = true; el.textContent = ''; return; }
    const label = (WINDOWS.find((w) => w.key === switchedFrom.win) || {}).pill || switchedFrom.win;
    el.textContent = `No ${switchedFrom.from} board for ${label} - that one needs a longer run of records than ${label} on its own. Showing ${switchedFrom.to} instead.`;
    el.hidden = false;
  }

  // A backlog type is ranked on what the city has not finished rather than on
  // how long the finished ones took, so every renderer below asks this first.
  const isBacklog = (T) => T.metric === 'backlog';
  // The figure a ward is ranked on, whichever axis the type uses.
  const val = (T, w) => (isBacklog(T) ? w.pct : w.p50);
  // Sample size behind that figure: completed requests on a speed type, mature
  // ones on a backlog type, since a backlog needs no closures to be measured.
  const size = (T, w) => (isBacklog(T) ? w.mature : w.n);
  const pctTxt = (v) => `${Math.round(v)}%`;

  // A ward number means nothing to most readers, and the headline asks them to
  // compare two of them. Two neighbourhood names is enough to place one without
  // turning the sentence into a list.
  const wardWithHoods = (w) => {
    const n = hoods(w, 2);
    return `Ward ${w}${n ? ` (${esc(n)})` : ''}`;
  };

  // What a ward is, and where the figures came from, directly under the claim.
  function renderTrust() {
    const el = $('hook-trust');
    el.innerHTML = 'A ward is one of the 50 districts Chicago elects an alderperson '
      + 'for, each about 55,000 residents. '
      + `<a href="#method">How these numbers were counted</a> &middot; `
      + `<a href="${esc(D.source.portal)}" rel="noopener">City of Chicago 311 records</a>`;
    el.hidden = false;
  }

  function renderHook(T) {
    const h = T.headline;
    if (!h) { $('hook').hidden = true; $('hook-trust').hidden = true; return; }
    const past = winKey !== 'rolling';
    // The official term used to close every one of these lines. It is there so
    // a reader can match a figure against the city's own records, which is a
    // real need - but it is a need a person has while checking the method, not
    // while reading the headline, and in the second line of the page it was the
    // most bureaucratic sentence on the most-read part of the site. It now sits
    // in "How we counted", where someone verifying is already looking.
    if (isBacklog(T)) {
      $('hook-line').textContent =
        `Ward ${h.worst.ward} has left ${pctTxt(h.worst.pct)} of its ${T.plain} unfinished. Ward ${h.best.ward} has left ${pctTxt(h.best.pct)}.`;
      $('hook-sub').innerHTML =
        `<span class="fig">${pctTxt(h.worst.pct)}</span> of requests still open in ${wardWithHoods(h.worst.ward)}, ` +
        `<span class="fig">${pctTxt(h.best.pct)}</span> in ${wardWithHoods(h.best.ward)}, ` +
        `<span class="fig">${pctTxt(T.citywide.pct)}</span> across the city. ` +
        `Counting only requests filed at least six months ago, because a new one is not late yet.`;
      $('hook').hidden = false;
      return;
    }
    if (h.slowest.p50 < 1.5) {
      // The city does the clearing; a ward is where it happened. Same reason the
      // tagline says "where the city fills potholes" and not "which ward fixes".
      // Type names are a mix of singular and plural ("pothole repair", "garbage
      // cart repairs"), so the verb has to agree or this reads as broken English.
      const plural = /s$/.test(T.plain);
      $('hook-line').textContent = past
        ? `In ${winKey}, ${T.plain} took about a day in every ward.`
        : `${T.plain[0].toUpperCase()}${T.plain.slice(1)} ${plural ? 'take' : 'takes'} about a day in every ward.`;
      $('hook-sub').innerHTML = `Typical times ${past ? 'ran' : 'run'} <span class="fig">${d1(h.fastest.p50)}</span> to <span class="fig">${d1(h.slowest.p50)}</span> days across wards over ${PERIOD}.`;
    } else if (past) {
      $('hook-line').textContent = `In ${winKey}, Ward ${h.slowest.ward} took ${human(h.slowest.p50)} ${VERB[T.key] || `to close a ${T.plain} request`}. Ward ${h.fastest.ward} took ${human(h.fastest.p50)}.`;
      $('hook-sub').innerHTML = `Typical days to close, ${PERIOD}: <span class="fig">${d1(h.slowest.p50)}</span> in ${wardWithHoods(h.slowest.ward)}, ` +
        `<span class="fig">${d1(h.fastest.p50)}</span> in ${wardWithHoods(h.fastest.ward)} - a gap of <span class="fig">${d1(h.gapDays)}</span> days.`;
    } else {
      $('hook-line').textContent = `Ward ${h.slowest.ward} takes ${human(h.slowest.p50)} ${VERB[T.key] || `to close a ${T.plain} request`}. Ward ${h.fastest.ward} takes ${human(h.fastest.p50)}.`;
      $('hook-sub').innerHTML = `Typical days to close, ${PERIOD}: <span class="fig">${d1(h.slowest.p50)}</span> in ${wardWithHoods(h.slowest.ward)}, ` +
        `<span class="fig">${d1(h.fastest.p50)}</span> in ${wardWithHoods(h.fastest.ward)} - a gap of <span class="fig">${d1(h.gapDays)}</span> days.`;
    }
    renderTrust();
    $('hook').hidden = false;
  }

  // Every type seen in any period loaded this session. Switching to 2024 used to
  // drop a pill with no explanation: the row went from eleven to ten and sidewalk
  // repairs was simply gone, which reads as a bug rather than as a fact about the
  // data. A type the current period cannot rank is now shown disabled and says so,
  // turning a disappearance into a statement.
  //
  // A visitor who lands directly on a past period only knows the types that period
  // has, because nothing else has been loaded yet. That is the honest limit of
  // doing this on the client, and it is the case nobody reported.
  const knownTypes = new Map();
  function noteTypes() {
    for (const t of D.types || []) if (!knownTypes.has(t.key)) knownTypes.set(t.key, t.plain);
  }
  const winLabel = () => (winKey === 'rolling' ? 'the rolling 12 months' : winKey);

  function renderTypes() {
    noteTypes();
    const have = new Map((D.types || []).map((t) => [t.key, t]));
    $('types').innerHTML = [...knownTypes.entries()].map(([key, plain]) => {
      const t = have.get(key);
      if (t) return `<button type="button" data-key="${t.key}" aria-pressed="${t.key === typeKey}">${esc(t.plain)}</button>`;
      return `<button type="button" class="type-off" disabled aria-disabled="true"`
        + ` title="No ${esc(plain)} board for ${esc(winLabel())}: too few closed requests to rank."`
        + `>${esc(plain)} <span class="type-why">not in ${esc(winLabel())}</span></button>`;
    }).join('');
    $('types').hidden = false;
    $('windows').innerHTML = WINDOWS.map((w) =>
      `<button type="button" data-win="${w.key}" aria-pressed="${w.key === winKey}">${esc(w.pill)}</button>`).join('');
    $('windows').hidden = false;
  }

  // The wards a colour can be read for: ranked ones. A thin ward is drawn grey
  // whatever its median, and a ward whose median does not exist has null for
  // it, which sorted as zero and dragged the lowest band down to "same day".
  const ranked = (T) => T.wards.filter((w) => !w.thin && val(T, w) !== null);
  function bins(T) {
    // quintile breaks over the ranked wards' figures, so every type's map has spread
    const v = ranked(T).map((w) => val(T, w)).sort((a, b) => a - b);
    return [0.2, 0.4, 0.6, 0.8].map((p) => v[Math.floor(p * (v.length - 1))]);
  }
  function binColor(v, breaks, ramp) {
    let i = 0; while (i < breaks.length && v > breaks[i]) i++;
    return (ramp || RAMP)[i];
  }

  function renderMap(T) {
    const breaks = bins(T);
    const byWard = new Map(T.wards.map((w) => [w.ward, w]));
    $('map-title').textContent = isBacklog(T) ? `Unfinished work on the map` : `Typical days on the map`;
    // A click selects the ward here - card above the map, row lit in the table -
    // and the card carries the link to the full report card. Saying "click for
    // the report card" promised a page the click never opened.
    $('map-hint').textContent = CAN_HOVER
      ? 'Hover any ward for its number. Click to pick it out in the table.'
      : 'Tap any ward for its number and neighborhoods, and to pick it out in the table.';
    const labels = new Map(GEO.features.map((f) => [f.properties.ward, f.properties.label]));
    const placedWardBoxes = [];
    $('map').innerHTML = [...wardPath.entries()].map(([ward, d]) => {
      const w = byWard.get(ward);
      const fill = w && !w.thin && val(T, w) !== null ? binColor(val(T, w), breaks, rampFor(T)) : 'var(--map-empty)';
      return `<path d="${d}" fill="${fill}" data-ward="${ward}" class="${ward === myWard ? 'sel' : ''}"></path>`;
    }).join('') + [...labels.entries()].map(([ward, [lon, lat]]) => {
      // A number crammed into a sliver of a ward is noise. Draw it only where the
      // shape can hold it; every ward is still identified on hover and on click.
      const b = wardBox.get(ward) || { w: 0, h: 0 };
      const wide = String(ward).length > 1 ? 16 : 12;
      if (b.w < wide || b.h < 14) return '';
      const lx = px(lon), ly = py(lat) + 4;
      const halfW = String(ward).length * 4 + 3;
      placedWardBoxes.push({ x0: lx - halfW, x1: lx + halfW, y0: ly - 10, y1: ly + 3 });
      return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle">${ward}</text>`;
    }).join('') + streetLayer(placedWardBoxes);
    // Reconcile with rendered truth: the placement above works from estimated
    // text boxes, and an estimate that runs a few pixels tight puts a street
    // name on top of a ward number. Measure what the browser actually drew and
    // hide any label that collides - expressways keep their spot first.
    requestAnimationFrame(() => {
      const svg = $('map');
      const nums = [...svg.querySelectorAll('text:not(.st-label)')].map((e) => e.getBoundingClientRect());
      const labs = [...svg.querySelectorAll('.st-label')]
        .sort((a, b) => b.classList.contains('x-label') - a.classList.contains('x-label'));
      const kept = [];
      const clash = (A, B) => A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom;
      const seen = new Set();
      for (const el of labs) {
        const name = el.dataset.tent;
        const r = el.getBoundingClientRect();
        if ((name && seen.has(name)) || nums.some((n) => clash(r, n)) || kept.some((k) => clash(r, k))) { el.remove(); continue; }
        kept.push(r);
        if (name) seen.add(name);
      }
    });
    const rv = ranked(T).map((w) => val(T, w));
    const lo = Math.min(...rv), hi = Math.max(...rv);
    // On a type the city closes almost instantly, the fastest quintiles are all
    // fractions of a day and one decimal renders them "0.0-0.0" - a band that
    // says nothing. A band that ends inside the same day is named for that, and
    // one whose ends round together is shown as the single figure it is.
    const band = (from, to) => {
      if (to < 0.05) return 'same day';
      if (from < 0.05) return `under ${to.toFixed(1)}`;
      const f = from.toFixed(1), t = to.toFixed(1);
      return f === t ? f : `${f}–${t}`;
    };
    const pctBand = (from, to) => {
      const f = Math.round(from), t = Math.round(to);
      return f === t ? `${f}%` : `${f}–${t}%`;
    };
    $('legend').innerHTML =
      `<span class="key-lead">${isBacklog(T) ? 'Share unfinished' : 'Typical days'}, in five equal groups of wards:</span>` +
      rampFor(T).map((c, i) => {
        const from = i === 0 ? lo : breaks[i - 1], to = i === rampFor(T).length - 1 ? hi : breaks[i];
        return `<span class="key"><span class="sw" style="background:${c}"></span>${isBacklog(T) ? pctBand(from, to) : band(from, to)}</span>`;
      }).join('') +
      `<span class="key"><span class="sw" style="background:var(--map-empty)"></span>under ${isBacklog(T) ? T.minWardN : D.minWardN} requests</span>`;

    const tip = $('map-tip'), box = $('map').parentElement;
    // One builder for both input types. A touch user cannot hover, and this map
    // puts 50 ward numbers in 350px, so the same panel a mouse gets on hover is
    // what a finger gets on tap. The brief's reader is exactly the person who
    // cannot pick their ward out of this shape, so the answer has to be on the
    // map rather than a redirection to the address box.
    const showTip = (t, clientX, clientY) => {
      const w = byWard.get(Number(t.dataset.ward));
      const aldName = ((D.aldermen || {})[Number(t.dataset.ward)] || {}).name;
      tip.innerHTML = (w
        ? (isBacklog(T)
          ? `<strong>Ward ${w.ward}</strong> - <span class="fig">${pctTxt(w.pct)}</span> still unfinished, ` +
            `<span class="fig">${fmt(w.open)}</span> of <span class="fig">${fmt(w.mature)}</span> requests`
          : `<strong>Ward ${w.ward}</strong> - typically <span class="fig">${d1(w.p50)}</span> days, ` +
            `<span class="fig">${w.week}%</span> closed within a week, ` +
            `<span class="fig">${fmt(w.n)}</span> closed` +
            (w.openShare >= 1 ? `, <span class="fig">${Math.round(w.openShare)}%</span> still open` : ''))
        : `<strong>Ward ${t.dataset.ward}</strong> - no data`) +
        (hoods(Number(t.dataset.ward)) ? `<br>${esc(hoods(Number(t.dataset.ward)))}` : '') +
        (aldName ? `<br>${esc(aldName)}` : '') +
        `<br><span class="tip-cta">Source: City of Chicago 311 records. ` +
        `${CAN_HOVER ? 'Click' : 'Tap'} to pick this ward out in the table.</span>`;
      const r = box.getBoundingClientRect();
      // Keep the panel inside the map on a narrow screen, where a tap near the
      // right edge would otherwise push it off.
      const wide = Math.min(230, r.width - 16);
      tip.style.left = Math.max(8, Math.min(clientX - r.left + 12, r.width - wide - 8)) + 'px';
      tip.style.top = (clientY - r.top + 14) + 'px';
      tip.hidden = false;
    };
    $('map').onmousemove = (e) => {
      if (!CAN_HOVER) return;
      const t = e.target.closest('path');
      if (!t) { tip.hidden = true; return; }
      showTip(t, e.clientX, e.clientY);
    };
    $('map').onmouseleave = () => { if (CAN_HOVER) tip.hidden = true; };
    $('map').onclick = (e) => {
      const t = e.target.closest('path'); if (!t) return;
      // On touch the tap has to reveal as well as select: it is the only way to
      // read a ward number off this map.
      if (!CAN_HOVER) showTip(t, e.clientX, e.clientY);
      setMyWard(Number(t.dataset.ward), null, true);
    };
  }

  // Arterials for orientation. Drawn over the fills but under the ward numbers,
  // and deliberately quiet: hairline strokes, small labels, no interaction.
  function streetLayer(wardBoxes) {
    if (!ST.length) return '';
    const lines = [], labels = [];
    // A 6.4 unit label renders at 6.4px only when the map is drawn at 1:1. On a
    // phone, and in the two-column desktop layout, it is drawn much smaller than
    // that and the names stop being readable. Scale the type so a label always
    // lands near 10 CSS px, and let the collision test below thin the set:
    // fewer streets named, but the ones that are named can be read.
    // The svg is aspect-fitted, so the drawn scale is the smaller of the two
    // ratios - using width alone overstates it whenever the box letterboxes.
    const mb = $('map').getBoundingClientRect();
    const drawn = (mb.width && mb.height)
      ? Math.min(mb.width / usedW, mb.height / usedH) : 1;
    const SF = Math.max(1, 10 / (6.4 * drawn));
    const taken = (wardBoxes || []).slice();
    const hits = (b) => taken.some((t) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0);
    // Expressways place their labels first: the brief names three of them, and
    // letting a surface street claim the space first left only Kennedy labelled.
    const ORDERED = [...ST].sort((a, b) => (b.properties.kind === 'xway') - (a.properties.kind === 'xway'));
    for (const f of ORDERED) {
      const xway = f.properties.kind === 'xway';
      for (const seg of f.geometry.coordinates) {
        const pts = seg.map(([lon, lat]) => [px(lon), py(lat)]);
        lines.push(`<path class="${xway ? 'x-line' : 'st-line'}" d="M${pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L')}"/>`);
      }
      // Label near the end of the longest run rather than its midpoint: the middle of
      // the city is where the ward numbers live, and midpoint labels collided with them.
      let best = null, bestLen = -1;
      for (const seg of f.geometry.coordinates) {
        const a = seg[0], b = seg[seg.length - 1];
        const L = Math.hypot(px(b[0]) - px(a[0]), py(b[1]) - py(a[1]));
        if (L > bestLen) { bestLen = L; best = seg; }
      }
      if (!best || bestLen < 60) continue;
      const proj = best.map(([lo, la]) => [px(lo), py(la)]);
      const head = proj[0], tail = proj[proj.length - 1];
      const vertical = Math.abs(tail[1] - head[1]) > Math.abs(tail[0] - head[0]);
      // walk in from whichever end sits nearest the map edge
      const ordered = vertical
        ? (head[1] <= tail[1] ? proj : proj.slice().reverse())      // start at the top
        : (head[0] <= tail[0] ? proj : proj.slice().reverse());     // start at the left
      // Walk along the street and take the first spot that clears the ward numbers
      // and the labels already placed. A street with nowhere clear goes unlabelled -
      // the line still orients you, and a collided label helps nobody.
      const xway2 = f.properties.kind === 'xway';
      if (!f.properties.name) continue;   // Stevenson and Edens: line only, no label
      const text = f.properties.grid ? `${f.properties.name} ${f.properties.grid}` : f.properties.name;
      const halfLen = (text.length * 1.7 + 3) * SF, halfThick = 5 * SF;
      const PADX = 24, PADY = 12;
      const ang = vertical ? -90 : 0;
      // Try along the line rotated, then the same spots set horizontally: a horizontal
      // label needs far less clearance, so a crowded avenue can still be named.
      let placed = null;
      outer:
      for (const rot of vertical ? [true, false] : [false]) {
        for (const frac of [0.14, 0.06, 0.24, 0.34, 0.86, 0.76, 0.66, 0.5, 0.94]) {
          const at = ordered[Math.min(ordered.length - 1, Math.max(0, Math.round((ordered.length - 1) * frac)))];
          // Expressways run straight through the densest ward-number territory,
          // so their labels may also try sitting just off the line.
          const offs = xway2 ? [0, 9, -9, 15, -15, 21, -21] : [0];
          for (const off of offs) {
            const x = Math.min(Math.max(at[0] + (rot ? off : 0), PADX), usedW - PADX);
            const y = Math.min(Math.max(at[1] + (rot ? 0 : off), PADY), usedH - PADY);
            let box = rot
              ? { x0: x - halfThick, x1: x + halfThick, y0: y - halfLen, y1: y + halfLen }
              : { x0: x - halfLen, x1: x + halfLen, y0: y - halfThick, y1: y + halfThick };
            // The estimate runs a shade tight for the bold expressway names; a
            // margin here is what keeps them clear of ward numbers in practice.
            if (xway2) box = { x0: box.x0 - 1, x1: box.x1 + 1, y0: box.y0 - 1, y1: box.y1 + 1 };
            if (!hits(box)) { placed = { x, y, box, rot }; break outer; }
          }
        }
      }
      const emit = (x, y, rot, tentative) => labels.push(
        `<text class="st-label${xway2 ? ' x-label' : ''}"${tentative ? ` data-tent="${esc(f.properties.name)}"` : ''} ` +
        `style="font-size:${(6.4 * SF).toFixed(2)}px" x="${x.toFixed(1)}" y="${y.toFixed(1)}" ` +
        `transform="rotate(${rot ? -90 : 0} ${x.toFixed(1)} ${y.toFixed(1)})" text-anchor="middle">` +
        `${esc(f.properties.name)}${f.properties.grid ? ` <tspan class="st-grid">${esc(f.properties.grid)}</tspan>` : ''}</text>`);
      if (placed) {
        taken.push(placed.box);
        emit(placed.x, placed.y, placed.rot, xway2);
      }
      if (xway2) {
        // The estimator found nowhere, but it is conservative and the reconcile
        // pass below judges by what actually rendered. Offer it three spots
        // along the line; it keeps the first clean one and removes the rest.
        for (const frac of [0.18, 0.5, 0.82]) {
          const at = ordered[Math.min(ordered.length - 1, Math.max(0, Math.round((ordered.length - 1) * frac)))];
          emit(Math.min(Math.max(at[0], PADX), usedW - PADX),
               Math.min(Math.max(at[1], PADY), usedH - PADY), vertical, true);
        }
      }
    }
    return `<g class="streets" aria-hidden="true">${lines.join('')}${labels.join('')}</g>`;
  }

  // Board sort state. Defaults to the ranking itself, ascending - rank 1 first,
  // which is the order the board is built in.
  let lbSortKey = 'rank', lbSortDir = 'asc';

  function paintSortHeads() {
    document.querySelectorAll('#lb thead th').forEach((th) => {
      const k = th.dataset.sort;
      const active = k === lbSortKey;
      th.setAttribute('aria-sort', active ? (lbSortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      const ind = th.querySelector('.sort-ind');
      if (ind) ind.textContent = active ? (lbSortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';
      const btn = th.querySelector('.sort-btn');
      if (btn) {
        const label = (btn.querySelector('span') || {}).textContent || '';
        btn.setAttribute('aria-label',
          `${label}: ${active ? (lbSortDir === 'asc' ? 'sorted low to high' : 'sorted high to low') : 'not sorted'}. Activate to sort.`);
      }
    });
  }

  function renderTable(T) {
    const back = isBacklog(T);
    $('board-title').textContent = `All 50 wards, ranked`;
    const thin = T.wards.filter((w) => w.thin).length;
    const floor = back ? T.minWardN : D.minWardN;
    $('board-note').innerHTML = (back ? `Most unfinished first. ` : `Fastest first. `) + (thin
      ? `The ${word(thin)} ward${thin > 1 ? 's' : ''} marked <em>too few to rank</em> had fewer than <span class="fig">${floor}</span> of these to judge: listed, but too thin to rank.`
      : `Every ward had at least <span class="fig">${floor}</span> of these requests, enough for the numbers to mean something.`);
    // The bar is proportional to the figure being ranked, so the longest bar is
    // always the worst ward on whichever axis this type uses.
    const maxV = Math.max(...T.wards.map((w) => val(T, w) || 0));
    // Column heads follow the metric, and on a backlog board they state the
    // arithmetic the row already shows: 140 unfinished out of 232 requests is
    // 60%. The earlier pair named a filtering step nobody had asked about and a
    // count that read like a verdict.
    $('th-bar').textContent = back ? 'Share unfinished' : 'Typical days';
    // "Closed in a week" broke to three lines in this column whatever width it
    // was given - the table is auto-layout and ignores the hint. Shortened here
    // and spelled out in the gloss under the table instead.
    $('th-tail').textContent = back ? 'Requests' : 'In a week';
    $('th-n').textContent = back ? 'Unfinished' : 'Completed';
    // Rank is fixed to the board's own order (fastest first, or most unfinished
    // first) and assigned before any display sort, so re-sorting by ward or by a
    // column reorders the rows without renumbering the ranking.
    let rank = 0;
    const ranked = T.wards.map((w) => ({ w, rank: w.thin ? null : ++rank }));
    const dir = lbSortDir === 'asc' ? 1 : -1;
    const KEY = {
      rank: (r) => (r.rank === null ? Infinity : r.rank),
      ward: (r) => r.w.ward,
      bar:  (r) => (val(T, r.w) === null || val(T, r.w) === undefined ? Infinity : val(T, r.w)),
      tail: (r) => (back ? r.w.mature : r.w.week),
      n:    (r) => (back ? r.w.open : r.w.n),
    };
    const get = KEY[lbSortKey] || KEY.rank;
    ranked.sort((a, b) => {
      // Unranked wards stay at the bottom whichever way a column is sorted.
      if (a.rank === null && b.rank !== null) return 1;
      if (b.rank === null && a.rank !== null) return -1;
      const x = get(a), y = get(b);
      if (x === Infinity && y !== Infinity) return 1;
      if (y === Infinity && x !== Infinity) return -1;
      return (x - y) * dir;
    });
    $('lb-body').innerHTML = ranked.map(({ w, rank: wRank }) => {
      const v = val(T, w);
      const pct = Math.max(1.5, ((v || 0) / (maxV || 1)) * 100);
      const tag = w.thin ? ` <span class="thin-tag">too few to rank</span>` : '';
      // A ward can sit mid-table on the median while a fifth of its requests
      // have never been closed at all. The median is estimated with those
      // counted, so it is not hidden from the maths - but it was invisible on
      // the page, and it is the difference between slow and not finishing.
      // On a backlog type the whole column is that fact, so the tag would only
      // repeat the number beside it.
      const openTag = !back && !w.thin && w.openShare >= OPEN_TAG
        ? ` <span class="open-tag">${Math.round(w.openShare)}% still open</span>` : '';
      const ald = (D.aldermen || {})[w.ward];
      return `<tr id="wrow-${w.ward}" class="${w.thin ? 'thin' : ''}${w.ward === myWard ? ' mine-row' : ''}">
        <td class="c-rank"${w.thin ? ' title="Not ranked: too few of these requests to compare"' : ''}>${wRank === null ? '' : wRank}</td>
        <td class="c-ward"><a href="${wardHref(w.ward)}">Ward ${w.ward}${tag}${openTag}` +
        // No alderperson name here. It made every row three lines tall, and fifty
        // of those was most of the page; the name is on the ward's own page,
        // next to the contact details that make it useful.
        `${hoods(w.ward, 2) ? `<div class="row-hood">${esc(hoods(w.ward, 2))}</div>` : ''}</a></td>
        <td class="c-bar"><div class="barcell"><div class="bar${back ? ' bar-back' : ''}" style="width:${pct.toFixed(1)}%"></div><span class="bar-val">${back ? pctTxt(w.pct) : d1(w.p50)}</span></div></td>
        <td class="c-num c-tail">${back ? fmt(w.mature) : w.week + '%'}</td>
        <td class="c-num">${fmt(back ? w.open : w.n)}</td>
      </tr>`;
    }).join('');
    $('table-gloss').textContent = back
      ? 'Requests = how many were filed long enough ago to be judged. Unfinished = how many of those are still not closed. Click any column head to sort, or any ward for its full report card.'
      : 'Typical days = the middle request: half close faster, half slower. In a week = the share of requests closed within seven days. Requests still open count toward both. Click any column head to sort, or any ward for its full report card.';
    paintSortHeads();
    $('board').hidden = false;
  }

  // Buttons, not click handlers on th, so the headers work by keyboard too.
  document.querySelectorAll('#lb thead th .sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.closest('th').dataset.sort;
      if (lbSortKey === k) lbSortDir = lbSortDir === 'asc' ? 'desc' : 'asc';
      else { lbSortKey = k; lbSortDir = 'asc'; }
      renderTable(type());
    });
  });

  function renderMethod(T) {
    if (isBacklog(T)) {
      // Months, not rounded years: the window is 30 months, and "3 years" was
      // both wrong and a rounding the reader had no way to check.
      const months = Math.round((Date.parse(T.window.to) - Date.parse(T.window.from)) / 2629800000);
      const from = new Date(T.window.from + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      $('method-list').innerHTML = [
        `This board ranks what the city has <em>not</em> finished, rather than how long the finished ones took. Everything else here closes eventually and differs only in speed - over two years, the share of potholes, rat complaints or tree debris still open after six months is effectively zero. Sidewalk requests are the one exception in the dataset.`,
        `The city files these as &ldquo;${esc(T.official)}&rdquo;, which is the term to search for in the records. ` +
        `Since ${from} it logged <span class="fig">${fmt(T.totals.filed)}</span> of them. ` +
        `<span class="fig">${fmt(T.totals.mature)}</span> were filed at least <span class="fig">${T.window.maturityDays}</span> days ago, which is the set judged here; ` +
        `<span class="fig">${fmt(T.totals.open)}</span> of those are still open, or <span class="fig">${pctTxt(T.citywide.pct)}</span> citywide.`,
        `A request filed last month is new, not late. Only requests old enough to have been dealt with are counted, so a ward that recently received a lot does not read as a ward that ignores them.`,
        `Why ${months} months and not twelve: the six-month wait before a request counts eats into any window, and over a single year a typical ward has too few left to measure a share against.`,
        `Wards with fewer than <span class="fig">${T.minWardN}</span> requests old enough to judge are shown but not ranked. ` +
        `${T.totals.duplicates > 0 ? `Reports the city flagged as duplicates are excluded: <span class="fig">${fmt(T.totals.duplicates)}</span>. ` : ''}` +
        `${T.totals.nullOrZeroWard > 0 ? `Rows with no ward dropped: <span class="fig">${fmt(T.totals.nullOrZeroWard)}</span>.` : ''}`,
        `What this cannot tell you: whether an open request means nobody came, or whether the repair is queued. Most residential sidewalk repair runs through the city's Shared Cost Sidewalk Program, which opens for applications one day each January. What the records do show is that closing one is no formality - completed ones take a median of about five months. Read an open one as work the city has not signed off on.`,
      ].map((s) => `<li>${s}</li>`).join('');
      $('method').hidden = false;
      return;
    }
    const ex = T.exclusions, dg = T.diagnostics, st = T.totals.statuses;
    const canceled = st.Canceled || 0;
    $('method-list').innerHTML = [
      `&ldquo;Closed&rdquo; means status Completed. The city files these as &ldquo;${esc(T.official)}&rdquo;, which is the term to search for in the records. ` +
      `Over ${PERIOD} it logged <span class="fig">${fmt(T.totals.requests)}</span> of them. ` +
      `${T.totals.duplicates > 0 ? `Of those, <span class="fig">${fmt(T.totals.duplicates)}</span> were flagged by the city as duplicates and are excluded; ` : `None were flagged as duplicates; `}` +
      `<span class="fig">${fmt(dg.rowsTimed)}</span> of them are finished and timed here.`,
      `Days to close runs from when a request is opened to when the city marks it closed (the <code>created_date</code> and <code>closed_date</code> fields in the records).` +
      // Zero-count diagnostics are noise; a drop is only worth a sentence when it happened.
      `${dg.sameSecondCloses > 0 ? ` Closed in the same second they were opened, usually the sign of bulk administrative closing: <span class="fig">${fmt(dg.sameSecondCloses)}</span> - read this type&rsquo;s fast wards accordingly.` : ''}` +
      `${ex.negativeDurations > 0 ? ` Negative durations dropped: <span class="fig">${fmt(ex.negativeDurations)}</span>.` : ''}` +
      `${ex.nullOrZeroWard > 0 ? ` Rows with no ward dropped: <span class="fig">${fmt(ex.nullOrZeroWard)}</span>.` : ''}`,
      // The rationale bullet only earns its place when this type actually had duplicates.
      ...(T.totals.duplicates > 0 ? [
        `A duplicate is the same physical problem reported twice, so counting it would time one repair as two. The city excludes them in its own tooling.`,
      ] : []),
      `Citywide, half of these close within <span class="fig">${d1(T.citywide.p50)}</span> days, and <span class="fig">${T.citywide.week}%</span> are shut inside a week. Every figure is computed from the records themselves.`,
      // Two floors, and the reader is told both. The endpoints are picked with a
      // maximum, which is the operation that finds noise, so they answer to the
      // higher one - see the header of tools/build-data.mjs.
      `A ward needs <span class="fig">${D.minWardN}</span> completed requests of a type to be ranked on it; below that it is listed and marked too few to rank. The fastest and slowest named above the board answer to a higher bar of <span class="fig">${D.minHeadlineN}</span>, because naming one ward the best or worst in the city means taking a maximum, and a maximum is what finds a fluke. A ward between the two is ranked in the table but never named at the top of the page.`,
      ...(dg.censored > 0 ? [
        `Requests that never closed are counted, not dropped. Over ${PERIOD}, <span class="fig">${fmt(dg.stillOpen)}</span> of these were still open when the data was pulled` +
        (dg.canceled > 0 ? ` and <span class="fig">${fmt(dg.canceled)}</span> ${dg.canceled === 1 ? 'was' : 'were'} cancelled` : '') +
        `. Dropping them would make a ward&rsquo;s unfinished work vanish from its own figures, so each counts as a wait of at least that long.`,
      ] : []),
      `Two things these numbers cannot separate, and neither is corrected for. The city says it prioritizes arterial streets when dispatching crews, so a ward with more arterial mileage may close requests faster without anyone working differently. And every row started with a resident filing, so wards that report more, or report different things, will look different for that alone.`,
    ].map((s) => `<li>${s}</li>`).join('');
    $('method').hidden = false;
  }

  function renderAll() {
    const T = type();
    renderHook(T); renderTypes(); renderSwitchNote(); renderMap(T); renderTable(T); renderMethod(T);
    $('finder').hidden = false;
    renderMine();
  }

  // ---- find-your-ward ----
  function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  // What this ward's own page holds beyond the board: its long-open requests,
  // and what riding here has cost. Stated flatly and in that order - the
  // open-past-a-year count is this site's own subject, the crash count is context.
  function mineExtras(ward) {
    const bits = [];
    const st = STUCK && (STUCK.wards || {})[ward];
    if (st && st.total > 0) {
      bits.push(`<span class="fig">${fmt(st.total)}</span> request${st.total === 1 ? '' : 's'} open more than a year`);
    }
    const bk = BIKE && (BIKE.wards || {})[ward];
    if (bk && bk.crashes > 0) {
      bits.push(`<span class="fig">${fmt(bk.crashes)}</span> bike crash${bk.crashes === 1 ? '' : 'es'} in ${BIKE.window.years} years`);
    }
    if (!bits.length) return '';
    return `<p class="mine-extra">Also on its page: ${bits.join(', ')}.</p>`;
  }
  // `jump` is only set when the visitor picked a ward off the map. Locating
  // yourself by address or GPS should leave you where you are - the card answers
  // the question on its own, and on a phone the table is a screen and a half
  // down, so scrolling to it threw the page out from under them.
  function renderMine(note, jump) {
    const box = $('mine');
    if (!myWard) { box.hidden = true; return; }
    const T = type();
    const rankedW = T.wards.filter((x) => !x.thin);
    const idx = rankedW.findIndex((x) => x.ward === myWard);
    const w = T.wards.find((x) => x.ward === myWard);
    const ald = (D.aldermen || {})[myWard];
    // "Your ward" only when we actually located them; a map click is just browsing.
    const heading = (note ? `Your ward: ${myWard}` : `Ward ${myWard}`) +
      (hoods(myWard) ? ` <span class="hood-inline">${esc(hoods(myWard))}</span>` : '');
    box.innerHTML = `<h3>${heading}${note ? ` <small style="font-weight:500">(${esc(note)})</small>` : ''}</h3>` +
      (ald && ald.name ? `<p>Alderperson ${esc(ald.name)}` : `<p>`) +
      ` &middot; <a href="${wardHref(myWard)}">full report card, all ${D.types.length} categories, office contact &rarr;</a></p>` + (w
      ? (isBacklog(T)
        ? `<p>For ${esc(T.plain)}: <span class="fig">${pctTxt(w.pct)}</span> still unfinished, <span class="fig">${fmt(w.open)}</span> of <span class="fig">${fmt(w.mature)}</span> requests` +
          (idx >= 0 ? ` - <strong>${ordinal(idx + 1)}</strong> worst of the ${rankedW.length} ranked wards.` : ` - too few to rank.`) + `</p>`
        : `<p>For ${esc(T.plain)}: typically <span class="fig">${d1(w.p50)}</span> days, <span class="fig">${fmt(w.n)}</span> completed over ${PERIOD}` +
          (idx >= 0 ? ` - <strong>${ordinal(idx + 1)}</strong> fastest of the ${rankedW.length} ranked wards.` : ` - too few to rank.`) + `</p>`)
      : `<p>No data for this type in Ward ${myWard} over ${PERIOD}.</p>`) +
      // The one moment a visitor has raised their hand: they have found their
      // own ward and are reading about it. Naming what else is on its page here
      // beats putting either figure in front of the board, where it would push
      // the ranking below the fold for everyone to reach the few who care.
      mineExtras(myWard);
    // Location and address lookups resolve after the first paint, so these two
    // files may still be in flight. Re-render once they land rather than
    // blocking the card that answers the question.
    if ((!STUCK || !BIKE) && !renderMine._retry) {
      renderMine._retry = true;
      setTimeout(() => { renderMine._retry = false; if (myWard) renderMine(note, false); }, 700);
    }
    box.hidden = false;
    // Two things used to move the destination out from under this scroll. The card
    // above the map is shown in the same pass, and the retry above re-renders it
    // taller once the context files land, so a scroll started before either had
    // settled aimed at where the row had been. And over a 4,000px table a smooth
    // scroll is in flight long enough that its midpoint reads as the destination:
    // a tap on ward 24 sat at rank 36 four hundred milliseconds in, on its way to
    // rank 50, which is what the QA pass recorded as landing in the wrong place.
    //
    // So the jump is remembered rather than fired once, it waits for layout, and
    // it re-aims on every later render until the card has stopped growing. It
    // scrolls to the row element; nothing here reads the hash.
    if (jump) jumpPending = true;
    if (jumpPending) {
      requestAnimationFrame(scrollToMyRow);
      if (STUCK && BIKE) jumpPending = false;
    }
  }
  let jumpPending = false;
  function scrollToMyRow() {
    const row = myWard && document.getElementById(`wrow-${myWard}`);
    if (!row) return;
    // Animate only when the page has stopped growing. A smooth scroll keeps
    // running to the position it was given, so one started while the ward card is
    // still filling out aims at where the row was and then overrides the
    // correction: on a phone that landed 256px, four rows, short of the target.
    // While anything above the table can still change height, correct instantly
    // instead and animate nothing.
    const settled = STUCK && BIKE;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const smooth = settled && !still;
    // Computed here rather than left to scrollIntoView, so the two paths agree and
    // the instant one cannot inherit a stale target from an animation in flight.
    const box = row.getBoundingClientRect();
    const top = Math.max(0, box.top + window.scrollY - (window.innerHeight - box.height) / 2);
    window.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  }
  // Drop a previous result rather than leaving it to be read as the new one.
  // Drops the card only. The URL is written by setAddrState once the lookup has
  // settled, because clearing on the way through RESOLVING would overwrite the
  // history entry that still holds the previous ward and make Back skip it.
  function clearMyWard() {
    myWard = null;
    document.querySelectorAll('#map path').forEach((p) => p.classList.remove('sel'));
    document.querySelectorAll('#lb-body tr').forEach((r) => r.classList.remove('mine-row'));
    const box = $('mine');
    if (box) { box.innerHTML = ''; box.hidden = true; }
  }

  // `push` adds a history entry, and only a fresh lookup sets it: restoring from
  // the URL must not push the entry it just came from, or Back stops working.
  function setMyWard(ward, note, jump, push) {
    const changed = myWard !== ward;
    myWard = ward;
    document.querySelectorAll('#map path').forEach((p) => p.classList.toggle('sel', Number(p.dataset.ward) === ward));
    document.querySelectorAll('#lb-body tr').forEach((r) => r.classList.toggle('mine-row', r.id === `wrow-${ward}`));
    if (push && changed) history.pushState(null, '', urlFor());
    else history.replaceState(null, '', urlFor());
    renderMine(note, jump);
  }

  // Point-in-polygon (ray cast) over the shipped ward polygons; GPS never leaves the browser.
  function wardAt(lon, lat) {
    for (const f of GEO.features) {
      for (const poly of f.geometry.coordinates) {
        let inside = false;
        const outer = poly[0];
        for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
          const [xi, yi] = outer[i], [xj, yj] = outer[j];
          if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) return f.properties.ward;
      }
    }
    return null;
  }

  // Routed through the same state machine as the address box. Two writers to one
  // note is the bug class this whole section exists to close: a denied location
  // used to print its message beside a still-visible card from an earlier search.
  $('finder-gps').onclick = () => {
    if (!navigator.geolocation) {
      setAddrState(S.NOT_FOUND, { message: 'Your browser has no location support.' });
      return;
    }
    setAddrState(S.RESOLVING);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const w = wardAt(pos.coords.longitude, pos.coords.latitude);
        if (w) {
          setAddrState(S.CONFIRMED, { ward: w, from: 'from your location',
            message: 'Matched to the ward map, in your browser - your location was not sent anywhere.' });
        } else {
          setAddrState(S.NOT_FOUND, { message: 'That location is outside the Chicago ward map.' });
        }
      },
      () => setAddrState(S.NOT_FOUND, { message: 'Location was blocked - try the address box instead.' }),
      { timeout: 12000 });
  };

  // ---- address lookup ----
  // Resolved entirely in the browser against data/address-points.json, so a typed
  // address is never sent anywhere - the same promise the location button makes.
  // Every ward in that file came from a point-in-polygon test on a real parcel
  // centroid against the unsimplified ward boundaries, done at build time by
  // tools/build-address-points.mjs. A block face the city has no parcel on is not
  // an address, which is what stopped this lookup answering confidently for
  // addresses past the end of a street or outside the city.
  //
  // Fetched on first lookup rather than at load: most visitors read the board and
  // never type an address, and they should not pay for this file.
  //
  // The matching itself lives in assets/address.js so that tools/test-address.mjs
  // can check it without a browser. This is the part of the site that can tell a
  // resident the wrong ward, so it is the part that needs checks of its own.
  let AX = null, axFail = false;
  async function addressIndex() {
    if (AX || axFail) return AX;
    try {
      const r = await fetch('data/address-points.json');
      if (!r.ok) throw new Error('http ' + r.status);
      AX = ChiAddress.prepare(await r.json());
    } catch { axFail = true; }
    return AX;
  }

  // ---- result state ----
  // EMPTY / RESOLVING / CONFIRMED / UNCERTAIN / NOT_FOUND. Every render path maps
  // to exactly one, and this function is the only thing that writes the note, the
  // suggestion list and the ward card. The defects here were all two of those
  // three disagreeing: a card from the previous search still reading "from the
  // address you typed" underneath a failed or emptied one.
  //
  // Only CONFIRMED carries a ward. An uncertain match is a question for the
  // resident, never an answer rendered on their behalf.
  const S = ChiAddress.STATES;
  // The resting copy under the box, restored whenever there is nothing to report.
  const FINDER_HINT = 'Location stays in your browser. Or just click a ward on the map.';
  let addrState = S.EMPTY;
  function setAddrState(state, data) {
    const d = data || {};
    addrState = state;
    const note = $('finder-note'), ask = $('finder-ask');
    ask.hidden = true; ask.innerHTML = '';
    // A result card must never outlive its input.
    if (state !== S.CONFIRMED) clearMyWard();
    // Every settled state leaves the URL describing what is on screen. RESOLVING
    // is skipped: it is passing through, and writing from here would drop the
    // ward out of the entry Back needs to return to. CONFIRMED writes its own,
    // through setMyWard, because only it knows whether to push or replace.
    if (state !== S.RESOLVING && state !== S.CONFIRMED) history.replaceState(null, '', urlFor());
    if (state === S.EMPTY) { note.textContent = d.message || FINDER_HINT; return; }
    if (state === S.RESOLVING) { note.textContent = 'Looking up' + '…'; return; }
    if (state === S.CONFIRMED) {
      setMyWard(d.ward, d.from || 'from the address you typed', false, d.push !== false);
      note.textContent = d.message
        || `Matched ${d.matched} to the block, in your browser - the address was not sent anywhere.`;
      return;
    }
    if (state === S.UNCERTAIN) {
      // Offer, never substitute. Picking one is the resident's to do.
      note.textContent = d.candidates.length === 1
        ? 'That is not a street the city lists. Did you mean this?'
        : 'That is not a street the city lists. Did you mean one of these?';
      ask.innerHTML = d.candidates.map((c) =>
        `<button type="button" data-ward="${c.ward}" data-label="${esc(c.label)}">${esc(c.label)}</button>`).join('');
      ask.hidden = false;
      return;
    }
    note.textContent = d.message;
  }

  $('finder-ask').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    // Put the confirmed spelling in the box, so the input and the card agree.
    $('finder-input').value = b.dataset.label;
    setAddrState(S.CONFIRMED, { ward: Number(b.dataset.ward), matched: b.dataset.label });
  });

  $('finder-form').onsubmit = async (e) => {
    e.preventDefault();
    const raw = $('finder-input').value.trim();
    // An empty box is a state, not a no-op. The bare return this replaces left the
    // previous ward card on screen, still labelled as the answer to an address the
    // visitor had just deleted.
    if (!raw) {
      setAddrState(S.EMPTY, { message: 'Enter an address to look up. The box is empty.' });
      $('finder-input').focus();
      return;
    }
    setAddrState(S.RESOLVING);
    const r = ChiAddress.lookup(raw, await addressIndex());
    setAddrState(r.state, r);
  };

  // Share, with something visible every time. The old version swallowed a
  // clipboard failure in a bare catch, so a browser that blocks the clipboard
  // (or any non-secure context) looked identical to a successful copy: nothing
  // happened at all. Now the control always says what it did, and if the copy
  // is refused it shows the link so it can be taken by hand.
  async function shareOrCopy(payload, done) {
    const say = (msg, ok) => {
      done.textContent = msg;
      done.hidden = false;
      done.classList.toggle('share-fail', !ok);
      clearTimeout(say._t);
      say._t = setTimeout(() => { done.hidden = true; }, ok ? 2500 : 12000);
    };
    if (navigator.share) {
      try { await navigator.share(payload); return; }
      // A cancelled share sheet is a choice, not a failure - say nothing.
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(`${payload.text} ${payload.url}`);
      say('Link copied.', true);
      return;
    } catch { /* fall through */ }
    // Last resort, and not a failure. A browser that refuses the clipboard has
    // not done anything wrong, so this offers the link in something the visitor
    // can select and copy rather than printing it as loose text under a red
    // error. The share sheet and the clipboard are tried first; only this is left.
    const box = $('share-fallback');
    if (box) {
      box.value = payload.url;
      box.hidden = false;
      box.focus();
      box.select();
      say('Copy the link below.', true);
      return;
    }
    say(`The link is ${payload.url}`, true);
  }

  // "How these numbers were counted" points at a <details>. Scrolling to a closed
  // one shows the reader a summary line and nothing they asked for.
  addEventListener('click', (e) => {
    const a = e.target.closest('a[href="#method"]');
    if (!a) return;
    const m = $('method');
    if (m) { m.hidden = false; m.open = true; }
  });

  $('share').onclick = async () => {
    const T = type();
    // The same hash the address bar carries, so a shared 2024 view opens as 2024.
    const url = `${location.origin}${location.pathname}${hashFor()}`;
    const h = T.headline;
    // Whole days in a text message: the table's one decimal is right for a
    // column you are comparing down, but it makes a sentence look like a readout.
    // Both figures carry the unit: "Ward 14: 5" left the reader asking 5 what.
    // The contrast leads, because the gap is the story, not either number alone.
    const days = (v) => { const d = Math.round(Number(v)); return `${d} ${d === 1 ? 'day' : 'days'}`; };
    const what = VERB[T.key] || `to close a ${T.plain} request`;
    const text = isBacklog(T)
      ? (h ? `Ward ${h.worst.ward} has left ${pctTxt(h.worst.pct)} of its ${T.plain} unfinished. Ward ${h.best.ward} has left ${pctTxt(h.best.pct)}. Same city.`
           : `Chicago's ${T.plain}, ranked by ward.`)
      : h && h.slowest.p50 >= 1.5
      ? `${days(h.slowest.p50)} in Ward ${h.slowest.ward}. ${days(h.fastest.p50)} in Ward ${h.fastest.ward}. That is how long Chicago takes ${what}, depending on where you live.`
      : `Chicago's ${T.plain}, ranked by ward.`;
    await shareOrCopy({ title: 'ChiWardBoard', text, url }, $('share-done'));
  };

  $('types').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled || !b.dataset.key) return;
    typeKey = b.dataset.key;
    history.replaceState(null, '', urlFor());
    renderAll();
  });

  $('windows').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b || b.dataset.win === winKey) return;
    const w = WINDOWS.find((x) => x.key === b.dataset.win);
    if (!winCache.has(w.key)) {
      try {
        const r = await fetch(w.file);
        if (!r.ok) throw new Error(String(r.status));
        winCache.set(w.key, await r.json());
      } catch { $('board-note').textContent = 'That year failed to load - try again.'; return; }
    }
    winKey = w.key;
    adoptData(winCache.get(w.key));
    reconcileType();
    history.replaceState(null, '', urlFor());
    renderFoot();
    renderAll();
  });

  // Everything below the board: the oldest unfinished requests, and the city's
  // cycling figures. Both are context rather than ranking, so they sit after the
  // table rather than in front of it - anything between the hook and the map
  // pushes the comparison the site exists for below the fold, worst on a phone.
  // They are also what a visitor never discovers otherwise: the board is
  // legible enough that people read it and leave, never learning a ward page
  // carries more. STUCK and BIKE are shared with the ward card below.
  let STUCK = null, BIKE = null;
  const ago = (d) => (d >= 730 ? `${(d / 365).toFixed(1)} years` : d >= 365 ? 'over a year' : `${d} days`);

  (async function belowTheBoard() {
    const [sRes, bRes] = await Promise.all([
      fetch('data/stuck.json').catch(() => null),
      fetch('data/bike-context.json').catch(() => null),
    ]);
    if (bRes && bRes.ok) {
      try {
        BIKE = await bRes.json();
        const c = BIKE.citywide, yrs = BIKE.window.years;
        const stat = (v, label, sub) =>
          `<div class="bstat"><div class="bstat-v">${v}</div><div class="bstat-k">${label}</div>${sub ? `<div class="bstat-s">${sub}</div>` : ''}</div>`;
        $('bike-stats').innerHTML =
          stat(fmt(c.crashes), 'crashes involving someone on a bike', `in the last ${yrs} years`) +
          stat(fmt(c.serious), 'left someone seriously hurt or killed', 'of those crashes') +
          stat(`${Math.round(c.laneMiles)} mi`, 'of bike route citywide', `${Math.round(c.protectedLaneMiles)} mi of it physically protected`);
        $('bike-note').innerHTML =
          `Every ward page carries its own version. Never ranked: a ward with more crashes is usually a ward with more cycling, ` +
          `and correcting for that needs ridership figures nobody publishes. ` +
          `Blocked lanes are not here at all - 311 has no category for a vehicle parked in one. ` +
          `<a href="https://www.bikelaneuprising.com/submit" rel="noopener">Bike Lane Uprising collects those reports</a>. ` +
          `From the city's <a href="${esc(BIKE.sources.crashes.portal)}" rel="noopener">traffic crash</a> and <a href="${esc(BIKE.sources.routes.portal)}" rel="noopener">bike route</a> datasets.`;
        $('bike').hidden = false;
      } catch { /* the board stands on its own without it */ }
    }
    try {
      if (!sRes || !sRes.ok) return;
      const S = STUCK = await sRes.json();
      const list = (S.citywide.oldest || []).slice(0, 4);
      if (!list.length) return;
      // Type names come from the data: which types qualify is decided by a
      // measurement at build time, so naming them in prose goes stale silently.
      const kinds = (S.types || []).map((t) => {
        const s = String(t.name || t).toLowerCase().replace(/ (repair|out|debris)$/, '');
        return s.endsWith('s') ? s : s + 's';
      });
      const kindList = kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}` : kinds[0] || 'infrastructure';
      $('stuck-lead').innerHTML =
        `<span class="fig">${fmt(S.citywide.total)}</span> requests about the city&rsquo;s own ${esc(kindList)} ` +
        `have been open more than a year. The oldest few:`;
      $('stuck-list').innerHTML = list.map((t) => `<li class="stuck-item">
        <div class="stuck-head"><a class="stuck-ward" href="ward-${t.ward}.html">Ward ${t.ward}</a> &middot; ` +
        `<strong>${esc(t.type)}</strong>${t.address ? ` &middot; ${esc(t.address)}` : ''}</div>
        <div class="stuck-meta">Reported ${esc(t.created)} &middot; open <span class="fig">${ago(t.days)}</span> &middot; ` +
        `<span class="stuck-sr">${esc(t.sr)}</span></div></li>`).join('');
      // Not "and the ones that finally got fixed": stuck.html lists open requests
      // and the method, and nothing else. data/stuck.json does carry a closed list,
      // but no page renders it, so the promise was empty.
      $('stuck-note').innerHTML = `<a href="stuck.html">The longest waits in Chicago, ward by ward &rarr;</a>`;
      $('stuck').hidden = false;
    } catch { /* the board stands on its own without it */ }
  })();

  // Footer
  function renderFoot() {
    $('foot-line').innerHTML = `Covering ${PERIOD}${winKey === 'rolling' ? ', a rolling 12 months' : ''}. Snapshot generated ${new Date(D.generatedAt).toISOString().slice(0, 10)}.`;
    $('foot-portal').href = D.source.portal;
    $('foot').hidden = false;
  }
  renderFoot();

  // A deep link like #pothole-2025 needs that year's file before first paint.
  if (winKey !== 'rolling') {
    const w = WINDOWS.find((x) => x.key === winKey);
    try {
      const r = await fetch(w.file);
      if (r.ok) { winCache.set(w.key, await r.json()); adoptData(winCache.get(w.key)); renderFoot(); }
      else winKey = 'rolling';
    } catch { winKey = 'rolling'; }
  }

  renderAll();

  // ---- ward from the URL ----
  // Restoring here is what makes Back and reload work: the ward is read out of
  // the query string on every entry to the page, including the ones the browser
  // serves from history. `push` is false so restoring never adds the entry it
  // just came from.
  const wardFromUrl = () => {
    const v = Number(new URLSearchParams(location.search).get('ward'));
    return Number.isInteger(v) && v >= 1 && v <= 50 ? v : null;
  };
  function syncWardFromUrl() {
    const w = wardFromUrl();
    if (w === myWard) return;
    if (w) {
      setAddrState(S.CONFIRMED, { ward: w, from: 'from this link', push: false,
        message: 'Ward ' + w + ' came from this link. Look up an address to change it.' });
    } else {
      setAddrState(S.EMPTY);
    }
  }
  syncWardFromUrl();
  addEventListener('popstate', syncWardFromUrl);
})();
