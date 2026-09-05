// Ward report card: one ward, every type on the board. Same snapshot as the front page.
(async function () {
  // Same three windows the board offers, and the same reason earlier years are
  // not among them: the ward map changed in May 2023, so a 2022 figure would
  // describe a different area under the same ward number.
  const WINDOWS = [
    { key: 'rolling', pill: 'Last 12 months', file: 'data/leaderboard.json' },
    { key: '2024', pill: '2024', file: 'data/leaderboard-2024.json' },
    { key: '2025', pill: '2025', file: 'data/leaderboard-2025.json' },
  ];
  const winCache = new Map();
  async function loadWin(key) {
    if (winCache.has(key)) return winCache.get(key);
    const w = WINDOWS.find((x) => x.key === key);
    const r = await fetch(w.file);
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    winCache.set(key, j);
    return j;
  }
  // A shared ward-12.html#2024 has to land on 2024, so the window is resolved
  // before anything renders rather than switched after first paint.
  const hm = (location.hash || '').match(/^#([\w-]+)$/);
  let winKey = hm && WINDOWS.some((w) => w.key === hm[1]) && hm[1] !== 'rolling' ? hm[1] : 'rolling';
  let D, WIN, PERIOD;
  function adoptData(d) {
    D = d;
    WIN = d.window || { from: `${d.year}-01-01`, to: `${d.year + 1}-01-01`, label: String(d.year) };
    PERIOD = WIN.label;
  }
  try { adoptData(await loadWin(winKey)); }
  catch { winKey = 'rolling'; adoptData(await loadWin('rolling')); }
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
  const wHoods = ((NB[ward] || {}).names || []).join(', ');
  // The same shape build-ward-pages.mjs bakes into the file, so the tab title
  // does not lose the neighbourhood names the moment the script runs.
  const wTitle = `Ward ${ward}${wHoods ? `: ${wHoods.split(', ').slice(0, 3).join(', ')}` : ''} - ChiWardBoard`;
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
    const keep = winKey === 'rolling' ? '' : `#${winKey}`;
    try { history.replaceState(null, '', `ward-${ward}.html${keep}`); } catch { /* file:// and the like */ }
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
  function renderSub() {
    $('ward-sub').innerHTML = (wHoods ? `<span class="hood-line">${esc(wHoods)}</span><br>` : '') +
      (ald && ald.name ? `Alderperson ${esc(ald.name)}` : 'Alderperson: see the city directory') +
      ` &middot; ${PERIOD}`;
  }
  renderSub();

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
        `<p class="office-note">Contact details from the City of Chicago&rsquo;s Ward Offices directory, with broken links corrected. The ward office handles service requests filed in Ward ${ward}.</p>`;
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

  // Build the rows as data first, so sorting is a re-render rather than DOM surgery.
  let rows = [];
  const buildRows = () => D.types.map((T) => {
    // A backlog type is ranked on the share the city never finished rather than
    // on how long the finished ones took, so its row carries percentages and its
    // rank runs worst-first. See the note in tools/build-data.mjs.
    const back = T.metric === 'backlog';
    const w = T.wards.find((x) => x.ward === ward);
    const eligible = T.wards.filter((x) => !x.thin);
    const idx = w && !w.thin ? eligible.findIndex((x) => x.ward === ward) : -1;
    const wv = w ? (back ? w.pct : w.p50) : null;
    const cv = back ? T.citywide.pct : T.citywide.p50;
    return {
      key: T.key, plain: T.plain, back,
      href: `./#${T.key}${winKey === 'rolling' ? '' : `-${winKey}`}`,
      wardVal: wv, cityVal: cv,
      rankIdx: idx >= 0 ? idx + 1 : null,
      rankOf: eligible.length,
      hasData: !!w,
      // Every column keeps one unit down its length: "Completed" is always a
      // count of requests the city finished, "Still open" always a share. On a
      // backlog row the finished count is the judged set minus the ones still
      // open, since that type carries no separate completion total.
      n: w ? (back ? w.mature - w.open : w.n) : 0,
      open: w ? (back ? w.pct : w.openShare) : null,
      // A ward whose curve never reached the median has no figure to compare;
      // null <= anything is true, and it used to read "faster than the city".
      delta: wv === null || cv === null ? ''
        : back ? (wv <= cv ? 'less left unfinished than the city' : 'more left unfinished than the city')
        : (wv <= cv ? 'faster than the city' : 'slower than the city'),
    };
  });

  // One decimal, matching the board's d1: the second decimal is false precision
  // on a median over a few hundred requests, and a small-but-nonzero value says
  // so rather than rounding into the same-day wards.
  const d2 = (v) => (v === null || v === undefined ? '-'
    : (v > 0 && v < 0.05 ? '<0.1' : Number(v).toFixed(1)));
  // A backlog row is a percentage, so it never takes the days formatting.
  const cell = (r, v) => (v === null || v === undefined ? '-' : r.back ? `${Math.round(v)}%` : d2(v));

  let sortKey = null, sortDir = 'asc';   // null = the published order below
  const VAL = {
    type: (r) => r.plain,
    ward: (r) => (r.wardVal === null ? Infinity : r.wardVal),
    city: (r) => r.cityVal,
    rank: (r) => (r.rankIdx === null ? Infinity : r.rankIdx),
    n:    (r) => r.n,
    open: (r) => (r.open === null ? -1 : r.open),
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
      <td class="c-num">${cell(r, r.wardVal)}</td>
      <td class="c-num">${cell(r, r.cityVal)}</td>
      <td class="c-num"${r.rankIdx === null && r.hasData ? ' title="Too few of these in this ward to rank it"' : ''}>${r.rankIdx !== null ? `${r.rankIdx}/${r.rankOf}` : (r.hasData ? '<span class="unranked">too few</span>' : '-')}</td>
      <td class="c-num c-vol">${fmt(r.n)}</td>
      <td class="c-num c-vol">${r.open === null ? '-' : Math.round(r.open) + '%'}</td>
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

  // Provenance, once, under the table instead of a column of repeated links.
  function renderSrc() {
    $('table-src').innerHTML =
      `Figures computed from the City of Chicago&rsquo;s public ` +
      `<a href="${esc(D.source.portal)}" rel="noopener">311 Service Requests dataset</a>` +
      ` (${PERIOD}). <a href="${esc(receiptUrlAll())}" rel="noopener">See this ward&rsquo;s completed requests</a>.`;
  }

  function renderWindows() {
    $('windows').innerHTML = WINDOWS.map((w) =>
      `<button type="button" data-win="${w.key}" aria-pressed="${w.key === winKey}">${esc(w.pill)}</button>`).join('');
    $('windows').hidden = false;
  }

  // Everything downstream of the snapshot, in one place, so switching a window
  // is the same code path as the first paint. The chosen sort survives it.
  function renderCard() {
    rows = buildRows();
    renderSub();
    renderRows();
    renderSrc();
    renderWindows();
  }
  renderCard();

  $('windows').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.win === winKey) return;
    try { await loadWin(b.dataset.win); }
    catch { $('table-src').textContent = 'That year failed to load - try again.'; return; }
    winKey = b.dataset.win;
    adoptData(winCache.get(winKey));
    // The address bar should be shareable at the year on screen.
    try { history.replaceState(null, '', winKey === 'rolling' ? `ward-${ward}.html` : `ward-${ward}.html#${winKey}`); } catch { /* file:// */ }
    renderCard();
  });

  // ---- what nobody came for ----
  // The aggregates above say a ward is slow or unfinished. This says which
  // corner. Every entry is a city-owned asset - a light, a sidewalk, a pothole -
  // so naming the address names a place and not a neighbour. See the public-way
  // rule at the top of tools/build-stuck.mjs.
  const sv = (ll) => (ll ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ll[0]},${ll[1]}` : null);
  const ago = (d) => (d >= 730 ? `${(d / 365).toFixed(1)} years` : d >= 365 ? 'over a year' : `${d} days`);
  try {
    const skRes = await fetch('data/stuck.json');
    if (skRes.ok) {
      const SK = await skRes.json();
      const mine = (SK.wards || {})[ward];
      if (mine && mine.total > 0) {
        $('stuck-lead').innerHTML =
          `<span class="fig">${fmt(mine.total)}</span> request${mine.total === 1 ? '' : 's'} on city property in Ward ${ward} ` +
          `${mine.total === 1 ? 'has' : 'have'} been open more than a year. The oldest ${mine.tickets.length === 1 ? 'one' : `${mine.tickets.length}`}:`;
        $('stuck-list').innerHTML = mine.tickets.map((t) => {
          const pano = sv(t.ll);
          return `<li class="stuck-item">
            <div class="stuck-head"><strong>${esc(t.type)}</strong>${t.address ? ` &middot; ${esc(t.address)}` : ''}</div>
            <div class="stuck-meta">Reported ${esc(t.created)} &middot; open <span class="fig">${ago(t.days)}</span>` +
            `${t.checks > 1 ? ` &middot; still open at <span class="fig">${t.checks}</span> checks since ${esc(t.watchedSince)}` : ''}` +
            `${t.dept ? ` &middot; ${esc(t.dept.replace(/ - .*$/, ''))}` : ''}</div>
            <div class="stuck-meta"><span class="stuck-sr">${esc(t.sr)}</span>` +
            `${pano ? ` &middot; <a href="${esc(pano)}" rel="noopener nofollow">see the spot</a>` : ''}</div>
          </li>`;
        }).join('');
        $('stuck-note').innerHTML =
          `Oldest first, no picking: every request on city-owned infrastructure still open past a year. ` +
          `Complaints about private property are never listed here. ` +
          `<a href="stuck.html">The longest waits citywide &rarr;</a>`;
        $('stuck').hidden = false;
      }
    }
  } catch { /* the card stands on its own without it */ }

  // ---- cycling context ----
  // Deliberately not a rank and never sorted against other wards. A ward with
  // more crashes is usually a ward with more cycling: the Loop leads the city
  // because that is where people ride, not because it is run worse. Correcting
  // for that needs ridership per ward, which nobody publishes. So this states
  // what happened here and leaves the comparison alone. See the header of
  // tools/build-bike-context.mjs.
  try {
    const bcRes = await fetch('data/bike-context.json');
    if (bcRes.ok) {
      const BC = await bcRes.json();
      const b = (BC.wards || {})[ward];
      if (b && (b.crashes > 0 || b.laneMiles > 0)) {
        const yrs = BC.window.years;
        const stat = (v, label, sub) =>
          `<div class="bstat"><div class="bstat-v">${v}</div><div class="bstat-k">${label}</div>${sub ? `<div class="bstat-s">${sub}</div>` : ''}</div>`;
        $('bike-stats').innerHTML =
          stat(fmt(b.crashes), `crashes involving someone on a bike`, `in the last ${yrs} years`) +
          stat(fmt(b.serious), `left someone seriously hurt or killed`, `of those crashes`) +
          stat(`${b.laneMiles.toFixed(1)} mi`, `of bike route in this ward`, `${b.protectedLaneMiles.toFixed(1)} mi of it physically protected`);
        $('bike-note').innerHTML =
          `Crash counts follow how much cycling a ward carries and what kind of streets it has, so they are printed here as facts about this place, not as a score. ` +
          `Citywide over the same ${yrs} years: <span class="fig">${fmt(BC.citywide.crashes)}</span> crashes, <span class="fig">${fmt(BC.citywide.serious)}</span> serious or fatal, ` +
          `across <span class="fig">${BC.citywide.laneMiles.toFixed(0)}</span> miles of bike route. ` +
          `From the city's <a href="${esc(BC.sources.crashes.portal)}" rel="noopener">traffic crash</a> and <a href="${esc(BC.sources.routes.portal)}" rel="noopener">bike route</a> datasets, placed into wards by their coordinates.`;
        $('bike').hidden = false;
      }
    }
  } catch { /* the card stands on its own without it */ }

  $('card').hidden = false;

  $('share').onclick = async () => {
    // Always the per-ward page. location.href may be the legacy ward.html?w=43,
    // whose static meta is generic, so sharing that produced a preview reading
    // "Ward report card" with no ward in it - the whole point of the per-ward
    // pages was to stop that.
    const url = winKey === 'rolling' ? wUrl : `${wUrl}#${winKey}`;
    const text = winKey === 'rolling'
      ? `Ward ${ward}'s 311 report card - ChiWardBoard`
      : `Ward ${ward}'s 311 report card for ${PERIOD} - ChiWardBoard`;
    try {
      if (navigator.share) { await navigator.share({ title: text, url }); return; }
      await navigator.clipboard.writeText(url);
      $('share-done').hidden = false; setTimeout(() => { $('share-done').hidden = true; }, 2500);
    } catch { /* user cancelled */ }
  };
})();
