const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./helpers.cjs');

// A day drawn in a chart box `width` px wide (the plot is 160 px narrower, as plotWidthPx assumes and the fake
// Plotly reports back). Returns the bars as drawn, the bin width in dollars and the plot's width.
async function drawAt(width) {
  const { c, element } = app();
  const gd = element('chart');
  gd.clientWidth = width;
  c.Plotly.react = (id, traces, layout, config) => {
    const g = element(id);
    g.data = traces; g.layout = layout; g.config = config;
    g._fullLayout = { width, xaxis: { _length: width - 160 }, legend: { _height: 29 } };
    return Promise.resolve();
  };
  const dates = ['2026-09-01', '2026-09-02'];
  c.allDates = dates; c.priceDates = dates.slice();
  c.priceIndexByDate = { '2026-09-01': 0, '2026-09-02': 1 };
  c.priceArray = [60000, 60100];
  c.currentIdx = 1;
  const raw = { all: { 50000: 2, 70000: 1 }, age: [{ 50000: 2 }, { 70000: 1 }] };
  c.fetchRaw = () => Promise.resolve(raw);
  await c.loadAndRender();
  const bars = gd.data.filter(t => t.type === 'bar' && t.x && t.x.length > 1);
  const data = c.lastRenderedData;
  return { bars, traces: gd.data, binWidth: data.binWidth, bins: data.aggAll.length, plotW: width - 160, c };
}

test('every bar keeps a 1 px gap from a 2 px pitch up, whatever the screen, and is drawn solid only below that', async () => {
  // 3840 px (a 4K monitor), 2160 px (the laptop, where the gaps always showed), 1920 and 1800 px (a desktop at 100%,
  // where 625 bars got under 3 px each and were drawn solid before), and 1300 px (under 2 px: solid).
  for (const width of [3840, 2160, 1920, 1800, 1300]) {
    const { bars, binWidth, bins, plotW } = await drawAt(width);
    assert.ok(bars.length >= 1, width + ': bars drawn');
    const pitch = plotW / bins;   // px per bar: the axis spans exactly the bins (the price is inside it)
    for (const t of bars) {
      const w = t.width[0];
      assert.ok(t.width.every(x => x === w), 'one width for every bar');
      const gapPx = (binWidth - w) / binWidth * pitch;
      if (pitch >= 2) assert.ok(Math.abs(gapPx - 1) < 1e-9, `${width} px (pitch ${pitch.toFixed(2)}): a 1 px gap, got ${gapPx}`);
      else assert.equal(w, binWidth, `${width} px (pitch ${pitch.toFixed(2)}): solid`);
      // An outline, however thin, makes Plotly round both edges of every bar to whole pixels instead of widening
      // bars under 2 px outwards (which filled the gaps); it is invisible.
      assert.ok(t.marker.line.width > 0.01 && t.marker.line.width < 0.1, 'a hairline outline');
      assert.equal(t.marker.line.color, 'rgba(0,0,0,0)', 'that cannot be seen');
    }
  }
});

test('under a 2 px pitch the bars are solid and the lines are drawn over them, as sharp single pixels where there is room', async () => {
  for (const width of [1300, 900]) {
    const { bars, traces, binWidth, bins, plotW, c } = await drawAt(width);
    const pitch = plotW / bins, pxData = binWidth / pitch;   // one pixel, in dollars
    assert.ok(pitch < 2, width + ': under 2 px');
    for (const t of bars) assert.equal(t.width[0], binWidth, 'solid bars');
    const k = traces.findIndex(t => t.meta === 'separators');
    assert.ok(k > 0, width + ': the lines are drawn');
    const sep = traces[k];
    assert.equal(k, traces.map(t => t.type).lastIndexOf('bar') + 1, 'right over the bars, under everything after them');
    assert.equal(sep.line.color, c.CHART_COLORS.bg, 'in the background colour');
    assert.equal(sep.hoverinfo, 'skip'); assert.equal(sep.showlegend, false);
    const prices = bars[0].x, h = prices.map((_, i) => bars.reduce((s, t) => s + (t.y[i] || 0), 0));
    const beside = [];   // boundaries with a bar beside them
    for (let j = 0; j + 1 < prices.length; j++) if (Math.max(h[j], h[j + 1]) > 0) beside.push([(prices[j] + prices[j + 1]) / 2, Math.max(h[j], h[j + 1])]);
    const got = [];
    for (let i = 0; i < sep.x.length; i += 3) { assert.equal(sep.x[i], sep.x[i + 1]); assert.equal(sep.y[i], 0); assert.equal(sep.x[i + 2], null); got.push([sep.x[i], sep.y[i + 1]]); }
    // Each line is at a boundary (within a pixel of it), as tall as the taller bar beside it.
    for (const [x, top] of got) {
      const b = beside.find(([bx]) => Math.abs(bx - x) <= pxData);
      assert.ok(b, 'a line at a boundary'); assert.ok(Math.abs(top - b[1]) < 1e-9, 'as tall as the taller bar beside it');
    }
    if (pitch >= 1.5) {
      assert.equal(sep.line.width, 1, `${width} px (pitch ${pitch.toFixed(2)}): one sharp pixel`);
      // a pixel's centre, on the screen's grid (the plot starts at 0 here)
      for (const [x] of got) { const p = x / pxData; assert.ok(Math.abs(p - Math.floor(p) - 0.5) < 1e-6, 'on a pixel centre'); }
      // left out only where the bar beside it would lose its last pixel: at this pitch, one boundary in about ten
      assert.ok(got.length >= 0.8 * beside.length && got.length <= beside.length, `${got.length} of ${beside.length}`);
    } else {
      assert.ok(Math.abs(sep.line.width - pitch / 2.5) < 1e-12, `${width} px (pitch ${pitch.toFixed(2)}): a thinner seam`);
      assert.equal(got.length, beside.length, 'at every boundary');
    }
  }
  // From a 2 px pitch up the bars carry their own gaps: no lines drawn over them.
  const { traces } = await drawAt(1920);
  assert.equal(traces.findIndex(t => t.meta === 'separators'), -1);
});
