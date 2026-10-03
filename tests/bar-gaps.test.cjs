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
  return { bars, binWidth: data.binWidth, bins: data.aggAll.length, plotW: width - 160 };
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
