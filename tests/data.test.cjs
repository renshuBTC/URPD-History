const test = require('node:test');
const assert = require('node:assert/strict');
const { app, deferred, flush, scripts } = require('./helpers.cjs');
const vm = require('node:vm');

test('every inline script parses', () => {
  for (const source of scripts) new vm.Script(source);
});

test('kernel preserves supply and USD at zero and upper boundaries', () => {
  const { c } = app();
  const raw = { 0: 50, 0.01: 1.23, 200: 4.56, 99999: 12.34, 100000: 56.78, 126198: 90.12 };
  const sums = { supply: Object.values(raw).reduce((a, b) => a + b, 0), invested: Object.entries(raw).reduce((s, [p, q]) => s + p * q, 0) };
  for (const bins of [50, 625, 1000]) for (const smooth of [0, 0.1, 0.3, 1]) {
    c.NUM_BINS = bins; c.KERNEL_PCT = smooth;
    const result = c.aggregate(raw, 126198 / bins);
    for (const [field, expected] of Object.entries(sums)) {
      const actual = result.reduce((s, b) => s + b[field], 0);
      assert.ok(Math.abs(actual - expected) <= expected * 1e-12, `${bins}/${smooth}/${field}`);
    }
  }
});

test('zero USD denominator is unavailable while BTC ratio remains valid', async () => {
  const { c, element } = app();
  c.allDates = ['2011-01-30']; c.priceArray = [0.46]; c.priceIndexByDate = { '2011-01-30': 0 };
  const data = c.buildData('2011-01-30', { all: { 0: 100 }, age: [{ 0: 100 }] });
  assert.equal(data.redPct, null); assert.equal(data.redPctCoin, 0);
  await c.renderChart(data);
  let text = element('chart').layout.annotations.map(a => a.text).join(' ');
  assert.match(text, /USD Value Last Moved Below This Price: N\/A/);
  assert.doesNotMatch(text, /BOTTOM SIGNAL|NaN/);
  c.coinMode = true;
  await c.renderChart(data);
  text = element('chart').layout.annotations.map(a => a.text).join(' ');
  assert.match(text, /BTC Supply Last Moved Below This Price: 100\.0%/);
  assert.equal(c.computeRedPct({ 10: 1 }, null), null);
});

test('startup publishes dates only after price initialization settles', async () => {
  const { c } = app(); const price = deferred();
  c.fetchJSON = url => {
    if (url.endsWith('/all/dates')) return Promise.resolve(['2009-01-03']);
    if (url.endsWith('/price_close/day1')) return price.promise;
    if (url.endsWith('/date/day1')) return Promise.resolve(['2009-01-01', '2009-01-02', '2009-01-03']);
    return Promise.resolve({ 5: 2, 20: 1 });
  };
  const ready = c.init(); await flush();
  await c.loadAndRender();
  assert.equal(c.allDates.length, 0); assert.equal(Object.keys(c.cache).length, 0);
  price.resolve([1, 1, 10]); await ready;
  assert.equal(c.lastRenderedData.spot, 10);
  assert.ok(Math.abs(c.lastRenderedData.redPct - 200 / 3) < 1e-10);
});

test('UTC price fallback agrees with date indices across DST boundaries', () => {
  const oldTZ = process.env.TZ;
  try {
    for (const tz of ['Australia/Sydney', 'America/New_York', 'Asia/Singapore']) {
      process.env.TZ = tz;
      const { c } = app();
      for (const day of ['2009-01-03', '2026-03-08', '2026-07-01', '2026-11-01']) assert.equal(c.priceDateAt(c.dayIndex(day)), day, tz);
    }
  } finally { if (oldTZ === undefined) delete process.env.TZ; else process.env.TZ = oldTZ; }
});

test('request timeout covers a stalled body, aborts, and ignores late results', async () => {
  let signal; const body = deferred();
  const { c, timers, runTimer } = app({ fetch: async (url, options) => { signal = options.signal; return { ok: true, json: () => body.promise }; } });
  const pending = c.fetchJSON('/test');
  const rejection = assert.rejects(pending, /timed out/);
  await flush();
  runTimer([...timers.keys()][0]); await rejection;
  assert.equal(signal.aborted, true);
  body.resolve({ late: true }); await flush();
  assert.equal(timers.size, 0);
});

test('a failed cohort preserves successful and in-flight siblings for retry', async () => {
  const { c } = app(); const calls = []; const first = deferred(), slow = deferred();
  c.AGE_BANDS = [{ cohort: 'a', label: 'a' }, { cohort: 'b', label: 'b' }, { cohort: 'c', label: 'c' }];
  c.AGE_BAND_COLORS = ['a', 'b', 'c'];
  let attempts = 0;
  c.fetchJSON = url => {
    calls.push(url);
    if (url.includes('/a/')) return Promise.resolve({ 0: 50, 100: 2 });
    if (url.includes('/c/')) return slow.promise;
    return ++attempts === 1 ? first.promise : Promise.resolve({ 100: 4 });
  };
  const initial = c.fetchRaw('2026-09-19');
  const rejected = assert.rejects(initial, /HTTP 404/);
  first.reject(new Error('HTTP 404')); await rejected; await flush();
  const retry = c.fetchRaw('2026-09-19'); slow.resolve({ 200: 3 });
  const raw = await retry;
  assert.equal(calls.filter(u => u.includes('/a/')).length, 1);
  assert.equal(calls.filter(u => u.includes('/b/')).length, 2);
  assert.equal(calls.filter(u => u.includes('/c/')).length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(raw.all)), { 0: 50, 100: 6, 200: 3 });
  const data = c.buildData('2026-09-19', raw);
  for (const field of ['supply', 'invested']) for (let i = 0; i < data.aggAll.length; i++) {
    const sum = data.aggAge.reduce((s, b) => s + b.agg[i][field], 0);
    assert.ok(Math.abs(sum - data.aggAll[i][field]) < 1e-9);
  }
});

test('cached loads await drawing and propagate draw errors to the caller', async () => {
  const { c } = app(); const render = deferred();
  c.allDates = ['2026-09-19']; c.currentIdx = 0;
  c.cache[c.dataKey(c.allDates[0])] = { dateStr: c.allDates[0] };
  c.renderChart = () => render.promise;
  let settled = false;
  const load = c.loadAndRender(true).finally(() => { settled = true; });
  const rejected = assert.rejects(load, /draw failed/);
  await flush(); assert.equal(settled, false);
  render.reject(new Error('draw failed')); await rejected;
  assert.equal(c.lastRenderedData, null);
});

test('render queue skips obsolete draws and only publishes completed data', async () => {
  const { c } = app(); const first = deferred(), calls = [];
  c.drawChart = (data) => { calls.push(data.dateStr); return first.promise; };
  const a = c.renderChart({ dateStr: 'A' }), b = c.renderChart({ dateStr: 'B' });
  await flush(); assert.deepEqual(calls, ['B']);
  first.resolve(); await Promise.all([a, b]);
  assert.equal(c.lastRenderedData, null);
});

test('smoothing and mode toggles coalesce rapid changes', async () => {
  const { c, element, timers, runTimer } = app(); let draws = 0;
  c.loadAndRender = () => { draws++; return Promise.resolve(); };
  for (const value of ['0.1', '0.12', '0.5']) element('smoothInput').emit('input', { target: { value } });
  assert.equal(c.KERNEL_PCT, 0.24); assert.equal(timers.size, 1);
  runTimer([...timers.keys()][0]); assert.equal(c.KERNEL_PCT, 0.5); assert.equal(draws, 1);
  c.setViewMode(1); c.setViewMode(0); c.setViewMode(1);
  assert.equal(draws, 1); assert.equal(timers.size, 1);
  runTimer([...timers.keys()][0]); assert.equal(draws, 2); assert.equal(c.coinMode, true);
});

test('BTC/USD overlay is linear from $0 to the highest close shown so far, and only grows moving forward', async () => {
  const { c, element } = app();
  const dates = [], prices = [];
  for (let i = 0; i < 800; i++) {
    dates.push(new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10));
    prices.push(i < 400 ? 1000 * (1 + i / 100) : 5000 - (i - 400) * 5);   // rally to 5000, then a long decline
  }
  c.allDates = dates; c.priceArray = prices; c.priceIndexByDate = Object.fromEntries(dates.map((d, i) => [d, i]));
  const tops = [];
  for (const i of [100, 300, 500, 700]) {
    await c.renderChart(c.buildData(dates[i], { all: { 1000: 1 }, age: [{ 1000: 1 }] }));
    const y3 = element('chart').layout.yaxis3;
    assert.equal(y3.type, 'linear'); assert.equal(y3.autorange, false); assert.equal(y3.range[0], 0);
    const right = Math.min(dates.length - 1, i + 91);                          // window edge (+90 days) plus one day
    assert.equal(y3.range[1], Math.max(...prices.slice(0, right + 1)), 'top = highest close shown so far');
    tops.push(y3.range[1]);
  }
  for (let k = 1; k < tops.length; k++) assert.ok(tops[k] >= tops[k - 1], 'the axis never shrinks when moving forward');
});
