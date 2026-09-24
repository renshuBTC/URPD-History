const test = require('node:test');
const assert = require('node:assert/strict');
const { app, deferred, flush } = require('./helpers.cjs');

function controlledApp() {
  const h = app();
  const draws = [];
  h.c.allDates = ['2026-09-18', '2026-09-19', '2026-09-20'];
  h.c.currentIdx = 0;
  h.c.Plotly.react = (id, traces, layout) => {
    const pending = deferred();
    draws.push({
      ...pending,
      complete() {
        const graph = h.element(id);
        graph.data = traces;
        graph.layout = layout;
        graph._fullLayout = { width: 1200, xaxis: { _length: 1040 }, legend: { _height: 29 } };
        pending.resolve();
      }
    });
    return pending.promise;
  };
  const a = h.c.buildData(h.c.allDates[0], { all: { 100: 2 }, age: [{ 100: 2 }] });
  const b = h.c.buildData(h.c.allDates[1], { all: { 500: 3 }, age: [{ 500: 3 }] });
  h.c.cache[h.c.dataKey(a.dateStr)] = a;
  h.c.cache[h.c.dataKey(b.dateStr)] = b;
  return { ...h, draws, a, b };
}

async function showFirst(h) {
  const first = h.c.loadAndRender();
  await flush();
  assert.equal(h.draws.length, 1);
  h.draws[0].complete();
  await first;
}

for (const failBeforeDraw of [false, true]) {
  test(`a newer load failure keeps graph and navigation aligned when it fails ${failBeforeDraw ? 'before' : 'after'} the prior draw completes`, async () => {
    const h = controlledApp();
    await showFirst(h);
    h.c.currentIdx = 1;
    const older = h.c.loadAndRender();
    await flush();
    assert.equal(h.draws.length, 2);
    const download = deferred();
    h.c.fetchRaw = () => download.promise;
    h.c.currentIdx = 2;
    const newer = h.c.loadAndRender();
    await flush();
    if (failBeforeDraw) {
      download.reject(new Error('newest date unavailable'));
      await flush();
      h.draws[1].complete();
    } else {
      h.draws[1].complete();
      await flush();
      download.reject(new Error('newest date unavailable'));
    }
    await flush();
    // A recovery render may have been queued behind the earlier Plotly operation.
    for (let i = 2; i < h.draws.length; i++) {
      h.draws[i].complete();
      await flush();
    }
    await Promise.all([older, newer]);
    const expectedIndex = failBeforeDraw ? 0 : 1;
    assert.equal(h.c.currentIdx, expectedIndex);
    assert.equal(h.c.lastRenderedData.dateStr, h.c.allDates[expectedIndex]);
    assert.match(h.element('chart').layout.title.text, new RegExp(`${18 + expectedIndex} Sept 2026`));
    assert.equal(h.element('dateDisplay').textContent, `${expectedIndex + 1}/3`);
  });
}

test('date counter and bin labels remain committed until the pending chart succeeds', async () => {
  const h = controlledApp();
  await showFirst(h);
  const oldCounter = h.element('dateDisplay').textContent;
  const oldBins = h.element('binsUnit').textContent;
  h.c.currentIdx = 1;
  const load = h.c.loadAndRender();
  await flush();
  assert.equal(h.element('dateDisplay').textContent, oldCounter);
  assert.equal(h.element('binsUnit').textContent, oldBins);
  h.draws[1].reject(new Error('draw failed'));
  await flush();
  for (let i = 2; i < h.draws.length; i++) {
    h.draws[i].complete();
    await flush();
  }
  await load;
  assert.equal(h.element('dateDisplay').textContent, oldCounter);
  assert.equal(h.element('binsUnit').textContent, oldBins);
});

test('pinning during a mode switch never saves the displayed USD peak under BTC', async () => {
  const h = controlledApp();
  await showFirst(h);
  const displayedKey = h.c.peakKey();
  const displayedPeak = h.c.lastDayPeak;
  h.c.setViewMode(1);
  const nextModeKey = h.c.peakKey();
  assert.notEqual(nextModeKey, displayedKey);
  h.c.peakPin();
  assert.equal(h.c.peakStore[nextModeKey], undefined);
  assert.equal(h.c.peakStore[displayedKey][1], displayedPeak);
});

test('an older completed draw cannot hide the newest date loading indicator', async () => {
  const h = controlledApp();
  await showFirst(h);
  h.c.currentIdx = 1;
  const older = h.c.loadAndRender();
  await flush();
  const download = deferred();
  h.c.fetchRaw = () => download.promise;
  h.c.currentIdx = 2;
  const newer = h.c.loadAndRender();
  await flush();
  assert.equal(h.element('loading').style.display, 'block');
  h.draws[1].complete();
  await older;
  assert.equal(h.element('loading').style.display, 'block');
  download.resolve({ all: { 700: 4 }, age: [{ 700: 4 }] });
  await flush();
  h.draws[2].complete();
  await newer;
  assert.equal(h.element('loading').style.display, 'none');
});

test('fallback redraw keeps the displayed data binning in its peak key', async () => {
  const h = controlledApp();
  await showFirst(h);
  const displayedKey = h.c.peakKey();
  h.c.currentIdx = 1;
  h.c.NUM_BINS = 500;
  const newKey = h.c.peakKey();
  // The selected date has no cache entry for the new bins yet, so a presentation
  // setting redraw uses the last displayed day's data until its fetch completes.
  const redraw = h.c.rerenderCurrent();
  await flush();
  h.draws[1].complete();
  await redraw;
  h.c.peakPin();
  assert.equal(h.c.peakStore[newKey], undefined);
  assert.ok(h.c.peakStore[displayedKey]);
});
