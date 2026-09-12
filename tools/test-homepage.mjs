// Named regression checks for the front page, one or more per finding from the
// September 2026 homepage QA pass. The address resolver has its own checks in
// tools/test-address.mjs and tools/test-finder.mjs; nothing here touches it.
//
// Run: python3 -m http.server 8787 &   then   node tools/test-homepage.mjs
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const PW_DIR = process.env.PLAYWRIGHT_DIR || '/opt/node22/lib/node_modules';
let chromium;
try { ({ chromium } = req('playwright')); }
catch { ({ chromium } = req(PW_DIR + '/playwright')); }

const BASE = process.env.BASE || 'http://localhost:8787';
const EXE = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: EXE });
let failed = 0;

// `slowContext` holds back the two files that make the ward card grow after first
// paint. Without that delay the scroll bug in finding 3 cannot reproduce at all:
// on localhost both land before a click is possible.
async function open({ touch = false, width = 1280, height = 900, slowContext = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, hasTouch: touch, isMobile: touch,
  });
  const p = await ctx.newPage();
  await p.route('**', async (r) => {
    const u = r.request().url();
    if (!u.startsWith(BASE)) return r.abort();           // fonts hang behind the proxy
    if (slowContext && /stuck\.json|bike-context\.json/.test(u)) {
      await new Promise((s) => setTimeout(s, 1800));
    }
    return r.continue();
  });
  await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#lb-body tr', { timeout: 20000 });
  return { p, ctx };
}
// Wait for scrolling to stop rather than guessing at a timeout: the first aim
// animates and the card keeps growing until the context files land.
async function settle(p, ms = 6000) {
  await p.waitForFunction(() => {
    const w = window;
    if (w.__lastY === undefined) { w.__lastY = -1; w.__same = 0; }
    if (Math.abs(w.scrollY - w.__lastY) < 1) w.__same++; else w.__same = 0;
    w.__lastY = w.scrollY;
    return w.__same > 8;
  }, null, { timeout: ms, polling: 50 });
  await p.evaluate(() => { delete window.__lastY; delete window.__same; });
}
async function check(name, opts, fn) {
  let h = null;
  try {
    h = await open(opts);
    const why = await fn(h.p);
    if (why) { console.log(`FAIL  ${name}\n      ${why}`); failed++; }
    else console.log(`ok    ${name}`);
  } catch (e) { console.log(`ERROR ${name}\n      ${e.message}`); failed++; }
  if (h) await h.ctx.close();
}

// ---- 3: selecting a ward from the map brings that ward's row into view ----
const rowAtCentre = (p) => p.evaluate(() => {
  const mid = window.innerHeight / 2;
  let best = null, d0 = Infinity;
  for (const tr of document.querySelectorAll('#lb-body tr')) {
    const b = tr.getBoundingClientRect();
    const d = Math.abs((b.top + b.bottom) / 2 - mid);
    if (d < d0) { d0 = d; best = { id: tr.id, rank: tr.querySelector('td').textContent.trim() }; }
  }
  return best;
});
const rankOf = (p, ward) => p.evaluate((w) =>
  document.getElementById('wrow-' + w).querySelector('td').textContent.trim(), ward);

for (const [label, opts] of [['mobile', { touch: true, width: 390, height: 844, slowContext: true }],
                             ['desktop', { width: 1280, height: 900, slowContext: true }]]) {
  await check(`3 selecting a mid-board ward centres that ward's row (${label})`, opts, async (p) => {
    // A ward from the middle of the ranking, so "centred" is actually reachable.
    // The last row cannot be centred at all: the document ends under it.
    const ward = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('#lb-body tr')];
      const tr = rows[Math.floor(rows.length / 2)];
      return Number(tr.id.replace('wrow-', ''));
    });
    const want = await rankOf(p, ward);
    await p.click(`#map path[data-ward="${ward}"]`);
    await p.waitForTimeout(2600);   // let the card finish growing, then the last aim
    await settle(p);
    const at = await rowAtCentre(p);
    if (at.id !== `wrow-${ward}`) return `centred on ${at.id} (rank ${at.rank}); ward ${ward} is rank ${want}`;
    if (at.rank !== want) return `centred row reports rank ${at.rank}, wanted ${want}`;
  });
  await check(`3 the last-ranked ward still lands near the bottom, not mid-list (${label})`, opts, async (p) => {
    // Ward 24 is last on the pothole board. This is the reported case: the scroll
    // used to be caught in flight around rank 31 on a phone and rank 36 on a
    // desktop, more than 1,200px short of the row it was aiming at.
    const want = await rankOf(p, 24);
    await p.click('#map path[data-ward="24"]');
    await p.waitForTimeout(2600);
    await settle(p);
    const at = await rowAtCentre(p);
    const gap = Math.abs(Number(at.rank) - Number(want));
    if (gap > 4) return `centred on rank ${at.rank}, ${gap} ranks from ward 24 at rank ${want}`;
  });
  await check(`3 the selected ward's row is fully in view (${label})`, opts, async (p) => {
    await p.click('#map path[data-ward="24"]');
    await p.waitForTimeout(2600);
    await settle(p);
    const v = await p.evaluate(() => {
      const b = document.getElementById('wrow-24').getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: window.innerHeight };
    });
    if (!(v.top >= 0 && v.bottom <= v.h)) return `row sits at ${v.top}..${v.bottom} in a ${v.h}px viewport`;
  });
}
await check('3 a ward that is already in view still centres', { width: 1280, height: 900 }, async (p) => {
  await p.click('#map path[data-ward="24"]');
  await settle(p);
  const at = await rowAtCentre(p);
  if (at.id !== 'wrow-24') return `centred on ${at.id}`;
});

// ---- 4: the map is usable without a pointer that can hover ----
await check('4 the map instruction says hover to a mouse', { width: 1280, height: 900 }, async (p) => {
  const t = await p.textContent('#map-hint');
  if (!/hover/i.test(t)) return `hint read: ${t}`;
});
await check('4 the map instruction says tap on touch', { touch: true, width: 390, height: 844 }, async (p) => {
  const t = await p.textContent('#map-hint');
  if (/hover/i.test(t)) return `a touch device was told to hover: ${t}`;
  if (!/tap/i.test(t)) return `hint read: ${t}`;
});
await check('4 tapping a ward reveals its number and neighborhoods', { touch: true, width: 390, height: 844 }, async (p) => {
  await p.tap('#map path[data-ward="24"]');
  await p.waitForTimeout(300);
  const tip = await p.evaluate(() => {
    const el = document.getElementById('map-tip');
    return { shown: !el.hidden, text: el.textContent };
  });
  if (!tip.shown) return 'no panel appeared on tap';
  if (!/Ward 24\b/.test(tip.text)) return `panel did not name the ward: ${tip.text.slice(0, 80)}`;
  // North Lawndale is ward 24's largest community area.
  if (!/Lawndale/.test(tip.text)) return `panel named no neighborhood: ${tip.text.slice(0, 80)}`;
});
await check('4 the tap panel stays inside the map near the right edge', { touch: true, width: 390, height: 844 }, async (p) => {
  await p.tap('#map path[data-ward="10"]');
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const t = document.getElementById('map-tip').getBoundingClientRect();
    return { right: Math.round(t.right), w: window.innerWidth, shown: t.width > 0 };
  });
  if (r.shown && r.right > r.w) return `panel runs ${r.right - r.w}px past the right edge`;
});

// ---- 1 and 2: the trust signals sit with the claim ----
await check('1 the headline names neighborhoods beside both ward numbers', { width: 1280, height: 900 }, async (p) => {
  const sub = await p.textContent('#hook-sub');
  const pairs = sub.match(/Ward \d+ \([^)]+\)/g) || [];
  if (pairs.length < 2) return `found ${pairs.length} ward-with-neighborhood mentions in: ${sub}`;
});
await check('2 a ward is defined directly under the headline', { width: 1280, height: 900 }, async (p) => {
  const t = await p.evaluate(() => {
    const el = document.getElementById('hook-trust');
    return { shown: !el.hidden, text: el.textContent };
  });
  if (!t.shown) return 'the trust line is hidden';
  if (!/\b50\b/.test(t.text) || !/alderperson/i.test(t.text)) return `definition read: ${t.text}`;
});
await check('2 the methodology and the city source are linked from the headline', { width: 1280, height: 900 }, async (p) => {
  const links = await p.evaluate(() =>
    [...document.querySelectorAll('#hook-trust a')].map((a) => a.getAttribute('href')));
  if (!links.includes('#method')) return `no methodology link, got ${links.join(', ')}`;
  if (!links.some((h) => /data\.cityofchicago\.org/.test(h))) return `no city source link, got ${links.join(', ')}`;
});
await check('2 the methodology link opens the section, not just scrolls to it', { width: 1280, height: 900 }, async (p) => {
  await p.click('#hook-trust a[href="#method"]');
  await p.waitForTimeout(300);
  const open = await p.evaluate(() => {
    const m = document.getElementById('method');
    return { open: m.open, hidden: m.hidden };
  });
  if (!open.open || open.hidden) return `details open=${open.open} hidden=${open.hidden}`;
});
await check('2 the trust line sits above the map, not below the board', { width: 1280, height: 900 }, async (p) => {
  const r = await p.evaluate(() => {
    const t = document.getElementById('hook-trust').getBoundingClientRect();
    const m = document.getElementById('map').getBoundingClientRect();
    return { trust: Math.round(t.top), map: Math.round(m.top) };
  });
  if (!(r.trust < r.map)) return `trust line at ${r.trust}, map at ${r.map}`;
});

// ---- 5: the share control copies, and says so on itself ----
await check('5 the share control renders nothing empty beside it', { touch: true, width: 390, height: 844 }, async (p) => {
  // The regression this replaces: a readonly input carrying display:block in the
  // stylesheet, which beats its own hidden attribute, so it drew an empty
  // full-width box next to the board on every load.
  const stray = await p.evaluate(() => {
    const row = document.getElementById('share').parentElement;
    return [...row.querySelectorAll('*')]
      .filter((el) => el !== document.getElementById('share'))
      .filter((el) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && !el.textContent.trim();
      })
      .map((el) => `${el.tagName}#${el.id || '(no id)'} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
  });
  if (stray.length) return `empty visible elements beside the button: ${stray.join(', ')}`;
});
await check('5 nothing hidden beside the share button can render anyway', { touch: true, width: 390, height: 844 }, async (p) => {
  // The general form of the same bug: an element carrying `hidden` whose
  // stylesheet gives it a display, so the attribute does nothing.
  const bad = await p.evaluate(() => [...document.querySelectorAll('[hidden]')]
    .filter((el) => getComputedStyle(el).display !== 'none')
    .map((el) => `${el.tagName}#${el.id || '(no id)'} display:${getComputedStyle(el).display}`));
  if (bad.length) return `hidden but still displayed: ${bad.join(', ')}`;
});
await check('5 clicking share copies the current URL and says Copied', { width: 1280, height: 900 }, async (p) => {
  await p.evaluate(() => {
    window.__copied = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } },
    });
  });
  const before = await p.textContent('#share');
  await p.click('#share');
  await p.waitForTimeout(200);
  const r = await p.evaluate(() => ({ copied: window.__copied, label: document.getElementById('share').textContent }));
  if (r.copied !== p.url && !/^https?:\/\//.test(r.copied || '')) return `copied "${r.copied}"`;
  if (r.label !== 'Copied') return `label read "${r.label}", wanted "Copied"`;
  if (before === 'Copied') return 'the label was already "Copied" before the click';
});
await check('5 the copied URL is the current one, ward and all', { width: 1280, height: 900 }, async (p) => {
  await p.evaluate(() => {
    window.__copied = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } },
    });
  });
  await p.click('#map path[data-ward="24"]');
  await p.waitForTimeout(1200);
  await p.click('#share');
  await p.waitForTimeout(200);
  const copied = await p.evaluate(() => window.__copied);
  if (!/[?&]ward=24\b/.test(copied || '')) return `copied "${copied}", which does not carry the selected ward`;
});
await check('5 the label goes back after two seconds', { width: 1280, height: 900 }, async (p) => {
  await p.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: () => Promise.resolve() },
    });
  });
  const before = await p.textContent('#share');
  await p.click('#share');
  await p.waitForTimeout(200);
  if ((await p.textContent('#share')) !== 'Copied') return 'never said Copied';
  await p.waitForTimeout(2200);
  const after = await p.textContent('#share');
  if (after !== before) return `label came back as "${after}", wanted "${before}"`;
});
await check('5 a second click does not make Copied the permanent label', { width: 1280, height: 900 }, async (p) => {
  await p.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: () => Promise.resolve() },
    });
  });
  const before = await p.textContent('#share');
  await p.click('#share');
  await p.waitForTimeout(150);
  await p.click('#share');       // while the label still reads "Copied"
  await p.waitForTimeout(2400);
  const after = await p.textContent('#share');
  if (after !== before) return `label settled on "${after}", wanted "${before}"`;
});
await check('5 a browser with no clipboard still copies', { width: 1280, height: 900 }, async (p) => {
  await p.evaluate(() => {
    // No async clipboard at all, the way an older browser or an insecure context
    // presents. The execCommand path has to carry it.
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    window.__exec = null;
    document.execCommand = (cmd) => { window.__exec = cmd; return true; };
  });
  await p.click('#share');
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => ({ exec: window.__exec, label: document.getElementById('share').textContent,
    leftovers: document.querySelectorAll('textarea').length }));
  if (r.exec !== 'copy') return `execCommand was called with ${r.exec}`;
  if (r.label !== 'Copied') return `label read "${r.label}"`;
  if (r.leftovers !== 0) return `${r.leftovers} textarea(s) left in the page`;
});
await check('5 when nothing can copy, the link is offered instead of a false Copied', { width: 1280, height: 900 }, async (p) => {
  await p.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = () => false;
  });
  await p.click('#share');
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const done = document.getElementById('share-done');
    const b = done.getBoundingClientRect();
    return { label: document.getElementById('share').textContent, shown: b.width > 0 && b.height > 0,
      text: done.textContent, leftovers: document.querySelectorAll('textarea').length };
  });
  if (r.label === 'Copied') return 'claimed Copied when nothing was copied';
  if (!r.shown) return `nothing was offered; the button said "${r.label}"`;
  if (!/^https?:\/\//.test(r.text)) return `offered "${r.text}"`;
  if (r.leftovers !== 0) return `${r.leftovers} textarea(s) left in the page`;
});

// ---- 6: the link does not promise what the destination lacks ----
await check('6 the stuck link does not promise fixed cases', { width: 1280, height: 900 }, async (p) => {
  await p.waitForSelector('#stuck-note a', { timeout: 20000 });
  const t = await p.textContent('#stuck-note a');
  if (/fixed|resolved/i.test(t)) return `link reads: ${t}`;
});

// ---- 8: a type the period cannot rank stays visible and says why ----
await check('8 switching period keeps an unavailable type visible and disabled', { width: 1280, height: 900 }, async (p) => {
  const before = await p.evaluate(() =>
    [...document.querySelectorAll('#types button')].map((b) => b.textContent.trim()));
  const years = await p.evaluate(() =>
    [...document.querySelectorAll('#windows button')].map((b) => b.dataset.win));
  const past = years.find((y) => y !== 'rolling');
  await p.click(`#windows button[data-win="${past}"]`);
  await p.waitForTimeout(1500);
  const after = await p.evaluate(() => [...document.querySelectorAll('#types button')].map((b) => ({
    text: b.textContent.trim(), off: b.disabled, why: b.getAttribute('title') || '',
  })));
  if (after.length < before.length) {
    return `the row shrank from ${before.length} to ${after.length} pills`;
  }
  const off = after.filter((b) => b.off);
  if (!off.length) return 'no type was marked unavailable, so nothing was dropped either';
  for (const b of off) {
    if (!/not in/i.test(b.text)) return `a disabled pill gave no visible reason: "${b.text}"`;
    if (!b.why) return `a disabled pill had no title explaining it: "${b.text}"`;
  }
});
await check('8 a disabled type cannot be selected', { width: 1280, height: 900 }, async (p) => {
  const years = await p.evaluate(() =>
    [...document.querySelectorAll('#windows button')].map((b) => b.dataset.win));
  await p.click(`#windows button[data-win="${years.find((y) => y !== 'rolling')}"]`);
  await p.waitForTimeout(1500);
  const before = p.url();
  const clicked = await p.evaluate(() => {
    const b = [...document.querySelectorAll('#types button')].find((x) => x.disabled);
    if (!b) return 'none';
    b.click();
    return b.textContent.trim();
  });
  if (clicked === 'none') return 'no disabled pill to try';
  await p.waitForTimeout(400);
  if (p.url() !== before) return `clicking "${clicked}" changed the URL to ${p.url()}`;
});

// ---- 7: the data period is not attached to a person like a term of office ----
// This one lives on a ward page rather than the front page, which is where the
// alderperson's name and the window sit together.
async function openWard(n) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.route('**', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  await p.goto(`${BASE}/ward-${n}.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#ward-sub', { timeout: 20000 });
  await p.waitForFunction(() => /\d{4}/.test(document.getElementById('ward-sub').textContent), null, { timeout: 20000 });
  return { p, ctx };
}
async function wardCheck(name, fn) {
  let h = null;
  try {
    h = await openWard(1);
    const why = await fn(h.p);
    if (why) { console.log(`FAIL  ${name}\n      ${why}`); failed++; }
    else console.log(`ok    ${name}`);
  } catch (e) { console.log(`ERROR ${name}\n      ${e.message}`); failed++; }
  if (h) await h.ctx.close();
}
await wardCheck('7 the date range is labelled as a data period', async (p) => {
  const t = await p.textContent('#ward-sub');
  if (!/Data period:/.test(t)) return `subtitle read: ${t.replace(/\s+/g, ' ')}`;
});
await wardCheck('7 the period is not on the same line as the alderperson', async (p) => {
  const r = await p.evaluate(() => {
    const sub = document.getElementById('ward-sub');
    const period = sub.querySelector('.data-period');
    if (!period) return { missing: true };
    // Walk back to the text node carrying the name and compare line boxes.
    const pr = period.getBoundingClientRect();
    const range = document.createRange();
    const nameNode = [...sub.childNodes].find((n) => n.nodeType === 3 && /Alderperson/.test(n.textContent));
    if (!nameNode) return { noName: true };
    range.selectNodeContents(nameNode);
    const nr = range.getBoundingClientRect();
    return { periodTop: Math.round(pr.top), nameTop: Math.round(nr.top) };
  });
  if (r.missing) return 'no .data-period element';
  if (r.noName) return 'no alderperson text node to compare against';
  if (r.periodTop <= r.nameTop) return `period at ${r.periodTop}, name at ${r.nameTop}: same line`;
});
await wardCheck('7 no middot joins the name to the dates', async (p) => {
  const t = await p.evaluate(() => {
    const sub = document.getElementById('ward-sub');
    const i = sub.textContent.indexOf('Data period');
    return sub.textContent.slice(Math.max(0, i - 30), i);
  });
  if (/\u00b7/.test(t)) return `text before the period: "${t}"`;
});

await browser.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
