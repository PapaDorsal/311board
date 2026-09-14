// Named checks for the iframe height message.
//
// chiwardboard is embedded in an iframe on stcchicago.org. An iframe does not
// size itself to its content, so the embedding page sets a fixed height and
// resizes on a { type: 'cwb:height', height } message from us. These checks
// hold that contract: the message is sent, it carries the real content height,
// it goes to a named origin rather than the wildcard, a ward page sends its own
// height on its own load, and a visitor who is not embedded gets nothing.
//
// TESTING NOTE, learned the hard way: do not record by wrapping
// window.parent.postMessage. The iframe is same-origin here, so the wrapper is
// installed on the parent's own function object and chains with any wrapper a
// previous realm of the same frame left behind - every call then records twice
// and looks like a duplicate-message bug in embed.js that is not there.
// Replace window.parent with a stub instead. Nothing chains, and the count is
// exactly what embed.js emitted.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const ROOT = process.cwd();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

let framePath = '/index.html';
const srv = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/parent.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<!doctype html><title>host</title><iframe src="${framePath}" style="width:100%;height:400px;border:0"></iframe>`);
  }
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}`;

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}${extra ? '  ' + extra : ''}`); } };

const STUB = `(() => {
  if (window.parent === window) return;
  window.__posts = [];
  const stub = { postMessage: (m, o) => window.__posts.push({ m, o }) };
  Object.defineProperty(window, 'parent', { get: () => stub });
})()`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function embedded(path) {
  framePath = path;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  await ctx.addInitScript(STUB);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/parent.html`);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await frame.waitForTimeout(2500);
  const read = async () => {
    const posts = (await frame.evaluate(() => window.__posts)).filter((p) => p.m && p.m.type === 'cwb:height');
    const real = await frame.evaluate(() => document.documentElement.scrollHeight);
    return { posts, real };
  };
  return { ctx, frame, errors, read };
}

console.log('embed height message');

{
  const { ctx, errors, read } = await embedded('/index.html');
  const { posts, real } = await read();
  check('the board posts cwb:height when embedded', posts.length > 0);
  const last = posts.length ? posts[posts.length - 1].m.height : 0;
  check('the posted height matches the real content height', Math.abs(last - real) <= 2, `posted ${last}, real ${real}`);
  check('the height is a number, not a string', posts.every((p) => typeof p.m.height === 'number'));
  check('the target origin is never the wildcard', posts.every((p) => p.o !== '*'), posts.map((p) => p.o).join(' '));
  check('both stcchicago origins are addressed', ['https://stcchicago.org', 'https://www.stcchicago.org'].every((o) => posts.some((p) => p.o === o)));
  const seq = posts.filter((p) => p.o === 'https://stcchicago.org').map((p) => p.m.height);
  check('no height is posted twice in a row', seq.every((v, i) => i === 0 || v !== seq[i - 1]), seq.join(','));
  check('an embedded page throws no error', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

{
  // Matt's second report: a ward page opens partway down. A ward link is a real
  // document load, so the frame is still sized for the board until this fires.
  const { ctx, read } = await embedded('/ward-27.html');
  const { posts, real } = await read();
  check('a ward page posts its height on its own load', posts.length > 0);
  const last = posts.length ? posts[posts.length - 1].m.height : 0;
  check('the ward height is the ward page height, not the board height', Math.abs(last - real) <= 2, `posted ${last}, real ${real}`);
  await ctx.close();
}

{
  // A category switch changes the board's length without a navigation.
  const { ctx, frame, read } = await embedded('/index.html');
  const before = (await read()).posts.length;
  const pills = await frame.$$('#types button[data-key]:not([disabled])');
  let clicked = false;
  for (const p of pills) {
    if (await p.getAttribute('aria-pressed') === 'true') continue;
    await p.click();
    clicked = true;
    break;
  }
  await frame.waitForTimeout(1500);
  const { posts, real } = await read();
  check('a switchable category was present', clicked);
  check('a category switch posts again', posts.length > before, `${before} then ${posts.length}`);
  check('the height after a switch matches the content', posts.length && Math.abs(posts[posts.length - 1].m.height - real) <= 2, `posted ${posts.length ? posts[posts.length - 1].m.height : 'none'}, real ${real}`);
  await ctx.close();
}

{
  // Most visitors are not embedded. They must get no message and no error.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  await ctx.addInitScript(`window.__posts = []; const real = window.postMessage.bind(window); window.postMessage = (m, o) => { window.__posts.push({ m, o }); return real(m, o); };`);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/index.html`);
  await page.waitForTimeout(2000);
  const posts = await page.evaluate(() => window.__posts.filter((p) => p.m && p.m.type === 'cwb:height'));
  check('a direct visitor posts nothing', posts.length === 0, JSON.stringify(posts));
  check('a direct visitor throws no error', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

{
  const pages = ['index.html', 'ward.html', 'stuck.html', 'about.html', 'privacy.html', 'terms.html'];
  for (let w = 1; w <= 50; w++) pages.push(`ward-${w}.html`);
  const missing = pages.filter((p) => !readFileSync(join(ROOT, p), 'utf8').includes('assets/embed.js'));
  check('every page loads embed.js', missing.length === 0, missing.join(', '));
}

await browser.close();
srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
