// The citywide list of requests nobody came for. Reads data/stuck.json, which
// build-stuck.mjs writes; the page makes no live calls and loads nothing from
// Google - "see the spot" is an ordinary outbound link.
(async function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('en-US');

  let D;
  try {
    const r = await fetch('data/stuck.json');
    if (!r.ok) throw new Error(String(r.status));
    D = await r.json();
  } catch {
    $('lead').textContent = 'The list did not load. Reload the page, or read the raw data at data/stuck.json.';
    return;
  }

  const sv = (ll) => (ll ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ll[0]},${ll[1]}` : null);
  // Years once it is past two, because "1223 days" is a number people have to
  // convert in their head before it means anything.
  const ago = (d) => (d >= 730 ? `${(d / 365).toFixed(1)} years` : d >= 365 ? 'over a year' : `${d} days`);

  const oldest = D.citywide.oldest[0];
  $('lead').innerHTML =
    `<span class="fig">${fmt(D.citywide.total)}</span> requests about Chicago&rsquo;s own street lights, sidewalks and roads ` +
    `have been open more than a year. The oldest has been waiting <span class="fig">${ago(oldest.days)}</span>.`;

  const byType = Object.entries(D.citywide.byType).sort((a, b) => b[1] - a[1]);
  $('summary').innerHTML = byType.map(([k, v]) => `<span><b>${fmt(v)}</b> ${esc(k.toLowerCase())}</span>`).join('');

  const row = (t, showWard) => {
    const pano = sv(t.ll);
    return `<li class="stuck-item">
      <div class="stuck-head">${showWard ? `<a class="stuck-ward" href="ward-${t.ward}.html">Ward ${t.ward}</a> &middot; ` : ''}` +
      `<strong>${esc(t.type)}</strong>${t.address ? ` &middot; ${esc(t.address)}` : ''}</div>
      <div class="stuck-meta">Reported ${esc(t.created)} &middot; open <span class="fig">${ago(t.days)}</span>` +
      `${t.checks > 1 ? ` &middot; still open at <span class="fig">${t.checks}</span> checks since ${esc(t.watchedSince)}` : ''}` +
      `${t.dept ? ` &middot; ${esc(t.dept.replace(/ - .*$/, ''))}` : ''}</div>
      <div class="stuck-meta"><span class="stuck-sr">${esc(t.sr)}</span>` +
      `${pano ? ` &middot; <a href="${esc(pano)}" rel="noopener nofollow">see the spot</a>` : ''}</div>
    </li>`;
  };

  $('stuck-title').textContent = `The ${D.citywide.oldest.length} longest waits in Chicago`;
  $('stuck-list').innerHTML = D.citywide.oldest.map((t) => row(t, true)).join('');
  $('stuck-note').innerHTML =
    `Oldest first, every one of them, with no picking. Each ward page carries its own list. ` +
    `Figures from the city&rsquo;s public 311 records, refreshed ${esc(D.generatedAt.slice(0, 10))}.`;
  $('stuck').hidden = false;

  // The payoff, and it only exists because the site kept watching. Empty on the
  // first run by definition: nothing has been observed twice yet.
  if ((D.closed || []).length) {
    $('closed-lead').innerHTML =
      `These were on the list and are not any more. The city marked them complete after the wait shown.`;
    $('closed-list').innerHTML = D.closed.map((t) => `<li class="stuck-item">
      <div class="stuck-head">${t.ward ? `<a class="stuck-ward" href="ward-${t.ward}.html">Ward ${t.ward}</a> &middot; ` : ''}` +
      `<strong>${esc(t.type || 'Request')}</strong>${t.address ? ` &middot; ${esc(t.address)}` : ''}</div>
      <div class="stuck-meta">Closed ${esc(t.closedOn)} after <span class="fig">${ago(t.days)}</span> &middot; ` +
      `<span class="stuck-sr">${esc(t.sr)}</span></div>
    </li>`).join('');
    $('closed').hidden = false;
  }
})();
