// The four views. USD and BTC draw the bars in dollars and in coins, with the left axis at each day's own tallest bar,
// every bar counted (in coins the first, from $0 to one bar width, whose height only Y-max cuts). % USD and % BTC draw
// every bar as its percent of the day's total, of the realized cap and of the supply, on a left axis fixed at 0 to 4%,
// so every day's bars add up to 100% and cover the same area of the chart. PIN Y-AXIS fixes the axis at a pinned day's
// tallest bar in any of them. Nothing is printed over the bars at the top left but a pin's label. Every way of moving
// through time draws a day the same however it is reached, and switching the view draws the day on screen again without
// fetching anything.
const test = require('node:test');
const assert = require('node:assert/strict');
const { html, app, flush } = require('./helpers.cjs');

const DAY = 864e5;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
// Each view: its button, and whether it counts coins and draws percents.
const VIEWS = [['btnUSD', false, false], ['btnBTC', true, false], ['btnPctUSD', false, true], ['btnPctBTC', true, true]];
// Ten days whose tallest bar rises and falls, with a pile at $0 on every day that outweighs every other bar in coins,
// as the first bar does on every real day.
// fetchRaw hands out each day's cohorts, counting the downloads.
function market(h) {
  const { c } = h, peaks = [3, 5, 4, 9, 2, 2, 7, 12, 1, 6];
  const t0 = Date.parse('2020-01-01T00:00:00Z'), dates = peaks.map((_, i) => iso(t0 + i * DAY));
  c.allDates = dates; c.priceDates = dates.slice(); c.priceIndexByDate = Object.fromEntries(dates.map((d, i) => [d, i]));
  c.priceArray = dates.map((_, i) => 1000 + 10 * i);
  const raws = dates.map((d, i) => {
    const age = c.AGE_BANDS.map(() => ({})); age[0] = { 950: peaks[i], 1005: 1 }; age[5] = { 990: 1 }; age[22] = { 0: 40 };
    const all = {}; for (const r of age) for (const k in r) all[k] = (all[k] || 0) + r[k];
    return { all, age };
  });
  c.setScales({ start: dates[0], end: dates[9], x: [[0, 1100]] });
  c.cache = {}; c.cacheOrder = [];
  const fetched = [];
  c.fetchRaw = (d) => { fetched.push(d); const r = raws[dates.indexOf(d)]; c.rawCache[d] = r; return Promise.resolve(r); };
  // Day i's bars as the chart should draw them: in dollars or coins, or as percents of the day's total.
  const bars = (i, coin, pct) => {
    const v = c.barValues(c.buildData(dates[i], raws[i]), coin);
    if (!pct) return v;
    const k = 100 / v.reduce((a, b) => a + b, 0);
    return v.map((x) => x * k);
  };
  // Its tallest bar, the first one counted: where the left axis ends in USD and BTC, and what PIN Y-AXIS pins.
  const tallest = (i, coin, pct) => Math.max(...bars(i, coin, pct));
  return { dates, raws, fetched, bars, tallest };
}
async function drawn(h) { for (let k = 0; k < 3; k++) { await flush(); await h.c.chartRenderPromise; } await flush(); return h.element('chart'); }
// Presses a view's button and lets the redraw it schedules (100 ms later) run.
async function press(h, id) {
  h.element(id).onclick();
  for (const [t, v] of [...h.timers]) if (v.ms === 100) h.runTimer(t);
  return drawn(h);
}
// The whole of each bar as drawn: its age bands stacked.
const heights = (h) => { const bars = h.element('chart').data.filter((t) => t.type === 'bar'); return bars[0].y.map((_, k) => bars.reduce((s, b) => s + b.y[k], 0)); };
const top = (h) => h.element('chart').layout.yaxis.range[1];
const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const same = (a, b) => a.length === b.length && a.every((v, k) => near(v, b[k]));
// At the top left: the pin's label and dashed line.
const pinLabel = (h) => h.element('chart').layout.annotations.find((a) => /^Peak /.test(a.text));
const pinLine = (h) => h.element('chart').layout.shapes.find((s) => s.type === 'line' && s.yref === 'y');
// What is printed over the plot at its top left, the pin's label aside: nothing (no readout, no ▲ figure).
const overTopLeft = (h) => Array.from(h.element('chart').layout.annotations, (a) => a).filter((a) => !/^Peak /.test(a.text) &&
  ((a.xref === 'paper' && a.x === 0 && a.yref !== 'paper') || (a.xref === 'paper' && a.x === 0 && a.y === 1) || (a.xref === 'x' && a.x === 0) || /^▲/.test(a.text)))
  .map((a) => a.text);

test('four views, USD | BTC | % USD | % BTC, then PIN Y-AXIS on its own; no Y-MAX modes, and the bars stay in their 23 age bands', async () => {
  const group = html.match(/<div class="mode-toggle">\s*<button id="btnUSD" class="active" aria-pressed="true">USD<\/button>\s*<button id="btnBTC" aria-pressed="false">BTC<\/button>\s*<button id="btnPctUSD" aria-pressed="false" title="([^"]+)">% USD<\/button>\s*<button id="btnPctBTC" aria-pressed="false" title="([^"]+)">% BTC<\/button>\s*<\/div>\s*<div class="ctrl-sep"><\/div>\s*<div class="mode-toggle">\s*<button id="btnPeak" aria-pressed="false" title="[^"]+">Pin Y-axis<\/button>\s*<\/div>/);
  assert.ok(group, 'the four views in one group, then PIN Y-AXIS in its own');
  assert.equal(group[1], "% USD: each bar as its percent of the day's realized cap (every coin's value when it last moved)");
  assert.equal(group[2], "% BTC: each bar as its percent of the day's supply");
  assert.equal((html.match(/class="mode-toggle"/g) || []).length, 2, 'two toggle groups');
  assert.doesNotMatch(html, /btnFit|btnAth|yFit|yMaxMode|yAxisSoFar|setYMaxMode|Y-max expands|Y-max always/i, 'the Y-MAX modes are gone for good');
  assert.doesNotMatch(html, /btnAge|btnSplit|btnRaw|splitMode|rawMode|STH_BANDS|CHART_THEMES|raw-chart|&lt;150D/, 'AGE, <150D/>150D and RAW are gone');
  const h = app(), { c, element } = h;
  market(h);
  assert.deepEqual([c.viewIdx, c.coinMode, c.pctMode, c.yMaxPct], [0, false, false, 100], 'USD first');
  c.currentIdx = 4; await c.loadAndRender(); await drawn(h);
  assert.equal(element('chart').data.filter((t) => t.type === 'bar').length, 23);
  for (const [id, coin, pct] of [...VIEWS.slice(1), VIEWS[0]]) {
    await press(h, id);
    assert.deepEqual([c.coinMode, c.pctMode], [coin, pct], id);
    assert.deepEqual(VIEWS.map((v) => element(v[0]).getAttribute('aria-pressed')), VIEWS.map((v) => String(v[0] === id)), id + ' alone pressed');
    assert.equal(element('chart').data.filter((t) => t.type === 'bar').length, 23, id);
  }
});

test('every way of moving draws each day in its view, USD and BTC to its own tallest bar and % USD and % BTC on the fixed 0-4% axis, and a day looks the same however it is reached', async () => {
  const h = app(), { c, element, docListeners } = h, m = market(h);
  c.currentIdx = 9; await c.loadAndRender(); await drawn(h);
  const seen = {}, visited = [];
  const check = (how) => {
    const i = c.allDates.indexOf(c.lastRenderedData.dateStr), coin = c.coinMode, pct = c.pctMode;
    const view = VIEWS.findIndex((v) => v[1] === coin && v[2] === pct), name = VIEWS[view][0] + ' ' + how + ': ' + m.dates[i];
    visited.push(i);
    const drawnNow = heights(h);
    assert.ok(same(drawnNow, m.bars(i, coin, pct)), name + ' as it should be drawn');
    assert.ok(near(top(h), pct ? 4 : m.tallest(i, coin, false)), name + (pct ? ' on the fixed axis' : ' to its tallest bar'));
    if (pct) assert.ok(near(drawnNow.reduce((a, b) => a + b, 0), 100), name + ' adding up to 100%');
    const k = i + '|' + view;
    if (seen[k]) assert.ok(same(drawnNow, seen[k]), name + ' as it looked before');
    seen[k] = drawnNow;
  };
  const key = async (k) => { c.navLast = 0; docListeners.keydown[0]({ key: k, target: { tagName: 'BODY' }, preventDefault() {} }); await drawn(h); };
  for (const [id] of VIEWS) {
    await press(h, id);
    check('the latest day');
    for (const k of ['ArrowLeft', 'a', 'ArrowLeft', 'd', 'ArrowRight']) { await key(k); check(k); }
    await key('Home'); check('Home');
    await key('End'); check('End');
    for (const i of [3, 7, 0, 5, 8, 1]) { c.goTo(i, true); await drawn(h); check('dragging the dot or a cycle jump to ' + m.dates[i]); }
    c.navLast = 0; element('btnPrev').onclick(); await drawn(h); check('<');
    c.goTo(9, true); await drawn(h);
  }
  const walk = [9, 8, 7, 6, 7, 8, 0, 9, 3, 7, 0, 5, 8, 1, 0];
  assert.deepEqual(visited, [].concat(walk, walk, walk, walk), 'each move went where it was sent, in every view');
});

test('switching views draws the day on screen again from memory, titled and labelled for the view', async () => {
  const h = app(), { c, element } = h, m = market(h);
  c.currentIdx = 6; await c.loadAndRender(); await drawn(h);
  assert.deepEqual(m.fetched, [m.dates[6]]);
  const want = {
    btnUSD: ['Bitcoin Supply by Price When Last Moved (USD Value) as of 07 Jan 2020', 'Value When Last Moved [USD]'],
    btnBTC: ['Bitcoin Supply by Price When Last Moved (BTC) as of 07 Jan 2020', 'Supply [BTC]'],
    btnPctUSD: ['Bitcoin Supply by Price When Last Moved (% USD Value) as of 07 Jan 2020', 'Value When Last Moved [%]'],
    btnPctBTC: ['Bitcoin Supply by Price When Last Moved (% BTC) as of 07 Jan 2020', 'Supply [%]'] };
  for (const [id, coin, pct] of [...VIEWS.slice(1), VIEWS[0], VIEWS[3], VIEWS[1]]) {
    await press(h, id);
    const L = element('chart').layout, bar = element('chart').data.find((t) => t.type === 'bar');
    assert.equal(L.title.text, '<b>' + want[id][0] + '</b>', id);
    assert.equal(L.yaxis.title.text, want[id][1], id);
    assert.ok(same(heights(h), m.bars(6, coin, pct)), id);
    assert.equal(bar.hovertemplate.includes('%{customdata[0]:.3f}%'), pct, id + ': the hover gives the percent in the % views');
    assert.equal(bar.hovertemplate.includes(coin ? '%{customdata[2]:,.2f} BTC' : '%{customdata[2]:$,.0f}'), true, id + ': and the bar in coins or dollars in all four');
    assert.deepEqual(m.fetched, [m.dates[6]], id + ': drawn again from memory');
  }
  assert.equal(heights(h)[0], top(h), 'in BTC the pile at $0 is the tallest bar, and the axis ends at it');
  assert.ok(heights(h)[0] > 3 * Math.max(...heights(h).slice(1)));
  await press(h, 'btnPctBTC');
  assert.ok(heights(h)[0] > top(h), 'in % BTC it runs off the fixed top');
  await press(h, 'btnUSD');
  assert.equal(heights(h)[0], 0, 'in USD the coins at $0 are worth nothing');
  assert.deepEqual(m.fetched, [m.dates[6]]);
});

test('the titles and the axis titles in every language, and nothing printed over the bars: no readout, no ▲ figure', async () => {
  const h = app(), { c, element } = h, m = market(h);
  c.currentIdx = 3; await c.loadAndRender(); await drawn(h);
  const want = {
    en: [['Bitcoin Supply by Price When Last Moved (USD Value) as of ', 'Value When Last Moved [USD]'], ['Bitcoin Supply by Price When Last Moved (BTC) as of ', 'Supply [BTC]'],
      ['Bitcoin Supply by Price When Last Moved (% USD Value) as of ', 'Value When Last Moved [%]'], ['Bitcoin Supply by Price When Last Moved (% BTC) as of ', 'Supply [%]']],
    zh: [['按最后移动时价格划分的比特币供应（美元价值）截至 ', '最后移动时的价值 [美元]'], ['按最后移动时价格划分的比特币供应（BTC）截至 ', '供应量 [BTC]'],
      ['按最后移动时价格划分的比特币供应（% 美元价值）截至 ', '最后移动时的价值 [%]'], ['按最后移动时价格划分的比特币供应（% BTC）截至 ', '供应量 [%]']],
    ja: [['最終移動時の価格別ビットコイン供給量（USD 評価額） 基準日 ', '最終移動時の評価額 [USD]'], ['最終移動時の価格別ビットコイン供給量（BTC） 基準日 ', '供給量 [BTC]'],
      ['最終移動時の価格別ビットコイン供給量（% USD 評価額） 基準日 ', '最終移動時の評価額 [%]'], ['最終移動時の価格別ビットコイン供給量（% BTC） 基準日 ', '供給量 [%]']] };
  for (const lang of ['zh', 'ja', 'en']) {
    c.lang = lang; c.applyLang();
    for (const [v, [id, coin, pct]] of VIEWS.entries()) {
      c.coinMode = coin; c.pctMode = pct; c.viewIdx = v; await c.rerenderCurrent();
      const L = element('chart').layout, notes = L.annotations, [title, axis] = want[lang][v], name = lang + ' ' + id;
      assert.ok(L.title.text.startsWith('<b>' + title), name + ' title: ' + L.title.text);
      assert.equal(L.yaxis.title.text, axis, name + ' axis');
      // The readout of the day's total and its tallest bar is gone, and so is the ▲ figure over the first bar: in BTC
      // the axis ends at that bar, and in % BTC it runs off the top with its figures in its hover like any other bar.
      assert.deepEqual(overTopLeft(h), [], name);
      assert.doesNotMatch(JSON.stringify(notes), /▲|Realized Cap:|Supply:|Tallest Bar|已实现市值：|供应量：|最高的柱子|実現時価総額：|供給量：|最も高い棒/, name);
      assert.equal(heights(h)[0] > top(h), coin && pct, name + ': the first bar runs off the top in % BTC alone');
    }
  }
  // The printed figures: a percent to three significant figures (100% for the whole day), coins and dollars with K/M/B/T.
  assert.deepEqual([2.3249, 0.012345, 13.84, 99.96, 100, 4].map(c.pctText), ['2.32%', '0.0123%', '13.8%', '100%', '100%', '4%']);
  assert.deepEqual([31.874e9, 2.7712e6, 999.5, 12.5].map(c.peakCompact), ['31.87B', '2.77M', '999.50', '12.50']);
  for (const lang of ['en', 'zh', 'ja']) assert.deepEqual(Object.keys(c.T[lang]).filter((k) => /^read/.test(k)), [], lang + ': the readout\'s words are gone too');
});

test('PIN Y-AXIS in every view: the axis stays at the pinned day\'s tallest bar, labelled with it, until pressed again; a Y-max zoom into the day wins', async () => {
  const h = app(), { c, element } = h, m = market(h), btn = element('btnPeak');
  c.currentIdx = 7; await c.loadAndRender(); await drawn(h);
  const keys = ['usd|b625|s0.24', 'btc|b625|s0.24', 'usd%|b625|s0.24', 'btc%|b625|s0.24'];
  for (const [v, [id, coin, pct]] of VIEWS.entries()) {
    await press(h, id);
    c.goTo(7, true); await drawn(h);
    assert.equal(pinLabel(h), undefined, id + ': nothing pinned yet');
    assert.equal(pinLine(h), undefined, id);
    btn.onclick(); await drawn(h);
    const pin = m.tallest(7, coin, pct);
    assert.deepEqual(Object.keys(c.peakStore), keys.slice(0, v + 1), id + ': pinned under its own key');
    assert.equal(c.peakStore[keys[v]][0], m.dates[7]);
    assert.ok(near(c.peakStore[keys[v]][1], pin), id + ': at the day\'s tallest bar');
    assert.equal(btn.getAttribute('aria-pressed'), 'true', id);
    const figure = pct ? c.pctText(pin) : coin ? c.peakCompact(pin) + ' BTC' : '$' + c.peakCompact(pin);
    for (const i of [3, 4, 9, 7]) {
      c.goTo(i, true); await drawn(h);
      const name = id + ' ' + m.dates[i];
      assert.ok(near(top(h), pin), name + ': drawn against the pin');
      assert.ok(same(heights(h), m.bars(i, coin, pct)), name + ': the bars as they are');
      assert.equal(pinLabel(h).text, 'Peak ' + figure + ' · 08 Jan 2020', name);
      assert.ok(near(pinLine(h).y0, pin) && near(pinLine(h).y1, pin), name + ': the dashed line at the pin');
      assert.deepEqual(overTopLeft(h), [], name + ': nothing else at the top left');
    }
    // A Y-max below 100 that clips the day zooms into it, and the pin waits.
    c.applyYMax(50); await drawn(h);
    const zoom = c.axisLevel(m.bars(7, coin, pct), 50);
    assert.ok(zoom > 0 && zoom < pin, id);
    assert.ok(near(top(h), zoom), id + ': the zoom');
    assert.equal(pinLabel(h), undefined, id + ': no pin while zoomed');
    assert.equal(pinLine(h), undefined, id);
    c.applyYMax(100); await drawn(h);
    assert.ok(near(top(h), pin), id + ': the pin again');
  }
  // Each view keeps its own pin; pressing again unpins that view alone.
  for (const [v, [id]] of VIEWS.entries()) {
    await press(h, id);
    assert.equal(btn.getAttribute('aria-pressed'), 'true', id);
    btn.onclick(); await drawn(h);
    assert.deepEqual(Object.keys(c.peakStore), keys.slice(v + 1), id + ': unpinned');
    assert.equal(pinLabel(h), undefined, id);
    assert.equal(btn.getAttribute('aria-pressed'), 'false', id);
  }
});
