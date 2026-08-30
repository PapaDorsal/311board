// Ward report card: one ward, every type on the board. Same snapshot as the front page.
(async function () {
  const D = await (await fetch('data/leaderboard.json')).json();
  const WIN = D.window || { from: `${D.year}-01-01`, to: `${D.year + 1}-01-01`, label: String(D.year) };
  const PERIOD = WIN.label;
  const nbRes = await fetch('data/ward-neighborhoods.json').catch(() => null);
  const NB = nbRes && nbRes.ok ? (await nbRes.json()).wards : {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('en-US');
  // Generated pages carry the ward in the markup; ward.html?w=27 still works so
  // links shared before those pages existed keep resolving.
  const ward = Number(document.body.dataset.ward || new URLSearchParams(location.search).get('w'));
  if (!Number.isInteger(ward) || ward < 1 || ward > 50) { $('missing').hidden = false; return; }

  // Per-ward identity so tabs, browser history and shared links are distinguishable.
  const BASE = 'https://chiwardboard.com';
  const wTitle = `Ward ${ward} - ChiWardBoard`;
  const aldName = ((D.aldermen || {})[ward] || {}).name;
  const wDesc = `How fast the city closes 311 requests in Chicago's Ward ${ward}` +
    (aldName ? ` (Alderperson ${aldName})` : '') +
    `: ${D.types.length} request types over ${PERIOD}, ranked against the other 49 wards, from public records.`;
  document.title = wTitle;
  const setMeta = (sel, attr, val) => {
    let el = document.head.querySelector(sel);
    if (!el) { el = document.createElement(sel.startsWith('link') ? 'link' : 'meta');
      const m = sel.match(/\[(\w+)="([^"]+)"\]/); if (m) el.setAttribute(m[1], m[2]);
      document.head.appendChild(el); }
    el.setAttribute(attr, val);
  };
  const wUrl = `${BASE}/ward-${ward}.html`;
  // Someone arriving on the legacy ward.html?w=43 sees that in the address bar,
  // and copying it by hand shares the generic preview. Swap it for the page that
  // identifies itself; the document already loaded is the same one.
  if (!document.body.dataset.ward) {
    try { history.replaceState(null, '', `ward-${ward}.html`); } catch { /* file:// and the like */ }
  }
  setMeta('meta[name="description"]', 'content', wDesc);
  setMeta('link[rel="canonical"]', 'href', wUrl);
  setMeta('meta[property="og:url"]', 'content', wUrl);
  setMeta('meta[property="og:title"]', 'content', wTitle);
  setMeta('meta[property="og:description"]', 'content', wDesc);
  setMeta('meta[name="twitter:title"]', 'content', wTitle);
  setMeta('meta[name="twitter:description"]', 'content', wDesc);
  const ald = (D.aldermen || {})[ward];
  $('ward-title').textContent = `Ward ${ward}`;
  const wHoods = ((NB[ward] || {}).names || []).join(', ');
  $('ward-sub').innerHTML = (wHoods ? `<span class="hood-line">${esc(wHoods)}</span><br>` : '') +
    (ald && ald.name ? `Alderperson ${esc(ald.name)}` : 'Alderperson: see the city directory') +
    ` &middot; ${PERIOD}`;

  // ---- locator map: this ward's own shape, in context ----
  // A rank tells you how the ward did; it does not tell you which ward this is.
  // The front page map answers that only if you already know where to look, so
  // the card carries its own: this ward filled, its neighbours outlined, framed
  // to the ward rather than to the city.
  try {
    const geo = await (await fetch('data/wards.geojson')).json();
    const me = geo.features.find((f) => Number(f.properties.ward) === ward);
    if (me) {
      const kx = Math.cos(41.85 * Math.PI / 180);
      // Frame on this ward's bounds, then pad generously so the neighbours that
      // give it context are actually in shot.
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const poly of me.geometry.coordinates) for (const ring of poly) for (const [lon, lat] of ring) {
        const x = lon * kx; if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (lat < y0) y0 = lat; if (lat > y1) y1 = lat;
      }
      const padX = (x1 - x0) * 0.55, padY = (y1 - y0) * 0.55;
      x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
      // Square frame: a long thin ward would otherwise render as a sliver.
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, half = Math.max(x1 - x0, y1 - y0) / 2;
      x0 = cx - half; x1 = cx + half; y0 = cy - half; y1 = cy + half;
      const S = 220, scale = S / (2 * half);
      const PX = (lon) => (lon * kx - x0) * scale;
      const PY = (lat) => S - (lat - y0) * scale;
      const pathFor = (f) => f.geometry.coordinates.map((poly) => poly.map((ring) => {
        let d = '';
        for (let i = 0; i < ring.length; i++) {
          const [lon, lat] = ring[i];
          d += (i ? 'L' : 'M') + PX(lon).toFixed(1) + ',' + PY(lat).toFixed(1);
        }
        return d + 'Z';
      }).join('')).join('');
      // Only draw neighbours that actually intersect the frame.
      const inFrame = (f) => f.geometry.coordinates.some((poly) => poly.some((ring) =>
        ring.some(([lon, lat]) => lon * kx >= x0 && lon * kx <= x1 && lat >= y0 && lat <= y1)));
      const others = geo.features.filter((f) => Number(f.properties.ward) !== ward && inFrame(f));
      const svg = $('loc-map');
      svg.setAttribute('viewBox', `0 0 ${S} ${S}`);
      svg.style.aspectRatio = '1 / 1';
      svg.setAttribute('aria-label', `Map showing the shape and location of Ward ${ward} within Chicago`);
      svg.innerHTML =
        others.map((f) => `<path class="loc-other" d="${pathFor(f)}"></path>`).join('') +
        `<path class="loc-me" d="${pathFor(me)}"></path>` +
        others.map((f) => {
          // Number a neighbour only where its visible piece can hold the digits.
          const lab = f.properties.label; if (!lab) return '';
          const lx = PX(lab[0]), ly = PY(lab[1]);
          if (lx < 12 || lx > S - 12 || ly < 12 || ly > S - 12) return '';
          return `<text class="loc-num" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle">${f.properties.ward}</text>`;
        }).join('');
      $('loc-cap').textContent = wHoods ? `Ward ${ward} - ${wHoods.split(', ')[0]}` : `Ward ${ward}`;
      $('locator').hidden = false;
    }
  } catch { /* the card stands on its own without the map */ }

  // Full office block, so anyone reading a number can act on it without a second search.
  if (ald) {
    const tel = (n) => `tel:${String(n).replace(/[^0-9+]/g, '').slice(0, 11)}`;
    const rows = [];
    if (ald.address) {
      rows.push(`<div class="office-row"><span class="office-k">Ward office</span><span class="office-v">${esc(ald.address.line1)}` +
        (ald.address.line2 ? `<br>${esc(ald.address.line2)}` : '') + `</span></div>`);
    }
    if (ald.phone) {
      // The city lists rollover lines as "(312) 744-6836 / 9867/6213"; link the first, show the rest.
      const first = (ald.phone.match(/\(?\d{3}\)?[ -]?\d{3}-\d{4}/) || [])[0];
      rows.push(`<div class="office-row"><span class="office-k">Phone</span><span class="office-v">` +
        (first ? `<a href="${tel(first)}">${esc(first)}</a>` : esc(ald.phone)) +
        (first && ald.phone.trim() !== first ? ` <span class="office-alt">${esc(ald.phone.replace(first, '').replace(/^[ /]+/, ''))}</span>` : '') +
        `</span></div>`);
    }
    if (ald.email) rows.push(`<div class="office-row"><span class="office-k">Email</span><span class="office-v"><a href="mailto:${esc(ald.email)}">${esc(ald.email)}</a></span></div>`);
    if (ald.website) rows.push(`<div class="office-row"><span class="office-k">Website</span><span class="office-v"><a href="${esc(ald.website)}" rel="noopener">${esc(String(ald.website).replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></span></div>`);
    if (ald.cityHall) {
      rows.push(`<div class="office-row"><span class="office-k">City Hall</span><span class="office-v">${esc(ald.cityHall.line1)}` +
        (ald.cityHall.line2 ? `<br>${esc(ald.cityHall.line2)}` : '') +
        (ald.cityHall.phone ? `<br>${esc(ald.cityHall.phone)}` : '') + `</span></div>`);
    }
    if (rows.length) {
      $('office-detail').innerHTML =
        (ald.name ? `<p class="office-name">Alderperson ${esc(ald.name)}</p>` : '') + rows.join('') +
        `<p class="office-note">Contact details published by the City of Chicago. The ward office handles service requests filed in Ward ${ward}.</p>`;
      $('office').hidden = false;
    }
  }

  function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function receiptUrlAll() {
    const where = `created_date >= '${WIN.from}T00:00:00' AND created_date < '${WIN.to}T00:00:00'` +
      ` AND status='Completed' AND ward=${ward}`;
    const p = new URLSearchParams({ $select: 'sr_number,sr_type,street_address,created_date,closed_date', $where: where, $order: 'created_date DESC', $limit: '1000' });
    return `${D.source.api}?${p}`;
  }

  function receiptUrl(type) {
    const where = `created_date >= '${WIN.from}T00:00:00' AND created_date < '${WIN.to}T00:00:00'` +
      ` AND sr_type='${type.official.replace(/'/g, "''")}' AND status='Completed' AND ward=${ward}`;
    const p = new URLSearchParams({ $select: 'sr_number,street_address,created_date,closed_date', $where: where, $order: 'created_date DESC', $limit: '1000' });
    return `${D.source.api}?${p}`;
  }

  let wins = 0, ranked = 0;

  // Build the rows as data first, so sorting is a re-render rather than DOM surgery.
  const rows = D.types.map((T) => {
    const w = T.wards.find((x) => x.ward === ward);
    const eligible = T.wards.filter((x) => !x.thin);
    const idx = w && !w.thin ? eligible.findIndex((x) => x.ward === ward) : -1;
    if (idx >= 0) { ranked++; if (w.p50 <= T.citywide.p50) wins++; }
    return {
      key: T.key, plain: T.plain, href: `./#${T.key}`,
      wardVal: w ? w.p50 : null,
      cityVal: T.citywide.p50,
      rankIdx: idx >= 0 ? idx + 1 : null,
      rankOf: eligible.length,
      hasData: !!w,
      n: w ? w.n : 0,
      delta: w ? (w.p50 <= T.citywide.p50 ? 'faster than the city' : 'slower than the city') : '',
    };
  });

  // Two decimals everywhere, so right-aligned figures also line up on the decimal point.
  const d2 = (v) => (v === null ? '-' : Number(v).toFixed(2));

  let sortKey = null, sortDir = 'asc';   // null = the published order below
  const VAL = {
    type: (r) => r.plain,
    ward: (r) => (r.wardVal === null ? Infinity : r.wardVal),
    city: (r) => r.cityVal,
    rank: (r) => (r.rankIdx === null ? Infinity : r.rankIdx),
    n:    (r) => r.n,
  };

  function renderRows() {
    let list = rows.slice();
    if (sortKey) {
      const get = VAL[sortKey];
      list.sort((a, b) => {
        const x = get(a), y = get(b);
        // rows with no ranking stay at the bottom whichever way the column is sorted
        if (x === Infinity && y !== Infinity) return 1;
        if (y === Infinity && x !== Infinity) return -1;
        const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
        return sortDir === 'asc' ? c : -c;
      });
    }
    $('card-body').innerHTML = list.map((r) => `<tr>
      <td><a href="${r.href}" style="text-decoration:none"><strong>${esc(r.plain)}</strong></a><div class="row-sub">${r.delta}</div></td>
      <td class="c-num">${d2(r.wardVal)}</td>
      <td class="c-num">${d2(r.cityVal)}</td>
      <td class="c-num">${r.rankIdx !== null ? `${r.rankIdx}/${r.rankOf}` : (r.hasData ? '<span class="unranked">unranked</span>' : '-')}</td>
      <td class="c-num c-vol">${fmt(r.n)}</td>
    </tr>`).join('');

    document.querySelectorAll('#card thead th').forEach((th) => {
      const k = th.dataset.sort;
      const active = k === sortKey;
      th.setAttribute('aria-sort', active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      const ind = th.querySelector('.sort-ind');
      if (ind) ind.textContent = active ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';
      const btn = th.querySelector('.sort-btn');
      if (btn) {
        // label from the column name only; the arrow lives in an aria-hidden span
        if (!btn.dataset.label) btn.dataset.label = btn.textContent.replace(/[\u25B2\u25BC]/g, '').trim();
        btn.setAttribute('aria-label',
          `${btn.dataset.label}: ${active ? (sortDir === 'asc' ? 'sorted low to high' : 'sorted high to low') : 'not sorted'}. Activate to sort.`);
      }
    });
  }

  // Buttons, not click handlers on th, so the headers are reachable and operable by keyboard.
  document.querySelectorAll('#card thead th .sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.closest('th').dataset.sort;
      if (sortKey === k) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortKey = k; sortDir = 'asc'; }
      renderRows();
    });
  });

  renderRows();

  // Provenance, once, under the table instead of a column of repeated links.
  $('table-src').innerHTML =
    `Figures computed from the City of Chicago&rsquo;s public ` +
    `<a href="${esc(D.source.portal)}" rel="noopener">311 Service Requests dataset</a>` +
    ` (${PERIOD}). <a href="${esc(receiptUrlAll())}" rel="noopener">See this ward&rsquo;s completed requests</a>.`;

  $('card').hidden = false;

  $('share').onclick = async () => {
    // Always the per-ward page. location.href may be the legacy ward.html?w=43,
    // whose static meta is generic, so sharing that produced a preview reading
    // "Ward report card" with no ward in it - the whole point of the per-ward
    // pages was to stop that.
    const url = wUrl;
    const text = `Ward ${ward}'s 311 report card - ChiWardBoard`;
    try {
      if (navigator.share) { await navigator.share({ title: text, url }); return; }
      await navigator.clipboard.writeText(url);
      $('share-done').hidden = false; setTimeout(() => { $('share-done').hidden = true; }, 2500);
    } catch { /* user cancelled */ }
  };
})();
