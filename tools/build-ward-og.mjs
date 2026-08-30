// One share card per ward (assets/og/ward-N.png), 1200x630, rendered headless.
//
// THE GAP THIS FILLS: per-ward pages fixed the shared *text* - a link to
// ward-27.html previews with "Ward 27: Near West Side" instead of a generic
// title - but every one of the fifty still pointed og:image at the same
// assets/og.png. The picture, which is the part a person actually looks at in
// a message bubble, said nothing about which ward it was.
//
// WHY THERE ARE NO NUMBERS ON THESE CARDS. The obvious card carries the ward's
// headline figure. It must not: the monthly refresh workflow rebuilds the data
// and regenerates the ward pages, but it runs on a CI box with no browser, so
// it cannot re-render fifty PNGs. A card with a figure on it would freeze at
// whatever the number was the day someone last ran this by hand, while the page
// beside it moved on - a wrong number in the most-shared surface on the site.
// So the card carries only what does not go stale: which ward this is, and
// which neighbourhoods that means. The figures live on the page, and the
// og:description (regenerated with every page) carries the alderperson.
//
// Playwright may be installed locally or globally depending on the machine;
// createRequire finds it either way, and NODE_PATH covers the global install.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const OUT_DIR = 'assets/og';
const NB = JSON.parse(readFileSync('data/ward-neighborhoods.json', 'utf8')).wards || {};
const STAR = 'M10,0 L7.6,5.84 L1.34,5 L5.2,10 L1.34,15 L7.6,14.16 L10,20 ' +
  'L12.4,14.16 L18.66,15 L14.8,10 L18.66,5 L12.4,5.84 Z';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Two neighbourhoods, not three: the card is read at thumbnail size in a chat
// list, and a third name shrinks the line past where it is worth having.
const hoodsFor = (w) => ((NB[w] || {}).names || []).slice(0, 2).join(' & ');

function card(w) {
  const hoods = hoodsFor(w);
  return `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; width:1200px; height:630px; background:#fbfbf9; box-sizing:border-box;
         font-family:system-ui,sans-serif; display:flex; flex-direction:column;
         justify-content:center; padding:0 90px; }
  .flag { width:210px; height:66px; margin-bottom:40px; }
  .stripe { fill:#7cc6e8; } .stars path { fill:#e4002b; }
  h1 { font-size:150px; line-height:0.95; margin:0; font-weight:800;
       letter-spacing:-.02em; color:#14141a; }
  .hoods { font-size:46px; line-height:1.15; color:#14141a; margin:22px 0 0; font-weight:600; }
  .rule { width:150px; height:9px; background:#e4002b; margin:38px 0 26px; }
  .wm { font-size:31px; color:#52514e; margin:0; font-weight:600; }
  .wm b { color:#0e6ba8; font-weight:800; }
  .wm span { color:#14141a; font-weight:800; }
</style>
<body>
  <svg class="flag" viewBox="0 0 64 20">
    <rect y="3" width="64" height="4" class="stripe"/><rect y="13" width="64" height="4" class="stripe"/>
    <g class="stars" transform="translate(6,5) scale(0.5)">
      <path d="${STAR}"/><path transform="translate(28,0)" d="${STAR}"/>
      <path transform="translate(56,0)" d="${STAR}"/><path transform="translate(84,0)" d="${STAR}"/>
    </g>
  </svg>
  <h1>Ward ${w}</h1>
  ${hoods ? `<p class="hoods">${esc(hoods)}</p>` : ''}
  <div class="rule"></div>
  <p class="wm"><span>Chi</span><b>Ward</b><span>Board</span> &middot; 311 response times, ranked by ward</p>
</body>`;
}

mkdirSync(OUT_DIR, { recursive: true });
const exe = process.env.CHROME_PATH || undefined;
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
let n = 0;
for (let w = 1; w <= 50; w++) {
  await p.setContent(card(w), { waitUntil: 'load' });
  writeFileSync(`${OUT_DIR}/ward-${w}.png`, await p.screenshot({ type: 'png' }));
  n++;
  process.stdout.write(`\rrendered ${n}/50`);
}
await b.close();
console.log(`\n${n} ward cards written to ${OUT_DIR}/`);
