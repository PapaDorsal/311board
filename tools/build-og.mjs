// Share card (assets/og.png), 1200x630, rendered headless.
//
// This is the image that shows up when someone texts the link, so it is the
// first thing most visitors ever see of the board. It says what the site is and
// nothing else: the flag, the name, one line about what you get. The window the
// data covers, the record count and the ward count all used to sit here too and
// they read as small print on a card nobody is going to study - that detail
// belongs on the page, where a reader has asked for it.
// Playwright may be installed locally or globally depending on the machine;
// createRequire finds it either way, and NODE_PATH covers the global install.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const OUT = 'assets/og.png';
// Not the same words as og:title. iMessage renders the title in bold directly
// beneath this image, so a tagline that repeats it printed the identical
// sentence twice in one card. The title is the hook; the image says what the
// site is. This line also has to make sense under a ward page's title, since
// every page shares this one card.
const TAGLINE = 'Chicago 311 response times, ranked by ward.';
const STAR = 'M10,0 L7.6,5.84 L1.34,5 L5.2,10 L1.34,15 L7.6,14.16 L10,20 ' +
  'L12.4,14.16 L18.66,15 L14.8,10 L18.66,5 L12.4,5.84 Z';

const html = `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; width:1200px; height:630px; background:#fbfbf9; box-sizing:border-box;
         font-family:system-ui,sans-serif; display:flex; flex-direction:column;
         justify-content:center; padding:0 90px; }
  .flag { width:300px; height:94px; margin-bottom:52px; }
  .stripe { fill:#7cc6e8; } .stars path { fill:#e4002b; }
  h1 { font-size:96px; line-height:1; margin:0 0 30px; font-weight:800;
       letter-spacing:-.01em; color:#14141a; }
  h1 span { color:#0e6ba8; }
  p  { font-size:40px; line-height:1.25; color:#52514e; margin:0; }
  .rule { width:150px; height:9px; background:#e4002b; margin-top:44px; }
</style>
<body>
  <svg class="flag" viewBox="0 0 64 20">
    <rect y="3" width="64" height="4" class="stripe"/><rect y="13" width="64" height="4" class="stripe"/>
    <g class="stars" transform="translate(6,5) scale(0.5)">
      <path d="${STAR}"/><path transform="translate(28,0)" d="${STAR}"/>
      <path transform="translate(56,0)" d="${STAR}"/><path transform="translate(84,0)" d="${STAR}"/>
    </g>
  </svg>
  <h1>Chi<span>Ward</span>Board</h1>
  <p>${TAGLINE}</p>
  <div class="rule"></div>
</body>`;

const exe = process.env.CHROME_PATH || undefined;
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await p.setContent(html, { waitUntil: 'load' });
writeFileSync(OUT, await p.screenshot({ type: 'png' }));
await b.close();
console.log(`${OUT} written`);
