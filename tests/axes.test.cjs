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

test('USD and BTC end the left axis at the day\'s own tallest bar; % USD and % BTC draw every bar as its percent of the day on 0 to 4%', async () => {
  const { c, element } = app();
  const peaks = [3, 5, 4, 9, 2, 2, 7, 12, 1, 6];
  const { dates, raws } = market(c, { n: 10, cohorts: i => [{ 950: peaks[i], 1005: 1 }, { 990: 1 }] });
  for (const [view, coin, pct] of [[0, false, false], [1, true, false], [2, false, true], [3, true, true]]) {
    c.coinMode = coin; c.pctMode = pct; c.viewIdx = view;
    for (const i of [5, 1, 8, 3, 9, 0, 5]) {
      const data = c.buildData(dates[i], raws[i]);
      await c.renderChart(data);
      const graph = element('chart'), bars = graph.data.filter(t => t.type === 'bar');
      const abs = c.barValues(data, coin), total = abs.reduce((a, b) => a + b, 0);
      const drawn = abs.map((_, k) => bars.reduce((s, b) => s + b.y[k], 0));
      if (pct) {
        assert.deepEqual(Array.from(graph.layout.yaxis.range), [0, 4], `${view} ${dates[i]}: the same axis on every day`);
        drawn.forEach((v, k) => assert.ok(Math.abs(v - abs[k] * 100 / total) < 1e-9, 'each bar is its percent of the day\'s total'));
        assert.ok(Math.abs(drawn.reduce((a, b) => a + b, 0) - 100) < 1e-9, 'every day\'s bars add up to 100%');
      } else {
        drawn.forEach((v, k) => assert.ok(Math.abs(v - abs[k]) <= 1e-9 * Math.max(1, abs[k]), 'the bars in dollars or coins'));
        const top = Math.max(...drawn);
        assert.ok(Math.abs(graph.layout.yaxis.range[1] - top) <= 1e-9 * top, `${view} ${dates[i]}: the day's own tallest bar reaches the top`);
      }
    }
  }
  assert.equal(c.PCT_TOP, 4);
});

test('a day whose coins all last moved below $0.50 has nothing to draw in USD and % USD; in BTC and % BTC it is all the first bar', async () => {
  const { c, element } = app();
  const { dates, raws } = market(c, { close: () => 0.3, cohorts: () => [{ 0: 50 }] });
  const draw = async (view, coin, pct) => { c.coinMode = coin; c.pctMode = pct; c.viewIdx = view; await c.renderChart(c.buildData(dates[2], raws[2])); return element('chart'); };
  for (const [view, pct] of [[0, false], [2, true]]) {
    const graph = await draw(view, false, pct);
    assert.ok(graph.data.filter(t => t.type === 'bar').every(t => t.y.every(v => v === 0)), 'no bars');
    assert.deepEqual(Array.from(graph.layout.yaxis.range), [0, pct ? 4 : 1], pct ? 'the fixed axis' : 'a placeholder axis');
  }
  const whole = (graph) => { const bars = graph.data.filter(t => t.type === 'bar'); return bars[0].y.map((_, k) => bars.reduce((s, b) => s + b.y[k], 0)); };
  let graph = await draw(1, true, false);
  assert.equal(whole(graph)[0], 50, 'BTC: every coin in the first bar');
  assert.equal(graph.layout.yaxis.range[1], 50, 'and the axis ends at it');
  graph = await draw(3, true, true);
  assert.equal(whole(graph)[0], 100, '% BTC: 100% of the supply');
  assert.deepEqual(Array.from(graph.layout.yaxis.range), [0, 4], 'running off the fixed top');
  for (const g of [await draw(1, true, false), graph]) assert.ok(!g.layout.annotations.some(a => /▲/.test(a.text)), 'with nothing printed over it');
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
  let L = element('chart').layout, y = L.yaxis;
  const x = L.xaxis;
  assert.equal(y.tickvals.length, 21); assert.equal(y.tickvals[20], y.range[1], 'the top of the left axis is labelled');
  assert.equal(x.tickvals.length, 21); assert.equal(x.tickvals[20], x.range[1], 'the right end of the price axis is labelled');
  assert.deepEqual(Array.from(y.ticktext), Array.from(c.axisLabels(y.tickvals, false)), 'USD: dollars');
  c.coinMode = true; c.viewIdx = 1;
  await c.renderChart(c.buildData(dates[2], raws[2]));
  y = element('chart').layout.yaxis;
  assert.deepEqual(Array.from(y.ticktext), Array.from(c.axisLabels(y.tickvals, true)), 'BTC: coins');
  c.coinMode = false; c.pctMode = true; c.viewIdx = 2;
  await c.renderChart(c.buildData(dates[2], raws[2]));
  L = element('chart').layout; y = L.yaxis;
  assert.deepEqual(Array.from(y.ticktext), Array.from(c.axisLabels(y.tickvals, 'pct')));
  assert.deepEqual(Array.from(y.ticktext), ['0%', '0.2%', '0.4%', '0.6%', '0.8%', '1%', '1.2%', '1.4%', '1.6%', '1.8%', '2%',
    '2.2%', '2.4%', '2.6%', '2.8%', '3%', '3.2%', '3.4%', '3.6%', '3.8%', '4%'], 'the percent axis, 0 to 4% in steps of 0.2');
  assert.equal(x.ticktext[0].trim(), '$0'); assert.ok(x.ticktext[0].length > 2, 'the price axis $0 is nudged off the corner');
  assert.equal(y.showgrid, true, 'each label has its own gridline');
  assert.equal(L.yaxis2, undefined, 'no % of Total axis');
});

test('hovering a bar gives its size (and in % USD and % BTC its percent) and its running share of the day, with no separate line', async () => {
  const { c, element } = app();
  const { dates, raws } = market(c, { cohorts: () => [{ 900: 1, 1000: 2 }, { 1000: 1 }] });
  for (const [view, coin, pct] of [[0, false, false], [1, true, false], [2, false, true], [3, true, true]]) {
    c.coinMode = coin; c.pctMode = pct; c.viewIdx = view;
    await c.renderChart(c.buildData(dates[3], raws[3]));
    const graph = element('chart'), bars = graph.data.filter(t => t.type === 'bar');
    assert.equal(bars.length, 2);
    const size = coin ? 'Total Supply: %{customdata[2]:,.2f} BTC' : 'Total Value When Last Moved: %{customdata[2]:$,.0f}';
    const share = pct ? '<br>' + (coin ? 'Percent of Supply' : 'Percent of Realized Cap') + ': %{customdata[0]:.3f}%' : '';
    const band = pct ? '%{y:.3f}%' : coin ? '%{y:,.2f} BTC' : '%{y:$,.0f}';
    for (const b of bars) {
      assert.ok(b.hovertemplate.endsWith(': ' + band + share + '<br>' + size + '<br>Cumulative % of Total: %{customdata[1]:.1f}%<extra></extra>'), view + ': ' + b.hovertemplate);
      assert.ok(b.hovertemplate.includes('<br>' + b.name + ': ' + band), 'the band\'s own part');
      assert.equal(b.customdata, bars[0].customdata, 'one shared array');
    }
    const cd = bars[0].customdata, totals = c.barValues(c.buildData(dates[3], raws[3]), coin), sum = totals.reduce((a, b) => a + b, 0);
    cd.forEach((p, i) => {
      assert.ok(Math.abs(p[0] - (pct ? totals[i] * 100 / sum : totals[i])) < 1e-9); assert.equal(p[2], totals[i]);
      if (i) assert.ok(p[1] >= cd[i - 1][1]);
    });
    assert.ok(Math.abs(cd.at(-1)[1] - 100) < 1e-9);
    assert.equal(graph.data.some(t => t.meta === 'pct' || t.yaxis === 'y2'), false);
    const title = { 0: 'Bitcoin Supply by Price When Last Moved (USD Value) as of ', 1: 'Bitcoin Supply by Price When Last Moved (BTC) as of ',
      2: 'Bitcoin: Percent of Realized Cap by Price When Last Moved as of ', 3: 'Bitcoin: Percent of Supply by Price When Last Moved as of ' }[view];
    assert.ok(graph.layout.title.text.startsWith('<b>' + title), graph.layout.title.text);
    assert.equal(graph.layout.xaxis.title.text, 'Price When Last Moved [USD]', 'the title names the axis and nothing else');
    assert.equal(graph.layout.yaxis.title.text, ['Value When Last Moved [USD]', 'Supply [BTC]', 'Percent of Realized Cap per Bar [%]', 'Percent of Supply per Bar [%]'][view]);
    assert.ok(!graph.layout.annotations.some(a => /Tallest|Realized Cap:|Supply:/.test(a.text)), 'no readout');
  }
  // the videos say the same (their words are in tools/video/looks.mjs, checked in video-looks.test.cjs)
  const video = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'tools', 'video', 'page.html'), 'utf8');
  for (const s of ['"<b>" + esc(sp.title) + ', 'title: { text: "Price When Last Moved [USD]", font', 'text: esc(sp.yTitle)',
    'esc(sp.profitLabel)', 'esc(sp.lossLabel)'
  ]) assert.ok(video.includes(s), 'video: ' + s);
  assert.doesNotMatch(video, /This Price|Supply Distribution|per bar|perBar|BOTTOM SIGNAL|GLOW|isBottom|sp\.read|Tallest/);
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

test('every bar counts for the left axis, the first one too: in BTC it sets the axis, and only Y-max cuts it; nothing is printed over it', async () => {
  const { c, element } = app();
  const { dates, raws } = market(c, { cohorts: () => [{ 0: 5000, 950: 2000, 1000: 1500 }] });
  c.coinMode = true; c.viewIdx = 1;
  await c.renderChart(c.buildData(dates[4], raws[4]));
  let graph = element('chart');
  const bars = c.barValues(c.lastRenderedData, true);
  assert.equal(bars[0], 5000);
  assert.equal(graph.layout.yaxis.range[1], 5000, 'the $0 pile sets the axis');
  assert.ok(!graph.layout.annotations.some(a => /▲/.test(a.text)), 'and nothing is printed over it');
  // A Y-max below 100 cuts it like any other bar: the axis ends at that percentile of the day's bars.
  c.yMaxPct = 90;
  await c.renderChart(c.lastRenderedData);
  graph = element('chart');
  assert.equal(graph.layout.yaxis.range[1], c.axisLevel(bars, 90));
  assert.ok(graph.layout.yaxis.range[1] < 5000, 'the first bar runs off the top');
  assert.ok(!graph.layout.annotations.some(a => /▲/.test(a.text)), 'still with nothing printed over it');
  c.yMaxPct = 100;
  // % BTC: the fixed top, which the first bar runs past.
  c.pctMode = true; c.viewIdx = 3;
  await c.renderChart(c.buildData(dates[4], raws[4]));
  graph = element('chart');
  assert.deepEqual(Array.from(graph.layout.yaxis.range), [0, 4]);
  assert.ok(!graph.layout.annotations.some(a => /▲/.test(a.text)));
  // In USD the $0 pile is worth nothing.
  for (const [view, pct] of [[0, false], [2, true]]) {
    c.coinMode = false; c.pctMode = pct; c.viewIdx = view;
    await c.renderChart(c.buildData(dates[4], raws[4]));
    assert.ok(!element('chart').layout.annotations.some(a => /▲/.test(a.text)), String(view));
  }
  // axisLevel takes every bar: the tallest, or at a percentile below 100 that percentile of the bars that hold anything.
  assert.equal(c.axisLevel([9, 1, 2, 3], 100), 9);
  assert.equal(c.axisLevel([9, 0, 1, 2, 3], 50), 3, 'of 1, 2, 3 and 9, the third');
  assert.equal(c.axisLevel([0, 0, 0], 100), 0);
  assert.equal(c.axisLevel.length, 2, '(values, percentile): there is no first bar to leave out');
});

test('a typed Y-max below 100 zooms into the day in view; at 100 the top is the day\'s tallest bar, or 4%', async () => {
  const { c, element } = app();
  const { dates, raws } = market(c, { cohorts: () => [{ 900: 1, 950: 2, 1000: 40 }] });
  c.setScales({ start: dates[0], end: dates.at(-1), x: [[0, 1100]] });
  const data = c.buildData(dates[5], raws[5]);
  const abs = c.barValues(data, false), toPct = 100 / abs.reduce((a, b) => a + b, 0), pct = abs.map(v => v * toPct);
  for (const [view, pctView, values, top] of [[0, false, abs, Math.max(...abs)], [2, true, pct, 4]]) {
    c.pctMode = pctView; c.viewIdx = view; c.yMaxPct = 100;
    await c.renderChart(data);
    assert.equal(element('chart').layout.yaxis.range[1], top, view + ': the default, 100');
    c.yMaxPct = 90;
    await c.renderChart(data);
    const zoomed = element('chart').layout.yaxis.range[1];
    assert.equal(zoomed, c.axisLevel(values, 90), view + ': the 90th percentile of the day\'s bars');
    assert.ok(zoomed < Math.max(...values));
    assert.equal(element('chart').layout.yaxis.ticktext.at(-1), c.axisLabels(c.axisTicks(zoomed), pctView ? 'pct' : false).at(-1));
  }
  c.yMaxPct = 100;
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
    const bars = c.barValues(data, false);
    assert.equal(element('chart').layout.yaxis.range[1], Math.max(...bars) || 1, d + ': USD, the day\'s own tallest bar');
  }
});

test('the spot price box keeps clear of the pin\'s label at the top left', async () => {
  // A $0 pile, the price at $20 or $1,000 on an axis to $1,100.
  async function draw(price, view, pinned) {
    const { c, element } = app();
    const { dates, raws } = market(c, { close: () => price, cohorts: () => [{ 0: 5000, 15: 20, 20: 30, 1000: 40 }] });
    c.setScales({ start: dates[0], end: dates.at(-1), x: [[0, 1100]] });
    c.coinMode = view % 2 === 1; c.pctMode = view > 1; c.viewIdx = view;
    const data = c.buildData(dates[5], raws[5]);
    if (pinned) c.peakStore[c.peakKey(data)] = [dates[1], c.pctMode ? 1 : 30];
    await c.renderChart(data);
    const notes = element('chart').layout.annotations;
    assert.ok(!notes.some(a => /▲/.test(a.text)), 'no ▲ figure');
    assert.equal(notes.some(a => /^Peak /.test(a.text)), pinned);
    assert.ok(!notes.some(a => /Tallest Bar|Realized Cap:|^Supply:/.test(a.text)), 'no readout');
    return notes.find(a => a.xref === 'x' && a.yref === 'paper' && /In Profit/.test(a.text));
  }
  for (const view of [0, 1, 2, 3]) {
    assert.ok(!(await draw(20, view, false)).yshift, view + ': nothing at the top left, the box stays at the top');
    assert.equal((await draw(20, view, true)).yshift, -25, view + ' pinned: just below the pin\'s label (21 px)');
  }
  const right = await draw(1000, 1, true);
  assert.equal(right.xanchor, 'right');
  assert.ok(!right.yshift, 'with the price over at the right the box is nowhere near it, and stays at the top');
});
