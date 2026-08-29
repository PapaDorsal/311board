// Ward report card: one ward, every type on the board. Same snapshot as the front page.
(async function () {
  const D = await (await fetch('data/leaderboard.json')).json();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const ward = Number(new URLSearchParams(location.search).get('w'));
  if (!Number.isInteger(ward) || ward < 1 || ward > 50) { $('missing').hidden = false; return; }

  // Per-ward identity so tabs, browser history and shared links are distinguishable.
  const BASE = 'https://chiwardboard.vercel.app';
  const wTitle = `Ward ${ward} - CHIWARDBOARD`;
  const aldName = ((D.aldermen || {})[ward] || {}).name;
  const wDesc = `How fast the city closes 311 requests in Chicago's Ward ${ward}` +
    (aldName ? ` (Alderperson ${aldName})` : '') +
    `: ${D.types.length} request types, ranked against the other 49 wards, from public records.`;
  document.title = wTitle;
  const setMeta = (sel, attr, val) => {
    let el = document.head.querySelector(sel);
    if (!el) { el = document.createElement(sel.startsWith('link') ? 'link' : 'meta');
      const m = sel.match(/\[(\w+)="([^"]+)"\]/); if (m) el.setAttribute(m[1], m[2]);
      document.head.appendChild(el); }
    el.setAttribute(attr, val);
  };
  const wUrl = `${BASE}/ward.html?w=${ward}`;
  setMeta('meta[name="description"]', 'content', wDesc);
  setMeta('link[rel="canonical"]', 'href', wUrl);
  setMeta('meta[property="og:url"]', 'content', wUrl);
  setMeta('meta[property="og:title"]', 'content', wTitle);
  setMeta('meta[property="og:description"]', 'content', wDesc);
  setMeta('meta[name="twitter:title"]', 'content', wTitle);
  setMeta('meta[name="twitter:description"]', 'content', wDesc);
  const ald = (D.aldermen || {})[ward];
  $('ward-title').textContent = `Ward ${ward}`;
  $('ward-sub').innerHTML = (ald && ald.name ? `Alderperson ${esc(ald.name)}` : 'Alderperson: see the city directory') +
    ` &middot; ${D.year} numbers`;

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
  function receiptUrl(type) {
    const where = `created_date >= '${D.year}-01-01T00:00:00' AND created_date < '${D.year + 1}-01-01T00:00:00'` +
      ` AND sr_type='${type.official.replace(/'/g, "''")}' AND status='Completed' AND ward=${ward}`;
    const p = new URLSearchParams({ $select: 'sr_number,street_address,created_date,closed_date', $where: where, $order: 'created_date DESC', $limit: '1000' });
    return `${D.source.api}?${p}`;
  }

  let wins = 0, ranked = 0;
  $('card-body').innerHTML = D.types.map((T) => {
    const w = T.wards.find((x) => x.ward === ward);
    const eligible = T.wards.filter((x) => !x.thin);
    const idx = w && !w.thin ? eligible.findIndex((x) => x.ward === ward) : -1;
    if (idx >= 0) { ranked++; if (w.p50 <= T.citywide.p50) wins++; }
    const rank = idx >= 0 ? `${idx + 1}/${eligible.length}` : (w ? 'unranked' : ' - ');
    const delta = w ? (w.p50 <= T.citywide.p50 ? 'faster than the city' : 'slower than the city') : '';
    return `<tr>
      <td><a href="./#${T.key}" style="text-decoration:none"><strong>${esc(T.plain)}</strong></a><div class="row-sub">${delta}</div></td>
      <td class="c-num">${w ? w.p50 : ' - '}</td>
      <td class="c-num">${T.citywide.p50}</td>
      <td class="c-num">${rank}</td>
      <td class="c-num">${w ? fmt(w.n) : '0'}</td>
      <td class="c-src">${w ? `<a href="${esc(receiptUrl(T))}" rel="noopener">rows</a>` : ''}</td>
    </tr>`;
  }).join('');
  $('card-note').textContent = ranked
    ? `Faster than the citywide typical time in ${wins} of ${ranked} ranked categories. Figures are median days - the middle request, half faster and half slower. Rank is fastest-first among the wards that handled enough of these requests for the numbers to mean something.`
    : 'Not enough requests in any category to rank this ward.';
  $('card').hidden = false;

  $('share').onclick = async () => {
    const url = location.href;
    const text = `Ward ${ward}'s 311 report card - chiwardboard`;
    try {
      if (navigator.share) { await navigator.share({ title: text, url }); return; }
      await navigator.clipboard.writeText(url);
      $('share-done').hidden = false; setTimeout(() => { $('share-done').hidden = true; }, 2500);
    } catch { /* user cancelled */ }
  };
})();
