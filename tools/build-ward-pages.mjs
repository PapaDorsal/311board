// One static page per ward, so a shared link identifies the ward.
//
// THE BUG THIS FIXES: ward.js sets the title and og: tags per ward, but it does
// it in JavaScript. Link crawlers - iMessage, Slack, Twitter, Facebook - read
// the HTML as served and do not run scripts, so every one of the fifty wards
// previewed as the same card: "Ward report card - ChiWardBoard". Sending
// someone their own ward told them nothing about which ward it was.
//
// Fixing that needs the identifying text present in the served bytes, which on
// a static site means a file per ward. Each one is the ward.html shell with its
// own title, description and canonical baked in; the stylesheet and script are
// shared, so the extra weight is a few KB of markup each.
//
// Files are written at the repository root as ward-27.html rather than in a
// ward/ directory: the shell references assets/app.css, assets/ward.js and
// data/leaderboard.json relatively, and a subdirectory would break all three.
//
// ward.html?w=27 keeps working. Links shared before this existed still resolve.
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';

const BASE = 'https://chiwardboard.com';
const shell = readFileSync('ward.html', 'utf8');
const D = JSON.parse(readFileSync('data/leaderboard.json', 'utf8'));
const NB = JSON.parse(readFileSync('data/ward-neighborhoods.json', 'utf8')).wards || {};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Clear out stale pages first, so a ward that loses its page does not linger.
for (const f of readdirSync('.')) if (/^ward-\d+\.html$/.test(f)) unlinkSync(f);

let written = 0;
for (let w = 1; w <= 50; w++) {
  const hoods = ((NB[w] || {}).names || []).slice(0, 3).join(', ');
  const ald = ((D.aldermen || {})[w] || {}).name || '';
  // The title is what a person actually sees in a message bubble, so the ward
  // number leads and the neighbourhoods follow: "Ward 27" is the identifier,
  // "Near West Side" is what makes it recognisable to someone who lives there.
  const title = `Ward ${w}${hoods ? `: ${hoods}` : ''} - ChiWardBoard`;
  const desc = `How fast the city closes 311 requests in Chicago's Ward ${w}` +
    (hoods ? ` (${hoods})` : '') + (ald ? `, represented by ${ald}` : '') +
    `: ${D.types.length} request types ranked against the other 49 wards, from public records.`;
  const url = `${BASE}/ward-${w}.html`;

  let html = shell;
  const sub = (pattern, replacement) => {
    const before = html;
    html = html.replace(pattern, replacement);
    if (html === before) throw new Error(`ward ${w}: pattern did not match, template changed? ${pattern}`);
  };
  sub(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  sub(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`);
  sub(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`);
  sub(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`);
  sub(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`);
  sub(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`);
  sub(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${esc(title)}">`);
  sub(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${esc(desc)}">`);
  // Its own card, rendered by build-ward-og.mjs. Versioned like the shared one:
  // crawlers cache the picture hard, and these replace an image they have
  // already fetched for this URL.
  const img = `${BASE}/assets/og/ward-${w}.png?v=1`;
  const cardHoods = ((NB[w] || {}).names || []).slice(0, 2).join(' & ');
  const imgAlt = `Ward ${w}${cardHoods ? `, ${cardHoods}` : ''} - ChiWardBoard`;
  sub(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${img}">`);
  sub(/<meta property="og:image:alt" content="[^"]*">/, `<meta property="og:image:alt" content="${esc(imgAlt)}">`);
  sub(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${img}">`);
  // The script reads this rather than the query string on these pages.
  sub(/<body([^>]*)>/, `<body$1 data-ward="${w}">`);

  writeFileSync(`ward-${w}.html`, html);
  written++;
}
console.log(`${written} ward pages written (ward-1.html .. ward-50.html)`);
