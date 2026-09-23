const test = require('node:test');
const assert = require('node:assert/strict');
const { app, deferred, flush } = require('./helpers.cjs');

function fixture(age = true) {
  const h = app();
  const { c, element } = h;
  c.allDates = ['2026-09-18', '2026-09-19'];
  c.currentIdx = 0;
  c.priceArray = [100, 110];
  c.priceDates = [...c.allDates];
  c.priceIndexByDate = { '2026-09-18': 0, '2026-09-19': 1 };
  for (const date of c.allDates) {
    const all = { 50: 1, 1000: 99 };
    c.rawCache[date] = { all, age: age ? [all] : [] };
  }
  // The shared DOM stub does not retain attributes, so retain them on this button
  // to exercise the accessibility state emitted by the production control.
  const button = element('btnRaw');
  button.attributes = {};
  button.setAttribute = (name, value) => { button.attributes[name] = String(value); };
  return h;
}

function snapshot(c) {
  return JSON.parse(JSON.stringify({
    coin: c.coinMode, view: c.viewIdx, bins: c.NUM_BINS,
    smoothing: c.KERNEL_PCT, ymax: c.yMaxPct, price: c.showPriceOverlay,
    threshold: c.bottomThreshold, modeYmax: c.yMaxByMode,
    explicitYmax: c.yMaxExplicit, pins: c.peakStore
  }));
}

const fixedControls = ['thresholdInput', 'binsInput', 'smoothInput', 'ymaxInput'];

function assertPreset(h, coin) {
  const { c, element } = h;
  assert.equal(c.rawMode, true);
  assert.equal(c.coinMode, coin);
  assert.equal(c.viewIdx, coin ? 1 : 0);
  assert.equal(c.NUM_BINS, 625);
  assert.equal(c.KERNEL_PCT, 0);
  assert.equal(c.yMaxPct, coin ? 99.8 : 100);
  assert.equal(c.showPriceOverlay, false);
  assert.equal(element('binsInput').value, '625');
  assert.equal(element('smoothInput').value, '0.0');
  assert.equal(element('ymaxInput').value, coin ? '99.8' : '100');
  assert.equal(element('btnRaw').attributes['aria-pressed'], 'true');
  for (const id of fixedControls) assert.equal(element(id).disabled, true, `${id} must be locked in RAW`);
  for (const id of ['btnUSD', 'btnBTC', 'btnPeak']) assert.notEqual(element(id).disabled, true, `${id} must remain usable in RAW`);
}

for (const coin of [false, true]) {
  test(`RAW preserves ${coin ? 'BTC' : 'USD'} on entry and restores customized settings on exit`, async () => {
    const h = fixture();
    const { c, element } = h;
    c.coinMode = coin;
    c.viewIdx = coin ? 1 : 0;
    c.NUM_BINS = 450;
    c.KERNEL_PCT = 0.7;
    c.yMaxByMode = [97, 98.5];
    c.yMaxExplicit = [true, true];
    c.yMaxPct = c.yMaxByMode[c.viewIdx];
    c.showPriceOverlay = coin;
    c.bottomThreshold = 62;
    c.peakStore = { 'btc|b625|s0': ['2026-09-17', 1e9] };
    await c.loadAndRender();
    const before = snapshot(c);

    await c.setRawMode(true);
    assertPreset(h, coin);
    // Clicking the active preset again programmatically must not overwrite the
    // saved settings with its own fixed settings.
    await c.setRawMode(true);
    c.setViewMode(coin ? 0 : 1);
    h.runTimer(c.viewRenderTimer);
    await flush();
    await c.chartRenderPromise;
    assertPreset(h, !coin);
    await c.setRawMode(false);

    assert.equal(c.rawMode, false);
    assert.deepEqual(snapshot(c), before);
    assert.equal(element('btnRaw').attributes['aria-pressed'], 'false');
    for (const id of fixedControls) assert.equal(element(id).disabled, false, `${id} must unlock after RAW`);
    assert.equal(element('binsInput').value, '450');
    assert.equal(element('smoothInput').value, '0.7');
    assert.equal(element('ymaxInput').value, String(before.ymax));
    assert.equal(c.lastRenderedData.numBins, 450);
    assert.equal(c.lastRenderedData.kernelPct, 0.7);
  });
}

test('leaving RAW restores the ordinary BTC default of 99.5', async () => {
  const h = fixture();
  h.c.setViewMode(1);
  await h.c.setRawMode(true);
  assertPreset(h, true);
  await h.c.setRawMode(false);
  assert.equal(h.c.coinMode, true);
  assert.equal(h.c.yMaxPct, 99.5);
  assert.equal(h.element('ymaxInput').value, '99.5');
  assert.deepEqual(Array.from(h.c.yMaxByMode), [100, 99.5]);
  assert.deepEqual(Array.from(h.c.yMaxExplicit), [false, false]);
});

for (const age of [true, false]) {
  test(`RAW renders unsmoothed BTC bars with a remembered pin and without percentage, historical price or bottom signal (${age ? 'age cohorts' : 'all-supply fallback'})`, async () => {
    const h = fixture(age);
    const { c, element } = h;
    c.setViewMode(1);
    c.peakStore = { 'btc|b625|s0': ['2026-09-17', 1e9] };
    await c.setRawMode(true);
    const graph = element('chart');
    const bars = graph.data.filter(trace => trace.type === 'bar');
    assert.equal(bars.length, 1);
    assert.equal(bars[0].y.reduce((a, b) => a + b, 0), 100);
    assert.deepEqual(Array.from(bars[0].y.filter(value => value > 0)).sort((a, b) => a - b), [1, 99]);
    assert.match(graph.layout.yaxis.title.text, /BTC/);
    assert.equal(graph.data.some(trace => trace.meta === 'pct' || trace.yaxis === 'y2' || trace.name === 'BTC/USD' || trace.xaxis === 'x2'), false);
    assert.ok(!graph.layout.yaxis2 || graph.layout.yaxis2.visible === false);
    assert.ok(graph.layout.yaxis.range[1] >= 1e9, 'a remembered RAW pin fixes the scale');
    assert.equal(graph.layout.shapes.find(shape => shape.xref === 'paper' && shape.yref === 'y').y0, 1e9);
    const annotations = graph.layout.annotations.map(annotation => annotation.text).join(' ');
    assert.doesNotMatch(annotations, /Price:|Last Moved In Profit|Last Moved In Loss|BOTTOM SIGNAL/);
    assert.match(annotations, /Peak /);
    assert.equal(graph.layout.shapes.find(shape => shape.type === 'line' && shape.xref === 'x').line.color, '#ffffff');
    assert.equal(graph.layout.shapes.some(shape => shape.line && shape.line.color === c.GLOW_COLOR), false);
    assert.equal(c.lastRenderedData.numBins, 625);
    assert.equal(c.lastRenderedData.kernelPct, 0);
  });
}

test('RAW rejects fixed-setting mutations and clears pending edits', async () => {
  const h = fixture();
  const { c, element, timers, runTimer } = h;
  element('binsInput').emit('input', { target: { value: '400' } });
  element('smoothInput').emit('input', { target: { value: '0.8' } });
  c.setViewMode(1);
  await c.setRawMode(true);
  const before = snapshot(c);

  c.applyThreshold(5);
  c.applyBins(100);
  c.applySmoothing(0.9);
  c.applyYMax(50);
  // Any timer already armed before entering RAW must either be canceled or inert.
  for (const id of [...timers.keys()]) if (timers.has(id)) runTimer(id);
  await flush();

  assert.deepEqual(snapshot(c), before);
  assertPreset(h, true);
});

test('rapid RAW toggles and date navigation render the latest preset and date', async () => {
  const h = fixture();
  const { c, element } = h;
  c.NUM_BINS = 400;
  c.KERNEL_PCT = 0.6;
  const first = c.setRawMode(true);
  const second = c.setRawMode(false);
  const final = c.setRawMode(true);
  c.goTo(1, true);
  await Promise.all([first, second, final]);
  await flush();
  await c.chartRenderPromise;

  assertPreset(h, false);
  assert.equal(c.currentIdx, 1);
  assert.equal(c.lastRenderedData.dateStr, '2026-09-19');
  assert.equal(c.lastRenderedData.numBins, 625);
  assert.equal(c.lastRenderedData.kernelPct, 0);
  assert.equal(element('dateDisplay').textContent, '(2/2)');
  assert.equal(element('chart').data.some(trace => trace.meta === 'pct' || trace.name === 'BTC/USD'), false);
  await c.setRawMode(false);
  assert.equal(c.NUM_BINS, 400);
  assert.equal(c.KERNEL_PCT, 0.6);
  assert.equal(c.coinMode, false);
  assert.equal(c.currentIdx, 1);
});

test('recording locks RAW changes without losing the settings to restore later', async () => {
  const h = fixture();
  const { c } = h;
  const initial = snapshot(c);
  c.videoRecording = true;
  await c.setRawMode(true);
  assert.equal(c.rawMode, false);
  assert.deepEqual(snapshot(c), initial);
  c.videoRecording = false;
  await c.setRawMode(true);
  c.videoRecording = true;
  await c.setRawMode(false);
  c.setViewMode(1);
  assertPreset(h, false);
  c.videoRecording = false;
  await c.setRawMode(false);
  assert.deepEqual(snapshot(c), initial);
});

for (const age of [true, false]) {
  test(`RAW permits USD and BTC weighting without changing the preset or normal preferences (${age ? 'age cohorts' : 'all-supply fallback'})`, async () => {
    const h = fixture(age);
    const { c, element, runTimer } = h;
    c.coinMode = true;
    c.viewIdx = 1;
    c.NUM_BINS = 450;
    c.KERNEL_PCT = 0.7;
    c.yMaxByMode = [97, 98.5];
    c.yMaxExplicit = [true, true];
    c.yMaxPct = 98.5;
    await c.loadAndRender();
    const original = snapshot(c);
    await c.setRawMode(true);
    assertPreset(h, true);

    async function finishModeChange() {
      runTimer(c.viewRenderTimer);
      await flush();
      await c.chartRenderPromise;
    }
    element('btnUSD').onclick();
    await finishModeChange();
    assertPreset(h, false);
    const graph = element('chart');
    let bars = graph.data.filter(trace => trace.type === 'bar');
    assert.equal(bars.length, 1);
    assert.equal(bars[0].y.reduce((a, b) => a + b, 0), 99050);
    assert.deepEqual(Array.from(bars[0].y.filter(value => value > 0)).sort((a, b) => a - b), [50, 99000]);
    assert.match(graph.layout.yaxis.title.text, /USD/);
    const annotations = graph.layout.annotations.map(annotation => annotation.text).join(' ');
    assert.doesNotMatch(annotations, /Price:|Last Moved In Profit|Last Moved In Loss|BOTTOM SIGNAL|Peak /);
    assert.equal(graph.data.some(trace => trace.meta === 'pct' || trace.name === 'BTC/USD'), false);
    assert.equal(graph.layout.shapes.find(shape => shape.type === 'line' && shape.xref === 'x').line.color, '#ffffff');
    assert.deepEqual(Array.from(c.yMaxByMode), original.modeYmax);
    assert.deepEqual(Array.from(c.yMaxExplicit), original.explicitYmax);

    element('btnBTC').onclick();
    await finishModeChange();
    assertPreset(h, true);
    bars = graph.data.filter(trace => trace.type === 'bar');
    assert.equal(bars[0].y.reduce((a, b) => a + b, 0), 100);
    assert.match(graph.layout.yaxis.title.text, /BTC/);
    assert.equal(graph.data.some(trace => trace.meta === 'pct' || trace.name === 'BTC/USD'), false);
    assert.deepEqual(Array.from(c.yMaxByMode), original.modeYmax);
    assert.deepEqual(Array.from(c.yMaxExplicit), original.explicitYmax);

    // The last RAW weighting must not replace the view to restore on exit.
    element('btnUSD').onclick();
    await finishModeChange();
    await c.setRawMode(false);
    assert.deepEqual(snapshot(c), original);
  });
}

for (const entering of [true, false]) {
  test(`a failed draw while ${entering ? 'entering' : 'leaving'} RAW restores the previous view and permits retry`, async () => {
    const h = fixture();
    const { c, element } = h;
    c.NUM_BINS = 400;
    c.KERNEL_PCT = 0.6;
    await c.loadAndRender();
    const ordinary = snapshot(c);
    if (!entering) await c.setRawMode(true);
    const previous = snapshot(c);
    const react = c.Plotly.react;
    let rejectNextDraw = true;
    c.Plotly.react = (...args) => {
      if (rejectNextDraw) {
        rejectNextDraw = false;
        return Promise.reject(new Error('RAW test draw failure'));
      }
      return react(...args);
    };

    // The control may consume the error for its notice or return it to callers;
    // either contract must finish rollback before the returned promise settles.
    await Promise.resolve(c.setRawMode(entering)).catch(() => {});
    await c.chartRenderPromise;
    assert.equal(c.rawMode, !entering);
    assert.deepEqual(snapshot(c), previous);
    assert.equal(c.lastRenderedData.numBins, previous.bins);
    assert.equal(c.lastRenderedData.kernelPct, previous.smoothing);
    assert.match(element('status').textContent, /RAW test draw failure/);

    await c.setRawMode(entering);
    if (entering) {
      assertPreset(h, false);
      await c.setRawMode(false);
    }
    assert.equal(c.rawMode, false);
    assert.deepEqual(snapshot(c), ordinary);
  });
}

test('a cumulative line hidden through the legend stays hidden after a RAW round trip', async () => {
  const h = fixture();
  const { c, element } = h;
  await c.loadAndRender();
  const graph = element('chart');
  const cumulative = graph.data.find(trace => trace.meta === 'pct');
  assert.ok(cumulative);
  // This is the visibility change Plotly applies for a legend click.
  cumulative.visible = 'legendonly';
  await c.setRawMode(true);
  assert.equal(graph.data.some(trace => trace.meta === 'pct'), false);
  c.goTo(1, true);
  await flush();
  await c.chartRenderPromise;
  await c.setRawMode(false);
  const restored = graph.data.find(trace => trace.meta === 'pct');
  assert.ok(restored);
  assert.equal(restored.visible, 'legendonly');
  assert.equal(graph.data.find(trace => trace.name === 'BTC/USD').visible, true);
});

test('a pending RAW load never redraws older smoothed data under RAW settings', async () => {
  const h = fixture();
  const { c, element } = h;
  c.NUM_BINS = 400;
  c.KERNEL_PCT = 0.6;
  await c.loadAndRender();
  const displayed = c.lastRenderedData;
  const oldTraces = element('chart').data;
  const raw = c.rawCache[c.allDates[0]];
  delete c.rawCache[c.allDates[0]];
  const download = deferred();
  c.fetchRaw = () => download.promise;
  const switching = c.setRawMode(true);
  await flush();
  await c.rerenderCurrent();
  assert.equal(c.lastRenderedData, displayed);
  assert.equal(element('chart').data, oldTraces);

  download.resolve(raw);
  await switching;
  assertPreset(h, false);
  assert.equal(c.lastRenderedData.numBins, 625);
  assert.equal(c.lastRenderedData.kernelPct, 0);
  assert.notEqual(element('chart').data, oldTraces);
});

for (const coin of [true, false]) test(`RAW ${coin ? 'BTC' : 'USD'} keeps the white spot line while navigating, hides its box and restores the box on exit`, async () => {
  const h = fixture();
  const { c, element } = h;
  c.bottomThreshold = 100;
  c.coinMode = coin;
  c.viewIdx = coin ? 1 : 0;
  c.yMaxPct = c.yMaxByMode[c.viewIdx];
  const secondDay = { 50: 10, 105: 10, 1000: 80 };
  c.rawCache[c.allDates[1]] = { all: secondDay, age: [secondDay] };
  await c.loadAndRender();
  const original = snapshot(c);
  await c.setRawMode(true);

  function spotParts() {
    const layout = element('chart').layout;
    return {
      line: layout.shapes.find(shape => shape.type === 'line' && shape.xref === 'x' && shape.yref === 'paper'),
      box: layout.annotations.find(annotation => annotation.xref === 'x' && annotation.yref === 'paper')
    };
  }
  function assertRawSpot(spot) {
    const { line, box } = spotParts();
    assert.ok(line, 'the vertical spot line remains in RAW');
    assert.equal(line.x0, spot);
    assert.equal(line.x1, spot);
    assert.equal(line.y0, 0);
    assert.equal(line.y1, 1);
    assert.equal(line.line.color, '#ffffff');
    assert.equal(line.line.dash, 'dash');
    assert.ok(line.line.width > 0);
    assert.equal(box, undefined, 'the spot price/profit/loss annotation is absent');
    assert.doesNotMatch(element('chart').layout.annotations.map(annotation => annotation.text).join(' '), /Price:|Last Moved In Profit|Last Moved In Loss/);
  }

  assertPreset(h, coin);
  assertRawSpot(100);
  c.goTo(1, true);
  await flush();
  await c.chartRenderPromise;
  assert.equal(c.lastRenderedData.dateStr, c.allDates[1]);
  assert.equal(c.lastRenderedData.spot, 110);
  assertRawSpot(110);

  await c.setRawMode(false);
  assert.deepEqual(snapshot(c), original);
  const restored = spotParts();
  assert.equal(restored.line.x0, 110);
  assert.equal(restored.line.x1, 110);
  assert.equal(restored.line.line.dash, 'dash');
  assert.equal(restored.line.line.color, '#ffffff');
  assert.equal(restored.box.x, 110);
  assert.equal(restored.box.font.color, '#ffffff');
  assert.match(restored.box.text, /Price: \$110/);
  assert.match(restored.box.text, coin ? /BTC Supply Last Moved In Profit: 20\.0%/ : /USD Value Last Moved In Profit: 1\.9%/);
  assert.match(restored.box.text, coin ? /BTC Supply Last Moved In Loss: 80\.0%/ : /USD Value Last Moved In Loss: 98\.1%/);
});

for (const entering of [true, false]) for (const previousRawAvailable of [true, false]) {
  test(`a failed date request during ${entering ? 'entry to' : 'exit from'} RAW restores a truthful chart ${previousRawAvailable ? 'by rebinning' : 'without cached raw data'}`, async () => {
    const h = fixture();
    const { c, element } = h;
    c.NUM_BINS = 400;
    c.KERNEL_PCT = 0.6;
    await c.loadAndRender();
    if (!entering) await c.setRawMode(true);
    const before = snapshot(c);
    delete c.rawCache[c.allDates[1]];
    if (!previousRawAvailable) delete c.rawCache[c.allDates[0]];
    c.fetchRaw = () => Promise.reject(new Error('Next date unavailable'));

    // A navigation request supersedes the preset's first render before it draws.
    // Its own failure handler must therefore reconcile chart and controls.
    const switching = c.setRawMode(entering);
    c.goTo(1, true);
    await switching;
    await flush();
    await c.chartRenderPromise;

    assert.equal(c.currentIdx, 0);
    assert.equal(c.lastRenderedData.dateStr, c.allDates[0]);
    assert.equal(c.rawMode, previousRawAvailable ? entering : !entering);
    assert.equal(c.lastRenderedData.numBins, c.NUM_BINS);
    assert.equal(c.lastRenderedData.kernelPct, c.KERNEL_PCT);
    assert.equal(element('btnRaw').attributes['aria-pressed'], String(c.rawMode));
    const graph = element('chart');
    assert.equal(graph.layout.yaxis.title.text.includes('[BTC]'), c.coinMode);
    assert.equal(graph.data.some(trace => trace.meta === 'pct'), !c.rawMode);
    assert.equal(graph.data.some(trace => trace.name === 'BTC/USD'), !c.rawMode);
    if (!previousRawAvailable) assert.deepEqual(snapshot(c), before);
    if (c.rawMode) assertPreset(h, false);
  });
}

test('RAW pins the displayed peak across dates, keeps USD and BTC pins independent, and unpins on the next press', async () => {
  const h = fixture();
  const { c, element, runTimer } = h;
  const larger = { 50: 5, 1000: 500 };
  c.rawCache[c.allDates[1]] = { all: larger, age: [larger] };
  const persisted = [];
  c.localStorage.setItem = (key, value) => persisted.push({ key, value: JSON.parse(value) });
  c.peakStore = { 'usd|b400|s0.6': ['2026-09-17', 123456] };
  c.setViewMode(1);
  await c.setRawMode(true);
  assertPreset(h, true);
  const graph = element('chart');
  const pinLine = () => graph.layout.shapes.find(shape => shape.xref === 'paper' && shape.yref === 'y');

  element('btnPeak').onclick();
  await c.chartRenderPromise;
  assert.deepEqual(Array.from(c.peakStore['btc|b625|s0']), ['2026-09-18', 99]);
  assert.equal(pinLine().y0, 99);
  const btcRange = Array.from(graph.layout.yaxis.range);
  c.goTo(1, true);
  await flush();
  await c.chartRenderPromise;
  assert.equal(c.lastDayPeak, 500, 'the new displayed peak does not overwrite the chosen pin');
  assert.deepEqual(Array.from(graph.layout.yaxis.range), btcRange);
  assert.equal(pinLine().y0, 99);

  async function switchTo(id) {
    element(id).onclick();
    runTimer(c.viewRenderTimer);
    await flush();
    await c.chartRenderPromise;
  }
  await switchTo('btnUSD');
  assertPreset(h, false);
  assert.equal(pinLine(), undefined, 'BTC pin cannot fix the USD scale');
  element('btnPeak').onclick();
  await c.chartRenderPromise;
  assert.deepEqual(Array.from(c.peakStore['usd|b625|s0']), ['2026-09-19', 500000]);
  assert.equal(pinLine().y0, 500000);
  const usdRange = Array.from(graph.layout.yaxis.range);

  await switchTo('btnBTC');
  assert.equal(pinLine().y0, 99, 'the BTC pin is remembered when its mode returns');
  assert.deepEqual(Array.from(graph.layout.yaxis.range), btcRange);
  element('btnPeak').onclick();
  await c.chartRenderPromise;
  assert.equal(c.peakStore['btc|b625|s0'], undefined);
  assert.equal(pinLine(), undefined);
  assert.ok(graph.layout.yaxis.range[1] > btcRange[1], 'unpinning fits the current taller day again');

  await switchTo('btnUSD');
  assert.equal(pinLine().y0, 500000);
  assert.deepEqual(Array.from(graph.layout.yaxis.range), usdRange);
  assert.deepEqual(Array.from(c.peakStore['usd|b400|s0.6']), ['2026-09-17', 123456]);
  assert.deepEqual(persisted.at(-1).value, JSON.parse(JSON.stringify(c.peakStore)));
});

test('an intentional RAW pin overrides its default percentile despite an explicit normal-mode Y-max', async () => {
  const h = fixture();
  const { c, element } = h;
  const dense = {};
  for (let price = 0; price < 625; price++) dense[price] = price === 624 ? 10000 : 1;
  c.rawCache[c.allDates[0]] = { all: dense, age: [dense] };
  c.NUM_BINS = 400;
  c.KERNEL_PCT = 0.6;
  c.yMaxByMode = [97, 88];
  c.yMaxExplicit = [true, true];
  c.yMaxPct = 97;
  c.setViewMode(1);
  await c.loadAndRender();
  const before = snapshot(c);
  await c.setRawMode(true);
  const graph = element('chart');
  assert.equal(c.lastDayPeak, 10000);
  assert.ok(graph.layout.yaxis.range[1] < 100, 'RAW initially clips the outlier at its default percentile');

  element('btnPeak').onclick();
  await c.chartRenderPromise;
  assert.deepEqual(Array.from(c.peakStore['btc|b625|s0']), ['2026-09-18', 10000]);
  assert.ok(graph.layout.yaxis.range[1] >= 10000, 'choosing a pin must override RAW percentile clipping');
  assert.equal(graph.layout.shapes.find(shape => shape.xref === 'paper' && shape.yref === 'y').y0, 10000);
  assertPreset(h, true);
  assert.deepEqual(Array.from(c.yMaxByMode), before.modeYmax);
  assert.deepEqual(Array.from(c.yMaxExplicit), before.explicitYmax);
  before.pins = snapshot(c).pins;
  await c.setRawMode(false);
  assert.deepEqual(snapshot(c), before);
});

test('recording blocks RAW pin creation and removal', async () => {
  const h = fixture();
  const { c, element } = h;
  c.setViewMode(1);
  await c.setRawMode(true);
  c.videoRecording = true;
  element('btnPeak').onclick();
  assert.equal(c.peakStore['btc|b625|s0'], undefined);
  c.videoRecording = false;
  element('btnPeak').onclick();
  await c.chartRenderPromise;
  const chosen = Array.from(c.peakStore['btc|b625|s0']);
  c.videoRecording = true;
  element('btnPeak').onclick();
  assert.deepEqual(Array.from(c.peakStore['btc|b625|s0']), chosen);
});
