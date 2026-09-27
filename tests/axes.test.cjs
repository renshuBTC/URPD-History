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
  assert.equal(c.xAxisEnd('2020-01-08', 1600, 1070), 1600, 'and grows to exactly a new highest stamp, nothing added');
  assert.equal(c.xAxisEnd('2020-01-09', 1400, 1700), 1700 * 1.001, 'or 0.1% past a price above every stamp');
  const data = c.buildData(dates[3], raws[3]);
  assert.equal(data.binWidth * c.NUM_BINS, 1500, 'bins divide the axis so far, not the day');
  c.setScales(null);
  assert.ok(c.xAxisEnd('2020-01-02', 50, 1010) >= 1010 * 1.001, 'without the history it still clears the price');
  c.setScales({ start: 'bad' });
  assert.equal(c.SCALES, null, 'a malformed file is ignored');
});

test('every bar is its percent of the day\'s total, on a left axis from 0 to 4% on every day', async () => {
  const { c, element } = app();
  const peaks = [3, 5, 4, 9, 2, 2, 7, 12, 1, 6];
  const { dates, raws } = market(c, { n: 10, cohorts: i => [{ 950: peaks[i], 1005: 1 }, { 990: 1 }] });
  for (const coin of [false, true]) {
    c.coinMode = coin; c.viewIdx = coin ? 1 : 0;
    for (const i of [5, 1, 8, 3, 9, 0, 5]) {
      const data = c.buildData(dates[i], raws[i]);
      await c.renderChart(data);
      const graph = element('chart'), bars = graph.data.filter(t => t.type === 'bar');
      assert.deepEqual(Array.from(graph.layout.yaxis.range), [0, 4], `${dates[i]}: the same axis on every day`);
      assert.equal(c.PCT_TOP, 4);
      const abs = c.barValues(data, coin), total = abs.reduce((a, b) => a + b, 0);
      const drawn = abs.map((_, k) => bars.reduce((s, b) => s + b.y[k], 0));
      drawn.forEach((v, k) => assert.ok(Math.abs(v - abs[k] * 100 / total) < 1e-9, 'each bar is its percent of the day\'s total'));
      assert.ok(Math.abs(drawn.reduce((a, b) => a + b, 0) - 100) < 1e-9, 'every day\'s bars add up to 100%');
    }
  }
});

test('in USD a day whose coins all last moved below $0.50 has nothing to draw, and says so', async () => {
  const { c, element } = app();
  const { dates, raws } = market(c, { close: () => 0.3, cohorts: () => [{ 0: 50 }] });
  await c.renderChart(c.buildData(dates[2], raws[2]));
  const graph = element('chart');
  assert.ok(graph.data.filter(t => t.type === 'bar').every(t => t.y.every(v => v === 0)), 'no bars');
  assert.deepEqual(Array.from(graph.layout.yaxis.range), [0, 4]);
  assert.ok(graph.layout.annotations.some(a => a.text === 'Realized Cap: $0 (every coin last moved below $0.50)'));
  c.coinMode = true; c.viewIdx = 1;
  await c.renderChart(c.buildData(dates[2], raws[2]));
  assert.ok(element('chart').layout.annotations.some(a => a.text === '▲ 100%'), 'in BTC it is all in the first bar');
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
  assert.deepEqual(Array.from(y.ticktext), Array.from(c.axisLabels(y.tickvals, 'pct')));
  assert.deepEqual(Array.from(y.ticktext), ['0%', '0.2%', '0.4%', '0.6%', '0.8%', '1%', '1.2%', '1.4%', '1.6%', '1.8%', '2%',
    '2.2%', '2.4%', '2.6%', '2.8%', '3%', '3.2%', '3.4%', '3.6%', '3.8%', '4%'], 'the percent axis, 0 to 4% in steps of 0.2');
  assert.equal(x.ticktext[0].trim(), '$0'); assert.ok(x.ticktext[0].length > 2, 'the price axis $0 is nudged off the corner');
  assert.equal(y.showgrid, true, 'each label has its own gridline');
  assert.equal(L.yaxis2, undefined, 'no % of Total axis');
});

test('hovering a bar gives its percent, its size and its running share of the day, with no separate line', async () => {
  const { c, element } = app();
  const { dates, raws } = market(c, { cohorts: () => [{ 900: 1, 1000: 2 }, { 1000: 1 }] });
  for (const coin of [false, true]) {
    c.coinMode = coin;
    await c.renderChart(c.buildData(dates[3], raws[3]));
    const graph = element('chart'), bars = graph.data.filter(t => t.type === 'bar');
    assert.equal(bars.length, 2);
    for (const b of bars) {
      assert.match(b.hovertemplate, coin ? /<br>Percent of Supply: %\{customdata\[0\]:\.3f\}%<br>Total Supply: %\{customdata\[2\]:,\.2f\} BTC/
        : /<br>Percent of Realized Cap: %\{customdata\[0\]:\.3f\}%<br>Total Value When Last Moved: %\{customdata\[2\]:\$,\.0f\}/);
      assert.match(b.hovertemplate, /<br>Cumulative % of Total: %\{customdata\[1\]:\.1f\}%<extra><\/extra>$/);
      assert.match(b.hovertemplate, new RegExp('<br>' + b.name.replace(/[<>]/g, '\\$&') + ': %\\{y:\\.3f\\}%<br>'), 'the band\'s own percent');
      assert.equal(b.customdata, bars[0].customdata, 'one shared array');
    }
    const cd = bars[0].customdata, totals = c.barValues(c.buildData(dates[3], raws[3]), coin), sum = totals.reduce((a, b) => a + b, 0);
    cd.forEach((p, i) => {
      assert.ok(Math.abs(p[0] - totals[i] * 100 / sum) < 1e-9); assert.equal(p[2], totals[i]);
      if (i) assert.ok(p[1] >= cd[i - 1][1]);
    });
    assert.ok(Math.abs(cd.at(-1)[1] - 100) < 1e-9);
    assert.equal(graph.data.some(t => t.meta === 'pct' || t.yaxis === 'y2'), false);
    assert.match(graph.layout.title.text, coin ? /^<b>Bitcoin: Percent of Supply by Price When Last Moved as of / : /^<b>Bitcoin: Percent of Realized Cap by Price When Last Moved as of /);
    assert.equal(graph.layout.xaxis.title.text, 'Price When Last Moved [USD]', 'the title names the axis and nothing else');
    assert.equal(graph.layout.yaxis.title.text, coin ? 'Percent of Supply per Bar [%]' : 'Percent of Realized Cap per Bar [%]');
  }
  // the videos say the same (their words are in tools/video/looks.mjs, checked in video-looks.test.cjs)
  const video = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'tools', 'video', 'page.html'), 'utf8');
  for (const s of ['"<b>" + esc(sp.title) + ', 'title: { text: "Price When Last Moved [USD]", font', 'text: esc(sp.yTitle)',
    'esc(sp.profitLabel)', 'esc(sp.lossLabel)'
  ]) assert.ok(video.includes(s), 'video: ' + s);
  assert.doesNotMatch(video, /This Price|Supply Distribution|per bar|perBar|BOTTOM SIGNAL|GLOW|isBottom/);
});

test('Cumulative % of Total meets the price box at the dashed line: at most In Profit left of it, at least right of it', async () => {
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

test('BTC leaves the first bar out of the axis and the readout, and prints its percent', async () => {
  const { c, element } = app();
  const { dates, raws } = market(c, { cohorts: () => [{ 0: 500, 950: 2000, 1000: 1500 }] });
  c.coinMode = true; c.viewIdx = 1;
  await c.renderChart(c.buildData(dates[4], raws[4]));
  const graph = element('chart'), notes = graph.layout.annotations;
  const bars = c.barValues(c.lastRenderedData, true);
  assert.equal(bars[0], 500);
  assert.deepEqual(Array.from(graph.layout.yaxis.range), [0, 4], 'the $0 pile does not set the axis');
  assert.ok(notes.some(a => a.text === '▲ 12.5%'), 'its percent is printed at the top');
  const read = notes.find(a => /^Supply: /.test(a.text));
  assert.ok(read, 'the readout');
  let k = 1; for (let i = 2; i < bars.length; i++) if (bars[i] > bars[k]) k = i;
  const w = c.lastRenderedData.binWidth, money = p => '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  assert.equal(read.text, 'Supply: 4.00K BTC<br>Tallest Bar: ' + c.pctText(bars[k] / 40) + ' · ' + c.peakCompact(bars[k]) + ' BTC · ' + money(k * w) + '–' + money((k + 1) * w));
  assert.equal(read.xref, 'paper'); assert.equal(read.x, 0); assert.equal(read.yanchor, 'top');
  // In USD the $0 pile is worth nothing: no ▲, and the first bar is an ordinary bar.
  c.coinMode = false; c.viewIdx = 0;
  await c.renderChart(c.buildData(dates[4], raws[4]));
  assert.ok(!element('chart').layout.annotations.some(a => /^▲/.test(a.text)));
  assert.ok(element('chart').layout.annotations.some(a => /^Realized Cap: \$3\.40M<br>Tallest Bar: /.test(a.text)));
});

test('a typed Y-max below 100 zooms into the day in view; at 100 the top is 4% again', async () => {
  const { c, element } = app();
  const { dates, raws } = market(c, { cohorts: () => [{ 900: 1, 950: 2, 1000: 40 }] });
  c.setScales({ start: dates[0], end: dates.at(-1), x: [[0, 1100]] });
  const data = c.buildData(dates[5], raws[5]);
  await c.renderChart(data);
  assert.equal(element('chart').layout.yaxis.range[1], 4, 'the default, 100, is the fixed top');
  const abs = c.barValues(data, false), toPct = 100 / abs.reduce((a, b) => a + b, 0), pct = abs.map(v => v * toPct);
  c.yMaxPct = 90;
  await c.renderChart(data);
  const zoomed = element('chart').layout.yaxis.range[1];
  assert.equal(zoomed, c.axisLevel(pct, false, 90), 'the 90th percentile of the day\'s bars, in percent');
  assert.ok(zoomed < Math.max(...pct));
  assert.equal(element('chart').layout.yaxis.ticktext.at(-1), c.axisLabels(c.axisTicks(zoomed), 'pct').at(-1));
  c.yMaxPct = 100;
  await c.renderChart(data);
  assert.equal(element('chart').layout.yaxis.range[1], 4);
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

test('build-scales writes the price axis history the page reads back, one day at a time', async () => {
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
  assert.deepEqual(Object.keys(saved), ['about', 'start', 'end', 'x'], 'the price axis only: the left axis is fixed');
  for (let i = 1; i < saved.x.length; i++) assert.ok(saved.x[i][0] > saved.x[i - 1][0] && saved.x[i][1] > saved.x[i - 1][1], 'x only steps up');
  assert.deepEqual(saved.x.map(s => s[1]), [1, 3, 7, 12], 'the highest stamp so far, exactly');
  // The page, reading that file, draws each day on exactly the price axis the file recorded for it, and on the fixed
  // left axis.
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
    assert.equal(element('chart').layout.yaxis.range[1], 4);
  }
});

test('the spot price box keeps clear of the readout and the ▲ figure at the top left', async () => {
  // A $0 pile (so in BTC ▲ is printed), the price at $20 or $1,000 on an axis to $1,100.
  async function draw(price, coin) {
    const { c, element } = app();
    const { dates, raws } = market(c, { close: () => price, cohorts: () => [{ 0: 5000, 15: 20, 20: 30, 1000: 40 }] });
    c.setScales({ start: dates[0], end: dates.at(-1), x: [[0, 1100]] });
    c.coinMode = coin; c.viewIdx = coin ? 1 : 0;
    await c.renderChart(c.buildData(dates[5], raws[5]));
    const notes = element('chart').layout.annotations;
    assert.equal(notes.some(a => /^▲/.test(a.text)), coin);
    assert.ok(notes.some(a => /^(Supply|Realized Cap): .*<br>Tallest Bar: /.test(a.text)), 'the readout, two lines (36 px)');
    return notes.find(a => a.xref === 'x' && a.yref === 'paper' && /In Profit/.test(a.text));
  }
  assert.equal((await draw(20, false)).yshift, -40, 'USD: just below the readout');
  assert.equal((await draw(20, true)).yshift, -65, 'BTC: below the readout and the ▲ under it (61 px down)');
  const right = await draw(1000, true);
  assert.equal(right.xanchor, 'right');
  assert.ok(!right.yshift, 'with the price over at the right the box is nowhere near them, and stays at the top');
});
