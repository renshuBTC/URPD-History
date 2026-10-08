// TIME POCKETS: the short-term holders' prices, from the first bin holding any of their coins to the last, cut into
// pockets whose bins turn long-term within a day of one another, each labelled with the most days until every coin
// last moved in it is a long-term holder (LTH IN XX DAYS), the labels in one row below the price box; its button right
// after LTH/STH | AGE, beside PIN Y-AXIS, on in LTH/STH only.
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
// Day 1000 of the Bitcoin Research Kit's index (its highs and lows are indexed from 2009-01-01). A fresh day's data each
// time: the page keeps each day's short-term prices on it.
const DAY1000 = iso(Date.UTC(2009, 0, 1) + 1000 * DAY);
const day = spec => ({ dateStr: DAY1000, rawAge: bandsWith(spec), binWidth: 10, aggAll: new Array(60).fill(null) });

test('the pockets are exact: every bin in one turns long-term within a day of the others, an empty bin going with the pocket on its left', () => {
  const { c } = app();
  assert.equal(c.POCKET_SPREAD, 1);
  c.priceHighLow = { high: null, low: null };   // no highs and lows: the age bands alone
  // Bins $10 wide from $0: 1m-2m coins in bins 10-19 (all long-term within 120 days), 3m-4m in 20-29 (60), nothing in 30,
  // 4m-5m in 31-33 (30), 2m-3m in 34-43 (90), 1w-1m in 44-48 (143) and <1h in 49-53 (150); long-term coins at $55.
  const spec = [[4, from(105, 195)], [6, from(205, 295)], [7, from(315, 335)], [5, from(345, 435)], [3, from(445, 485)], [0, from(495, 535)], [12, [55]]];
  assert.deepEqual(plain(c.timePocketsOf(day(spec))), [{ lo: 100, hi: 200, days: 120 }, { lo: 200, hi: 310, days: 60 }, { lo: 310, hi: 340, days: 30 },
    { lo: 340, hi: 440, days: 90 }, { lo: 440, hi: 490, days: 143 }, { lo: 490, hi: 540, days: 150 }], 'none merged: the empty bin 30 goes with 60');
  // The highs and lows: the price was last in bins 10-19 40 days ago, so their coins are at least 40 days old.
  const high = new Array(1001).fill(1000), low = new Array(1001).fill(900);
  high[960] = 199; low[960] = 101;
  c.priceHighLow = { high, low };
  assert.deepEqual(plain(c.timePocketsOf(day(spec)).map(p => p.days)), [110, 60, 30, 90, 143, 150], '150 - 40');
  // Within a day, and no more: <1h coins in bins 10-13, last in each 99, 98, 97 and 100 days ago (51, 52, 53, 50 days to
  // go): 51 and 52 share a pocket (52), 53 and 50 each have their own.
  const h2 = new Array(1001).fill(1000), l2 = new Array(1001).fill(900);
  [[901, 101, 109], [902, 111, 119], [903, 121, 129], [900, 131, 139]].forEach(([i, lo, hi]) => { l2[i] = lo; h2[i] = hi; });
  c.priceHighLow = { high: h2, low: l2 };
  assert.deepEqual(plain(c.timePocketsOf(day([[0, from(105, 135)]]))), [{ lo: 100, hi: 120, days: 52 }, { lo: 120, hi: 130, days: 53 }, { lo: 130, hi: 140, days: 50 }]);
  // While they load, nothing yet; a day with no short-term holders has no pockets.
  c.priceHighLow = null;
  assert.equal(c.timePocketsOf(day(spec)), null);
  assert.deepEqual(plain(c.timePocketsOf(day([[12, [55, 155]]]))), []);
});

test('the labels sit in one row below the price box, each over its own pocket: flat where it fits, upright where only that does, else none', () => {
  const { c } = app();
  const ctx = { xSpan: 1000, plotPx: 500, topLeft: [], spotBox: { x0: 0.7, x1: 0.9, y0: 0, h: 40 } };
  // 30, 20, 200 and 2.5 px wide.
  const labs = c.pocketLabelsLayout([{ lo: 0, hi: 60, days: 150 }, { lo: 60, hi: 100, days: 30 }, { lo: 100, hi: 500, days: 90 }, { lo: 500, hi: 505, days: 60 }], ctx);
  assert.deepEqual(plain(labs.map(l => [l.x, l.rows, l.size, l.upright, l.y])),
    [[30, ['LTH IN 150 DAYS'], 11, true, 46], [300, ['LTH IN 90 DAYS'], 13, false, 46]], 'the 20 and 2.5 px pockets give their days in the hover instead');
  // No price box: at the top, below the top-left labels.
  assert.deepEqual(plain(c.pocketLabelsLayout([{ lo: 100, hi: 500, days: 90 }], { ...ctx, spotBox: null }).map(l => l.y)), [0]);
  assert.deepEqual(plain(c.pocketLabelsLayout([{ lo: 100, hi: 500, days: 90 }], { ...ctx, spotBox: null, topLeft: [{ x1: 0.1, y1: 21 }] }).map(l => l.y)), [25]);
  // The words, in each language.
  assert.equal(c.pocketLabel(64), 'LTH IN 64 DAYS');
  assert.equal(c.pocketLabel(1), 'LTH IN 1 DAY');
  c.lang = 'zh'; assert.equal(c.pocketLabel(64), '64 天内成为 LTH');
  c.lang = 'ja'; assert.equal(c.pocketLabel(64), '64 日以内に LTH');
});

test('the sooner a pocket turns long-term, the brighter its shading', () => {
  const { c } = app();
  const alpha = d => Number(c.pocketTint(d).match(/,([\d.]+)\)$/)[1]);
  assert.equal(alpha(150), c.POCKET_TINT_LATE);
  assert.equal(alpha(0), c.POCKET_TINT_SOON);
  assert.ok(alpha(30) > alpha(90) && alpha(90) > alpha(149), 'sooner, brighter');
  assert.ok(c.POCKET_TINT_SOON <= 0.15, 'the bars and the grid read through even the brightest');
});

test('TIME POCKETS draws the pockets in LTH/STH in a marked range\'s place, names them in the hover, and is off in AGE', async () => {
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
  assert.deepEqual(plain(pockets.map(p => p.days)), [120, 150], 'the empty prices between go with the 120-day pocket');
  const labels = L.annotations.filter(a => a.xanchor === 'center' && /LTH IN/.test(a.text));
  assert.deepEqual(plain(labels.map(a => a.text.replace(/<br>/g, ' ').replace(/<[^>]+>/g, ''))), ['LTH IN 120 DAYS', 'LTH IN 150 DAYS']);
  assert.ok(labels.every(a => a.text.includes("<span style='color:" + c.LTH_COLOR + "'>")), 'in the long-term holders\' colour');
  assert.equal(new Set(labels.map(a => a.yshift)).size, 1, 'in one row');
  const tints = L.shapes.filter(s => s.type === 'rect' && pockets.some(p => s.fillcolor === c.pocketTint(p.days) && s.x0 === p.lo));
  assert.deepEqual(plain(tints.map(s => [s.x0, s.x1, s.fillcolor])), plain(pockets.map(p => [p.lo, p.hi, c.pocketTint(p.days)])), 'each pocket shaded by how soon');
  const ends = L.shapes.filter(s => s.type === 'line' && s.line.color === c.MARK_EDGE).map(s => s.x0);
  assert.deepEqual(plain(ends), plain([pockets[0].lo, pockets[1].hi]), 'a white line at each end of the span');
  const between = L.shapes.filter(s => s.type === 'line' && s.line.color === c.POCKET_EDGE).map(s => s.x0);
  assert.deepEqual(plain(between), plain([pockets[1].lo]), 'a fainter one between the two');
  assert.ok(!L.annotations.some(a => /Last Moved Here/.test(a.text.replace(/<br>/g, ' '))), 'no marked range while the pockets are drawn');
  // Each bar's hover ends with its pocket's days (and nothing, outside the span).
  const bars = element('chart').data.filter(tr => tr.type === 'bar');
  assert.ok(bars.length && bars.every(tr => /%\{customdata\[3\]\}<extra><\/extra>$/.test(tr.hovertemplate)));
  const at = price => bars[0].customdata[Math.floor(price / data.binWidth)][3].replace(/<[^>]+>/g, '');
  assert.deepEqual([at(53000), at(56500), at(59000), at(30000)], ['LTH IN 120 DAYS', 'LTH IN 120 DAYS', 'LTH IN 150 DAYS', '']);
  const btn = element('btnPockets');
  assert.deepEqual([btn.disabled, btn.getAttribute('aria-pressed'), btn.title], [false, 'true', c.t('pocketsTitle')]);
  // In AGE it does not apply: the button is off, nothing is drawn, the hover is as it was, and the marked range is back.
  c.splitMode = false;
  await c.renderChart(data);
  L = element('chart').layout;
  assert.ok(!L.shapes.some(s => pockets.some(p => s.fillcolor === c.pocketTint(p.days)) || (s.line && s.line.color === c.POCKET_EDGE)) && !L.annotations.some(a => /LTH IN/.test(a.text)));
  assert.ok(element('chart').data.filter(tr => tr.type === 'bar').every(tr => !/customdata\[3\]/.test(tr.hovertemplate)));
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

test('TIME POCKETS and PIN Y-AXIS come right after LTH/STH | AGE, in that order, named in each language', () => {
  const { c, element } = app();
  assert.match(html, /<button id="btnAge"[^>]*>[^<]*<\/button>\s*<\/div>\s*<div class="ctrl-sep"><\/div>\s*<div class="mode-toggle">\s*<button id="btnPockets" aria-pressed="false" title="Time pockets: [^"]+">Time pockets<\/button>\s*<button id="btnPeak"[^>]*>Pin Y-axis<\/button>\s*<\/div>\s*<div class="ctrl-sep"><\/div>\s*<label class="field" id="signalWrap"/,
    'AGE, then TIME POCKETS and PIN Y-AXIS together, then BOTTOM SIGNAL');
  assert.match(html, /#controls button:disabled \{ opacity: 0\.4; cursor: not-allowed; \}/, 'dimmed where it does not apply');
  for (const [lang, word] of [['zh', '时间口袋'], ['ja', 'タイムポケット'], ['en', 'Time pockets']]) {
    c.lang = lang; c.applyLang();
    assert.equal(element('btnPockets').textContent, word, lang);
  }
});
