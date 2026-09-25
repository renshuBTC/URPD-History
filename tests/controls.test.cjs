// The toolbar's controls: the date box, the step sizes, the settings fields, pins, the download button and the
// languages. Each test here pins down a bug the 2026-09-24 audit found.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { html, scripts, app, flush } = require('./helpers.cjs');

const plain = v => JSON.parse(JSON.stringify(v));   // out of the page's realm, for deepEqual
// The page's stylesheet, comments stripped, as rules; decls(sel) is every declaration given to exactly that selector.
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const rules = css.split('}').map(r => r.split('{')).filter(r => r.length === 2)
  .map(([sel, body]) => ({ sels: sel.split(',').map(x => x.trim().replace(/\s+/g, ' ')), body: body.trim() }));
const decls = sel => {
  const found = rules.filter(r => r.sels.includes(sel));
  assert.ok(found.length, 'no rule for ' + sel);
  return found.map(r => r.body).join('; ');
};
const props = sel => Object.fromEntries(decls(sel).split(';').map(d => d.split(':')).filter(p => p.length > 1)
  .map(([k, ...v]) => [k.trim(), v.join(':').trim()]));
const main = scripts.find(s => s.includes('var BASE ='));
function section(start, end) {
  const a = main.indexOf(start), b = main.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing ${start} .. ${end}`);
  return main.slice(a, b);
}
function days(from, to) {
  const out = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 864e5) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
// The app with its date list, drawing stubbed out: navigation only records where it was sent.
function navApp(dates) {
  const h = app(), loads = [];
  h.c.allDates = dates;
  h.c.loadAndRender = () => { loads.push(h.c.allDates[h.c.currentIdx]); h.c.lastRenderedData = { dateStr: h.c.allDates[h.c.currentIdx] }; return Promise.resolve(); };
  return Object.assign(h, { loads });
}

test('1W, 1M and 1Y are calendar steps, and never skip a listed day or stall on a gap', () => {
  const dates = ['2009-01-03', '2009-01-09', '2009-01-10', '2009-01-11'].concat(days('2009-01-12', '2011-03-31'));
  const h = navApp(dates), { c } = h;
  const at = d => dates.indexOf(d), step = (from, dir) => dates[Math.max(0, Math.min(dates.length - 1, c.stepTarget(at(from), dir)))];
  c.setInterval1(2);   // 1M
  assert.equal(step('2010-01-31', 1), '2010-02-28', 'February is not skipped');
  assert.equal(step('2010-03-31', -1), '2010-02-28');
  assert.equal(step('2010-02-28', 1), '2010-03-28');
  c.setInterval1(3);   // 1Y
  assert.equal(step('2009-01-03', 1), '2010-01-03', 'a year from the first day, across the gap in early 2009');
  assert.equal(step('2010-06-15', -1), '2009-06-15');
  assert.equal(step('2009-01-09', -1), '2009-01-03', 'before the history starts: its first day');
  c.setInterval1(1);   // 1W
  assert.equal(step('2009-01-03', 1), '2009-01-10', 'the first listed day on or after a week on');
  assert.equal(step('2009-01-12', -1), '2009-01-03', 'the last listed day on or before a week back');
  c.setInterval1(0);   // 1D: the next listed day
  assert.equal(step('2009-01-03', 1), '2009-01-09');
});

test('prefetch fetches the next steps of the selected size, not the neighbouring days', async () => {
  const dates = days('2022-01-01', '2026-09-20');
  const h = navApp(dates), { c } = h, fetched = [];
  vm.runInContext(section('var PREFETCH_AHEAD = 2;', 'function loadAndRender('), c);
  c.fetchRaw = d => { fetched.push(d); return Promise.resolve({}); };
  c.setInterval1(3);
  c.currentIdx = dates.indexOf('2026-09-20');
  c.prefetchPrev = dates.indexOf('2026-09-20') + 1;   // walking back
  c.schedulePrefetch();
  h.runTimer([...h.timers.keys()].at(-1));
  await flush();
  assert.deepEqual(fetched, ['2025-09-20', '2024-09-20']);
});

test('a failed first draw can be retried with the same key, and an already drawn day is not reloaded', () => {
  const h = navApp(days('2026-09-01', '2026-09-10')), { c } = h;
  c.currentIdx = 9; c.lastRenderedData = null;
  c.goTo(9);
  assert.equal(h.loads.length, 1, 'nothing on screen yet: pressing End again retries');
  c.goTo(9);
  assert.equal(h.loads.length, 1, 'now it is drawn: nothing to do');
});

test('the settings fields take a number and nothing else', () => {
  const { c } = app();
  const cases = { '1,000': NaN, '1e3': 1000, '400abc': NaN, ' 625 ': 625, '６２５': 625, '': NaN, '0.24': 0.24, '-': NaN };
  for (const [typed, want] of Object.entries(cases)) assert.ok(Object.is(c.fieldNumber(typed), want), typed);
});

test('a pin is kept per weighting, bin count and smoothing, and PIN Y-AXIS does nothing before the first chart', () => {
  const { c, element } = app();
  c.coinMode = true;
  assert.equal(c.peakKey({ numBins: 625, kernelPct: 0 }), 'btc|b625|s0');
  c.coinMode = false;
  assert.equal(c.peakKey({ numBins: 400, kernelPct: 0.24 }), 'usd|b400|s0.24');
  c.lastRenderedData = null;
  c.peakStore = { 'usd|b625|s0.24': ['2026-01-01', 5] };
  element('btnPeak').onclick();
  assert.deepEqual(plain(c.peakStore), { 'usd|b625|s0.24': ['2026-01-01', 5] }, 'a saved pin is not deleted');
});

test('every text has all three languages', () => {
  const { c } = app();
  const langs = ['en', 'zh', 'ja'], keys = new Set(langs.flatMap(l => Object.keys(c.T[l])));
  for (const l of langs) for (const k of keys) assert.ok(typeof c.T[l][k] === 'string' && c.T[l][k].length, `${l}.${k}`);
});

test('the download button is a small icon with a name, and the bar keeps the grey-bordered look it had before 2026-09-24', () => {
  const button = html.match(/<a id="videoBtn" href="[^"]+" download aria-label="Download the full-history video">(<svg[\s\S]*?<\/svg>)<\/a>/);
  assert.ok(button, 'an icon-only link with an accessible name');
  assert.match(button[1], /aria-hidden="true"/);
  assert.match(button[1], /width="14" height="14"/);
  assert.equal(button[1].replace(/<[^>]*>/g, '').trim(), '', 'no words on the button');
  // Every button and link: a #555 border, #888 under the mouse, orange when on.
  for (const sel of ['#controls button', '#controls #githubLink', '#controls #videoBtn']) assert.match(decls(sel), /border:\s*1px solid #555/, sel);
  for (const sel of ['#controls button:hover', '#controls #githubLink:hover', '#controls #videoBtn:hover', '#explainBtn:hover', '#langBtn:hover']) {
    assert.match(decls(sel), /border-color:\s*#888/, sel);
  }
  assert.match(decls('#controls .mode-toggle button.active'), /background:\s*#ff8c00;.*border-color:\s*#ff8c00/);
  // The step bar and the cycle list are framed the same way; the list turns orange while it has focus.
  assert.match(decls('#intervalBar'), /border:\s*1px solid #555/);
  assert.match(decls('#landmarks'), /background:\s*#1e1e1e;.*border:\s*1px solid #555/);
  assert.match(decls('#landmarks:hover'), /border-color:\s*#888/);
  assert.match(decls('#landmarks:focus'), /border-color:\s*#ff8c00/);
  // Keyboard focus shows as before: the browser's ring on buttons, an orange ring on the two links. (A mouse click
  // lets go of focus, so none of this is ever drawn for the mouse; see ui.test.cjs.)
  assert.ok(!rules.some(r => r.sels.some(x => /^#controls (button|a|select):focus$/.test(x))), 'focus rings are not switched off');
  for (const sel of ['#githubLink:focus-visible', '#videoBtn:focus-visible']) assert.match(decls(sel), /outline:\s*2px solid #ff8c00/, sel);
  assert.equal(rules.filter(r => /background-color:\s*#(4a4a4a|ffc266)/.test(r.body)).length, 0, 'no focus fills');
});

test('the day counter looks like the cycle list: same frame, grey text, normal weight, and a box that holds still', async () => {
  const counter = props('#dateDisplay'), list = props('#landmarks');
  for (const k of ['background', 'color', 'border', 'border-radius']) assert.equal(counter[k], list[k], k);
  assert.equal(counter['font-weight'], 'normal');
  assert.equal(counter.height, '24px', 'as tall as the list and the buttons');
  assert.match(decls('#controls #dateDisplay'), /font-size:\s*12px/);
  assert.ok(!rules.some(r => r.sels.some(x => /#dateDisplay:hover/.test(x))), 'no hover state: it is not a control');
  // N/N is 2 × digits + 1 characters of a monospace font, and 18px is its padding and border (0 8px, 1px).
  assert.match(counter.padding, /^0 8px$/);
  for (const [n, width] of [[3, 'calc(3ch + 18px)'], [150, 'calc(7ch + 18px)'], [6469, 'calc(9ch + 18px)']]) {
    const h = app(), dates = days('2009-01-03', '2030-01-01').slice(0, n);
    h.c.fetchJSON = url => Promise.resolve(url.endsWith('/all/dates') ? dates : null);
    h.c.loadAndRender = () => Promise.resolve();
    await h.c.init();
    assert.equal(h.element('dateDisplay').style.minWidth, width, n + ' days');
  }
});

test('the YouTube button sits beside the download button, and shows only once there is a video others can watch', async () => {
  const a = html.match(/<a id="ytBtn" hidden href="([^"]+)" target="_blank" rel="noopener noreferrer" aria-label="([^"]+)" title="([^"]+)">(<svg[\s\S]*?<\/svg>)<\/a>/);
  assert.ok(a, 'a hidden icon-only link that opens in a new tab, named for screen readers and tooltips');
  assert.equal(a[1], 'https://www.youtube.com/channel/UC1jY5BEQXSetr93AbZNDbwg');
  assert.equal(a[2], a[3]);
  assert.match(a[4], /aria-hidden="true"/);
  assert.equal(a[4].replace(/<[^>]*>/g, '').trim(), '', 'no words on the button');
  assert.match(decls('#ytBtn[hidden]'), /display:\s*none/, 'hidden means hidden, whatever display the button has');
  assert.match(decls('#controls #ytBtn'), /border:\s*1px solid #555/);
  assert.match(decls('#controls #ytBtn:hover'), /border-color:\s*#888/);
  assert.match(decls('#ytBtn:focus-visible'), /outline:\s*2px solid #ff8c00/);
  // data/youtube.json names the latest video once it is unlisted or public; anything else leaves the button hidden.
  const { c, element } = app(), btn = element('ytBtn');
  btn.hidden = true;
  c.setYouTubeLink({ id: 'dQw4w9WgXcQ', end: '2026-09-24' });
  assert.equal(btn.href, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(btn.hidden, false);
  for (const bad of [null, {}, { id: null }, { id: 'javascript:x' }, { id: 'short' }, { id: 'dQw4w9WgXcQ"x' }, { id: 12345678901 }, 'dQw4w9WgXcQ']) {
    c.setYouTubeLink(bad);
    assert.equal(btn.hidden, true, JSON.stringify(bad));
  }
  // The page asks for it on its own, and a missing file changes nothing else.
  for (const found of [true, false]) {
    const h = app(), asked = [];
    h.element('ytBtn').hidden = true;   // as the page starts (the hidden attribute)
    const yt = () => (found ? Promise.resolve({ id: 'dQw4w9WgXcQ' }) : Promise.reject(new Error('HTTP 404')));
    h.c.fetchJSON = url => { asked.push(url); return url === 'data/youtube.json' ? yt() : Promise.resolve(url.endsWith('/all/dates') ? days('2026-09-20', '2026-09-24') : null); };
    h.c.loadAndRender = () => Promise.resolve();
    await h.c.init(); await flush();
    assert.equal(asked[0], 'data/youtube.json');
    assert.equal(h.c.allDates.length, 5, 'the chart loads either way');
    assert.equal(h.element('ytBtn').hidden, !found);
  }
});

test('data/youtube.json names no video, or one YouTube video by its id', () => {
  const fs = require('node:fs'), path = require('node:path');
  const yt = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'youtube.json'), 'utf8'));
  assert.ok(yt.id === null || /^[A-Za-z0-9_-]{11}$/.test(yt.id), String(yt.id));
});
