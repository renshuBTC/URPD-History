// The percent view: every bar is its percent of the day's total, of the realized cap in USD and of the supply in BTC,
// on a left axis fixed at 0 to 4%, so every day's bars add up to 100% and cover the same area of the chart. USD | BTC
// is the only choice of view. Every way of moving through time draws each day on that axis, a day always looks the
// same however it is reached, and switching the weighting draws the day on screen again without fetching anything.
const test = require('node:test');
const assert = require('node:assert/strict');
const { html, app, flush } = require('./helpers.cjs');

const DAY = 864e5;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
// Ten days whose tallest bar rises and falls, with a pile at $0 on every day. fetchRaw hands out each day's cohorts,
// counting the downloads.
function market(h) {
  const { c } = h, peaks = [3, 5, 4, 9, 2, 2, 7, 12, 1, 6];
  const t0 = Date.parse('2020-01-01T00:00:00Z'), dates = peaks.map((_, i) => iso(t0 + i * DAY));
  c.allDates = dates; c.priceDates = dates.slice(); c.priceIndexByDate = Object.fromEntries(dates.map((d, i) => [d, i]));
  c.priceArray = dates.map((_, i) => 1000 + 10 * i);
  const raws = dates.map((d, i) => {
    const age = c.AGE_BANDS.map(() => ({})); age[0] = { 950: peaks[i], 1005: 1 }; age[5] = { 990: 1 }; age[22] = { 0: 4 };
    const all = {}; for (const r of age) for (const k in r) all[k] = (all[k] || 0) + r[k];
    return { all, age };
  });
  c.setScales({ start: dates[0], end: dates[9], x: [[0, 1100]] });
  c.cache = {}; c.cacheOrder = [];
  const fetched = [];
  c.fetchRaw = (d) => { fetched.push(d); const r = raws[dates.indexOf(d)]; c.rawCache[d] = r; return Promise.resolve(r); };
  // Day i's bars as percents of its total, as the chart should draw them.
  const pct = (i, coin = false) => {
    const v = c.barValues(c.buildData(dates[i], raws[i]), coin), k = 100 / v.reduce((a, b) => a + b, 0);
    return v.map((x) => x * k);
  };
  return { dates, raws, fetched, pct };
}
async function drawn(h) { for (let k = 0; k < 3; k++) { await flush(); await h.c.chartRenderPromise; } await flush(); return h.element('chart'); }
// Presses USD or BTC and lets the redraw it schedules (100 ms later) run.
async function press(h, id) {
  h.element(id).onclick();
  for (const [t, v] of [...h.timers]) if (v.ms === 100) h.runTimer(t);
  return drawn(h);
}
// The whole of each bar as drawn: its age bands stacked.
const heights = (h) => { const bars = h.element('chart').data.filter((t) => t.type === 'bar'); return bars[0].y.map((_, k) => bars.reduce((s, b) => s + b.y[k], 0)); };
const top = (h) => h.element('chart').layout.yaxis.range[1];
const same = (a, b) => a.length === b.length && a.every((v, k) => Math.abs(v - b[k]) <= 1e-9);

test('USD | BTC is the only choice of view: no Y-MAX buttons, no PIN Y-AXIS, and the bars stay in their 23 age bands', async () => {
  const group = html.match(/<div class="mode-toggle">\s*<button id="btnUSD" class="active" aria-pressed="true">USD<\/button>\s*<button id="btnBTC" aria-pressed="false">BTC<\/button>\s*<\/div>\s*<div class="ctrl-sep"><\/div>\s*<label class="field" id="smoothWrap"/);
  assert.ok(group, 'USD | BTC, then the Smoothing field');
  assert.equal((html.match(/class="mode-toggle"/g) || []).length, 1, 'one toggle group');
  assert.doesNotMatch(html, /btnFit|btnAth|btnPeak|yFit|yMaxMode|yAxisSoFar|setYMaxMode|Y-max expands|Y-max always|Y-Max Always|Y-Max Expands/, 'the Y-MAX modes and the pin are gone');
  assert.doesNotMatch(html, /btnAge|btnSplit|btnRaw|splitMode|rawMode|STH_BANDS|CHART_THEMES|raw-chart|&lt;150D/, 'AGE, <150D/>150D and RAW are gone');
  const h = app(), { c } = h;
  market(h);
  assert.equal(c.coinMode, false, 'USD first');
  assert.equal(c.yMaxPct, 100);
  c.currentIdx = 4; await c.loadAndRender(); await drawn(h);
  assert.equal(h.element('chart').data.filter((t) => t.type === 'bar').length, 23);
  assert.deepEqual(Array.from(h.element('chart').layout.yaxis.range), [0, 4]);
});

test('every way of moving draws each day as its percents on the fixed 0-4% axis, and a day looks the same however it is reached', async () => {
  const h = app(), { c, element, docListeners } = h, m = market(h);
  c.currentIdx = 9; await c.loadAndRender(); await drawn(h);
  const seen = {}, visited = [];
  const check = (how) => {
    const i = c.allDates.indexOf(c.lastRenderedData.dateStr), coin = c.coinMode;
    visited.push(i);
    assert.equal(top(h), 4, `${how}: ${m.dates[i]} on the fixed axis`);
    const drawnNow = heights(h);
    assert.ok(same(drawnNow, m.pct(i, coin)), `${how}: ${m.dates[i]} as its percents`);
    assert.ok(Math.abs(drawnNow.reduce((a, b) => a + b, 0) - 100) < 1e-9, `${how}: adding up to 100%`);
    const k = i + (coin ? 'btc' : 'usd');
    if (seen[k]) assert.ok(same(drawnNow, seen[k]), `${how}: ${m.dates[i]} as it looked before`);
    seen[k] = drawnNow;
  };
  const key = async (k) => { c.navLast = 0; docListeners.keydown[0]({ key: k, target: { tagName: 'BODY' }, preventDefault() {} }); await drawn(h); };
  for (const coin of [false, true]) {
    if (coin) await press(h, 'btnBTC');
    check('the latest day');
    for (const k of ['ArrowLeft', 'a', 'ArrowLeft', 'd', 'ArrowRight']) { await key(k); check(k); }
    await key('Home'); check('Home');
    await key('End'); check('End');
    for (const i of [3, 7, 0, 5, 8, 1]) { c.goTo(i, true); await drawn(h); check('dragging the dot or a cycle jump to ' + m.dates[i]); }
    c.navLast = 0; element('btnPrev').onclick(); await drawn(h); check('<');
    c.goTo(9, true); await drawn(h);
  }
  const walk = [9, 8, 7, 6, 7, 8, 0, 9, 3, 7, 0, 5, 8, 1, 0];
  assert.deepEqual(visited, walk.concat(walk), 'each move went where it was sent, in USD and then in BTC');
});

test('switching USD | BTC draws the day on screen again from memory, as its percent of the realized cap or of the supply', async () => {
  const h = app(), { c, element } = h, m = market(h);
  c.currentIdx = 6; await c.loadAndRender(); await drawn(h);
  assert.deepEqual(m.fetched, [m.dates[6]]);
  assert.ok(same(heights(h), m.pct(6, false)));
  const usdFirst = heights(h)[0];
  assert.equal(usdFirst, 0, 'in USD the coins at $0 are worth nothing');
  await press(h, 'btnBTC');
  assert.deepEqual(m.fetched, [m.dates[6]], 'drawn again from memory');
  assert.equal(c.coinMode, true);
  assert.ok(same(heights(h), m.pct(6, true)), 'the percent of the supply');
  assert.ok(heights(h)[0] > 4, 'the pile at $0 runs off the top in BTC');
  assert.equal(top(h), 4);
  assert.match(element('chart').layout.title.text, /^<b>Bitcoin: Percent of Supply by Price When Last Moved as of 07 Jan 2020<\/b>$/);
  await press(h, 'btnUSD');
  assert.match(element('chart').layout.title.text, /^<b>Bitcoin: Percent of Realized Cap by Price When Last Moved as of 07 Jan 2020<\/b>$/);
  assert.deepEqual(m.fetched, [m.dates[6]]);
});

test('the readout, the ▲ figure, the titles and the axis in every language', async () => {
  const h = app(), { c, element } = h, m = market(h);
  c.currentIdx = 3; await c.loadAndRender(); await drawn(h);
  const want = {
    en: ['Bitcoin: Percent of Realized Cap by Price When Last Moved as of ', 'Bitcoin: Percent of Supply by Price When Last Moved as of ', 'Realized Cap: $', 'Supply: ', 'Tallest Bar: ', 'Percent of Realized Cap per Bar [%]', 'Percent of Supply per Bar [%]'],
    zh: ['比特币：按最后移动时价格划分的已实现市值百分比 截至 ', '比特币：按最后移动时价格划分的供应量百分比 截至 ', '已实现市值：$', '供应量：', '最高的柱子：', '每根柱子占已实现市值的百分比 [%]', '每根柱子占供应量的百分比 [%]'],
    ja: ['ビットコイン：最終移動時の価格別に見た実現時価総額の割合（%） 基準日 ', 'ビットコイン：最終移動時の価格別に見た供給量の割合（%） 基準日 ', '実現時価総額：$', '供給量：', '最も高い棒：', '1 本あたりの実現時価総額の割合 [%]', '1 本あたりの供給量の割合 [%]'] };
  for (const lang of ['zh', 'ja', 'en']) {
    const [tUsd, tBtc, rUsd, rBtc, rTall, aUsd, aBtc] = want[lang];
    c.lang = lang; c.applyLang();
    for (const coin of [false, true]) {
      c.coinMode = coin; c.viewIdx = coin ? 1 : 0; await c.rerenderCurrent();
      const L = element('chart').layout, notes = L.annotations;
      assert.ok(L.title.text.startsWith('<b>' + (coin ? tBtc : tUsd)), lang + ' title');
      assert.equal(L.yaxis.title.text, coin ? aBtc : aUsd, lang + ' axis');
      const read = notes.find((a) => a.xref === 'paper' && a.x === 0 && a.yanchor === 'top' && a.y === 1);
      assert.ok(read && read.text.startsWith(coin ? rBtc : rUsd) && read.text.includes('<br>' + rTall), lang + ': ' + (read && read.text));
      const pct = m.pct(3, coin);
      let k = coin ? 1 : 0; for (let i = k + 1; i < pct.length; i++) if (pct[i] > pct[k]) k = i;
      assert.ok(read.text.includes(rTall + c.pctText(pct[k]) + ' · '), lang + ': the tallest bar\'s percent');
      assert.equal(notes.some((a) => /^▲ /.test(a.text)), coin, lang + ': ▲ in BTC only');
      if (coin) assert.ok(notes.some((a) => a.text === '▲ ' + c.pctText(pct[0])));
    }
  }
  // The printed percent: three significant figures, 100% for the whole day.
  assert.deepEqual([2.3249, 0.012345, 13.84, 99.96, 100, 4].map(c.pctText), ['2.32%', '0.0123%', '13.8%', '100%', '100%', '4%']);
});
