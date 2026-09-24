const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('./helpers.cjs');

const DAY = 864e5;
const iso = t => new Date(t).toISOString().slice(0, 10);

// A small market: `n` days from `start`, closes from `close(i)`, and each day's cohorts from `cohorts(i)`.
function market(c, { start = '2020-01-01', n = 12, close = i => 1000 + 10 * i, cohorts }) {
  const t0 = Date.parse(start + 'T00:00:00Z');
  const dates = Array.from({ length: n }, (_, i) => iso(t0 + i * DAY));
  c.allDates = dates;
  c.priceDates = dates.slice();
  c.priceIndexByDate = Object.fromEntries(dates.map((d, i) => [d, i]));
  c.priceArray = dates.map((_, i) => close(i));
  const raws = dates.map((d, i) => {
    const age = cohorts(i), all = {};
    for (const r of age) for (const k in r) all[k] = (all[k] || 0) + r[k];
    return { all, age };
  });
  return { dates, raws };
}
const sigFigs = label => label.replace(/^\$/, '').replace(/[KMBT]$/, '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '').length;

test('smoothing spreads each stamp over the price range it was rounded from, keeps $0 at $0, and preserves totals and means', () => {
  const { c } = app();
  c.NUM_BINS = 625; c.KERNEL_PCT = 0.24;
  const w = 10, agg = c.aggregate({ 0: 5, 1000: 2 }, w);
  assert.equal(agg.length, 626);
  assert.equal(agg[0].supply, 5, 'the $0 stamp stays whole in the first bar');
  let s = 0, m = 0, below = 0, above = 0;
  for (const b of agg.slice(1)) { s += b.supply; m += b.supply * b.price; if (b.price < 1000) below += b.supply; else above += b.supply; }
  assert.ok(Math.abs(s - 2) < 1e-12);
  assert.ok(Math.abs(m / s - 1000) < 0.05, 'mean price preserved');
  assert.ok(Math.abs(below - above) < 1e-9, 'symmetric about the stamp');
  assert.ok(agg.filter(b => b.supply > 1e-6).length >= 3, 'spread over several bars');
  // $10 steps from $100,000: still centred, and wider
  const hi = c.aggregate({ 100000: 1 }, 170);
  const mh = hi.reduce((a, b) => a + b.supply * b.price, 0);
  assert.ok(Math.abs(mh - 100000) < 1);
  // Smoothing 0 is the raw bars
  c.KERNEL_PCT = 0;
  const raw = c.aggregate({ 0: 5, 1000: 2, 1009.9: 1 }, w);
  assert.equal(raw[100].supply, 3); assert.equal(raw[0].supply, 5);
  assert.equal(raw.filter(b => b.supply > 0).length, 2);
});

test('the price axis comes from the history on days it covers, and only grows after it', () => {
  const { c } = app();
  const { dates, raws } = market(c, { cohorts: () => [{ 900: 1 }] });
  c.setScales({ start: '2020-01-01', end: '2020-01-05', bins: 625, smoothing: 0.24, x: [[0, 1000], [3, 1500]], usd: [[0, 10]], btc: [[0, 1]] });
  assert.equal(c.xAxisEnd('2020-01-02', 5000, 900), 1000, 'a covered day ignores its own data');
  assert.equal(c.xAxisEnd('2020-01-04', 5000, 900), 1500);
  assert.equal(c.xAxisEnd('2020-01-07', 1400, 1060), 1500, 'after the file it carries on from the last value');
  const grown = c.xAxisEnd('2020-01-08', 1600, 1070);
  assert.ok(grown > 1600 && grown < 1612, 'and grows past a new highest stamp by half a step and two sigmas');
  const data = c.buildData(dates[3], raws[3]);
  assert.equal(data.binWidth * c.NUM_BINS, 1500, 'bins divide the axis so far, not the day');
  c.setScales(null);
  assert.ok(c.xAxisEnd('2020-01-02', 50, 1010) >= 1010 * 1.001, 'without the history it still clears the price');
  c.setScales({ start: 'bad' });
  assert.equal(c.SCALES, null, 'a malformed file is ignored');
});

test('the left axis ends at the tallest bar so far, is the same on every visit, and never shrinks moving forward', async () => {
  const { c, element } = app();
  const peaks = [3, 5, 4, 9, 2, 2, 7, 12, 1, 6];
  const { dates, raws } = market(c, { n: 10, cohorts: i => [{ 950: peaks[i], 1005: 1 }, { 990: 1 }] });
  // Build the history the way tools/build-scales.cjs does: this file's own bars at the default settings.
  const file = { start: dates[0], end: dates[6], bins: 625, smoothing: 0.24, x: [], usd: [], btc: [] };
  for (let i = 0; i <= 6; i++) {
    c.setScales(file.x.length ? file : null);
    let maxStamp = 0; for (const k in raws[i].all) maxStamp = Math.max(maxStamp, +k);
    const X = c.xAxisEnd(dates[i], maxStamp, c.priceArray[i]);
    if (!file.x.length || X > file.x.at(-1)[1]) file.x.push([i, X]);
    const saveEnd = file.end; file.end = dates[i]; c.setScales(file);
    const level = c.axisLevel(c.barValues(c.buildData(dates[i], raws[i]), false), false, 100);
    if (!file.usd.length || level > file.usd.at(-1)[1]) file.usd.push([i, level]);
    file.end = saveEnd;
  }
  file.end = dates[6];
  c.setScales(file);
  const seen = {};
  for (const i of [5, 1, 8, 3, 9, 0, 6, 2, 7, 4, 5, 8, 0, 9]) {
    const data = c.buildData(dates[i], raws[i]);
    await c.renderChart(data);
    const top = element('chart').layout.yaxis.range[1];
    if (seen[i] !== undefined) assert.equal(top, seen[i], `${dates[i]} looks the same on every visit`);
    seen[i] = top;
    assert.ok(Math.max(...c.barValues(data, false)) <= top * (1 + 1e-12), 'no bar is cut off');
  }
  for (let i = 1; i <= 6; i++) assert.ok(seen[i] >= seen[i - 1], 'moving forward the axis never shrinks');
  assert.equal(seen[6], file.usd.at(-1)[1], 'at the defaults the axis is exactly the history');
  assert.ok(seen[4] > Math.max(...c.barValues(c.buildData(dates[4], raws[4]), false)) * 2, 'a short day keeps the taller axis from before');
  // More bins, narrower bars: the history is scaled to the bin width in use
  c.NUM_BINS = 1250;
  assert.equal(c.yAxisSoFar(dates[6], false), file.usd.at(-1)[1] / 2);
});

test('both axes are labelled at twenty equal steps from 0 to their very end, to two significant figures', async () => {
  const { c, element } = app();
  let threes = 0, n = 0;
  for (let e = -2; e < 13; e += 0.0137) {
    const end = Math.pow(10, e), ticks = c.axisTicks(end), labels = c.axisLabels(ticks, false);
    assert.equal(ticks.length, 21); assert.equal(ticks[0], 0); assert.ok(Math.abs(ticks[20] - end) <= end * 1e-12, 'the end itself is a tick');
    assert.equal(labels[0], '$0');
    labels.forEach((l, k) => { if (k) assert.notEqual(l, labels[k - 1], `${end}: neighbouring labels differ`); });
    const top = Math.pow(10, Math.floor(Math.log10(end)));
    labels.slice(1).forEach((l, k) => {
      const v = ticks[k + 1], sf = sigFigs(l);
      if (sf > 2) { assert.ok(sf === 3 && end / top < 2 && v >= top * (1 - 1e-9), `${l}: a third figure only in the top power of ten of an end between 1 and 2 of it (${labels.join(' ')})`); threes++; }
      n++;
    });
    labels.forEach((l, k) => { const v = ticks[k]; if (v) { const shown = Number(l.replace('$', '').replace(/K$/, 'e3').replace(/M$/, 'e6').replace(/B$/, 'e9').replace(/T$/, 'e12')); assert.ok(Math.abs(shown - v) <= v * 0.05 + 1e-12, `${l} is within rounding of ${v}`); } });
  }
  assert.ok(threes / n < 0.1, 'nearly every label has two figures');
  const { dates, raws } = market(c, { cohorts: () => [{ 950: 3, 1005: 1 }] });
  await c.renderChart(c.buildData(dates[2], raws[2]));
  const L = element('chart').layout, y = L.yaxis, x = L.xaxis;
  assert.equal(y.tickvals.length, 21); assert.equal(y.tickvals[20], y.range[1], 'the top of the left axis is labelled');
  assert.equal(x.tickvals.length, 21); assert.equal(x.tickvals[20], x.range[1], 'the right end of the price axis is labelled');
  assert.deepEqual(Array.from(y.ticktext), Array.from(c.axisLabels(y.tickvals, false)));
  assert.equal(x.ticktext[0].trim(), '$0'); assert.ok(x.ticktext[0].length > 2, 'the price axis $0 is nudged off the corner');
  assert.equal(y.showgrid, true, 'each label has its own gridline');
  assert.equal(L.yaxis2, undefined, 'no % of Total axis');
});

test('hovering a bar gives the whole bar\'s total and its running share of the day, with no separate line', async () => {
  const { c, element } = app();
  const { dates, raws } = market(c, { cohorts: () => [{ 900: 1, 1000: 2 }, { 1000: 1 }] });
  for (const coin of [false, true]) {
    c.coinMode = coin;
    await c.renderChart(c.buildData(dates[3], raws[3]));
    const graph = element('chart'), bars = graph.data.filter(t => t.type === 'bar');
    assert.equal(bars.length, 2);
    for (const b of bars) {
      assert.match(b.hovertemplate, coin ? /Total BTC Supply Last Moved: %\{customdata\[0\]/ : /Total USD Value Last Moved: %\{customdata\[0\]/);
      assert.match(b.hovertemplate, /<br>Percent of Total: %\{customdata\[1\]:\.1f\}%/);
      assert.equal(b.customdata, bars[0].customdata, 'one shared array');
    }
    const cd = bars[0].customdata, totals = c.barValues(c.buildData(dates[3], raws[3]), coin);
    cd.forEach((p, i) => { assert.equal(p[0], totals[i]); if (i) assert.ok(p[1] >= cd[i - 1][1]); });
    assert.ok(Math.abs(cd.at(-1)[1] - 100) < 1e-9);
    assert.equal(graph.data.some(t => t.meta === 'pct' || t.yaxis === 'y2'), false);
    assert.match(graph.layout.title.text, coin ? /\(in BTC Supply Last Moved\) as of / : /\(in USD Value Last Moved\) as of /);
  }
});

test('BTC leaves the first bar out of the axis and prints its height; RAW counts every bar', async () => {
  const { c, element } = app();
  const { dates, raws } = market(c, { cohorts: () => [{ 0: 5000, 950: 20, 1000: 30 }] });
  c.coinMode = true; c.viewIdx = 1;
  await c.renderChart(c.buildData(dates[4], raws[4]));
  let graph = element('chart');
  const bars = c.barValues(c.lastRenderedData, true);
  assert.equal(bars[0], 5000);
  assert.ok(graph.layout.yaxis.range[1] < 100, 'the $0 pile does not set the axis');
  assert.ok(graph.layout.annotations.some(a => a.text === '▲ 5.00K BTC'), 'its height is printed at the top');
  c.currentIdx = 4; c.rawCache[dates[4]] = raws[4];
  await c.setRawMode(true);
  graph = element('chart');
  assert.equal(graph.layout.annotations.some(a => /^▲/.test(a.text)), false);
  assert.ok(graph.layout.yaxis.range[1] >= 30, 'RAW fits the day on its own');
});

test('a typed Y-max zooms into the day in view, and a pin freezes the axis', async () => {
  const { c, element } = app();
  const { dates, raws } = market(c, { cohorts: () => [{ 900: 1, 950: 2, 1000: 40 }] });
  c.setScales({ start: dates[0], end: dates.at(-1), bins: 625, smoothing: 0.24, x: [[0, 1100]], usd: [[0, 1e9]], btc: [[0, 1e6]] });
  const data = c.buildData(dates[5], raws[5]);
  await c.renderChart(data);
  assert.equal(element('chart').layout.yaxis.range[1], 1e9, 'the default follows the history');
  c.yMaxPct = 90; c.yMaxExplicit = [true, false];
  await c.renderChart(data);
  const zoomed = element('chart').layout.yaxis.range[1];
  assert.ok(zoomed < Math.max(...c.barValues(data, false)), 'a percentile below 100 clips this day');
  c.yMaxPct = 100; c.yMaxExplicit = [false, false];
  c.peakStore[c.peakKey(data)] = [dates[1], 12345];
  await c.renderChart(data);
  assert.equal(element('chart').layout.yaxis.range[1], 12345, 'a pin overrides the history');
});

test('landmark markers sit on the line\'s own extreme within a week, labelled inside the plot', async () => {
  const { c, element } = app();
  // The close peaks on 2021-11-09, a day before the landmark's (intraday) date.
  const { dates, raws } = market(c, { start: '2021-09-01', n: 120, close: i => (iso(Date.UTC(2021, 8, 1) + i * DAY) === '2021-11-09' ? 67000 : 60000 + (i % 7) * 100), cohorts: () => [{ 60000: 1 }] });
  await c.renderChart(c.buildData('2021-11-20', raws[dates.indexOf('2021-11-20')]));
  const graph = element('chart');
  const markers = graph.data.find(t => t.mode === 'markers' && Array.isArray(t.marker.symbol));
  const k = markers.marker.symbol.indexOf('triangle-down');
  assert.equal(markers.x[k], '2021-11-09'); assert.equal(markers.y[k], 67000);
  const label = graph.layout.annotations.find(a => a.text === 'Cycle 4 Top');
  assert.ok(label, 'labelled with an annotation');
  assert.equal(label.xref, 'x2'); assert.equal(label.yref, 'y3'); assert.equal(label.y, 67000);
  assert.equal(label.yanchor, 'top', 'hangs down from the peak, so a new high stays inside the plot');
  assert.ok(label.bgcolor && label.font.size >= 11, 'on a dark backing, readable');
  assert.equal(graph.layout.yaxis3.range[1], 67000, 'the line still fills the height');
});

test('build-scales writes the history the page reads back, one day at a time', async () => {
  const { main } = require('../tools/build-scales.cjs');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scales-')), 'scales.json');
  const priceDates = [], closes = [];
  for (let t = Date.UTC(2009, 0, 1); t <= Date.UTC(2009, 0, 13); t += DAY) { priceDates.push(iso(t)); closes.push(0); }
  const dates = ['2009-01-03', '2009-01-09', '2009-01-10', '2009-01-11', '2009-01-12'];
  const stamps = { '2009-01-03': { 0: 50 }, '2009-01-09': { 0: 50, 3: 2000 }, '2009-01-10': { 0: 50, 3: 2000, 7: 1500 }, '2009-01-11': { 0: 50, 3: 1000 }, '2009-01-12': { 0: 51, 12: 4000 } };
  closes[priceDates.indexOf('2009-01-10')] = 6;
  const realFetch = global.fetch;
  global.fetch = async url => {
    const u = String(url), body =
      u.endsWith('/cost-basis/all/dates') ? dates.concat('2009-01-13') :   // the API lists the day in progress too
      u.endsWith('/price_close/day1') ? { data: closes } :
      u.endsWith('/date/day1') ? { data: priceDates } :
      /utxos_under_1h_old\/(\d{4}-\d\d-\d\d)$/.test(u) ? stamps[u.slice(-10)] : {};
    return { ok: true, json: async () => body };
  };
  try {
    let file = await main(['--rebuild', '--until', '2009-01-11', '--out', out]);
    assert.equal(file.end, '2009-01-11');
    file = await main(['--until', '2009-01-12', '--out', out]);   // carries on from where it stopped
    assert.equal(file.end, '2009-01-12');
  } finally { global.fetch = realFetch; }
  const saved = JSON.parse(fs.readFileSync(out, 'utf8'));
  for (const k of ['x', 'usd', 'btc']) for (let i = 1; i < saved[k].length; i++) {
    assert.ok(saved[k][i][0] > saved[k][i - 1][0] && saved[k][i][1] > saved[k][i - 1][1], `${k} only steps up`);
  }
  // The page, reading that file, draws each day on exactly the axes the file recorded for it.
  const { c, element } = app();
  c.allDates = dates; c.priceDates = priceDates; c.priceArray = closes;
  c.priceIndexByDate = Object.fromEntries(priceDates.map((d, i) => [d, i]));
  c.setScales(saved);
  let prevTop = 0;
  for (const d of dates) {
    const age = [stamps[d]].concat(Array(22).fill({})), all = Object.assign({}, stamps[d]);
    const data = c.buildData(d, { all, age });
    const day = Math.round((Date.parse(d) - Date.parse('2009-01-03')) / DAY);
    assert.equal(data.binWidth * 625, c.scaleAt(saved.x, day));
    await c.renderChart(data);
    const top = element('chart').layout.yaxis.range[1];
    assert.equal(top, c.scaleAt(saved.usd, day) || 1);
    assert.ok(top >= prevTop); prevTop = top;
  }
});

test('the spot price box keeps clear of the pin\'s label and the ▲ figure at the top left', async () => {
  // BTC on a $0-1,100 axis, with a $0 pile above the axis (so ▲ is printed), the price at $50 or $1,000.
  async function draw(price, pinned) {
    const { c, element } = app();
    const { dates, raws } = market(c, { close: () => price, cohorts: () => [{ 0: 5000, 40: 20, 50: 30 }] });
    c.setScales({ start: dates[0], end: dates.at(-1), bins: 625, smoothing: 0.24, x: [[0, 1100]], usd: [[0, 1e9]], btc: [[0, 60]] });
    c.coinMode = true; c.viewIdx = 1;
    const data = c.buildData(dates[5], raws[5]);
    if (pinned) c.peakStore[c.peakKey(data)] = [dates[1], 40];
    await c.renderChart(data);
    const notes = element('chart').layout.annotations;
    assert.ok(notes.some(a => /^▲/.test(a.text)));
    assert.equal(notes.some(a => /^Peak/.test(a.text)), pinned);
    return notes.find(a => a.xref === 'x' && a.yref === 'paper' && /<br>/.test(a.text));
  }
  assert.equal((await draw(50, false)).yshift, -27, '▲ alone: just below it (its label ends 23 px down)');
  assert.equal((await draw(50, true)).yshift, -48, 'pinned: below the pin\'s label and the ▲ under it');
  const right = await draw(1000, true);
  assert.equal(right.xanchor, 'right');
  assert.ok(!right.yshift, 'with the price over at the right the box is nowhere near them, and stays at the top');
});

test('the chart is white, and its 23 age colours read on white: 3:1 or more each, darker with age, colour steps in proportion to the age gaps', () => {
  const { c } = app();
  const lin = (h) => [1, 3, 5].map((i) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const oklab = ([r, g, b]) => {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const contrastOnWhite = (h) => { const [r, g, b] = lin(h); return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05); };
  const cols = c.AGE_BAND_COLORS;
  assert.equal(cols.length, 23);
  const labs = cols.map((h) => oklab(lin(h)));
  for (const h of cols) assert.ok(contrastOnWhite(h) >= 3, `${h} is ${contrastOnWhite(h).toFixed(2)}:1 on white`);
  // Each band's place on a log-age scale: its geometric mid-age, 30 min for <1h to 16 y for >15y (hours).
  const D = 24, M = 730, Y = 8760, edges = [[0.25, 1], [1, D], [D, 7 * D], [7 * D, M], [M, 2 * M], [2 * M, 3 * M], [3 * M, 4 * M], [4 * M, 5 * M], [5 * M, 6 * M], [6 * M, 9 * M], [9 * M, Y],
    [Y, 1.5 * Y], [1.5 * Y, 2 * Y], [2 * Y, 3 * Y], [3 * Y, 4 * Y], [4 * Y, 5 * Y], [5 * Y, 6 * Y], [6 * Y, 7 * Y], [7 * Y, 8 * Y], [8 * Y, 10 * Y], [10 * Y, 12 * Y], [12 * Y, 15 * Y], [15 * Y, 18 * Y]];
  const pos = edges.map(([a, b]) => Math.log(Math.sqrt(a * b)));
  const perGap = [];
  for (let i = 1; i < 23; i++) {
    assert.ok(labs[i][0] < labs[i - 1][0], `band ${i} is darker than the one before`);
    const step = Math.hypot(...labs[i].map((v, k) => v - labs[i - 1][k]));
    assert.ok(step >= 0.0115, `bands ${i - 1} and ${i} are far enough apart`);
    perGap.push(step / (pos[i] - pos[i - 1]));
  }
  assert.ok(Math.max(...perGap) / Math.min(...perGap) <= 1.06, 'a gap twice as long in log-age is a colour step twice as big');
  assert.equal(c.PRICE_LINE_COLOR, '#000000');
  for (const h of [c.PROFIT_COLOR, c.LOSS_COLOR, c.GLOW_COLOR]) assert.ok(contrastOnWhite(h) >= 4.5, `${h} reads as text on white`);
});
