// chiwardboard front page. Renders the build-time snapshot (data/leaderboard.json)
// and ward map (data/wards.geojson). Every figure comes from the snapshot, and the
// address lookup resolves against a shipped index: the page makes no live calls.
(async function () {
  const [dataRes, geoRes, nbRes, stRes] = await Promise.all([
    fetch('data/leaderboard.json'), fetch('data/wards.geojson'), fetch('data/ward-neighborhoods.json'),
    fetch('data/streets.geojson')]);
  if (!dataRes.ok || !geoRes.ok) return;
  const D = await dataRes.json();
  const GEO = await geoRes.json();
  // Neighbourhood context is a nicety; the board still works without it.
  const NB = nbRes.ok ? (await nbRes.json()).wards : {};
  // Street context is optional garnish; the map still works if it fails to load.
  const ST = stRes.ok ? (await stRes.json()).features : [];
  const hoods = (w, max) => ((NB[w] || {}).names || []).slice(0, max || 3).join(', ');
  // The board covers a rolling window, not a calendar year; say so wherever a period is named.
  const WIN = D.window || { from: `${D.year}-01-01`, to: `${D.year + 1}-01-01`, label: String(D.year) };
  const PERIOD = WIN.label;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const word = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));

  // Deadpan phrasing per type: what "closing" one of these means in English.
  const VERB = {
    'abandoned-vehicle': 'to deal with an abandoned car', 'pothole': 'to fill a pothole',
    'rodent': 'to bait a rat complaint', 'graffiti': 'to remove graffiti',
    'garbage-cart': 'to fix a garbage cart', 'street-light': 'to fix a street light',
    'tree-debris': 'to clear tree debris', 'sanitation': 'to close a sanitation violation',
  };
  // Sequential blue ramp (light steps 100..600 of the validated palette).
  const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#2a78d6', '#184f95'];

  function human(days) {
    if (days < 1) return 'under a day';
    if (days < 6) { const d = Math.round(days); return d === 1 ? 'about a day' : `about ${word(d)} days`; }
    const w = Math.round(days / 7);
    return w <= 1 ? 'about a week' : `about ${word(w)} weeks`;
  }
  function receiptUrl(type, ward) {
    const where = `created_date >= '${WIN.from}T00:00:00' AND created_date < '${WIN.to}T00:00:00'` +
      ` AND sr_type='${type.official.replace(/'/g, "''")}' AND status='Completed' AND ward=${ward}`;
    const p = new URLSearchParams({
      $select: 'sr_number,street_address,created_date,closed_date',
      $where: where, $order: 'created_date DESC', $limit: '1000',
    });
    return `${D.source.api}?${p}`;
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
  let typeKey = (location.hash || '').slice(1);
  if (!D.types.some((t) => t.key === typeKey)) typeKey = D.featured;
  let myWard = null;

  function type() { return D.types.find((t) => t.key === typeKey); }

  function renderHook(T) {
    const h = T.headline;
    if (!h) { $('hook').hidden = true; return; }
    if (h.slowest.p50 < 1.5) {
      $('hook-line').textContent = `Every ward clears ${T.plain} in about a day.`;
      $('hook-sub').innerHTML = `Typical times run <span class="fig">${h.fastest.p50}</span> to <span class="fig">${h.slowest.p50}</span> days across wards over ${PERIOD}. This one is not a race - but it is a record.`;
    } else {
      $('hook-line').textContent = `Ward ${h.slowest.ward} takes ${human(h.slowest.p50)} ${VERB[T.key] || `to close a ${T.plain} request`}. Ward ${h.fastest.ward} takes ${human(h.fastest.p50)}.`;
      $('hook-sub').innerHTML = `Typical days to close, ${PERIOD}: <span class="fig">${h.slowest.p50}</span> in Ward ${h.slowest.ward}, ` +
        `<span class="fig">${h.fastest.p50}</span> in Ward ${h.fastest.ward} - a gap of <span class="fig">${h.gapDays}</span> days. ` +
        `Official request type: &ldquo;${esc(T.official)}&rdquo;.`;
    }
    $('hook').hidden = false;
  }

  function renderTypes() {
    $('types').innerHTML = D.types.map((t) =>
      `<button type="button" data-key="${t.key}" aria-pressed="${t.key === typeKey}">${esc(t.plain)}</button>`).join('');
    $('types').hidden = false;
  }

  function bins(T) {
    // quintile breaks over ward medians, so every type's map has spread
    const v = T.wards.map((w) => w.p50).sort((a, b) => a - b);
    const qq = [0.2, 0.4, 0.6, 0.8].map((p) => v[Math.floor(p * (v.length - 1))]);
    return qq;
  }
  function binColor(v, breaks) {
    let i = 0; while (i < breaks.length && v > breaks[i]) i++;
    return RAMP[i];
  }

  function renderMap(T) {
    const breaks = bins(T);
    const byWard = new Map(T.wards.map((w) => [w.ward, w]));
    $('map-title').textContent = `Typical days on the map`;
    $('map-hint').textContent = 'Hover any ward for its number. Click for its full report card.';
    const labels = new Map(GEO.features.map((f) => [f.properties.ward, f.properties.label]));
    const placedWardBoxes = [];
    $('map').innerHTML = [...wardPath.entries()].map(([ward, d]) => {
      const w = byWard.get(ward);
      const fill = w ? (w.thin ? 'var(--map-empty)' : binColor(w.p50, breaks)) : 'var(--map-empty)';
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
    const lo = Math.min(...T.wards.map((w) => w.p50)), hi = Math.max(...T.wards.map((w) => w.p50));
    $('legend').innerHTML =
      RAMP.map((c, i) => {
        const from = i === 0 ? lo : breaks[i - 1], to = i === RAMP.length - 1 ? hi : breaks[i];
        return `<span class="key"><span class="sw" style="background:${c}"></span>${from.toFixed(1)}–${to.toFixed(1)} d</span>`;
      }).join('') +
      `<span class="key"><span class="sw" style="background:var(--map-empty)"></span>under ${D.minWardN} requests</span>`;

    const tip = $('map-tip'), box = $('map').parentElement;
    $('map').onmousemove = (e) => {
      const t = e.target.closest('path'); if (!t) { tip.hidden = true; return; }
      const w = byWard.get(Number(t.dataset.ward));
      const aldName = ((D.aldermen || {})[Number(t.dataset.ward)] || {}).name;
      tip.innerHTML = (w
        ? `<strong>Ward ${w.ward}</strong> - typically <span class="fig">${w.p50}</span> days, slowest 10% over <span class="fig">${w.p90}</span> days, <span class="fig">${fmt(w.n)}</span> requests`
        : `<strong>Ward ${t.dataset.ward}</strong> - no data`) +
        (hoods(Number(t.dataset.ward)) ? `<br>${esc(hoods(Number(t.dataset.ward)))}` : '') +
        (aldName ? `<br>${esc(aldName)}` : '') +
        `<br><span class="tip-cta">Source: City of Chicago 311 records. Click for the rows behind this.</span>`;
      const r = box.getBoundingClientRect();
      tip.style.left = Math.min(e.clientX - r.left + 12, r.width - 230) + 'px';
      tip.style.top = (e.clientY - r.top + 14) + 'px';
      tip.hidden = false;
    };
    $('map').onmouseleave = () => { tip.hidden = true; };
    $('map').onclick = (e) => {
      const t = e.target.closest('path'); if (!t) return;
      setMyWard(Number(t.dataset.ward), null);
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
    for (const f of ST) {
      for (const seg of f.geometry.coordinates) {
        const pts = seg.map(([lon, lat]) => [px(lon), py(lat)]);
        lines.push(`<path class="st-line" d="M${pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L')}"/>`);
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
      const text = `${f.properties.name} ${f.properties.grid}`;
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
          const x = Math.min(Math.max(at[0], PADX), usedW - PADX);
          const y = Math.min(Math.max(at[1], PADY), usedH - PADY);
          const box = rot
            ? { x0: x - halfThick, x1: x + halfThick, y0: y - halfLen, y1: y + halfLen }
            : { x0: x - halfLen, x1: x + halfLen, y0: y - halfThick, y1: y + halfThick };
          if (!hits(box)) { placed = { x, y, box, rot }; break outer; }
        }
      }
      if (!placed) continue;
      taken.push(placed.box);
      const { x, y } = placed;
      labels.push(`<text class="st-label" style="font-size:${(6.4 * SF).toFixed(2)}px" x="${x.toFixed(1)}" y="${y.toFixed(1)}" ` +
        `transform="rotate(${placed.rot ? -90 : 0} ${x.toFixed(1)} ${y.toFixed(1)})" text-anchor="middle">` +
        `${esc(f.properties.name)} <tspan class="st-grid">${esc(f.properties.grid)}</tspan></text>`);
    }
    return `<g class="streets" aria-hidden="true">${lines.join('')}${labels.join('')}</g>`;
  }

  function renderTable(T) {
    $('board-title').textContent = `All 50 wards, ranked`;
    const thin = T.wards.filter((w) => w.thin).length;
    $('board-note').innerHTML = `Fastest first. ` + (thin
      ? `The ${word(thin)} ward${thin > 1 ? 's' : ''} marked <em>too few to rank</em> handled fewer than <span class="fig">${D.minWardN}</span> of these requests all year - too few for the numbers to mean much, too many to hide. They are listed but not ranked.`
      : `Every ward handled at least <span class="fig">${D.minWardN}</span> of these requests, enough for the numbers to mean something.`);
    const maxP50 = Math.max(...T.wards.map((w) => w.p50));
    let rank = 0;
    $('lb-body').innerHTML = T.wards.map((w) => {
      const pct = Math.max(1.5, (w.p50 / (maxP50 || 1)) * 100);
      const tag = w.thin ? ` <span class="thin-tag">too few to rank</span>` : '';
      const ald = (D.aldermen || {})[w.ward];
      return `<tr id="wrow-${w.ward}" class="${w.thin ? 'thin' : ''}${w.ward === myWard ? ' mine-row' : ''}">
        <td class="c-rank">${w.thin ? '–' : ++rank}</td>
        <td class="c-ward"><a href="ward.html?w=${w.ward}">Ward ${w.ward}${tag}` +
        `${hoods(w.ward, 2) ? `<div class="row-hood">${esc(hoods(w.ward, 2))}</div>` : ''}` +
        `${ald && ald.name ? `<div class="row-sub">${esc(ald.name)}</div>` : ''}</a></td>
        <td class="c-bar"><div class="barcell"><div class="bar" style="width:${pct.toFixed(1)}%"></div><span class="bar-val">${w.p50}</span></div></td>
        <td class="c-num">${w.p90}</td>
        <td class="c-num">${fmt(w.n)}</td>
      </tr>`;
    }).join('');
    $('board').hidden = false;
  }

  function renderMethod(T) {
    const ex = T.exclusions, dg = T.diagnostics, st = T.totals.statuses;
    const canceled = st.Canceled || 0;
    $('method-list').innerHTML = [
      `&ldquo;Closed&rdquo; means status Completed. Over ${PERIOD} the city filed <span class="fig">${fmt(T.totals.requests)}</span> ${esc(T.plain)} requests; ` +
      `<span class="fig">${fmt(dg.rowsTimed)}</span> completed ones are timed here` +
      `${canceled ? `; <span class="fig">${fmt(canceled)}</span> cancellations are excluded` : ''}.`,
      `Days to close is the time from when a request is opened to when the city marks it closed (the <code>created_date</code> and <code>closed_date</code> fields in the records). Requests closed in the same second they were opened, the tell for bulk administrative closing: <span class="fig">${fmt(dg.sameSecondCloses)}</span>` +
      `${dg.sameSecondCloses > 0 ? ' - read this type&rsquo;s fast wards accordingly' : ''}. ` +
      `Negative durations dropped: <span class="fig">${fmt(ex.negativeDurations)}</span>. Rows with no ward dropped: <span class="fig">${fmt(ex.nullOrZeroWard)}</span>.`,
      `Rows the city flags as duplicates: <span class="fig">${fmt(dg.duplicateFlagged)}</span>, currently included.`,
      `Citywide, half of these close within <span class="fig">${T.citywide.p50}</span> days and nine in ten within <span class="fig">${T.citywide.p90}</span> days. Every figure is worked out from the records themselves, not taken from a summary we did not check.`,
    ].map((s) => `<li>${s}</li>`).join('');
    $('method').hidden = false;
  }

  function renderAll() {
    const T = type();
    renderHook(T); renderTypes(); renderMap(T); renderTable(T); renderMethod(T);
    $('finder').hidden = false;
    renderMine();
  }

  // ---- find-your-ward ----
  function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function renderMine(note) {
    const box = $('mine');
    if (!myWard) { box.hidden = true; return; }
    const T = type();
    const idx = T.wards.filter((w) => !w.thin).findIndex((w) => w.ward === myWard);
    const w = T.wards.find((x) => x.ward === myWard);
    const ald = (D.aldermen || {})[myWard];
    // "Your ward" only when we actually located them; a map click is just browsing.
    const heading = (note ? `Your ward: ${myWard}` : `Ward ${myWard}`) +
      (hoods(myWard) ? ` <span class="hood-inline">${esc(hoods(myWard))}</span>` : '');
    box.innerHTML = `<h3>${heading}${note ? ` <small style="font-weight:500">(${esc(note)})</small>` : ''}</h3>` +
      (ald && ald.name ? `<p>Alderperson ${esc(ald.name)}` : `<p>`) +
      ` &middot; <a href="ward.html?w=${myWard}">full report card, all ${D.types.length} categories, office contact &rarr;</a></p>` + (w
      ? `<p>For ${esc(T.plain)}: typically <span class="fig">${w.p50}</span> days, <span class="fig">${fmt(w.n)}</span> requests over ${PERIOD}` +
        (idx >= 0 ? ` - <strong>${ordinal(idx + 1)}</strong> fastest of the ${T.wards.filter(x => !x.thin).length} ranked wards.` : ` - too few requests to rank.`) + `</p>`
      : `<p>No data for this type in Ward ${myWard} over ${PERIOD}.</p>`);
    box.hidden = false;
    const row = document.getElementById(`wrow-${myWard}`);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function setMyWard(ward, note) {
    myWard = ward;
    document.querySelectorAll('#map path').forEach((p) => p.classList.toggle('sel', Number(p.dataset.ward) === ward));
    document.querySelectorAll('#lb-body tr').forEach((r) => r.classList.toggle('mine-row', r.id === `wrow-${ward}`));
    renderMine(note);
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

  $('finder-gps').onclick = () => {
    if (!navigator.geolocation) { finderErr('Your browser has no location support.'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const w = wardAt(pos.coords.longitude, pos.coords.latitude);
        if (w) setMyWard(w, 'from your location');
        else finderErr('That location is outside the Chicago ward map.');
      },
      () => finderErr('Location was blocked - try the address box instead.'),
      { timeout: 12000 });
  };

  function finderErr(msg) { $('finder-note').textContent = msg; }

  // ---- address lookup ----
  // Resolved entirely in the browser against data/address-index.json, so a typed
  // address is never sent anywhere - the same promise the location button makes.
  // The index maps hundred-blocks to wards, which is why a house number with no
  // 311 record of its own still resolves: its block almost certainly has one.
  let AX = null, axFail = false;
  async function addressIndex() {
    if (AX || axFail) return AX;
    try {
      const r = await fetch('data/address-index.json');
      if (!r.ok) throw new Error('http ' + r.status);
      AX = await r.json();
      AX.names = [...new Set(Object.keys(AX.streets).map((k) => k.split('|')[1]))];
    } catch { axFail = true; }
    return AX;
  }

  // The city writes street types and directions in its own shorthand. Accept the
  // long forms people actually type and fold them onto it.
  const DIRS = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', N: 'N', S: 'S', E: 'E', W: 'W' };
  const TYPES = {
    STREET: 'ST', ST: 'ST', AVENUE: 'AVE', AVE: 'AVE', AV: 'AVE', BOULEVARD: 'BLVD', BLVD: 'BLVD',
    ROAD: 'RD', RD: 'RD', DRIVE: 'DR', DR: 'DR', PLACE: 'PL', PL: 'PL', COURT: 'CT', CT: 'CT',
    LANE: 'LN', LN: 'LN', PARKWAY: 'PKWY', PKWY: 'PKWY', TERRACE: 'TER', TER: 'TER',
    SQUARE: 'SQ', SQ: 'SQ', HIGHWAY: 'HWY', HWY: 'HWY', EXPRESSWAY: 'EXPY', EXPY: 'EXPY',
    CRESCENT: 'CRES', CRES: 'CRES', ROW: 'ROW', PLAZA: 'PLZ', PLZ: 'PLZ', WAY: 'WAY',
  };
  // 53, 53rd and THIRD all mean the same numbered street to a Chicagoan.
  const WORDNUM = {
    FIRST: '1', SECOND: '2', THIRD: '3', FOURTH: '4', FIFTH: '5', SIXTH: '6',
    SEVENTH: '7', EIGHTH: '8', NINTH: '9', TENTH: '10',
  };
  function numberedStreet(word) {
    const w = WORDNUM[word] || word;
    const m = /^(\d+)(ST|ND|RD|TH)?$/.exec(w);
    if (!m) return null;
    const n = Number(m[1]), v = n % 100;
    const suf = ['TH', 'ST', 'ND', 'RD'][(v - 20) % 10] || ['TH', 'ST', 'ND', 'RD'][v] || 'TH';
    return n + suf;
  }

  function parseAddress(raw) {
    const parts = raw.toUpperCase().replace(/[.,]/g, ' ').replace(/['`]/g, '')
      .replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!parts.length) return null;
    const num = /^(\d+)/.exec(parts.shift());
    if (!num) return null;
    let dir = '';
    if (parts.length > 1 && DIRS[parts[0]]) dir = DIRS[parts.shift()];
    let type = '';
    if (parts.length > 1 && TYPES[parts[parts.length - 1]]) type = TYPES[parts.pop()];
    // a trailing direction ("2100 W NORTH AVE" vs "500 N MAIN N") is part of the name
    if (!parts.length) return null;
    const name = parts.map((p, i) => (i === parts.length - 1 ? (numberedStreet(p) || p) : p)).join(' ');
    return { number: Number(num[1]), dir, type, name: numberedStreet(name) || name };
  }

  // Small edit distance, capped: enough to forgive a slip or a doubled letter,
  // not enough to turn one real street into a different real street.
  function within(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return false;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        best = Math.min(best, cur[j]);
      }
      if (best > max) return false;
      prev = cur;
    }
    return prev[b.length] <= max;
  }

  // Candidate keys, most specific first: exactly what was typed, then the same
  // street without the type, then without the direction. A wrong "Ave" for a
  // "Blvd" should not beat the visitor for it.
  function keysFor(a, name) {
    const ks = [];
    for (const t of [a.type, ''].filter((v, i, s) => s.indexOf(v) === i))
      for (const d of [a.dir, ''].filter((v, i, s) => s.indexOf(v) === i))
        ks.push(`${d}|${name}|${t}`);
    return ks;
  }

  // Runs are [blockStart, ward, blockStart, ward, ...] ascending; the ward for a
  // block is the one whose run starts at or before it.
  function wardOnStreet(runs, block) {
    let lo = 0, hi = runs.length / 2 - 1, hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (runs[mid * 2] <= block) { hit = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return hit < 0 ? null : runs[hit * 2 + 1];
  }

  async function lookupAddress(raw) {
    const ix = await addressIndex();
    if (!ix) return { err: 'The address index did not load. Use your location, or click a ward on the map.' };
    const a = parseAddress(raw);
    if (!a) return { err: 'Type a house number and street, like "1060 W Addison St".' };
    const block = Math.floor(a.number / 100);

    let names = [a.name], corrected = null;
    if (!keysFor(a, a.name).some((k) => ix.streets[k])) {
      // nothing under that spelling: find the closest real street name instead
      const max = a.name.length <= 5 ? 1 : 2;
      const near = ix.names.filter((n) => n !== a.name && within(a.name, n, max));
      if (near.length) { names = near; corrected = near.length === 1 ? near[0] : null; }
    }
    for (const name of names) {
      for (const k of keysFor(a, name)) {
        const runs = ix.streets[k];
        if (!runs) continue;
        const w = wardOnStreet(runs, block);
        if (w) return { ward: w, corrected: name === a.name ? null : corrected, ambiguous: names.length > 1 && !corrected };
      }
    }
    return { err: `No Chicago block matches "${raw}". Check the street name, or use your location.` };
  }

  $('finder-form').onsubmit = async (e) => {
    e.preventDefault();
    const raw = $('finder-input').value.trim();
    if (!raw) return;
    finderErr('Looking up…');
    const r = await lookupAddress(raw);
    if (r.err) { finderErr(r.err); return; }
    setMyWard(r.ward, 'from the address you typed');
    finderErr(r.corrected
      ? `Read that as ${r.corrected}. Matched to the block, in your browser - the address was not sent anywhere.`
      : 'Matched to the block, in your browser - the address was not sent anywhere.');
  };

  $('share').onclick = async () => {
    const T = type();
    const url = `${location.origin}${location.pathname}#${T.key}`;
    const h = T.headline;
    const text = h && h.slowest.p50 >= 1.5
      ? `Ward ${h.slowest.ward} takes ${h.slowest.p50} days on ${T.plain}. Ward ${h.fastest.ward}: ${h.fastest.p50}. - chiwardboard`
      : `Chicago's ${T.plain}, ranked by ward - chiwardboard`;
    try {
      if (navigator.share) { await navigator.share({ title: 'chiwardboard', text, url }); return; }
      await navigator.clipboard.writeText(`${text} ${url}`);
      $('share-done').hidden = false; setTimeout(() => { $('share-done').hidden = true; }, 2500);
    } catch { /* user cancelled */ }
  };

  $('types').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    typeKey = b.dataset.key;
    history.replaceState(null, '', `#${typeKey}`);
    renderAll();
  });

  // Footer
  $('foot-line').innerHTML = `Covering ${PERIOD}, a rolling 12 months. Snapshot generated ${new Date(D.generatedAt).toISOString().slice(0, 10)} from live API responses.`;
  $('foot-portal').href = D.source.portal;
  $('foot').hidden = false;

  renderAll();
})();
