// Y-MAX EXPANDS ON ATH | Y-MAX ALWAYS AT 100%: where the left axis ends. EXPANDS ON ATH, the default, ends it at the
// tallest bar so far (the axis history, data/scales.json, and the day's own bars), so it grows only when a bar sets a
// new all-time high and never shrinks; ALWAYS AT 100% ends it at the day's own tallest bar. Every way of moving
// through time draws each day on the axis of the button that is on, a day always looks the same however it is reached,
// and switching draws the day on screen again without fetching anything.
const test = require('node:test');
const assert = require('node:assert/strict');
const { html, app, flush } = require('./helpers.cjs');

const DAY = 864e5;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const plain = (v) => JSON.parse(JSON.stringify(v));
// Ten days whose tallest bar rises and falls, and an axis history built as tools/build-scales.cjs builds it (this
// file's own bars at the default settings). fetchRaw hands out each day's cohorts, counting the downloads.
function market(h) {
  const { c } = h, peaks = [3, 5, 4, 9, 2, 2, 7, 12, 1, 6];
  const t0 = Date.parse('2020-01-01T00:00:00Z'), dates = peaks.map((_, i) => iso(t0 + i * DAY));
  c.allDates = dates; c.priceDates = dates.slice(); c.priceIndexByDate = Object.fromEntries(dates.map((d, i) => [d, i]));
  c.priceArray = dates.map((_, i) => 1000 + 10 * i);
  const raws = dates.map((d, i) => {
    const age = c.AGE_BANDS.map(() => ({})); age[0] = { 950: peaks[i], 1005: 1 }; age[5] = { 990: 1 };
    const all = {}; for (const r of age) for (const k in r) all[k] = (all[k] || 0) + r[k];
    return { all, age };
  });
  const file = { start: dates[0], end: dates[9], bins: 625, smoothing: 0.24, x: [], usd: [], btc: [] };
  for (let i = 0; i < dates.length; i++) {
    c.setScales(file.x.length ? file : null);
    let maxStamp = 0; for (const k in raws[i].all) maxStamp = Math.max(maxStamp, +k);
    const X = c.xAxisEnd(dates[i], maxStamp, c.priceArray[i]);
    if (!file.x.length || X > file.x.at(-1)[1]) file.x.push([i, X]);
    const saveEnd = file.end; file.end = dates[i]; c.setScales(file);
    const d = c.buildData(dates[i], raws[i]);
    for (const [key, coin] of [['usd', false], ['btc', true]]) {
      const level = c.axisLevel(c.barValues(d, coin), coin, 100);
      if (!file[key].length || level > file[key].at(-1)[1]) file[key].push([i, level]);
    }
    file.end = saveEnd;
  }
  c.setScales(file);
  c.cache = {}; c.cacheOrder = [];
  const fetched = [];
  c.fetchRaw = (d) => { fetched.push(d); const r = raws[dates.indexOf(d)]; c.rawCache[d] = r; return Promise.resolve(r); };
  // The tallest bar of day i (in BTC, leaving out the first bar, as the axis does), and the axis so far on that day.
  const dayTop = (i, coin = false) => c.axisLevel(c.barValues(c.buildData(dates[i], raws[i]), coin), coin, 100);
  const soFar = (i, coin = false) => Math.max(c.yAxisSoFar(dates[i], coin), dayTop(i, coin));
  return { dates, raws, fetched, dayTop, soFar };
}
async function drawn(h) { for (let k = 0; k < 3; k++) { await flush(); await h.c.chartRenderPromise; } await flush(); return h.element('chart'); }
const top = (h) => h.element('chart').layout.yaxis.range[1];
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

test('Y-MAX EXPANDS ON ATH | Y-MAX ALWAYS AT 100% sits right of USD | BTC, EXPANDS ON ATH on at first; the bars stay in their 23 age bands', () => {
  const group = html.match(/<div class="mode-toggle">\s*<button id="btnUSD"[\s\S]*?<\/div>\s*<div class="ctrl-sep"><\/div>\s*<div class="mode-toggle">\s*(<button id="btnAth"[^>]*>Y-max expands on ATH<\/button>)\s*(<button id="btnFit"[^>]*>Y-max always at 100%<\/button>)\s*<\/div>\s*<div class="ctrl-sep"><\/div>\s*<div class="mode-toggle">\s*<button id="btnPeak"/);
  assert.ok(group, 'USD | BTC, then the two Y-MAX buttons, then Pin Y-axis');
  assert.match(group[1], /class="active" aria-pressed="true" title="Y-max expands on ATH: the left axis ends at the tallest bar so far; it grows when a bar reaches a new all-time high and never shrinks"/);
  assert.match(group[2], /aria-pressed="false" title="Y-max always at 100%: the left axis ends at each day's own tallest bar, so the tallest bar always reaches the top"/);
  assert.doesNotMatch(html, /btnAge|btnSplit|btnRaw|splitMode|rawMode|STH_BANDS|CHART_THEMES|raw-chart|&lt;150D/, 'AGE, <150D/>150D and RAW are gone');
  const { c } = app();
  assert.equal(c.yFit, false);
  assert.equal(c.yMaxMode(), 'ath');
});

test('ALWAYS AT 100% ends the left axis at the day\'s own tallest bar, EXPANDS ON ATH at the tallest so far; switching fetches nothing', async () => {
  const h = app(), { c, element } = h, m = market(h);
  c.currentIdx = 4; await c.loadAndRender(); await drawn(h);
  assert.deepEqual(m.fetched, [m.dates[4]]);
  assert.ok(close(top(h), m.soFar(4)), 'EXPANDS ON ATH: the tallest bar so far');
  assert.ok(top(h) > m.dayTop(4) * 2, 'a short day after a tall one keeps the taller axis');
  let bars = element('chart').data.filter((t) => t.type === 'bar');
  assert.equal(bars.length, 23);
  assert.match(element('chart').layout.title.text, /^<b>Bitcoin Supply by Price When Last Moved \(USD Value, Y-Max Expands on ATH\) as of 05 Jan 2020<\/b>$/);
  element('btnFit').onclick();
  assert.deepEqual([c.yFit, element('btnFit').getAttribute('aria-pressed'), element('btnAth').getAttribute('aria-pressed')], [true, 'true', 'false']);
  await drawn(h);
  assert.deepEqual(m.fetched, [m.dates[4]], 'drawn again from memory');
  assert.ok(close(top(h), m.dayTop(4)), 'ALWAYS AT 100%: the day\'s own tallest bar reaches the top');
  const values = c.barValues(c.lastRenderedData, false);
  assert.ok(close(Math.max(...values), top(h)), 'no bar is cut off, and the tallest touches the top');
  bars = element('chart').data.filter((t) => t.type === 'bar');
  assert.equal(bars.length, 23, 'the same bars, coloured by age band');
  assert.match(element('chart').layout.title.text, /^<b>Bitcoin Supply by Price When Last Moved \(USD Value, Y-Max Always at 100%\) as of 05 Jan 2020<\/b>$/);
  assert.equal(element('chart').layout.yaxis.tickvals.length, 21, 'still twenty labelled steps');
  // A second press of the button that is on changes nothing.
  const before = c.chartRenderSeq;
  element('btnFit').onclick();
  assert.equal(c.chartRenderSeq, before, 'already on: no redraw');
  element('btnAth').onclick(); await drawn(h);
  assert.ok(close(top(h), m.soFar(4)), 'back to the tallest so far');
  assert.equal(c.captureChartSettings().yFit, false);
});

test('every way of moving draws each day on the axis of the button that is on, and a day looks the same however it is reached', async () => {
  const h = app(), { c, element, docListeners } = h, m = market(h);
  c.currentIdx = 9; await c.loadAndRender(); await drawn(h);
  element('btnFit').onclick(); await drawn(h);
  const seen = {}, visited = [];
  const check = (how) => {
    const i = c.allDates.indexOf(c.lastRenderedData.dateStr);
    visited.push(i);
    assert.ok(close(top(h), m.dayTop(i)), `${how}: ${m.dates[i]} at its own tallest bar`);
    if (seen[i] !== undefined) assert.equal(top(h), seen[i], `${how}: ${m.dates[i]} as it looked before`);
    seen[i] = top(h);
  };
  const key = async (k) => { c.navLast = 0; docListeners.keydown[0]({ key: k, target: { tagName: 'BODY' }, preventDefault() {} }); await drawn(h); };
  check('the latest day');
  for (const k of ['ArrowLeft', 'a', 'ArrowLeft', 'd', 'ArrowRight']) { await key(k); check(k); }
  await key('Home'); check('Home');
  await key('End'); check('End');
  for (const i of [3, 7, 0, 5, 8, 1]) { c.goTo(i, true); await drawn(h); check('dragging the dot or a cycle jump to ' + m.dates[i]); }
  c.navLast = 0; element('btnPrev').onclick(); await drawn(h); check('<');
  assert.deepEqual(visited, [9, 8, 7, 6, 7, 8, 0, 9, 3, 7, 0, 5, 8, 1, 0], 'each move went where it was sent');
  // The same walk with EXPANDS ON ATH: the axis so far, the same on every visit, never shrinking going forward.
  element('btnAth').onclick(); await drawn(h);
  const ath = {};
  for (const i of [5, 1, 8, 3, 9, 0, 6, 2, 7, 4, 5, 8, 0, 9]) {
    c.goTo(i, true); await drawn(h);
    assert.ok(close(top(h), m.soFar(i)), m.dates[i]);
    if (ath[i] !== undefined) assert.equal(top(h), ath[i], `${m.dates[i]} the same on every visit`);
    ath[i] = top(h);
  }
  for (let i = 1; i < 10; i++) assert.ok(ath[i] >= ath[i - 1], 'moving forward the axis never shrinks');
});

test('in BTC, ALWAYS AT 100% leaves the first bar out as EXPANDS ON ATH does; a Y-max below 100 and a pin work the same in both', async () => {
  const h = app(), { c, element } = h, m = market(h);
  c.currentIdx = 6; await c.loadAndRender(); await drawn(h);
  element('btnFit').onclick(); await drawn(h);
  c.coinMode = true; c.viewIdx = 1; await c.rerenderCurrent();
  assert.ok(close(top(h), m.dayTop(6, true)), 'BTC: the tallest bar but the first');
  // A Y-max typed below 100 zooms into the day in either.
  for (const fit of [true, false]) {
    c.coinMode = false; c.viewIdx = 0; c.yFit = fit; c.yMaxPct = 50; c.yMaxExplicit = [true, false];
    await c.rerenderCurrent();
    assert.ok(close(top(h), c.axisLevel(c.barValues(c.lastRenderedData, false), false, 50)), fit + ': the 50th percentile of the day');
  }
  c.yMaxPct = 100; c.yMaxExplicit = [false, false];
  // A pin fixes the axis in either, wherever you go.
  c.yFit = true; c.syncYMaxButtons();
  c.goTo(7, true); await drawn(h);
  element('btnPeak').onclick(); await drawn(h);
  const pinned = m.dayTop(7);
  assert.ok(close(top(h), pinned));
  for (const i of [2, 9]) {
    c.goTo(i, true); await drawn(h);
    assert.ok(close(top(h), pinned), `${m.dates[i]}: on the pin, not its own tallest bar`);
    assert.equal(element('btnPeak').getAttribute('aria-pressed'), 'true');
  }
  element('btnPeak').onclick(); await drawn(h);
  assert.ok(close(top(h), m.dayTop(9)), 'unpinned: the day\'s own again');
});

test('the Y-MAX buttons and the titles in every language', async () => {
  const h = app(), { c, element } = h, m = market(h);
  c.currentIdx = 3; await c.loadAndRender(); await drawn(h);
  const titles = { en: ['(USD Value, Y-Max Expands on ATH) as of ', '(USD Value, Y-Max Always at 100%) as of ', '(BTC, Y-Max Always at 100%) as of '],
    zh: ['（美元价值，Y 轴上限随历史新高扩展）截至 ', '（美元价值，Y 轴上限始终 100%）截至 ', '（BTC，Y 轴上限始终 100%）截至 '],
    ja: ['（USD 評価額、Y軸上限は過去最高で拡大） 基準日 ', '（USD 評価額、Y軸上限は常に 100%） 基準日 ', '（BTC、Y軸上限は常に 100%） 基準日 '] };
  for (const lang of ['zh', 'ja', 'en']) {
    c.lang = lang; c.applyLang(); await drawn(h);
    assert.equal(element('btnAth').textContent, c.T[lang].ath, lang);
    assert.equal(element('btnFit').textContent, c.T[lang].fit, lang);
    assert.equal(element('btnAth').title, c.T[lang].athTitle, lang);
    assert.equal(element('btnFit').title, c.T[lang].fitTitle, lang);
    c.yFit = false; c.coinMode = false; await c.rerenderCurrent();
    assert.ok(element('chart').layout.title.text.includes(titles[lang][0]), lang + ' ath');
    c.yFit = true; await c.rerenderCurrent();
    assert.ok(element('chart').layout.title.text.includes(titles[lang][1]), lang + ' fit');
    c.coinMode = true; await c.rerenderCurrent();
    assert.ok(element('chart').layout.title.text.includes(titles[lang][2]), lang + ' fit, BTC');
    c.coinMode = false;
  }
  assert.deepEqual(plain(['ath', 'fit'].map((k) => c.T.en[k])), ['Y-max expands on ATH', 'Y-max always at 100%'], 'drawn in capitals by the toolbar');
  assert.ok(m.dates.length === 10);
});
