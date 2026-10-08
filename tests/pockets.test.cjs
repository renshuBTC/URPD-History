// TIME POCKETS: the short-term holders' prices, from the first bin holding any of their coins to the last, cut into
// pockets, each labelled with the most days until every coin last moved in it is a long-term holder (LTH IN XX DAYS);
// its button beside PIN Y-AXIS, on in LTH/STH only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, html } = require('./helpers.cjs');
const plain = v => JSON.parse(JSON.stringify(v));   // out of the page's realm, for deepEqual

const DAY = 864e5, iso = t => new Date(t).toISOString().slice(0, 10);
// A day's age bands: one coin at each of the given prices in the given bands (0 to 7 short-term, 8 on long-term).
const bandsWith = spec => {
  const a = new Array(23).fill(null).map(() => ({}));
  for (const [band, prices] of spec) for (const p of prices) a[band][p] = (a[band][p] || 0) + 1;
  return a;
};
const from = (lo, hi, step = 10) => Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
// Day 1000 of the Bitcoin Research Kit's index (its highs and lows are indexed from 2009-01-01).
const DAY1000 = iso(Date.UTC(2009, 0, 1) + 1000 * DAY);

test('the pockets: runs of bins whose coins turn long-term together, slivers and empty bins kept in, each taking its bins\' most days', () => {
  const { c } = app();
  c.priceHighLow = { high: null, low: null };   // no highs and lows: the age bands alone
  // Bins $10 wide from $0: 1m-2m coins in bins 10-19 (all long-term within 120 days), 3m-4m in 20-29 (60), nothing in 30,
  // 4m-5m in 31-33 (30: a sliver turning sooner than either side), 2m-3m in 34-43 (90), 1w-1m in 44-48 (143) and <1h in
  // 49-53 (150); long-term coins at $55, outside the span.
  const rawAge = bandsWith([[4, from(105, 195)], [6, from(205, 295)], [7, from(315, 335)], [5, from(345, 435)], [3, from(445, 485)], [0, from(495, 535)], [12, [55]]]);
  const data = { dateStr: DAY1000, rawAge, binWidth: 10, aggAll: new Array(60).fill(null) };
  assert.deepEqual(plain(c.timePocketsOf(data)), [{ lo: 100, hi: 200, days: 120 }, { lo: 200, hi: 340, days: 60 }, { lo: 340, hi: 440, days: 90 }, { lo: 440, hi: 540, days: 150 }],
    'the 60-day pocket takes in the empty bin and the 30-day sliver; 143 and 150 are within two weeks: one pocket, 150');
  // The highs and lows: the price was last in bins 10-19 40 days ago, so their coins are at least 40 days old.
  const high = new Array(1001).fill(1000), low = new Array(1001).fill(900);
  high[960] = 199; low[960] = 101;
  c.priceHighLow = { high, low };
  assert.deepEqual(plain(c.timePocketsOf(data).map(p => p.days)), [110, 60, 90, 150], '150 - 40');
  // While they load, nothing yet; a day with no short-term holders has no pockets.
  c.priceHighLow = null;
  assert.equal(c.timePocketsOf(data), null);
  assert.deepEqual(plain(c.timePocketsOf({ dateStr: DAY1000, rawAge: bandsWith([[12, [55, 155]]]), binWidth: 10, aggAll: new Array(60).fill(null) })), []);
  c.priceHighLow = { high: null, low: null };
  // A pocket is at least 8 bins wide unless it is the only one: 3 bins of 150 days beside 20 of 60 join them (the larger
  // days). (A day's data each time: the page keeps each day's short-term prices on it.)
  const day = spec => ({ dateStr: DAY1000, rawAge: bandsWith(spec), binWidth: 10, aggAll: new Array(60).fill(null) });
  assert.deepEqual(plain(c.timePocketsOf(day([[6, from(105, 295)], [0, from(305, 325)]]))), [{ lo: 100, hi: 330, days: 150 }]);
  assert.deepEqual(plain(c.timePocketsOf(day([[0, from(305, 325)]]))), [{ lo: 300, hi: 330, days: 150 }], 'the only pocket, however narrow');
  // Wider than 8 bins and further apart than two weeks: two pockets.
  assert.deepEqual(plain(c.timePocketsOf(day([[6, from(105, 295)], [0, from(305, 405)]]))), [{ lo: 100, hi: 300, days: 60 }, { lo: 300, hi: 410, days: 150 }]);
  assert.equal(c.POCKET_MIN_BINS, 8); assert.equal(c.POCKET_SPREAD, 14);
});

test('each pocket\'s label sits centred at its top, as large as fits, a row lower where it would meet the one before it', () => {
  const { c } = app();
  const ctx = { xSpan: 1000, plotPx: 500, topLeft: [], spotBox: null };
  const labs = c.pocketLabelsLayout([{ lo: 0, hi: 40, days: 150 }, { lo: 40, hi: 80, days: 30 }, { lo: 80, hi: 500, days: 90 }], ctx);
  // The first two pockets are 20 px wide: their labels at 9 px on two rows, wider than the pockets; the first kept inside
  // the plot, the second a row lower, clear of it. The third has room for its words at 13 px on one row, centred over it.
  assert.deepEqual(plain(labs.map(l => [l.rows, l.size])), [[['LTH IN', '150 DAYS'], 9], [['LTH IN', '30 DAYS'], 9], [['LTH IN 90 DAYS'], 13]]);
  assert.equal(labs[0].l, 0, 'inside the plot');
  assert.equal(labs[0].y, 0); assert.equal(labs[2].y, 0);
  assert.ok(labs[1].y >= labs[0].y + labs[0].h, 'below the first');
  assert.equal(labs[2].x, 290, 'centred over its pocket');
  for (let i = 0; i < labs.length; i++) for (let j = 0; j < i; j++) {
    const a = labs[i], b = labs[j];
    assert.ok(a.r <= b.l || a.l >= b.r || a.y >= b.y + b.h || a.y + a.h <= b.y, `labels ${j} and ${i} do not meet`);
  }
  // A label that would meet the price box drops below it, as a marked range's box does.
  const under = c.pocketLabelsLayout([{ lo: 600, hi: 1000, days: 150 }], { ...ctx, spotBox: { x0: 0.7, x1: 0.9, y0: 0, h: 40 } });
  assert.equal(under[0].y, 46);
  // The words, in each language.
  assert.equal(c.pocketLabel(64), 'LTH IN 64 DAYS');
  assert.equal(c.pocketLabel(1), 'LTH IN 1 DAY');
  c.lang = 'zh'; assert.equal(c.pocketLabel(64), '64 天内成为 LTH');
  c.lang = 'ja'; assert.equal(c.pocketLabel(64), '64 日以内に LTH');
});

test('TIME POCKETS draws the pockets in LTH/STH in a marked range\'s place, and is off in AGE', async () => {
  const { c, element } = app();
  // 60 days at $60,000; on the day, 1m-2m coins from $52,000 to $55,000, <1h coins from $58,000 to $61,000 and long-term
  // coins at $30,000.
  const t0 = Date.parse('2021-09-01T00:00:00Z');
  const dates = Array.from({ length: 60 }, (_, i) => iso(t0 + i * DAY));
  c.allDates = dates; c.priceDates = dates.slice(); c.priceIndexByDate = Object.fromEntries(dates.map((d, i) => [d, i]));
  c.priceArray = dates.map(() => 60000);
  const age = bandsWith([[4, from(52000, 55000, 100)], [0, from(58000, 61000, 100)], [12, [30000]]]), all = {};
  for (const r of age) for (const k in r) all[k] = (all[k] || 0) + r[k];
  const data = c.buildData(dates[50], { all, age });
  c.priceHighLow = { high: null, low: null };
  c.splitMode = true; c.timePockets = true; c.rangeMark = { lo: 10000, hi: 20000 };
  await c.renderChart(data);
  let L = element('chart').layout;
  const pockets = c.timePocketsOf(data);
  assert.deepEqual(plain(pockets.map(p => p.days)), [120, 150]);
  const labels = L.annotations.filter(a => a.xanchor === 'center' && /LTH IN/.test(a.text));
  assert.deepEqual(plain(labels.map(a => a.text.replace(/<br>/g, ' ').replace(/<[^>]+>/g, ''))), ['LTH IN 120 DAYS', 'LTH IN 150 DAYS']);
  assert.ok(labels.every(a => a.text.includes("<span style='color:" + c.LTH_COLOR + "'>")), 'in the long-term holders\' colour');
  const tints = L.shapes.filter(s => s.type === 'rect' && c.POCKET_TINTS.includes(s.fillcolor));
  assert.deepEqual(plain(tints.map(s => [s.x0, s.x1, s.fillcolor])), plain(pockets.map((p, k) => [p.lo, p.hi, c.POCKET_TINTS[k % 2]])), 'each pocket shaded, lighter and darker in turn');
  const ends = L.shapes.filter(s => s.type === 'line' && s.line.color === c.MARK_EDGE).map(s => s.x0);
  assert.deepEqual(plain(ends), plain([pockets[0].lo, pockets[1].hi]), 'a white line at each end of the span');
  const between = L.shapes.filter(s => s.type === 'line' && s.line.color === c.POCKET_EDGE).map(s => s.x0);
  assert.deepEqual(plain(between), plain([pockets[1].lo]), 'a fainter one between the two');
  assert.ok(!L.annotations.some(a => /Last Moved Here/.test(a.text.replace(/<br>/g, ' '))), 'no marked range while the pockets are drawn');
  const btn = element('btnPockets');
  assert.deepEqual([btn.disabled, btn.getAttribute('aria-pressed'), btn.title], [false, 'true', c.t('pocketsTitle')]);
  // In AGE it does not apply: the button is off, nothing is drawn, and the marked range is back.
  c.splitMode = false;
  await c.renderChart(data);
  L = element('chart').layout;
  // (The lighter shade is a marked range's own tint, which is back: the darker one and the lines between pockets are not.)
  assert.ok(!L.shapes.some(s => s.fillcolor === c.POCKET_TINTS[1] || (s.line && s.line.color === c.POCKET_EDGE)) && !L.annotations.some(a => /LTH IN/.test(a.text)));
  assert.deepEqual([btn.disabled, btn.getAttribute('aria-pressed'), btn.title], [true, 'false', 'Time pockets: in LTH/STH only']);
  assert.ok(L.annotations.some(a => /Last Moved Here/.test(a.text.replace(/<br>/g, ' '))));
  // Its click: nothing in AGE; in LTH/STH it turns the pockets off and on, and on clears a marked range.
  c.rerenderCurrent = () => Promise.resolve();
  c.lastRenderedData = data;
  btn.onclick();
  assert.equal(c.timePockets, true, 'AGE: no change');
  c.splitMode = true;
  btn.onclick();
  assert.equal(c.timePockets, false);
  btn.onclick();
  assert.deepEqual([c.timePockets, c.rangeMark], [true, null]);
});

test('the TIME POCKETS button sits beside PIN Y-AXIS, named in each language', () => {
  const { c, element } = app();
  assert.match(html, /<button id="btnPeak"[^>]*>Pin Y-axis<\/button>\s*<button id="btnPockets" aria-pressed="false" title="Time pockets: [^"]+">Time pockets<\/button>\s*<\/div>/, 'in the same group, right after it');
  assert.match(html, /#controls button:disabled \{ opacity: 0\.4; cursor: not-allowed; \}/, 'dimmed where it does not apply');
  for (const [lang, word] of [['zh', '时间口袋'], ['ja', 'タイムポケット'], ['en', 'Time pockets']]) {
    c.lang = lang; c.applyLang();
    assert.equal(element('btnPockets').textContent, word, lang);
  }
});
