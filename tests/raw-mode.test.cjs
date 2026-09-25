// RAW, the third way to draw the bars (AGE | <150D/>150D | RAW): the recorded prices with no smoothing, every bar
// black, on a light chart. Choosing it sets the smoothing to 0 (the field shows it, locked) and leaving it gives the
// smoothing back; the chart's colours follow, and nothing is fetched again for a day already loaded.
const test = require('node:test');
const assert = require('node:assert/strict');
const { html, app, deferred, flush } = require('./helpers.cjs');

const plain = (v) => JSON.parse(JSON.stringify(v));
const iso = (t) => new Date(t).toISOString().slice(0, 10);
function days(from, to) {
  const out = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 864e5) out.push(iso(t));
  return out;
}
// Five days of a small market, the last day's coins in three age bands at stamps close enough together that the
// smoothing (0.24 %) spreads them into their neighbours' bars.
function market(c) {
  const dates = days('2026-09-20', '2026-09-24');
  c.allDates = dates; c.priceDates = dates.slice(); c.priceIndexByDate = Object.fromEntries(dates.map((d, i) => [d, i]));
  c.priceArray = dates.map(() => 60000); c.currentIdx = 4;
  const age = c.AGE_BANDS.map(() => ({}));
  age[0] = { 50000: 1 }; age[7] = { 50000: 2, 70000: 1 }; age[8] = { 50000: 4, 50100: 3 };
  return { dates, raw: { all: { 50000: 7, 50100: 3, 70000: 1 }, age } };
}
async function drawn(h) { await flush(); await h.c.chartRenderPromise; await flush(); return h.element('chart'); }

test('RAW: no smoothing, one black trace with no legend entry, on a light chart, from the day already loaded', async () => {
  const h = app(), { c, element } = h, { raw } = market(c);
  let fetched = 0;
  c.fetchRaw = (d) => { fetched++; c.rawCache[d] = raw; return Promise.resolve(raw); };   // kept in memory, as the page's own does
  await c.loadAndRender();
  assert.equal(c.KERNEL_PCT, 0.24);
  element('btnRaw').onclick();
  assert.deepEqual([c.rawMode, c.splitMode, c.KERNEL_PCT, c.smoothingBeforeRaw], [true, false, 0, 0.24]);
  let graph = await drawn(h);
  assert.equal(fetched, 1, 'binned again from the day in memory, not fetched again');
  assert.deepEqual(['btnAge', 'btnSplit', 'btnRaw'].map((id) => element(id).getAttribute('aria-pressed')), ['false', 'false', 'true']);
  // The smoothing field shows 0, locked, and says why.
  assert.deepEqual([element('smoothInput').value, element('smoothInput').disabled], ['0.00', true]);
  assert.equal(element('smoothWrap').title, c.T.en.smoothTitleRaw);
  const bars = graph.data.filter((t) => t.type === 'bar');
  assert.deepEqual(plain(bars.map((b) => [b.meta, b.marker.color, b.showlegend])), [['raw', '#000000', false]]);
  assert.equal(graph.data.filter((t) => t.showlegend !== false && t.name).map((t) => t.name).join(), 'BTC/USD', 'the legend holds only the price line');
  assert.match(graph.layout.title.text, /^<b>Bitcoin Supply by Price When Last Moved \(USD Value, RAW\) as of 24 Sept 2026<\/b>$/);
  assert.match(bars[0].hovertemplate, /^Price: \$%\{x:,\.0f\}<br>Total Value When Last Moved: %\{customdata\[0\]:\$,\.0f\}<br>/, 'the whole bar\'s hover');
  // Unsmoothed: every coin in the bar of its own stamp, so the bars hold exactly the recorded amounts.
  const width = c.lastRenderedData.binWidth, sum = bars[0].y.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - (50000 * 7 + 50100 * 3 + 70000)) < 1e-6, 'every dollar, in its bar');
  assert.equal(bars[0].y.filter((v) => v > 0).length, new Set([50000, 50100, 70000].map((p) => Math.floor(p / width))).size, 'no bar the smoothing spread into');
  // The light chart: white, black ink, the grid and watermark for white, black price line on a white casing, dashed
  // lines with a casing so they show over black bars, the price box and labels on white.
  const L = c.CHART_THEMES.light, layout = graph.layout;
  assert.deepEqual([layout.paper_bgcolor, layout.plot_bgcolor, layout.font.color, layout.title.font.color, layout.legend.font.color], ['#ffffff', '#ffffff', '#000000', '#000000', '#000000']);
  assert.deepEqual([layout.xaxis.gridcolor, layout.yaxis.gridcolor, layout.xaxis.tickfont.color, layout.yaxis.title.font.color], [L.grid, L.grid, '#000000', '#000000']);
  assert.equal(layout.shapes.find((s) => s.label).label.font.color, L.watermark);
  const lines = graph.data.filter((t) => t.xaxis === 'x2' && t.mode === 'lines');
  assert.deepEqual(plain(lines.map((t) => [t.line.color, t.line.width])), [[L.casing, 4], ['#000000', 1.5]]);
  const spot = layout.shapes.filter((s) => s.type === 'line' && s.xref === 'x');
  assert.deepEqual(plain(spot.map((s) => [s.line.color, s.line.width, s.line.dash || 'solid'])), [[L.dashCasing, 3, 'solid'], ['#000000', 1, 'dash']], 'a white casing under the dashed line');
  const box = layout.annotations.find((a) => /In Profit/.test(a.text));
  assert.deepEqual([box.font.color, box.bgcolor, box.bordercolor], ['#000000', L.boxBg, L.boxBorder]);
  assert.match(box.text, new RegExp(`color:${L.profit}'>USD Value Last Moved In Profit: `));
  assert.match(box.text, new RegExp(`color:${L.loss}'>USD Value Last Moved In Loss: `));
  const credit = layout.annotations.find((a) => /Bitview/.test(a.text));
  assert.equal(credit.font.color, L.credit);
  assert.match(credit.text, /style="color:#000000">Bitview\.space<\/a>/);
});

test('leaving RAW gives the smoothing back, and the dark chart; RAW keeps its smoothing at 0 whatever is typed', async () => {
  const h = app(), { c, element } = h, { raw } = market(c);
  c.fetchRaw = () => Promise.resolve(raw);
  await c.loadAndRender();
  c.applySmoothing(0.5); await drawn(h);
  assert.equal(c.KERNEL_PCT, 0.5);
  c.setBarsMode('raw'); await drawn(h);
  assert.equal(c.KERNEL_PCT, 0);
  c.applySmoothing(0.8); await drawn(h);
  assert.equal(c.KERNEL_PCT, 0, 'locked while RAW is on');
  assert.equal(c.peakKey(), 'usd|b625|s0', 'a pin in RAW is kept with the unsmoothed bars');
  // Back to <150D/>150D (or AGE): the smoothing that was set aside, and the dark chart.
  c.setBarsMode('split'); const graph = await drawn(h);
  assert.deepEqual([c.rawMode, c.splitMode, c.KERNEL_PCT, c.smoothingBeforeRaw], [false, true, 0.5, null]);
  assert.deepEqual([element('smoothInput').value, element('smoothInput').disabled, element('smoothWrap').title], ['0.50', false, c.T.en.smoothTitle]);
  assert.equal(graph.layout.paper_bgcolor, '#0a0a0a');
  assert.equal(graph.data.filter((t) => t.type === 'bar').length, 2);
  assert.match(graph.layout.title.text, /\(USD Value, &lt;150D\/&gt;150D\)/);
  // RAW again from <150D/>150D, then AGE: the same smoothing comes back.
  c.setBarsMode('raw'); await drawn(h);
  c.setBarsMode('age'); await drawn(h);
  assert.equal(c.KERNEL_PCT, 0.5);
  assert.equal(element('chart').data.filter((t) => t.type === 'bar').length, 23);
  // Pressing the button already on changes nothing.
  const seq = c.chartRenderSeq;
  element('btnAge').onclick();
  assert.equal(c.chartRenderSeq, seq);
});

test('RAW that cannot be drawn (the day not in memory and its download failing) goes back to the view on screen', async () => {
  const h = app(), { c, element } = h, { raw } = market(c);
  c.fetchRaw = () => Promise.resolve(raw);
  await c.loadAndRender();
  c.rawCache = {};   // the day's series gone from memory
  const fail = deferred();
  c.fetchRaw = () => fail.promise;
  element('btnRaw').onclick();
  assert.equal(c.rawMode, true);
  fail.reject(new Error('HTTP 503')); await drawn(h); await flush();
  assert.deepEqual([c.rawMode, c.KERNEL_PCT, c.barsMode()], [false, 0.24, 'age'], 'the settings the chart is drawn with');
  assert.deepEqual(['btnAge', 'btnSplit', 'btnRaw'].map((id) => element(id).getAttribute('aria-pressed')), ['true', 'false', 'false']);
  assert.deepEqual([element('smoothInput').value, element('smoothInput').disabled], ['0.24', false]);
});

test('RAW in every language: the button, its tooltip and the title', async () => {
  const h = app(), { c, element } = h, { raw } = market(c);
  c.fetchRaw = () => Promise.resolve(raw);
  await c.loadAndRender();
  c.setBarsMode('raw'); await drawn(h);
  for (const [lang, want] of [['zh', '（美元价值，RAW）截至 '], ['ja', '（USD 評価額、RAW） 基準日 '], ['en', '(USD Value, RAW) as of ']]) {
    c.lang = lang; c.applyLang(); await drawn(h);
    assert.equal(element('btnRaw').textContent, 'RAW', lang);
    assert.equal(element('btnRaw').title, c.T[lang].rawTitle, lang);
    assert.equal(element('smoothWrap').title, c.T[lang].smoothTitleRaw, lang);
    assert.ok(element('chart').layout.title.text.includes(want), lang);
  }
  c.coinMode = true; await c.rerenderCurrent();
  assert.match(element('chart').layout.title.text, /\(BTC, RAW\) as of /);
  // The tooltip says what RAW is: the bars as recorded, no smoothing, no colours.
  assert.match(c.T.en.rawTitle, /no smoothing/); assert.match(c.T.en.rawTitle, /no colours/);
  assert.match(html, /<button id="btnRaw" aria-pressed="false" title="RAW: the bars as recorded, with no smoothing and no colours: every bar in black, on a light chart">RAW<\/button>/);
});
