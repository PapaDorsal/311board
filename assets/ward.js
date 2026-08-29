// Ward report card: one ward, every type on the board. Same snapshot as the front page.
(async function () {
  const D = await (await fetch('data/leaderboard.json')).json();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const ward = Number(new URLSearchParams(location.search).get('w'));
  if (!Number.isInteger(ward) || ward < 1 || ward > 50) { $('missing').hidden = false; return; }

  document.title = `Ward ${ward} report card - chiwardboard`;
  const ald = (D.aldermen || {})[ward];
  $('ward-title').textContent = `Ward ${ward}`;
  $('ward-sub').innerHTML = (ald && ald.name ? `Alderperson ${esc(ald.name)}` : 'Alderperson: see the city directory') +
    (ald && ald.website ? ` &middot; <a href="${esc(ald.website)}" rel="noopener">ward website</a>` : '') +
    (ald && ald.email ? ` &middot; <a href="mailto:${esc(ald.email)}">${esc(ald.email)}</a>` : '') +
    ` &middot; ${D.year} numbers`;

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
    ? `Faster than the citywide median in ${wins} of ${ranked} ranked categories. Medians in days; "rank" is fastest-first among wards with enough requests to trust a percentile.`
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
