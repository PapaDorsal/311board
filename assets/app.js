// 311board front page. Renders data/leaderboard.json — the build-time snapshot
// produced by tools/build-data.mjs. Every figure on the page comes from it.
(async function () {
  const res = await fetch('data/leaderboard.json');
  if (!res.ok) return;
  const D = await res.json();

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const word = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));

  // Deadpan duration: the number carries the weight, so keep it plain.
  function human(days) {
    if (days < 1) return 'under a day';
    if (days < 6) { const d = Math.round(days); return d === 1 ? 'about a day' : `about ${word(d)} days`; }
    const w = Math.round(days / 7);
    return w <= 1 ? 'about a week' : `about ${word(w)} weeks`;
  }

  // Receipts: the live rows behind a ward's number, one click away.
  function receiptUrl(ward) {
    const where = `created_date >= '${D.year}-01-01T00:00:00' AND created_date < '${D.year + 1}-01-01T00:00:00'` +
      ` AND sr_type='${D.type.official.replace(/'/g, "''")}' AND status='Completed' AND ward=${ward}`;
    const p = new URLSearchParams({
      $select: 'sr_number,street_address,created_date,closed_date',
      $where: where, $order: 'created_date DESC', $limit: '1000',
    });
    return `${D.source.api}?${p}`;
  }

  // Hook
  const { fastest, slowest, gapDays } = D.headline;
  $('hook-line').textContent =
    `Ward ${slowest.ward} takes ${human(slowest.p50)} to close an abandoned vehicle complaint. ` +
    `Ward ${fastest.ward} takes ${human(fastest.p50)}.`;
  $('hook-sub').innerHTML =
    `Median days to close, ${D.year}: <span class="fig">${slowest.p50}</span> days in Ward ${slowest.ward}, ` +
    `<span class="fig">${fastest.p50}</span> in Ward ${fastest.ward} — a gap of <span class="fig">${gapDays}</span> days.`;
  $('hook').hidden = false;

  // Board
  $('type-plain').textContent = D.type.plain;
  $('type-plain').title = `Official request type: “${D.type.official}”`;
  $('board-year').textContent = D.year;
  const thinCount = D.wards.filter((w) => w.thin).length;
  $('board-note').innerHTML =
    `All ${D.wards.length} wards shown, slowest last. Rank is withheld from the ${word(thinCount)} wards with fewer than ` +
    `<span class="fig">${D.minWardN}</span> completed requests — too few to trust a percentile, too many to hide.`;

  const maxP50 = Math.max(...D.wards.map((w) => w.p50));
  let rank = 0;
  $('lb-body').innerHTML = D.wards.map((w) => {
    const pct = Math.max(1.5, (w.p50 / maxP50) * 100);
    const tag = w.thin ? ` <span class="thin-tag">n &lt; ${D.minWardN}</span>` : '';
    return `<tr${w.thin ? ' class="thin"' : ''}>
      <td class="c-rank">${w.thin ? '–' : ++rank}</td>
      <td class="c-ward">Ward ${w.ward}${tag}</td>
      <td class="c-bar"><div class="barcell"><div class="bar" style="width:${pct.toFixed(1)}%"></div><span class="bar-val">${w.p50}</span></div></td>
      <td class="c-num">${w.p75}</td>
      <td class="c-num">${w.p90}</td>
      <td class="c-num">${fmt(w.n)}</td>
      <td class="c-src"><a href="${esc(receiptUrl(w.ward))}" rel="noopener">rows</a></td>
    </tr>`;
  }).join('');
  $('board').hidden = false;

  // Methodology, at the point of the claim, every number from the snapshot.
  const st = D.totals.statuses, ex = D.exclusions, dg = D.diagnostics;
  const canceled = st.Canceled || 0;
  $('method-list').innerHTML = [
    `“Closed” means status Completed: the city recorded the work as done. ${D.year} filed ` +
    `<span class="fig">${fmt(D.totals.requests)}</span> abandoned-vehicle requests; ` +
    `<span class="fig">${fmt(dg.rowsTimed)}</span> completed ones are timed here` +
    `${canceled ? `; <span class="fig">${fmt(canceled)}</span> cancellations are excluded` : ` (this type had ${word(ex.notCompleted)} cancellations)`}.`,
    `Days to close is closed_date minus created_date, real dates from the record. ` +
    `Same-second closures, the tell for bulk administrative closing: <span class="fig">${word(dg.sameSecondCloses)}</span>. ` +
    `Negative durations dropped: <span class="fig">${word(ex.negativeDurations)}</span>. ` +
    `Rows with no ward dropped: <span class="fig">${word(ex.nullOrZeroWard)}</span>.`,
    `Rows the city flags as duplicates: <span class="fig">${fmt(dg.duplicateFlagged)}</span>, currently included; a stated duplicate policy is on the to-do list.`,
    `Medians and percentiles are computed from the rows, not taken from an aggregate we didn't check.`,
  ].map((s) => `<li>${s}</li>`).join('');
  $('method').hidden = false;

  // Footer
  $('foot-line').innerHTML =
    `Snapshot generated ${new Date(D.generatedAt).toISOString().slice(0, 10)} from live API responses ` +
    `(<span class="fig">${D.run.httpAttempts}</span> requests, <span class="fig">${D.run.retries}</span> retries).`;
  $('foot-portal').href = D.source.portal;
  $('foot').hidden = false;
})();
