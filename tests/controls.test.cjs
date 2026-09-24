// The toolbar's controls: the date box, the step sizes, the settings fields, pins, the download button and the
// languages. Each test here pins down a bug the 2026-09-24 audit found.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { html, scripts, app, flush } = require('./helpers.cjs');

const plain = v => JSON.parse(JSON.stringify(v));   // out of the page's realm, for deepEqual
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

test('the date box takes a day in any common spelling, or a month or a year, and refuses anything else', () => {
  const { c } = app();
  const ok = {
    '2024-01-05': ['2024-01-05', null], '2024-1-5': ['2024-01-05', null], '2024/01/05': ['2024-01-05', null],
    '2024.1.5': ['2024-01-05', null], ' 2024-06-15 ': ['2024-06-15', null], '２０２４－０１－０５': ['2024-01-05', null],
    '2024': ['2024-01-01', '2024'], '2024-03': ['2024-03-01', '2024-03'], '2024/3': ['2024-03-01', '2024-03'], '2024-02-29': ['2024-02-29', null]
  };
  for (const [typed, [date, period]] of Object.entries(ok)) assert.deepEqual(plain(c.parseDateQuery(typed)), { date, period }, typed);
  for (const bad of ['hello', '', '2024-13-01', '2023-02-29', '2024-04-31', '24-01-05', '2024-01-05T00:00', '2024-00-10', '2024-01-05-01']) {
    assert.equal(c.parseDateQuery(bad), null, bad);
  }
});

test('typing a date goes to it, or to the nearest listed day before it; a month or year goes to its first listed day', () => {
  const dates = ['2009-01-03', '2009-01-09', '2009-01-10'].concat(days('2023-12-28', '2024-03-05'));
  const h = navApp(dates), { c, element } = h;
  const typeAndEnter = v => { element('dateInput').value = v; c.jumpToDate(); };
  typeAndEnter('2024-02-10'); assert.equal(h.loads.at(-1), '2024-02-10');
  assert.equal(element('dateInput').value, '', 'the box is emptied, so the list opens unfiltered next time');
  typeAndEnter('2024/1/2'); assert.equal(h.loads.at(-1), '2024-01-02');
  typeAndEnter('2024'); assert.equal(h.loads.at(-1), '2024-01-01');
  typeAndEnter('2024-03'); assert.equal(h.loads.at(-1), '2024-03-01');
  typeAndEnter('2009-01-05'); assert.equal(h.loads.at(-1), '2009-01-03', 'a day missing from the list: the last one before it');
  assert.match(element('status').textContent, /2009-01-03/);
  typeAndEnter('2030-01-01'); assert.equal(h.loads.at(-1), '2024-03-05');
  const before = h.loads.length;
  typeAndEnter('2024-02-30');
  assert.equal(h.loads.length, before, 'an impossible date goes nowhere');
  assert.equal(element('status').textContent, c.t('badDate'));
});

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

test('RAW keeps its own pins, and PIN SCALE does nothing before the first chart', () => {
  const { c, element } = app();
  c.coinMode = true; c.rawMode = true;
  assert.equal(c.peakKey({ numBins: 625, kernelPct: 0 }), 'btc|b625|s0|raw');
  c.rawMode = false;
  assert.equal(c.peakKey({ numBins: 625, kernelPct: 0 }), 'btc|b625|s0');
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
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = css.split('}').map(r => r.split('{')).filter(r => r.length === 2)
    .map(([sel, body]) => ({ sels: sel.split(',').map(x => x.trim().replace(/\s+/g, ' ')), body: body.trim() }));
  const decls = sel => {
    const found = rules.filter(r => r.sels.includes(sel));
    assert.ok(found.length, 'no rule for ' + sel);
    return found.map(r => r.body).join('; ');
  };
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
