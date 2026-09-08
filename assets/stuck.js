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
  // Named from the data, not written down. The list of qualifying types is
  // decided by a measurement at build time, so a sentence naming them by hand
  // goes wrong the moment the city speeds one up - as it did when street lights
  // dropped out and the copy still claimed them.
  const kinds = (D.types || []).map((t) => {
    const s = String(t.name || t).toLowerCase().replace(/ (repair|out|debris)$/, '');
    return s.endsWith('s') ? s : s + 's';
  });
  const kindList = kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}` : kinds[0] || 'infrastructure';
  $('lead').innerHTML =
    `<span class="fig">${fmt(D.citywide.total)}</span> requests about Chicago&rsquo;s own ${esc(kindList)} ` +
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

  // The share text carries the finding, not the page name. A link that arrives
  // saying "Open more than a year" is a title; one that says how many and for
  // how long is the reason to open it.
  $('share').onclick = async () => {
    const url = 'https://chiwardboard.com/stuck.html';
    const text = `${fmt(D.citywide.total)} requests about Chicago's own ${kindList} have been open more than a year. ` +
      `The oldest has been waiting ${ago(oldest.days)}.`;
    try {
      if (navigator.share) { await navigator.share({ title: 'Open more than a year - ChiWardBoard', text, url }); return; }
      await navigator.clipboard.writeText(`${text} ${url}`);
      $('share-done').hidden = false; setTimeout(() => { $('share-done').hidden = true; }, 2500);
    } catch { /* user cancelled */ }
  };

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
