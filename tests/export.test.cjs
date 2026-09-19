const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('var videoRecording = false;');
const end = html.indexOf('// ---- Draggable tracer:', start);
assert.ok(start >= 0 && end > start, 'Production export section must be present');
const source = html.slice(start, end);

function setup(options = {}) {
  let now = 0, timerId = 0, renderSeq = 0, decodeCount = 0;
  const timers = new Map(), captures = [], downloads = [], bitmaps = [], recorders = [];
  const dates = Array.from({ length: (options.frames || 2) + 1 }, (_, i) => '2020-01-' + String(i + 1).padStart(2, '0'));
  const audio = { starts: 0, stops: 0, closes: 0 };
  const elements = new Map();
  const classes = () => { const set = new Set(); return { add: v => set.add(v), remove: v => set.delete(v), contains: v => set.has(v) }; };
  const get = id => {
    if (!elements.has(id)) elements.set(id, Object.assign(new EventEmitter(), {
      style: {}, value: '', textContent: '', classList: classes(), offsetWidth: 1200, offsetHeight: 600, disabled: id === 'videoCancelBtn',
    }));
    return elements.get(id);
  };
  const schedule = (fn, ms = 0) => { const id = ++timerId; timers.set(id, { at: now + ms, fn }); return id; };
  const delay = ms => new Promise(resolve => schedule(resolve, ms));
  const track = { stopped: 0, stop() { this.stopped++; } };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  let frameRequests = 0;
  if (options.frameApi !== 'none') {
    const receiver = options.frameApi === 'stream' ? stream : track;
    receiver.requestFrame = function() {
      assert.equal(this, receiver, 'requestFrame must retain its browser receiver');
      if (options.requestError) throw new Error('frame capture failed');
      frameRequests++;
    };
  }
  function Canvas() {}
  Canvas.prototype.captureStream = () => stream;
  Canvas.prototype.getContext = () => ({ drawImage() { if (options.drawError) throw new Error('canvas draw failed'); } });
  class Recorder {
    static isTypeSupported() { return !options.noCodec; }
    constructor() {
      if (options.constructorError) throw new Error('recorder unavailable');
      this.state = 'inactive'; this.stops = 0; recorders.push(this);
    }
    start() { if (options.startError) throw new Error('encoder cannot start'); this.state = 'recording'; }
    stop() {
      if (this.state === 'inactive') return;
      this.stops++; this.state = 'inactive';
      schedule(() => {
        if (this.ondataavailable) this.ondataavailable({ data: new Blob(['encoded frames']) });
        if (this.onstop) this.onstop();
      });
    }
    error() {
      this.state = 'inactive';
      if (this.onerror) this.onerror({ error: { name: 'UnknownError' } });
      if (this.ondataavailable) this.ondataavailable({ data: new Blob(['partial']) });
      if (this.onstop) this.onstop();
    }
  }
  class AudioContext {
    constructor() { this.state = 'running'; this.destination = {}; }
    createOscillator() { return { frequency: {}, connect() {}, start() { audio.starts++; }, stop() { audio.stops++; } }; }
    createGain() { return { gain: {}, connect() {} }; }
    close() { audio.closes++; return Promise.resolve(); }
  }
  const document = {
    getElementById: get, addEventListener() {}, activeElement: { blur() {} },
    body: { classList: classes(), appendChild() {}, removeChild() {} },
    createElement: tag => tag === 'canvas' ? new Canvas() : { click() { downloads.push(this.download); } },
  };
  let context;
  const globals = {
    document, allDates: dates, lang: options.lang || 'en', stepSize: 1, currentIdx: dates.length - 1, coinMode: false,
    lastRenderedData: { dateStr: dates.at(-1) }, syncSettingFields() {}, modeKey: () => '',
    performance: { now: () => now }, setTimeout: schedule, clearTimeout: id => timers.delete(id),
    HTMLCanvasElement: Canvas, MediaRecorder: Recorder, AudioContext, Blob,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    fetch: async dataUrl => ({ blob: async () => ({ source: dataUrl }) }),
    createImageBitmap: async blob => {
      const k = decodeCount++;
      if (options.decodeDelay) await delay(typeof options.decodeDelay === 'function' ? options.decodeDelay(k) : options.decodeDelay);
      if (options.decodeError && k === 0) throw new Error('PNG decode failed');
      const bitmap = { source: blob.source, closes: 0, close() { this.closes++; } };
      bitmaps.push(bitmap);
      return bitmap;
    },
    Plotly: { toImage: async () => {
      captures.push({ date: context.lastRenderedData.dateStr, at: now });
      if (options.captureDelay) await delay(options.captureDelay);
      return context.lastRenderedData.dateStr;
    } },
    loadAndRender: async propagateErrors => {
      const date = dates[context.currentIdx], seq = ++renderSeq;
      if (propagateErrors && options.earlyAfterplot) get('chart').emit('plotly_afterplot');
      await delay(propagateErrors ? (options.loadDelay || 10) : 10);
      if (seq !== renderSeq) return;
      if (propagateErrors && options.renderError) throw new Error('plot failed');
      if (!options.wrongDate || !propagateErrors) context.lastRenderedData = { dateStr: date };
      get('chart').emit('plotly_afterplot');
    },
  };
  globals.window = globals;
  context = vm.createContext(globals);
  vm.runInContext(source, context, { filename: 'production-export.js' });
  get('videoFrom').value = dates[0]; get('videoTo').value = dates.at(-2);
  async function until(predicate = () => false) {
    for (let n = 0; n < 10000; n++) {
      // Drain cross-realm Promise jobs before advancing the deterministic browser clock.
      await new Promise(setImmediate);
      if (predicate()) return;
      if (!timers.size) return;
      const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      timers.delete(id); now = timer.at; timer.fn();
    }
    assert.fail('Export left an unbounded timer loop');
  }
  return {
    context, get, document, track, stream, audio, captures, downloads, bitmaps, recorders, dates, timers, schedule, until,
    record: () => get('videoRecBtn').onclick(), cancel: () => get('videoCancelBtn').onclick(),
    get frameRequests() { return frameRequests; }, get decodeCount() { return decodeCount; },
    get status() { return get('videoStatus').textContent; },
  };
}

function assertReleased(h) {
  assert.equal(h.context.videoRecording, false);
  assert.equal(h.get('videoRecBtn').disabled, false);
  assert.equal(h.get('videoCancelBtn').disabled, true);
  assert.equal(h.document.body.classList.contains('recording'), false);
  assert.equal(h.track.stopped, 1);
  assert.ok(h.bitmaps.every(b => b.closes === 1), 'Every decoded bitmap must be closed exactly once');
  assert.ok(h.recorders.every(r => r.state === 'inactive'));
  assert.equal(h.audio.starts, h.audio.stops);
  assert.equal(h.audio.starts, h.audio.closes);
}

for (const frameApi of ['track', 'stream']) test(`exports using ${frameApi}-level requestFrame and releases resources`, async () => {
  const h = setup({ frameApi, earlyAfterplot: true }); h.record(); await h.until();
  assert.equal(h.downloads.length, 1);
  assert.deepEqual(h.captures.map(c => c.date), h.dates.slice(0, -1));
  assert.ok(h.captures[0].at >= 10, 'An unrelated afterplot event must not complete the render');
  assert.ok(h.frameRequests >= 2); assert.match(h.status, /^Saved 2 frames/); assertReleased(h);
});

test('a timed-out render never becomes a stale frame or a successful download', async () => {
  const h = setup({ loadDelay: 20000 }); h.record(); await h.until();
  assert.deepEqual(h.captures, []); assert.deepEqual(h.downloads, []);
  assert.match(h.status, /Timed out while rendering 2020-01-01/);
  assert.equal(h.context.lastRenderedData.dateStr, h.dates.at(-1)); assertReleased(h);
});

for (const option of ['renderError', 'wrongDate']) test(`${option} fails without capturing the chart`, async () => {
  const h = setup({ [option]: true }); h.record(); await h.until();
  assert.deepEqual(h.captures, []); assert.deepEqual(h.downloads, []); assert.match(h.status, /^Error:/); assertReleased(h);
});

for (const options of [{ frameApi: 'none' }, { noCodec: true }, { constructorError: true }]) test(`preflight cleans up before capture: ${JSON.stringify(options)}`, async () => {
  const h = setup(options); h.record(); await h.until();
  assert.deepEqual(h.captures, []); assert.deepEqual(h.downloads, []); assert.match(h.status, /^Error:/); assertReleased(h);
});

for (const option of ['drawError', 'requestError', 'decodeError', 'startError']) test(`${option} unlocks the page and cleans resources`, async () => {
  const h = setup({ [option]: true }); h.record(); await h.until();
  assert.deepEqual(h.downloads, []); assert.match(h.status, /^Error:/); assertReleased(h);
});

test('cancelling an in-flight render restores the chart and cannot resume the export', async () => {
  const h = setup({ loadDelay: 1000 }); h.record();
  await new Promise(setImmediate); h.cancel();
  assert.equal(h.context.videoRecording, false); await h.until();
  assert.deepEqual(h.captures, []); assert.deepEqual(h.downloads, []); assert.equal(h.status, 'Cancelled.');
  assert.equal(h.context.lastRenderedData.dateStr, h.dates.at(-1)); assertReleased(h);
});

test('cancelling during image capture ignores its late result', async () => {
  const h = setup({ captureDelay: 1000 }); h.record(); await h.until(() => h.captures.length === 1);
  h.cancel(); await h.until(); assert.equal(h.captures.length, 1); assert.deepEqual(h.downloads, []); assertReleased(h);
});

test('cancelling during predecode closes bitmaps that resolve after cancellation', async () => {
  const h = setup({ decodeDelay: k => k ? 1000 : 100 }); h.record(); await h.until(() => h.bitmaps.length === 1);
  h.cancel(); await h.until(); assert.equal(h.bitmaps.length, 2); assert.deepEqual(h.downloads, []); assertReleased(h);
});

test('a recorder error discards partial output and stops scheduled encoding', async () => {
  const h = setup({ frames: 10 }); h.record(); await h.until(() => h.frameRequests === 1);
  h.recorders[0].error(); await h.until();
  assert.equal(h.frameRequests, 1); assert.deepEqual(h.downloads, []); assert.match(h.status, /UnknownError/); assertReleased(h);
});

test('export start clears queued navigation and settings redraws', async () => {
  const h = setup(); let fired = 0;
  for (const name of ['navTimer', 'viewRenderTimer', 'binsInputTimer', 'smoothInputTimer']) h.context[name] = h.schedule(() => fired++, 5000);
  h.record(); await h.until(); assert.equal(fired, 0); assert.equal(h.downloads.length, 1); assertReleased(h);
});

test('Japanese validation, render, encode, completion and cancellation statuses are localized', async () => {
  const h = setup({ lang: 'ja' }); h.get('videoFrom').value = ''; h.record(); assert.match(h.status, /開始日/);
  h.get('videoFrom').value = h.dates[0]; h.record(); assert.match(h.status, /フレームを描画中/);
  await h.until(() => h.status.startsWith('エンコード中')); assert.match(h.status, /エンコード中/);
  await h.until(); assert.match(h.status, /保存しました/); assertReleased(h);
  const cancelled = setup({ lang: 'ja' }); cancelled.record(); cancelled.cancel(); await cancelled.until();
  assert.equal(cancelled.status, 'キャンセルしました。');
  const failed = setup({ lang: 'ja', frameApi: 'none' }); failed.record(); assert.match(failed.status, /^エラー：/);
});
