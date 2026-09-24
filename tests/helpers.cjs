const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
const main = scripts.find(s => s.includes('var BASE =')).replace(/\ninit\(\);\s*$/, '');
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function app(overrides = {}) {
  const elements = new Map(), timers = new Map(), docListeners = {};
  let timerId = 0;
  function element(id) {
    if (!elements.has(id)) {
      const el = Object.assign(new EventEmitter(), {
        id, style: {}, value: '', textContent: '', clientWidth: 1200,
        options: [{ textContent: 'Landmarks' }],
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener(type, fn) { this.on(type, fn); },
        querySelectorAll() { return []; }, querySelector() { return null; },
        attributes: {}, setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k]; },
        focus(options) { c.document.activeElement = this; this.focusOptions = options; },
        getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
        appendChild() {}, blur() {}, contains() { return false; }
      });
      elements.set(id, el);
    }
    return elements.get(id);
  }
  const c = vm.createContext({
    console, AbortController, Float64Array, Date, Math, Promise,
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener() {},
    localStorage: { getItem() { return null; }, setItem() {} },
    document: {
      getElementById: element, querySelectorAll() { return []; },
      addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
      documentElement: {}, body: { classList: { add() {}, remove() {} } },
      createElement() { return element('created'); }
    },
    fetch() { throw new Error('Unexpected network request'); },
    Plotly: {
      react(id, traces, layout) {
        const gd = element(id);
        gd.data = traces; gd.layout = layout;
        gd._fullLayout = { width: 1200, xaxis: { _length: 1040 }, legend: { _height: 29 } };
        return Promise.resolve();
      }
    },
    ...overrides
  });
  c.window = c;
  vm.runInContext(main, c, { filename: 'index.html/main' });
  c.schedulePrefetch = () => {};
  return { c, element, timers, docListeners, runTimer(id) { const t = timers.get(id); timers.delete(id); t.fn(); } };
}
module.exports = { html, scripts, app, deferred, flush };
