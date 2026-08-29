// chiwardboard front page. Renders the build-time snapshot (data/leaderboard.json)
// and ward map (data/wards.geojson). Every figure comes from the snapshot; the only
// live network call is the optional address lookup, against the same public dataset.
(async function () {
  const [dataRes, geoRes] = await Promise.all([fetch('data/leaderboard.json'), fetch('data/wards.geojson')]);
  if (!dataRes.ok || !geoRes.ok) return;
  const D = await dataRes.json();
  const GEO = await geoRes.json();

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
    const where = `created_date >= '${D.year}-01-01T00:00:00' AND created_date < '${D.year + 1}-01-01T00:00:00'` +
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
      $('hook-sub').innerHTML = `Medians run <span class="fig">${h.fastest.p50}</span> to <span class="fig">${h.slowest.p50}</span> days across wards in ${D.year}. This one is not a race - but it is a record.`;
    } else {
      $('hook-line').textContent = `Ward ${h.slowest.ward} takes ${human(h.slowest.p50)} ${VERB[T.key] || `to close a ${T.plain} request`}. Ward ${h.fastest.ward} takes ${human(h.fastest.p50)}.`;
      $('hook-sub').innerHTML = `Median days to close, ${D.year}: <span class="fig">${h.slowest.p50}</span> in Ward ${h.slowest.ward}, ` +
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
    $('map-title').textContent = `Median days on the map`;
    $('map-hint').textContent = 'Hover any ward for its number. Click for its full report card.';
    const labels = new Map(GEO.features.map((f) => [f.properties.ward, f.properties.label]));
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
      return `<text x="${px(lon).toFixed(1)}" y="${(py(lat) + 4).toFixed(1)}" text-anchor="middle">${ward}</text>`;
    }).join('');
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
        : `<strong>Ward ${t.dataset.ward}</strong> - no data`) + (aldName ? `<br>${esc(aldName)}` : '') +
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
        <td class="c-ward"><a href="ward.html?w=${w.ward}">Ward ${w.ward}${tag}${ald && ald.name ? `<div class="row-sub">${esc(ald.name)}</div>` : ''}</a></td>
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
      `&ldquo;Closed&rdquo; means status Completed. ${D.year} filed <span class="fig">${fmt(T.totals.requests)}</span> ${esc(T.plain)} requests; ` +
      `<span class="fig">${fmt(dg.rowsTimed)}</span> completed ones are timed here` +
      `${canceled ? `; <span class="fig">${fmt(canceled)}</span> cancellations are excluded` : ''}.`,
      `Days to close is the time from when a request is opened to when the city marks it closed (the <code>created_date</code> and <code>closed_date</code> fields in the records). Requests closed in the same second they were opened, the tell for bulk administrative closing: <span class="fig">${fmt(dg.sameSecondCloses)}</span>` +
      `${dg.sameSecondCloses > 0 ? ' - read this type&rsquo;s fast wards accordingly' : ''}. ` +
      `Negative durations dropped: <span class="fig">${fmt(ex.negativeDurations)}</span>. Rows with no ward dropped: <span class="fig">${fmt(ex.nullOrZeroWard)}</span>.`,
      `Rows the city flags as duplicates: <span class="fig">${fmt(dg.duplicateFlagged)}</span>, currently included.`,
      `Citywide, half of these close within <span class="fig">${T.citywide.p50}</span> days and nine in ten within <span class="fig">${T.citywide.p90}</span> days. Every figure is computed from the records themselves, not from a summary we did not check.`,
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
    const heading = note ? `Your ward: ${myWard}` : `Ward ${myWard}`;
    box.innerHTML = `<h3>${heading}${note ? ` <small style="font-weight:500">(${esc(note)})</small>` : ''}</h3>` +
      (ald && ald.name ? `<p>Alderperson ${esc(ald.name)}` : `<p>`) +
      ` &middot; <a href="ward.html?w=${myWard}">full report card, all ${D.types.length} categories, office contact &rarr;</a></p>` + (w
      ? `<p>For ${esc(T.plain)}: median <span class="fig">${w.p50}</span> days, <span class="fig">${fmt(w.n)}</span> requests in ${D.year}` +
        (idx >= 0 ? ` - <strong>${ordinal(idx + 1)}</strong> fastest of the ${T.wards.filter(x => !x.thin).length} ranked wards.` : ` - too few requests to rank.`) + `</p>`
      : `<p>No ${D.year} data for this type in Ward ${myWard}.</p>`);
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

  // Point-in-polygon (ray cast) over the shipped ward polygons — GPS never leaves the browser.
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

  // Address lookup: match against the same public 311 records, read the ward off a record.
  $('finder-form').onsubmit = async (e) => {
    e.preventDefault();
    const raw = $('finder-input').value.trim().toUpperCase().replace(/'/g, '');
    if (!raw) return;
    finderErr('Looking up…');
    try {
      const p = new URLSearchParams({
        $select: 'ward, count(1) as c',
        $where: `upper(street_address) like '${raw.replace(/\s+/g, ' ')}%' AND ward IS NOT NULL`,
        $group: 'ward', $order: 'count(1) DESC', $limit: '3',
      });
      const res = await fetch(`${D.source.api}?${p}`);
      const hits = res.ok ? await res.json() : [];
      if (hits.length) {
        setMyWard(Number(hits[0].ward), 'matched from 311 records at that address');
        finderErr(hits.length > 1 ? 'That address matched more than one ward; showing the most common. Add a direction (N/S/E/W) to narrow it.' : 'Matched against the city’s own 311 records.');
      } else {
        finderErr('No 311 record matches that address. Try just the number and street name, like "1060 W ADDISON".');
      }
    } catch { finderErr('The city data portal did not answer - try again, or use your location.'); }
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
  $('foot-line').innerHTML = `Snapshot generated ${new Date(D.generatedAt).toISOString().slice(0, 10)} from live API responses. ${D.year} season.`;
  $('foot-portal').href = D.source.portal;
  $('foot').hidden = false;

  renderAll();
})();
