const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function section(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Missing source markers: ${start}, ${end}`);
  return source.slice(first, last);
}

function harness() {
  let now = 1000, nextTimer = 0;
  const timers = new Map();
  const listeners = {}, tracerListeners = {}, loads = [], notices = [];
  const classList = { add() {}, remove() {} };
  const dateInput = { value: '' };
  const tracer = {
    style: {}, classList,
    addEventListener: (name, fn) => { tracerListeners[name] = fn; },
    setPointerCapture() {}, releasePointerCapture() {}
  };
  const chart = {
    layout: { xaxis2: { range: ['2025-09-27', '2026-09-27'] } },
    _fullLayout: { xaxis2: { _length: 100, _offset: 0, p2d: px => dates[Math.round(px)] }, yaxis3: {} },
    getBoundingClientRect: () => ({ left: 0, top: 0 })
  };
  const dates = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
  const elements = {
    dateInput, tracer, chart, loading: { style: {} },
    landmarks: { addEventListener: (name, fn) => { listeners[`landmarks:${name}`] = fn; } }
  };
  class ClockDate extends Date { static now() { return now; } }
  const context = vm.createContext({
    Date: ClockDate, IS_MOBILE: true,
    allDates: dates, currentIdx: 5, renderSeq: 0,
    window: { innerWidth: 400, videoRecording: false, addEventListener() {} },
    document: {
      documentElement: {}, body: { classList },
      getElementById: id => elements[id],
      addEventListener: (name, fn) => { listeners[name] = fn; }
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    setTimeout: (fn, delay = 0) => {
      const id = ++nextTimer;
      timers.set(id, { fn, due: now + delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    showNotice: message => notices.push(message), t: key => `${key}:`,
    loadAndRender: () => {
      ++context.renderSeq;
      loads.push({ date: dates[context.currentIdx], window: context.window.tracerDragWindow });
      return Promise.resolve();
    }
  });
  function run(start, end) { vm.runInContext(section(start, end), context); }
  run('var navTimer = null, navLast = 0;', 'document.getElementById("btnPrev")');
  function advance(ms) {
    const target = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      const [id, timer] = next;
      now = timer.due;
      timers.delete(id);
      timer.fn();
    }
    now = target;
  }
  return { context, run, advance, loads, notices, dateInput, listeners, tracerListeners, chart, dates };
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

test('a selected landmark uses its own date without replacing the date-search filter', () => {
  for (const filter of ['', '2026-09-15']) {
    const h = harness();
    h.run('function jumpToDate(', 'var ddOpen = false;');
    h.dateInput.value = filter;
    const target = { value: '2026-09-17', blur() {} };
    h.listeners['landmarks:change']({ target });
    assert.equal(h.context.currentIdx, 2);
    assert.equal(h.loads.at(-1).date, '2026-09-17');
    assert.equal(h.dateInput.value, filter);
    assert.equal(target.value, '');
  }
});

test('a typed date replaces a pending navigation target and cancels its timer', () => {
  const h = harness();
  h.run('function jumpToDate(', 'var ddOpen = false;');
  h.context.goTo(4);
  h.advance(50);
  h.context.goTo(3);
  h.dateInput.value = '2026-09-15';
  h.context.jumpToDate();
  h.advance(500);
  assert.equal(h.context.currentIdx, 0);
  assert.deepEqual(h.loads.map(load => load.date), ['2026-09-19', '2026-09-15']);
});

test('an older failed load cannot reset a newer navigation waiting for debounce', async () => {
  const h = harness();
  const requests = [], requestedDates = [];
  Object.assign(h.context, {
    cache: {}, rawCache: {}, lastRenderedData: { dateStr: '2026-09-20' },
    schedulePrefetch() {}, dataKey: date => date, rawComplete: () => false,
    fetchRaw: date => {
      requestedDates.push(date);
      return new Promise((resolve, reject) => requests.push({ resolve, reject }));
    },
    buildData: date => ({ dateStr: date }), cacheSet() {}, showData: () => Promise.resolve()
  });
  h.run('function loadAndRender(propagateErrors) {', 'function renderChart(data) {');
  h.context.goTo(4);
  await settle();
  h.advance(50);
  h.context.goTo(3);
  requests[0].reject(new Error('network failure'));
  await settle();
  assert.equal(h.context.currentIdx, 3);
  assert.deepEqual(h.notices, []);
  h.advance(110);
  await settle();
  assert.deepEqual(requestedDates, ['2026-09-19', '2026-09-18']);
  requests[1].resolve({});
  await settle();
});

function touch(h, x, moveX) {
  h.listeners.touchstart({ touches: [{ clientX: x, clientY: 100 }] });
  if (moveX !== undefined) h.listeners.touchmove({ touches: [{ clientX: moveX, clientY: 100 }] });
  h.listeners.touchend();
}

test('every rapid mobile tap contributes a day while only the last target is loaded', () => {
  const h = harness();
  h.run('if (IS_MOBILE) (function () {', '</script>');
  for (let i = 0; i < 4; i++) touch(h, 10);
  assert.equal(h.context.currentIdx, 1);
  assert.equal(h.loads.length, 1);
  h.advance(110);
  assert.deepEqual(h.loads.map(load => load.date), ['2026-09-19', '2026-09-16']);
  touch(h, 10);
  touch(h, 10); // clamped at the first day
  touch(h, 390); // reversing direction also contributes a day
  assert.equal(h.context.currentIdx, 1);
  touch(h, 200); // the middle half is inert
  touch(h, 10, 100); // a drag is not an edge tap
  assert.equal(h.context.currentIdx, 1);
});

test('dragging coalesces requests and release flushes the final date with an unfrozen window', () => {
  const h = harness();
  h.run('window.tracerDragWindow = null;', 'var EXPLAINER = {');
  const event = x => ({ pointerType: 'mouse', button: 0, pointerId: 1, clientX: x, preventDefault() {}, stopPropagation() {} });
  h.tracerListeners.pointerdown(event(5));
  assert.equal(h.context.window.tracerDragWindow[0], Date.UTC(2025, 8, 27));
  for (const x of [4, 3, 2, 1, 0]) {
    h.tracerListeners.pointermove(event(x));
    h.advance(16);
  }
  assert.equal(h.context.currentIdx, 0);
  assert.equal(h.loads.length, 1);
  assert.ok(h.loads[0].window);
  h.tracerListeners.pointerup(event(0));
  assert.equal(h.loads.length, 2);
  assert.equal(h.loads[1].date, '2026-09-15');
  assert.equal(h.loads[1].window, null);
  h.advance(500);
  assert.equal(h.loads.length, 2);
});

test('releasing an already rendered tracer date redraws the normal price window', () => {
  const h = harness();
  h.run('window.tracerDragWindow = null;', 'var EXPLAINER = {');
  const event = { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 3, preventDefault() {}, stopPropagation() {} };
  h.tracerListeners.pointerdown(event);
  h.tracerListeners.pointermove(event);
  assert.equal(h.loads.length, 1);
  h.advance(300);
  h.tracerListeners.pointerup(event);
  assert.equal(h.loads.length, 2);
  assert.equal(h.loads[1].window, null);
});

test('navigation is inert before dates load, and a burst loads only its first and last steps', () => {
  const h = harness();
  h.context.allDates = [];
  h.context.goTo(0);
  assert.equal(h.loads.length, 0);
  h.context.allDates = h.dates;
  h.context.goTo(4);
  h.context.goTo(3);
  h.advance(500);
  assert.equal(h.context.currentIdx, 3);
  assert.deepEqual(h.loads.map(l => l.date), [h.dates[4], h.dates[3]], 'the first step loads at once, the burst after it once it settles');
});
