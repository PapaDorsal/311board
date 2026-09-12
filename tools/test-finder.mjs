// Named regression checks for the address finder as it behaves in a real page.
// One per defect class from the September 2026 QA run. The resolver's own checks
// are in tools/test-address.mjs; these are the ones that need a DOM and a history
// stack, so they drive Chromium.
//
// Run: python3 -m http.server 8787 &   then   node tools/test-finder.mjs
//
// Playwright is resolved by hand because ESM import ignores NODE_PATH, and on this
// machine Playwright is installed globally rather than in the repo (there is no
// package.json: the site ships as plain files). Set PLAYWRIGHT_DIR to override.
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const PW_DIR = process.env.PLAYWRIGHT_DIR || '/opt/node22/lib/node_modules';
let chromium;
try { ({ chromium } = req('playwright')); }
catch { ({ chromium } = req(PW_DIR + '/playwright')); }

const BASE = process.env.BASE || 'http://localhost:8787';
const EXE = process.env.CHROMIUM || '/opt/pw-browsers/chromium';

let failed = 0;
const browser = await chromium.launch({ executablePath: EXE });

async function check(name, fn) {
  const p = await browser.newPage();
  // Google Fonts hangs behind a proxy and the page does not need it to resolve
  // an address. Everything else is served locally.
  await p.route('**', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  try {
    await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#finder:not([hidden])', { timeout: 15000 });
    const why = await fn(p);
    if (why) { console.log(`FAIL  ${name}\n      ${why}`); failed++; }
    else console.log(`ok    ${name}`);
  } catch (e) { console.log(`ERROR ${name}\n      ${e.message}`); failed++; }
  await p.close();
}

const look = async (p, addr) => {
  await p.fill('#finder-input', addr);
  await p.click('#finder-form .addr-go');
  await p.waitForFunction(() => !/^Looking up/.test(document.getElementById('finder-note').textContent),
    null, { timeout: 15000 });
};
const card = (p) => p.evaluate(() => {
  const b = document.getElementById('mine');
  return { shown: !b.hidden, text: b.textContent.trim() };
});
const note = (p) => p.textContent('#finder-note');
const asks = (p) => p.evaluate(() => [...document.querySelectorAll('#finder-ask button')].map((b) => b.textContent));
const wardParam = (p) => p.evaluate(() => new URLSearchParams(location.search).get('ward'));

// ---- P0: a typo must not render a ward card ----
await check('P0 a typo renders no ward card', async (p) => {
  await look(p, '1060 W Adison St');
  const c = await card(p);
  if (c.shown) return `card was shown reading: ${c.text.slice(0, 80)}`;
  if (await wardParam(p)) return `URL claimed ward ${await wardParam(p)}`;
});
await check('P0 a typo asks which street was meant', async (p) => {
  await look(p, '1060 W Adison St');
  const opts = await asks(p);
  if (!opts.length) return `no confirmation offered; note read: ${await note(p)}`;
  if (!opts.includes('1060 W Addison St')) return `offered ${opts.join(', ')}`;
  if (!/did you mean/i.test(await note(p))) return `note read: ${await note(p)}`;
});
await check('P0 confirming a suggestion gives that ward', async (p) => {
  await look(p, '1060 W Adison St');
  await p.click('#finder-ask button:has-text("1060 W Addison St")');
  const c = await card(p);
  if (!c.shown) return 'no card after confirming';
  if (!/Your ward: 44\b/.test(c.text)) return `card read: ${c.text.slice(0, 80)}`;
  if (await p.inputValue('#finder-input') !== '1060 W Addison St') {
    return `box still read "${await p.inputValue('#finder-input')}"`;
  }
});
await check('P0 the correct spelling is unaffected', async (p) => {
  await look(p, '1060 W Addison St');
  const c = await card(p);
  if (!c.shown || !/Your ward: 44\b/.test(c.text)) return `card read: ${c.text.slice(0, 80)}`;
  if ((await asks(p)).length) return 'a confirmed match still asked for confirmation';
});

// ---- a wrong suffix asks instead of answering ----
await check('a wrong street suffix renders no ward card', async (p) => {
  await look(p, '1060 W Addison Ave');
  const c = await card(p);
  if (c.shown) return `card was shown reading: ${c.text.slice(0, 80)}`;
  const opts = await asks(p);
  if (!opts.includes('1060 W Addison St')) return `offered ${opts.join(', ') || 'nothing'}`;
});

// ---- P1: a valid partial resolves ----
await check('P1 an address with no street suffix resolves', async (p) => {
  await look(p, '1060 W Addison');
  const c = await card(p);
  if (!c.shown) return `no card; note read: ${await note(p)}`;
  if (!/Your ward: 44\b/.test(c.text)) return `card read: ${c.text.slice(0, 80)}`;
});
await check('P1 a valid partial is never told to check the street name', async (p) => {
  await look(p, '1060 W Addison');
  if (/check the street name/i.test(await note(p))) return await note(p);
});

// ---- P2: a result card must not outlive its input ----
await check('P2 an emptied box clears the card', async (p) => {
  await look(p, '1060 W Addison St');
  if (!(await card(p)).shown) return 'setup failed: no card from a good address';
  await look(p, '');
  const c = await card(p);
  if (c.shown) return `card survived, reading: ${c.text.slice(0, 80)}`;
  if (await wardParam(p)) return `URL still claimed ward ${await wardParam(p)}`;
});
await check('P2 an emptied box says the field is required', async (p) => {
  await look(p, '1060 W Addison St');
  await look(p, '');
  const n = await note(p);
  if (!/empty|enter an address/i.test(n)) return `note read: ${n}`;
});
await check('P2 a failed lookup clears the previous card', async (p) => {
  await look(p, '1060 W Addison St');
  await look(p, '100 W Zyzzyxqq St');
  const c = await card(p);
  if (c.shown) return `card survived, reading: ${c.text.slice(0, 80)}`;
});
await check('P2 an uncertain lookup clears the previous card', async (p) => {
  await look(p, '1060 W Addison St');
  await look(p, '1060 W Adison St');
  const c = await card(p);
  if (c.shown) return `stale ward 44 card survived an uncertain lookup: ${c.text.slice(0, 80)}`;
});

// ---- P3: Back and reload keep the located ward ----
await check('P3 a resolved ward is in the URL', async (p) => {
  await look(p, '1060 W Addison St');
  if (await wardParam(p) !== '44') return `?ward was ${await wardParam(p)}`;
});
await check('P3 the typed address is never put in the URL', async (p) => {
  // The page promises a typed address stays in the browser, and a query string
  // is sent to the server on the next navigation.
  await look(p, '1060 W Addison St');
  const url = p.url();
  if (/addison/i.test(url)) return `URL carried the address: ${url}`;
});
await check('P3 reload keeps the ward', async (p) => {
  await look(p, '1060 W Addison St');
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#mine:not([hidden])', { timeout: 15000 });
  const c = await card(p);
  if (!/Your ward: 44\b/.test(c.text)) return `card read: ${c.text.slice(0, 80)}`;
});
await check('P3 Back returns to the located ward', async (p) => {
  await look(p, '1060 W Addison St');
  await look(p, '1060 W Madison St');
  if (await wardParam(p) !== '34') return `setup failed: ?ward was ${await wardParam(p)}`;
  await p.goBack({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => new URLSearchParams(location.search).get('ward') === '44',
    null, { timeout: 15000 });
  const c = await card(p);
  if (!c.shown || !/Your ward: 44\b/.test(c.text)) return `after Back the card read: ${c.text.slice(0, 80)}`;
});
await check('P3 Back past the first lookup clears the card', async (p) => {
  await look(p, '1060 W Addison St');
  await p.goBack({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => !new URLSearchParams(location.search).get('ward'),
    null, { timeout: 15000 });
  if ((await card(p)).shown) return 'the card survived Back past its own lookup';
});
await check('P3 a shared ward link opens on that ward', async (p) => {
  await p.goto(BASE + '/index.html?ward=7', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#mine:not([hidden])', { timeout: 15000 });
  const c = await card(p);
  if (!/Your ward: 7\b/.test(c.text)) return `card read: ${c.text.slice(0, 80)}`;
});
await check('P3 a junk ward param is ignored', async (p) => {
  for (const v of ['0', '51', 'abc', '44.5']) {
    await p.goto(`${BASE}/index.html?ward=${v}`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#finder:not([hidden])', { timeout: 15000 });
    if ((await card(p)).shown) return `?ward=${v} rendered a card`;
  }
});

await browser.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
