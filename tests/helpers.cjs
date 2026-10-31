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
// An element's style: plain properties, and custom properties set and removed as a browser's CSSStyleDeclaration does.
const STYLE = { setProperty(k, v) { this[k] = String(v); }, removeProperty(k) { delete this[k]; } };
function app(overrides = {}) {
  const elements = new Map(), timers = new Map(), docListeners = {};
  let timerId = 0;
  function element(id) {
    if (!elements.has(id)) {
      const el = Object.assign(new EventEmitter(), {
        id, style: Object.create(STYLE), value: '', textContent: '', clientWidth: 1200,
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
      react(id, traces, layout, config) {
        const gd = element(id);
        gd.data = traces; gd.layout = layout; gd.config = config;
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
// The API as the page reads its days: its day1 series, a date and the first block height for each day from
// 2009-01-01 to the latest, for days with blocks `listed` (the last of them the day in progress). A day has blocks
// where the next day's first height is higher, and the latest day has the blocks so far.
const DAY0 = Date.UTC(2009, 0, 1), isoDay = t => new Date(t).toISOString().slice(0, 10);
function firstHeights(calendar, listed) {
  const on = new Set(listed), last = listed.length ? calendar.indexOf(listed[listed.length - 1]) : -1, data = [];
  for (let i = 0, h = 0; i <= last; i++) { data.push(h); if (on.has(calendar[i])) h++; }
  return { data };
}
function daySeries(listed) {
  const calendar = [];
  if (listed.length) for (let t = DAY0; isoDay(t) <= listed[listed.length - 1]; t += 864e5) calendar.push(isoDay(t));
  return { date: { data: calendar }, first_height: firstHeights(calendar, listed) };
}
// The answer to a request for one of those two series, or undefined for any other.
function dayAnswer(url, listed) {
  if (url.endsWith('/first_height/day1')) return daySeries(listed).first_height;
  if (url.endsWith('/date/day1')) return daySeries(listed).date;
}
// A URPD as /api/urpd/{cohort}/{date} sends it: price -> amount as columns, in ascending price.
function urpd(date, amounts = {}) {
  const prices = Object.keys(amounts).map(Number).sort((a, b) => a - b);
  return { height: 0, hash: '', date, cohort: 'age_under_1h', weight: 'none', aggregation: 'raw', close: 0,
    supply: prices.reduce((s, p) => s + amounts[p], 0),
    buckets: { price: prices, supply: prices.map(p => amounts[p]), realized_cap: prices.map(p => p * amounts[p]), unrealized_pnl: prices.map(() => 0) } };
}

module.exports = { html, scripts, app, deferred, flush, firstHeights, daySeries, dayAnswer, urpd };
