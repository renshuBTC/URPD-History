const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('./helpers.cjs');
const plain = v => JSON.parse(JSON.stringify(v));   // out of the page's realm, for deepEqual

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
// A day's bars as the left axis draws them: each its share of the day in percent.
const shares = v => { const tot = v.reduce((a, b) => a + b, 0), k = tot > 0 ? 100 / tot : 0; return v.map(x => x * k); };   // as drawChart works it out
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
  assert.equal(c.xAxisEnd('2020-01-08', 1600, 1070), 1600, 'and grows to exactly a new highest stamp, nothing added');
  assert.equal(c.xAxisEnd('2020-01-09', 1400, 1700), 1700 * 1.001, 'or 0.1% past a price above every stamp');
  const data = c.buildData(dates[3], raws[3]);
  assert.equal(data.binWidth * c.NUM_BINS, 1500, 'bins divide the axis so far, not the day');
  c.setScales(null);
  assert.ok(c.xAxisEnd('2020-01-02', 50, 1010) >= 1010 * 1.001, 'without the history it still clears the price');
  c.setScales({ start: 'bad' });
  assert.equal(c.SCALES, null, 'a malformed file is ignored');
});

test('the left axis ends at the day\'s own bars, where the Y-max field says, and a day looks the same however it is reached', async () => {
  const { c, element } = app();
  const peaks = [3, 5, 4, 9, 2, 2, 7, 12, 1, 6];
  const { dates, raws } = market(c, { n: 10, cohorts: i => [{ 950: peaks[i], 1005: 1 }, { 990: 1 }] });
  const seen = {};
  for (const i of [5, 1, 8, 3, 9, 0, 6, 2, 7, 4, 5, 8, 0, 9]) {
    const data = c.buildData(dates[i], raws[i]);
    await c.renderChart(data);
    const top = element('chart').layout.yaxis.range[1];
    assert.ok(Math.abs(top - Math.max(...shares(c.barValues(data, false)))) < 1e-9, `${dates[i]}: USD starts at Y-max 100, the day's tallest bar, as its share of the day`);
    if (seen[i] !== undefined) assert.equal(top, seen[i], `${dates[i]} looks the same on every visit`);
    seen[i] = top;
  }
  assert.ok(seen[4] < seen[3], 'a short day is drawn at its own height, not the tallest so far');
  assert.equal(c.yMaxPct, 100);
  for (const gone of ['setYMaxMode', 'yAxisSoFar', 'yFit', 'yMaxExplicit']) assert.equal(typeof c[gone], 'undefined', gone + ' is gone: nothing but the Y-max field and a pin sets the axis');
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
  assert.deepEqual(Array.from(y.ticktext), Array.from(c.axisLabels(y.tickvals, '%')), 'the left axis in percent');
  assert.deepEqual(plain(c.axisLabels(c.axisTicks(1.46), '%')).slice(0, 3), ['0%', '0.073%', '0.15%']);
  assert.equal(c.axisLabels(c.axisTicks(100), '%')[20], '100%');
  assert.deepEqual([c.pctCompact(13.93), c.pctCompact(1.4712), c.pctCompact(0.07254)], ['13.9%', '1.47%', '0.0725%']);
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
      assert.match(b.hovertemplate, coin ? /Total Supply: %\{customdata\[0\]:\.3r\}% \(%\{customdata\[2\]:,\.2f\} BTC\)/ : /Total Value When Last Moved: %\{customdata\[0\]:\.3r\}% \(%\{customdata\[2\]:\$,\.0f\}\)/);
      assert.match(b.hovertemplate, /<br>(<1h|1h-1d): %\{y:\.3r\}%<br>/, 'its band as a share of the day');
      assert.match(b.hovertemplate, /<br>Percent of Total: %\{customdata\[1\]:\.1f\}%/);
      assert.equal(b.customdata, bars[0].customdata, 'one shared array');
    }
    const cd = bars[0].customdata, totals = c.barValues(c.buildData(dates[3], raws[3]), coin), pct = shares(totals);
    cd.forEach((p, i) => { assert.ok(Math.abs(p[0] - pct[i]) < 1e-12); assert.equal(p[2], totals[i], 'the amount behind it'); if (i) assert.ok(p[1] >= cd[i - 1][1]); });
    const drawn = bars.reduce((sum, b) => sum + b.y.reduce((a, v) => a + v, 0), 0);
    assert.ok(Math.abs(drawn - 100) < 1e-9, 'the day\'s bars add up to 100%');
    assert.ok(Math.abs(cd.at(-1)[1] - 100) < 1e-9);
    assert.equal(graph.data.some(t => t.meta === 'pct' || t.yaxis === 'y2'), false);
    assert.match(graph.layout.title.text, coin ? /^<b>Bitcoin URPD \(% BTC, AGE\) as of / : /^<b>Bitcoin URPD \(% USD, AGE\) as of /);
    assert.equal(graph.layout.xaxis.title.text, 'Price When Last Moved [USD]', 'the title names the axis and nothing else');
    assert.equal(graph.layout.yaxis.title.text, coin ? 'Percent of BTC Supply Last Moved [%]' : 'Percent of USD Value Last Moved [%]');
  }
  // the video's chart says the same (USD view; its title is checked in video-looks.test.cjs)
  const video = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'tools', 'video', 'page.html'), 'utf8');
  const looks = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'tools', 'video', 'looks.mjs'), 'utf8');
  for (const s of ['"<b>" + esc(sp.title) + ', 'title: { text: "Price When Last Moved [USD]", font', 'text: esc(sp.yTitle)',
  ]) assert.ok(video.includes(s), 'video: ' + s);
  for (const s of ['yTitle: "Percent of USD Value Last Moved [%]"', 'yTitle: "Percent of BTC Supply Last Moved [%]"', 'profit: "USD Value Last Moved In Profit: "', 'loss: "USD Value Last Moved In Loss: "',
    'profit: "BTC Supply Last Moved In Profit: "', 'loss: "BTC Supply Last Moved In Loss: "']) assert.ok(looks.includes(s), 'video: ' + s);
  assert.doesNotMatch(video, /This Price|Supply Distribution|per bar|perBar|BOTTOM SIGNAL|GLOW|isBottom/);
});

test('LTH/STH draws the same bars as AGE, split at 150 days: short-term holders (the first eight bands) under long-term holders', async () => {
  const { c, element } = app();
  // All 23 bands, each at a price of its own, so every band shows where it went.
  const { dates, raws } = market(c, { cohorts: () => Array.from({ length: 23 }, (_, k) => ({ [900 + 10 * k]: k + 1 })) });
  for (const coin of [false, true]) {
    c.coinMode = coin;
    const data = c.buildData(dates[3], raws[3]);
    c.splitMode = false;
    await c.renderChart(data);
    const ageGraph = element('chart'), age = ageGraph.data.filter(t => t.type === 'bar'), ageTop = ageGraph.layout.yaxis.range[1];
    assert.equal(age.length, 23);
    c.splitMode = true;
    await c.renderChart(data);
    const g = element('chart'), split = g.data.filter(t => t.type === 'bar');
    assert.deepEqual(plain(split.map(t => t.meta)), ['sth', 'lth']);
    assert.deepEqual(plain(split.map(t => t.name)), ['Short-Term Holders (STH)', 'Long-Term Holders (LTH)']);
    assert.deepEqual(plain(split.map(t => t.marker.color)), ['#e6a817', '#5599ff'], 'amber under blue');
    for (let i = 0; i < age[0].y.length; i++) {
      const young = age.slice(0, 8).reduce((s, t) => s + t.y[i], 0), all = age.reduce((s, t) => s + t.y[i], 0), tol = 1e-9 * Math.max(1, all);
      assert.ok(Math.abs(split[0].y[i] - young) <= tol, 'STH: bands <1h to 4m-5m');
      assert.ok(Math.abs(split[0].y[i] + split[1].y[i] - all) <= tol, 'together the whole bar');
    }
    for (const t of split) {
      assert.match(t.hovertemplate, new RegExp('<br>' + t.name.replace(/[()]/g, '\\$&') + ': '));
      assert.match(t.hovertemplate, /<br>Percent of Total: %\{customdata\[1\]:\.1f\}%/);
    }
    assert.equal(g.layout.yaxis.range[1], ageTop, 'the same left axis');
    assert.equal(g.layout.legend.font.size, 12, 'two legend entries, in the larger type');
    assert.match(g.layout.title.text, coin ? /^<b>Bitcoin URPD \(% BTC, LTH\/STH\) as of / : /^<b>Bitcoin URPD \(% USD, LTH\/STH\) as of /);
  }
  c.splitMode = false;
});

test('Percent of Total meets the price box at the dashed line: at most In Profit left of it, at least right of it', async () => {
  const { c, element } = app();
  // A pile of supply just above the day's price (1020), which the smoothing spreads onto both sides of the line.
  const { dates, raws } = market(c, { cohorts: () => [{ 900: 5, 1015: 2, 1025: 50, 1100: 3 }] });
  c.KERNEL_PCT = 0.24;
  for (const coin of [false, true]) {
    c.coinMode = coin;
    const data = c.buildData(dates[2], raws[2]);
    await c.renderChart(data);
    const graph = element('chart'), bar = graph.data.find(t => t.type === 'bar'), spot = data.spot;
    const profit = coin ? data.profitPctCoin : data.profitPct;
    const box = graph.layout.annotations.find(a => /In Profit/.test(a.text)).text;
    assert.ok(box.includes('In Profit: ' + profit.toFixed(1) + '%'), box);
    let left = 0, right = 0;
    bar.x.forEach((price, i) => {
      const share = bar.customdata[i][1];
      if (price < spot) { left++; assert.ok(share <= profit && +share.toFixed(1) <= +profit.toFixed(1), `${price}: ${share} > ${profit}`); }
      else { right++; assert.ok(share >= profit && +share.toFixed(1) >= +profit.toFixed(1), `${price}: ${share} < ${profit}`); }
    });
    assert.ok(left > 0 && right > 0);
    // The smoothed bars' own running sum, which the hover used to show, crossed the line here.
    const vals = c.barValues(data, coin), tot = vals.reduce((a, b) => a + b, 0);
    let run = 0;
    const smoothed = vals.map(v => (run += v, 100 * run / tot));
    assert.ok(bar.x.some((price, i) => price < spot && smoothed[i] > profit + 0.05), 'the case this guards against');
  }
});

test('BTC starts at Y-max 99.8: the first bar, the tallest, runs off the top with its height printed; at 100 it counts like any other', async () => {
  const { c, element } = app();
  // a $0 pile, and a little in every dollar up to the price, so that every one of the 626 bars holds something
  const day = { 0: 5000 }; for (let p = 1; p <= 1099; p++) day[p] = 1 + (p % 7);
  const { dates, raws } = market(c, { close: () => 1000, cohorts: () => [day] });
  c.setScales({ start: dates[0], end: dates.at(-1), x: [[0, 1100]] });
  assert.deepEqual(plain(c.yMaxByMode), [100, 99.8], 'USD starts at 100, BTC at 99.8');
  c.setViewMode(1);
  assert.equal(c.yMaxPct, 99.8);
  assert.equal(element('ymaxInput').value, '99.8', 'and the field says so');
  const data = c.buildData(dates[4], raws[4]);
  await c.renderChart(data);
  const graph = element('chart'), bars = shares(c.barValues(data, true)), top = graph.layout.yaxis.range[1];
  assert.equal(bars.length, 626);
  assert.equal(top, bars.slice().sort((a, b) => a - b)[624], 'the axis ends at the second tallest bar');
  assert.deepEqual(plain(bars.map((v, i) => (v > top ? i : -1)).filter(i => i >= 0)), [0], 'the $0 pile runs off the top, and nothing else');
  assert.ok(graph.layout.annotations.some(a => a.text === '▲ ' + c.pctCompact(bars[0])), 'its share of the day is printed at the top');
  c.applyYMax(100);
  assert.deepEqual(plain(c.yMaxByMode), [100, 100], 'a typed value is kept for the weighting in view');
  await c.renderChart(data);
  assert.equal(element('chart').layout.yaxis.range[1], bars[0], 'at 100 the first bar counts like any other');
  assert.ok(!element('chart').layout.annotations.some(a => /^▲/.test(a.text)), 'and nothing is cut');
  c.setViewMode(0);
  assert.equal(c.yMaxPct, 100, 'USD keeps its own');
});

test('a typed Y-max zooms into the day in view, and every bar it cuts is counted; a pin freezes the axis and turns the field off', async () => {
  const { c, element } = app();
  const day = { 1000: 400 }; for (let p = 1; p <= 1099; p++) day[p] = (day[p] || 0) + 1;
  const { dates, raws } = market(c, { cohorts: () => [day] });
  c.setScales({ start: dates[0], end: dates.at(-1), x: [[0, 1100]] });
  const data = c.buildData(dates[5], raws[5]), bars = shares(c.barValues(data, false)), tallest = Math.max(...bars);
  await c.renderChart(data);
  assert.equal(element('chart').layout.yaxis.range[1], tallest, 'at 100 the day\'s tallest bar reaches the top');
  assert.equal(element('ymaxInput').disabled, false);
  c.applyYMax(99);
  await c.renderChart(data);
  const zoomed = element('chart').layout.yaxis.range[1], cut = bars.filter(v => v > zoomed);
  assert.equal(zoomed, bars.slice().sort((a, b) => a - b)[Math.floor(626 * 0.99)], 'the 99th percentile of the day\'s bars');
  assert.ok(cut.length > 1, 'the spike and the bars its smoothing reaches');
  const note = element('chart').layout.annotations.find(a => /^▲/.test(a.text));
  assert.equal(note.text, '▲ ' + c.pctCompact(tallest) + ' (+' + (cut.length - 1) + ')', 'the tallest of them, and how many more');
  assert.equal(c.peakKey(data), 'usd%|b625|s0.24', 'pins are shares now, kept apart from the amounts pinned before');
  c.peakStore[c.peakKey(data)] = [dates[1], 2.5];
  await c.renderChart(data);
  assert.equal(element('chart').layout.yaxis.range[1], 2.5, 'a pin holds the axis, whatever the Y-max says');
  assert.equal(element('ymaxInput').disabled, true, 'so the Y-max field is off while it holds');
  assert.ok(element('chart').layout.annotations.some(a => /^Pinned 2\.50% · /.test(a.text)), 'the pin is labelled with its share and day');
  delete c.peakStore[c.peakKey(data)];
  await c.renderChart(data);
  assert.equal(element('ymaxInput').disabled, false, 'released, the field is on again');
  assert.equal(element('chart').layout.yaxis.range[1], zoomed);
  assert.doesNotMatch(require('./helpers.cjs').html, /yMaxExplicit/, 'a typed Y-max no longer outranks a pin: the field is simply off');
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

test('a click and drag marks a range of prices instead of zooming; it stays, with its share of the day', async () => {
  const { c, element } = app();
  const { dates, raws } = market(c, { start: '2021-09-01', n: 60, close: () => 60000, cohorts: () => [{ 100: 1, 60000: 1, 70000: 2 }] });
  const data = c.buildData(dates[50], raws[50]);
  await c.renderChart(data);
  let gd = element('chart'), L = gd.layout;
  assert.equal(L.dragmode, false, 'Plotly neither zooms nor pans');
  assert.equal(gd.config.doubleClick, false);
  for (const b of ['zoom2d', 'pan2d', 'select2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d', 'resetScale2d']) assert.ok(gd.config.modeBarButtonsToRemove.includes(b), b);
  for (const ax of ['xaxis', 'yaxis', 'xaxis2', 'yaxis3']) assert.equal(L[ax].fixedrange, true, ax);
  assert.ok(!L.annotations.some(a => /Last Moved Here/.test(a.text.replace(/<br>/g, ' '))), 'nothing marked yet');
  // A mark over the prices 50,000 to 65,000: the value there is the 60,000 stamp's, 60000 / (100 + 60000 + 140000).
  c.rangeMark = { lo: 50000, hi: 65000 };
  await c.renderChart(data);
  L = element('chart').layout;
  const box = L.annotations.find(a => /Last Moved Here/.test(a.text.replace(/<br>/g, ' ')));
  assert.ok(box, 'a box with the figures');
  const want = 100 * 60000 / 200100;
  const flat = box.text.replace(/<br>/g, ' ').replace(/<[^>]+>/g, '');
  // Every coin here is in the first age band, a short-term holder: all of the share is STH.
  assert.equal(flat, 'Price: $50,000 \u2013 $65,000 USD Value Last Moved Here: ' + c.pctCompact(want) + ' LTH USD Value Last Moved Here: 0% STH USD Value Last Moved Here: ' + c.pctCompact(want), 'the range, its share and its split, wrapped');
  assert.ok(!/All LTH|Already All/.test(box.text), 'AGE: no days line');
  // Inside the mark, as wide as it is, at the top: from 3 px inside its left edge to 3 px inside its right one.
  const bandPx = (65000 - 50000) / L.xaxis.range[1] * 1040;
  assert.equal(box.xref, 'x'); assert.equal(box.x, 50000); assert.equal(box.xanchor, 'left'); assert.equal(box.xshift, 3);
  assert.equal(box.yref, 'paper'); assert.equal(box.y, 1); assert.equal(box.yanchor, 'top');
  assert.ok(Math.abs(box.width + 2 * (box.borderpad + box.borderwidth) - (bandPx - 6)) < 1e-6, 'the box spans the mark');
  for (const row of box.text.split('<br>').map(r => r.replace(/<[^>]+>/g, ''))) assert.ok(row.length * 0.6 * box.font.size * 1.07 <= box.width + 1e-9, row + ' fits');
  // As it looked while dragged (#markBand): a light tint between two thin white lines the full height of the plot.
  const tint = L.shapes.filter(s => s.type === 'rect' && s.xref === 'x' && s.fillcolor === c.MARK_TINT);
  assert.deepEqual(JSON.parse(JSON.stringify(tint.map(v => [v.x0, v.x1, v.y0, v.y1]))), [[50000, 65000, 0, 1]], 'tinted inside');
  const edges = L.shapes.filter(s => s.type === 'line' && s.line.color === c.MARK_EDGE);
  assert.deepEqual(JSON.parse(JSON.stringify(edges.map(e => [e.x0, e.x1, e.yref, e.y0, e.y1, e.line.width]))), [[50000, 50000, 'paper', 0, 1], [65000, 65000, 'paper', 0, 1]].map(e => e.concat(1)), 'a white line at each edge');
  assert.ok(!L.shapes.some(s => s.xsizemode === 'pixel' || s.ysizemode === 'pixel'), 'no corner brackets');
  assert.match(require('./helpers.cjs').html, /#markBand \{[^}]*background: rgba\(255,255,255,0\.06\);[^}]*border-left: 1px solid rgba\(255,255,255,0\.75\);[^}]*border-right: 1px solid rgba\(255,255,255,0\.75\);/, 'the drag looks the same');
  assert.equal(c.MARK_TINT, 'rgba(255,255,255,0.06)'); assert.equal(c.MARK_EDGE, 'rgba(255,255,255,0.75)');
  // In % BTC the share is of the coins: 1 of 4.
  c.coinMode = true;
  await c.renderChart(data);
  assert.match(element('chart').layout.annotations.find(a => /Last Moved Here/.test(a.text.replace(/<br>/g, ' '))).text.replace(/<br>/g, ' '), /BTC Supply Last Moved Here: 25\.0%/);
  c.coinMode = false;
  // Escape clears it.
  c.rangeMark = { lo: 50000, hi: 65000 };
  c.rangeMark = null;
  await c.renderChart(data);
  assert.ok(!element('chart').layout.annotations.some(a => /Last Moved Here/.test(a.text.replace(/<br>/g, ' '))), 'cleared');
});

test('a marked range\'s box text wraps to the mark\'s width and shrinks only as far as its words need', () => {
  const { c } = app();
  const mono = (str, size) => { let w = 0; for (let i = 0; i < str.length; i++) w += str.charCodeAt(i) > 0x2e7f ? size : 0.6 * size; return w; };
  const wide = c.fitMarkText(['Price: $50,000 \u2013 $65,000', 'USD Value Last Moved Here: 23.5%'], 2000, mono);
  assert.equal(wide.size, 13); assert.deepEqual(JSON.parse(JSON.stringify(wide.lines)), [['Price: $50,000 \u2013 $65,000'], ['USD Value Last Moved Here: 23.5%']], 'room for every line');
  const narrow = c.fitMarkText(['USD Value Last Moved Here: 23.5%'], 130, mono);
  assert.equal(narrow.size, 13, 'every word still fits at 13 px');
  for (const row of narrow.lines[0]) assert.ok(mono(row, 13) * 1.07 <= 130, row);
  assert.equal(narrow.lines[0].join(' '), 'USD Value Last Moved Here: 23.5%', 'nothing lost or doubled');
  const tight = c.fitMarkText(['Price: $50,000'], 50, mono);
  assert.ok(tight.size < 13 && tight.size >= 9, 'a word wider than the box: a smaller size');
  const cjk = c.fitMarkText(['最后在此移动的美元价值占比: 23.5%'], 60, mono);
  for (const row of cjk.lines[0]) assert.ok(mono(row, cjk.size) * 1.07 <= 60, row + ': CJK breaks between characters');
  assert.equal(cjk.lines[0].join('').replace(/ /g, ''), '最后在此移动的美元价值占比:23.5%', 'nothing lost or doubled');
});

test('a marked range\'s box splits its share between long- and short-term holders, each of the whole day, in AGE as in LTH/STH', async () => {
  const { c, element } = app();
  // At $60,000: 1 coin a week old (short-term) and 2 coins three years old (long-term); at $70,000 one more long-term.
  const bands = () => { const a = new Array(23).fill(null).map(() => ({})); a[3] = { 60000: 1 }; a[13] = { 60000: 2, 70000: 1 }; return a; };
  const { dates, raws } = market(c, { start: '2021-09-01', n: 60, close: () => 60000, cohorts: bands });
  const data = c.buildData(dates[50], raws[50]);
  c.priceHighLow = { high: null, low: null };   // no highs and lows: the age bands alone
  c.splitMode = true;
  c.rangeMark = { lo: 50000, hi: 65000 };
  const box = async () => { await c.renderChart(data); return element('chart').layout.annotations.find(a => a.xref === 'x' && a.width).text.replace(/<br>/g, ' ').replace(/<[^>]+>/g, ''); };
  // Value: 60,000 short-term, 120,000 long-term in the mark, of 250,000 in the day.
  let text = await box();
  assert.match(text, /USD Value Last Moved Here: 72\.0%/);
  assert.match(text, /LTH USD Value Last Moved Here: 48\.0%/);
  assert.match(text, /STH USD Value Last Moved Here: 24\.0%/, 'and the two add up to the share above');
  assert.match(text, /All LTH Within: 143 Days \(by 13 Mar 2022\)/, 'the youngest coins there are at least a week old; 143 days after 21 Oct 2021');
  // (CJK wraps between any two characters, so the rows are joined without the spaces here.)
  c.lang = 'zh'; assert.ok((await box()).replace(/ /g, '').includes('全部成为长期持有者:143天内（2022年3月13日前）'));
  c.lang = 'ja'; assert.ok((await box()).replace(/ /g, '').includes('すべて長期保有者になるまで:143日以内（2022年3月13日まで）'));
  c.lang = 'en'; await box();
  assert.ok(text.indexOf('LTH USD Value') < text.indexOf('STH USD Value') && text.indexOf('STH USD Value') < text.indexOf('All LTH'), 'LTH, then STH, then the days');
  const raw = element('chart').layout.annotations.find(a => a.xref === 'x' && a.width).text;
  assert.match(raw, new RegExp("<span style='color:" + c.LTH_COLOR + "'>LTH USD"), 'LTH in its legend colour');
  assert.match(raw, new RegExp("<span style='color:" + c.STH_COLOR + "'>STH USD"), 'STH in its');
  // Coins: 1 short-term and 2 long-term in the mark, of 4.
  c.coinMode = true;
  text = await box();
  assert.match(text, /BTC Supply Last Moved Here: 75\.0%/);
  assert.match(text, /LTH BTC Supply Last Moved Here: 50\.0%/);
  assert.match(text, /STH BTC Supply Last Moved Here: 25\.0%/);
  // AGE has the split too, not the days.
  c.splitMode = false; c.coinMode = false;
  text = await box();
  assert.match(text, /LTH USD Value Last Moved Here: 48\.0%/); assert.match(text, /STH USD Value Last Moved Here: 24\.0%/);
  assert.ok(!/All LTH|Already All/.test(text), text);
});

test('a marked range\'s share comes from the recorded prices, [a, b)', () => {
  const { c } = app();
  const ladder = c.priceLadder({ 10: 1, 20: 2, 30: 3 });
  assert.equal(c.shareInRange(ladder, 10, 20, true), 100 / 6, 'the 10 stamp, not the 20 one');
  assert.equal(c.shareInRange(ladder, 10, 21, true), 50);
  assert.equal(c.shareInRange(ladder, 0, 1000, false), 100);
  assert.equal(c.shareInRange(ladder, 31, 40, false), 0);
  assert.equal(c.shareInRange(c.priceLadder({}), 0, 10, false), null);
});

test('in LTH/STH a marked range gives the most days until every coin there is a long-term holder', () => {
  const { c } = app();
  // Day 1000 of BRK's index; the price was between 50 and 60 on day 990, ten days earlier, and nowhere near it since.
  const dateStr = new Date(Date.UTC(2009, 0, 1) + 1000 * 864e5).toISOString().slice(0, 10);
  const high = new Array(1001).fill(100), low = new Array(1001).fill(90);
  high[990] = 58; low[990] = 52;
  const age = new Array(23).fill(null).map(() => ({}));
  age[3][55] = 1;   // 1w-1m: at least 7 days old
  age[12][40] = 5;  // a long-term band, outside the range
  const data = { dateStr, rawAge: age };
  assert.equal(c.daysToAllLth(data, 50, 60), null, 'waits for the highs and lows');
  c.priceHighLow = { high, low };
  assert.equal(c.daysToAllLth(data, 50, 60), 140, 'the price was last there 10 days ago: 150 - 10');
  age[3] = {}; age[4][55] = 1; delete data.sthPrices;   // the youngest band there is 1m-2m: at least 30 days old (the day's lists built again)
  assert.equal(c.daysToAllLth(data, 50, 60), 120);
  assert.equal(c.daysToAllLth(data, 30, 50), 0, 'only long-term holders there');
  c.priceHighLow = { high: null, low: null };
  assert.equal(c.daysToAllLth(data, 50, 60), 120, 'without the highs and lows, the age bands alone');
  high[1000] = 70; low[1000] = 54; c.priceHighLow = { high, low }; age[4] = {}; age[0][55] = 1; delete data.sthPrices;
  assert.equal(c.daysToAllLth(data, 50, 60), 150, 'inside the range on the day itself, coins less than an hour old');
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
  assert.deepEqual(Object.keys(saved), ['about', 'start', 'end', 'x'], 'the price axis only: the left axis needs no history');
  for (const k of ['x']) for (let i = 1; i < saved[k].length; i++) {
    assert.ok(saved[k][i][0] > saved[k][i - 1][0] && saved[k][i][1] > saved[k][i - 1][1], `${k} only steps up`);
  }
  // The page, reading that file, draws each day on exactly the price axis the file recorded for it, and its left axis at
  // the day's own tallest bar.
  const { c, element } = app();
  c.allDates = dates; c.priceDates = priceDates; c.priceArray = closes;
  c.priceIndexByDate = Object.fromEntries(priceDates.map((d, i) => [d, i]));
  c.setScales(saved);
  for (const d of dates) {
    const age = [stamps[d]].concat(Array(22).fill({})), all = Object.assign({}, stamps[d]);
    const data = c.buildData(d, { all, age });
    const day = Math.round((Date.parse(d) - Date.parse('2009-01-03')) / DAY);
    assert.ok(Math.abs(data.binWidth * 625 - c.scaleAt(saved.x, day)) <= 1e-12 * c.scaleAt(saved.x, day), d + ': the axis the file recorded');
    await c.renderChart(data);
    assert.ok(Math.abs(element('chart').layout.yaxis.range[1] - (Math.max(...shares(c.barValues(data, false))) || 1)) < 1e-9, d);
  }
});

test('the spot price box keeps clear of the pin\'s label and the ▲ figure at the top left', async () => {
  // BTC on a $0-1,100 axis, with a $0 pile above the axis (so ▲ is printed), the price at $50 or $1,000.
  async function draw(price, pinned) {
    const { c, element } = app();
    const { dates, raws } = market(c, { close: () => price, cohorts: () => [{ 0: 5000, 40: 20, 50: 30 }] });
    c.setScales({ start: dates[0], end: dates.at(-1), x: [[0, 1100]] });
    c.setViewMode(1);   // Y-max 99.8: the $0 pile runs off the top
    const data = c.buildData(dates[5], raws[5]);
    if (pinned) c.peakStore[c.peakKey(data)] = [dates[1], 40];
    await c.renderChart(data);
    const notes = element('chart').layout.annotations;
    assert.ok(notes.some(a => /^▲/.test(a.text)));
    assert.equal(notes.some(a => /^Pinned/.test(a.text)), pinned);
    return notes.find(a => a.xref === 'x' && a.yref === 'paper' && /<br>/.test(a.text));
  }
  assert.equal((await draw(50, false)).yshift, -27, '▲ alone: just below it (its label ends 23 px down)');
  assert.equal((await draw(50, true)).yshift, -48, 'pinned: below the pin\'s label and the ▲ under it');
  const right = await draw(1000, true);
  assert.equal(right.xanchor, 'right');
  assert.ok(!right.yshift, 'with the price over at the right the box is nowhere near them, and stays at the top');
});
