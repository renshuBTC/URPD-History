// What the page shows around the chart and how it takes input: messages, the toolbar and its panels, narrow
// plots, input methods, phone taps and saved pins. Each test here pins down a bug the second 2026-09-24 audit found.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { html, scripts, app, deferred, flush } = require('./helpers.cjs');

const plain = v => JSON.parse(JSON.stringify(v));   // out of the page's realm, for deepEqual
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const rules = css.split('}').map(r => r.split('{')).filter(r => r.length === 2)
  .map(([sel, body]) => ({ sels: sel.split(',').map(s => s.trim().replace(/\s+/g, ' ')), body: body.trim() }));
function decls(selector) {
  const found = rules.filter(r => r.sels.includes(selector));
  assert.ok(found.length, 'no rule for ' + selector);
  return found.map(r => r.body).join('; ');
}
// The panel script (explainer, orange dot, phone taps) run in the same page as the main one.
const panelScript = scripts.find(s => s.includes('var EXPLAINER'));
function withPanels(h) { vm.runInContext(panelScript, h.c, { filename: 'index.html/panels' }); return h; }
const iso = t => new Date(t).toISOString().slice(0, 10);
function days(from, to) {
  const out = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 864e5) out.push(iso(t));
  return out;
}
// Five days of a small market; every day's cost basis is the same two stamps.
function market(c) {
  const dates = days('2026-09-01', '2026-09-05');
  c.allDates = dates; c.priceDates = dates.slice();
  c.priceIndexByDate = Object.fromEntries(dates.map((d, i) => [d, i]));
  c.priceArray = dates.map((_, i) => 60000 + 100 * i);
  c.currentIdx = dates.length - 1;
  return { dates, raw: { all: { 50000: 2, 70000: 1 }, age: [{ 50000: 2 }, { 70000: 1 }] } };
}
// Monospace estimate the page itself uses: 0.6 em a character, a full em for CJK.
const textPx = (s, size) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e7f ? size : 0.6 * size), 0);

test('messages float over the chart near the bottom of the window and take no room from it', () => {
  const d = decls('#status');
  for (const want of [/position:\s*fixed/, /bottom:/, /left:\s*50%/, /pointer-events:\s*none/, /background:\s*#111/, /(^|[;\s])color:\s*#d4d4d4/, /z-index:\s*\d+/]) assert.match(d, want);
  assert.doesNotMatch(d, /(^|;)\s*top:/, 'never over the title');
  assert.match(decls('html.phone #status'), /font-size/);
});

test('the retry hint names the >> button, and a phone, which has neither, is told to tap the right edge', async () => {
  const { c } = app();
  for (const l of ['en', 'zh', 'ja']) {
    assert.match(c.T[l].retryHint, />>/, l); assert.doesNotMatch(c.T[l].retryHint, /»/, l);
    assert.ok(c.T[l].retryHintPhone.length, l);
  }
  for (const phone of [false, true]) {
    const { c, element } = app(phone ? { __PHONE: { w: 2000, h: 900 } } : {});
    market(c);
    c.fetchRaw = () => Promise.reject(new Error('HTTP 503'));
    await c.loadAndRender();
    assert.equal(element('status').textContent, 'Error: HTTP 503. ' + c.T.en[phone ? 'retryHintPhone' : 'retryHint']);
    assert.equal(element('status').style.display, 'block');
  }
});

test('a failed first load keeps its message until a chart draws, and the message follows the language', async () => {
  const { c, element } = app();
  const { raw } = market(c), status = element('status');
  c.fetchRaw = () => Promise.reject(c.pageError(() => c.t('errTimeout') + 15 + c.t('errTimeoutUnit')));
  await c.loadAndRender();
  assert.equal(status.textContent, 'Error: Request timed out after 15 seconds. Press >> or End to try again.');
  // Switching language retries the load; while that runs, the message is already in the new language.
  let retry = null;
  c.fetchRaw = () => (retry = deferred()).promise;
  c.lang = 'zh'; c.applyLang();
  assert.equal(status.textContent, '错误：请求超时（15 秒）。' + c.T.zh.retryHint);
  assert.equal(status.style.display, 'block');
  await flush();
  retry.resolve(raw); await flush(); await c.chartRenderPromise; await flush();
  assert.ok(c.lastRenderedData, 'the retry drew');
  assert.equal(status.style.display, 'none', 'and the message went with it');
  // A message that cannot be re-worded is dropped on a language change rather than left in the old language.
  c.showNotice('Exact date not found, showing nearest: 2026-09-03');
  c.lang = 'ja'; c.applyLang();
  assert.equal(status.style.display, 'none');
});

test('a start-up that could not reach the API says so in whatever language the page is switched to', async () => {
  const { c, element } = app();
  c.fetchJSON = url => (url.endsWith('/all/dates') ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(null));
  await c.init();
  assert.equal(element('status').textContent, c.T.en.errBRK);
  c.lang = 'ja'; c.applyLang();
  assert.equal(element('status').textContent, c.T.ja.errBRK);
  assert.equal(element('status').style.display, 'block', 'still up: nothing can draw without dates');
});

test('the toolbar wraps instead of scrolling; YouTube, How to read and GitHub follow the settings in words, and the language button keeps to the right on its own', () => {
  assert.match(decls('#controls'), /flex-wrap:\s*wrap/);
  assert.match(decls('#toolbarEnd'), /margin-left:\s*auto/);
  assert.doesNotMatch(decls('#githubLink'), /margin-left/);
  const end = html.slice(html.indexOf('<div id="toolbarEnd">'), html.indexOf('<div id="status"'));
  assert.deepEqual([...end.matchAll(/\sid="(\w+)"/g)].map(m => m[1]), ['toolbarEnd', 'langBtn'], 'only the language at the right-hand end');
  const bar = html.slice(html.indexOf('<div id="controls">'), html.indexOf('<div id="toolbarEnd">'));
  assert.deepEqual([...bar.matchAll(/\sid="(ymaxWrap|ytBtn|explainWrap|githubLink)"/g)].map(m => m[1]), ['ymaxWrap', 'ytBtn', 'explainWrap', 'githubLink']);
  // Each shows its icon and a word, at the weight of the other buttons (the ? used to be bold on its own).
  assert.match(bar, /id="ytBtn"[^>]*>\s*<svg[\s\S]*?<\/svg><span id="ytLabel" class="btn-word">Full history in 5 min<\/span>/, 'the video button says what it gives you');
  assert.match(bar, /id="githubLink"[^>]*>\s*<svg[\s\S]*?<\/svg><span class="btn-word">GitHub<\/span>/);
  assert.match(bar, /<button id="explainBtn"[^>]*><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg><span id="explainLabel" class="btn-word">How to read<\/span><\/button>/);
  // Where the words would wrap the bar they give way to the icons: measured against the step bar at the start.
  assert.match(decls('#controls.compact .btn-word'), /display:\s*none/);
  assert.match(html, /function fitToolbarWords\(\) \{[\s\S]*?bar\.classList\.remove\("compact"\);\s*if \(end\.getBoundingClientRect\(\)\.top - first\.getBoundingClientRect\(\)\.top > 4\) bar\.classList\.add\("compact"\);/);
  for (const sel of ['#explainBtn', '#ytBtn', '#githubLink']) assert.doesNotMatch(decls(sel), /font-weight/, sel);
  const { c, element } = app();
  for (const [lang, word] of [['zh', '如何看懂'], ['ja', '読み方'], ['en', 'How to read']]) {
    c.lang = lang; c.applyLang();
    assert.equal(element('explainLabel').textContent, word, lang);
    assert.ok(c.t('ariaExplain').startsWith(word) || c.t('ariaExplain').endsWith(word), lang + ': the spoken name holds the visible word');
  }
});

test('the chart follows its own box, which the toolbar can change without the window resizing', async () => {
  const observers = [];
  class FakeResizeObserver { constructor(cb) { this.cb = cb; observers.push(this); } observe(el) { this.target = el; } }
  const { c, element, timers } = app({ ResizeObserver: FakeResizeObserver });
  assert.equal(observers.length, 1);
  assert.equal(observers[0].target, element('chart'));
  const resized = [], fire = (w, h) => observers[0].cb([{ contentRect: { width: w, height: h } }]);
  c.Plotly.Plots = { resize: gd => { resized.push(gd); return Promise.resolve(gd); } };
  const redraws = () => [...timers.values()].filter(t => t.ms === 150).length;
  fire(1200, 800);
  assert.equal(resized.length, 0, 'nothing drawn yet: the first draw measures the box itself');
  const { raw } = market(c);
  c.fetchRaw = () => Promise.resolve(raw);
  await c.loadAndRender();
  const gd = element('chart');
  gd._fullLayout.height = 800;   // the size Plotly drew at
  fire(1200, 800); fire(1200.6, 799.4);
  assert.equal(resized.length, 0, 'a size Plotly already has is left alone');
  assert.equal(redraws(), 0);
  fire(1200, 772);   // the toolbar took a second row
  assert.equal(resized.length, 1);
  assert.equal(resized[0], gd);
  assert.equal(redraws(), 1, 'and the bars are redrawn for the new width, on the window resize timer');
  fire(1200, 744);
  assert.equal(redraws(), 1, 'one pending redraw, however many changes');
  const phone = [];
  app({ __PHONE: { w: 2000, h: 900 }, ResizeObserver: class { constructor() { phone.push(this); } observe() {} } });
  assert.equal(phone.length, 0, 'a phone draws a fixed 2000 px figure and needs no observer');
});

// The chart drawn over a plot `plotW` px wide.
async function drawAt(plotW, lang = 'en') {
  const { c, element } = app();
  c.lang = lang;
  const { dates, raw } = market(c), react = c.Plotly.react;
  element('chart').clientWidth = plotW + 160;
  c.Plotly.react = (id, traces, layout) => react(id, traces, layout).then(() => {
    element('chart')._fullLayout = { width: plotW + 160, xaxis: { _length: plotW }, legend: { _height: 29 } };
  });
  await c.renderChart(c.buildData(dates.at(-1), raw));
  return element('chart').layout;
}

test('a narrow plot labels every other price step, shrinks the title to fit and wraps the credit line', async () => {
  for (const lang of ['en', 'zh', 'ja']) {
    const L = await drawAt(600, lang), x = L.xaxis;
    assert.equal(x.tickvals.length, 21, 'all twenty-one gridlines stay');
    assert.deepEqual(x.ticktext.map(s => s !== ''), x.ticktext.map((s, k) => k % 2 === 0), `${lang}: every other label`);
    const size = L.title.font.size, title = L.title.text.replace(/<[^>]+>/g, '');
    assert.ok(size >= 12 && size <= 20, `${lang}: ${size}`);
    assert.ok(textPx(title, size) <= 600, `${lang}: the title fits over the plot at ${size} px`);
    const credit = L.annotations.find(a => /Bitview/.test(a.text));
    for (const line of credit.text.split('<br>')) assert.ok(textPx(line.replace(/<[^>]*>/g, ''), credit.font.size) * 1.07 <= 620, `${lang}: ${line}`);
    if (lang === 'en') { assert.equal(size, 13); assert.equal(credit.text.split('<br>').length, 2); assert.equal(L.margin.b, 78); assert.equal(credit.align, 'left'); }
  }
  const wide = await drawAt(1040);
  assert.ok(wide.xaxis.ticktext.every(s => s !== ''), 'a plot with room keeps all twenty-one labels');
  assert.equal(wide.title.font.size, 20);
  const credit = wide.annotations.find(a => /Bitview/.test(a.text));
  assert.doesNotMatch(credit.text, /<br>/); assert.equal(credit.font.size, 11); assert.equal(wide.margin.b, 64);
  assert.equal(wide.margin.t, 13 + 26 + 29);
  const tablet = await drawAt(420);
  assert.ok(tablet.title.font.size >= 12, 'never below 12 px');
});

test('the explainer\'s section headings are underlined', () => {
  assert.match(decls('#explainPanel h3'), /text-decoration:\s*underline/);
  assert.match(decls('#explainPanel h3'), /text-underline-offset:\s*3px/);
});

test('Smoothing and Y-max are framed like the cycle list: label, white value, unit; the frame doubles while editing', () => {
  for (const [wrap, input, unit] of [['smoothWrap', 'smoothInput', '%'], ['ymaxWrap', 'ymaxInput', 'PCTL']]) {
    const m = new RegExp(`<label class="field" id="${wrap}"[^>]*>\\s*<span class="field-label">[^<]+</span><input type="text" id="${input}"[^>]*><span class="field-unit">([^<]+)</span>\\s*</label>`).exec(html);
    assert.ok(m, wrap); assert.equal(m[1], unit);
    assert.doesNotMatch(m[0], /style=/, 'no inline styles');
  }
  const frame = decls('#controls .field');
  for (const want of [/border:\s*1px solid #595959/, /background:\s*#1a1a1a/, /height:\s*24px/, /border-radius:\s*0/]) assert.match(frame, want);
  assert.match(decls('#controls .field:focus-within'), /border-color:\s*#fff;\s*box-shadow:\s*inset 0 0 0 1px #fff/);
  assert.match(decls('#controls .field .field-label'), /text-transform:\s*uppercase/);
  assert.match(decls('#controls .field input'), /color:\s*#fff/);
  assert.match(decls('#controls .field input'), /border:\s*0/);
});

test('the price box says In Profit and In Loss, in every language and for both weightings', async () => {
  const { c, element } = app();
  const { dates } = market(c);
  const data = c.buildData(dates[4], { all: { 10: 1, 90000: 3 }, age: [{ 10: 1, 90000: 3 }] });
  const want = {
    en: [['USD Value Last Moved In Profit: ', 'USD Value Last Moved In Loss: '], ['BTC Supply Last Moved In Profit: ', 'BTC Supply Last Moved In Loss: ']],
    zh: [['最后移动的美元价值处于盈利: ', '最后移动的美元价值处于亏损: '], ['最后移动的 BTC 供应处于盈利: ', '最后移动的 BTC 供应处于亏损: ']],
    ja: [['含み益の最終移動 USD 評価額: ', '含み損の最終移動 USD 評価額: '], ['含み益の最終移動 BTC 供給量: ', '含み損の最終移動 BTC 供給量: ']],
  };
  for (const lang of ['en', 'zh', 'ja']) for (const coin of [false, true]) {
    c.lang = lang; c.coinMode = coin; await c.renderChart(data);
    const [profit, loss] = want[lang][+coin];
    const box = element('chart').layout.annotations.find(a => a.text.includes(profit));
    assert.ok(box, `${lang} ${coin ? 'BTC' : 'USD'}: ${profit}`);
    assert.ok(box.text.includes(loss), `${lang} ${coin ? 'BTC' : 'USD'}: ${loss}`);
  }
  assert.doesNotMatch(html, /Below This Price|Above This Price|Below %/);
  assert.match(html, /Profit % = /);
});

test('no bottom signal, no Bins field and no bar width: 625 bars, and the price axis title names the axis only', async () => {
  for (const gone of ['thresholdInput', 'thresholdWrap', 'binsInput', 'binsWrap', 'binsUnit', 'Bottom signal', 'BOTTOM SIGNAL', 'GLOW_COLOR', 'bottomThreshold'])
    assert.ok(!html.includes(gone), gone);
  const { c, element } = app();
  assert.equal(c.NUM_BINS, 625);
  const { dates, raw } = market(c);
  // every coin above the day's price: the old signal would have fired
  const data = c.buildData(dates[4], { all: { 90000: 3 }, age: [{ 90000: 3 }] });
  await c.renderChart(data);
  const layout = element('chart').layout;
  const spotLine = layout.shapes.find(s => s.type === 'line' && s.xref === 'x');
  assert.equal(spotLine.line.color, '#ffffff', 'the spot line stays white');
  const box = layout.annotations.find(a => /In Profit/.test(a.text));
  assert.equal(box.text.split('<br>').length, 3, 'price and the two shares, nothing more');
  assert.equal(box.bordercolor, 'rgba(255,255,255,0.45)');
  assert.equal(layout.xaxis.title.text, 'Price When Last Moved [USD]');
  for (const [lang, want] of [['zh', c.T.zh.priceUSD], ['ja', c.T.ja.priceUSD]]) {
    c.lang = lang; await c.renderChart(data);
    assert.equal(element('chart').layout.xaxis.title.text, want, lang);
  }
  assert.doesNotMatch(html, /per bar|perBar|每根柱 \{w\}|1 本あたり \{w\}/);
});

test('input methods: their 。 is the decimal point, and the Enter or Escape that ends a composition is theirs', () => {
  const { c, element } = app();
  assert.equal(c.fieldNumber('０。２４'), 0.24);
  assert.equal(c.fieldNumber('0。5'), 0.5);
  assert.ok(Number.isNaN(c.fieldNumber('1、000')), 'a comma is still not a number');
  let prevented = 0;
  const key = (extra = {}) => Object.assign({ key: 'Enter', preventDefault() { prevented++; } }, extra);
  for (const id of ['smoothInput', 'ymaxInput']) {
    const field = element(id);
    let blurred = 0;
    field.blur = () => blurred++;
    field.emit('keydown', key({ isComposing: true }));
    field.emit('keydown', key({ key: 'Escape', keyCode: 229 }));
    assert.equal(blurred, 0, id);
    field.emit('keydown', key());
    assert.equal(blurred, 1, id);
  }
});

test('on a phone a tap on the orange dot, the legend, the mode bar or a credit link is not an edge tap', () => {
  const h = withPanels(app({ __PHONE: { w: 2000, h: 900 }, innerWidth: 400 })), { c, docListeners } = h;
  const steps = [];
  c.goTo = i => steps.push(i);
  c.currentIdx = 5;
  const tap = (x, target) => { docListeners.touchstart[0]({ touches: [{ clientX: x, clientY: 100 }], target }); docListeners.touchend[0](); };
  const inside = selector => ({ closest: s => (s.split(',').map(p => p.trim()).includes(selector) ? {} : null) });
  tap(390, inside('#tracer')); tap(10, inside('.legend')); tap(390, inside('.modebar')); tap(10, inside('a'));
  assert.deepEqual(steps, []);
  tap(390, { closest: () => null }); tap(10, undefined);
  assert.deepEqual(steps, [6, 4], 'anywhere else the edges still step');
});

test('the explainer takes the keyboard when it opens, and hands it back to ? on Escape if it was opened from the keyboard', () => {
  assert.match(html, /<div id="explainPanel" tabindex="-1">/);
  const h = withPanels(app()), { c, element, docListeners } = h;
  const btn = element('explainBtn'), panel = element('explainPanel'), keydown = docListeners.keydown[0];
  btn.onclick.call(btn, { stopPropagation() {} });
  assert.equal(panel.style.display, 'block');
  assert.equal(c.document.activeElement, panel);
  assert.equal(panel.focusOptions.preventScroll, true, 'without scrolling the page');
  let prevented = false;
  keydown({ key: 'ArrowDown', target: panel, preventDefault() { prevented = true; } });
  assert.equal(prevented, false, 'the arrows are left to scroll the panel');
  keydown({ key: 'Escape', target: panel, preventDefault() {} });
  assert.equal(panel.style.display, 'none');
  assert.equal(btn.attributes['aria-expanded'], 'false');
  assert.equal(c.document.activeElement, btn);
  assert.equal(btn.focusOptions.preventScroll, true);
  // Opened with the mouse, Escape just drops focus: handing it to ? would draw the keyboard focus ring around it.
  let blurred = 0;
  panel.blur = () => blurred++;
  c.document.activeElement = null;
  btn.onclick.call(btn, { stopPropagation() {}, detail: 1 });
  assert.equal(c.document.activeElement, panel, 'still takes the keys while open');
  keydown({ key: 'Escape', target: panel, preventDefault() {} });
  assert.equal(panel.style.display, 'none');
  assert.equal(c.document.activeElement, panel, 'not moved to ?');
  assert.equal(blurred, 1);
});

test('each name in the credit line links to its X account, and a click opens it with no handle on this page', async () => {
  const want = [['Bitview.space', '_bitview_'], ['Bitcoin Core', 'bitcoincoreorg'], ['Antoine Le Calvez', 'khannib'],
    ['Renato Shirakashi', 'renato_shira'], ['James Check', '_Checkmatey_'], ['@_nym21_', '_nym21_']].map(([n, x]) => [n, 'https://x.com/' + x]);
  const plainText = {
    en: 'Powered by Bitview.space & Bitcoin Core. Credits: Antoine Le Calvez, Renato Shirakashi, James Check, @_nym21_',
    zh: '由 Bitview.space 和 Bitcoin Core 提供支持。鸣谢：Antoine Le Calvez、Renato Shirakashi、James Check、@_nym21_',
    ja: 'Bitview.space と Bitcoin Core を利用。クレジット：Antoine Le Calvez、Renato Shirakashi、James Check、@_nym21_'
  };
  for (const lang of ['en', 'zh', 'ja']) {
    const { c, element } = app();
    c.lang = lang;
    const { dates, raw } = market(c);
    await c.renderChart(c.buildData(dates.at(-1), raw));
    const credit = element('chart').layout.annotations.find(a => /Bitview/.test(a.text));
    assert.deepEqual([...credit.text.matchAll(/<a href="([^"]+)" style="color:#ffffff">([^<]+)<\/a>/g)].map(m => [m[2], m[1]]), want, lang + ': every name a link');
    // White under the line's 55% opacity (Plotly draws a link's colour inside the text, which keeps the opacity) is
    // exactly the grey of the words around the names.
    assert.equal(credit.font.color, 'rgba(255,255,255,0.55)', lang);
    assert.equal(credit.text.replace(/<[^>]*>/g, ''), plainText[lang], lang + ': the words are as before');
  }
  const { c, element } = app(), opened = [];
  c.open = (...args) => { opened.push(args); return null; };
  const click = element('chart').listeners('click')[0];
  let prevented = 0;
  const on = (href, extra) => ({ button: 0, target: { closest: s => (s === 'a' && href ? { href: { baseVal: href } } : null) }, preventDefault() { prevented++; }, ...extra });
  click(on('https://x.com/_Checkmatey_'));
  assert.deepEqual(opened, [['https://x.com/_Checkmatey_', '_blank', 'noopener']]);
  assert.equal(prevented, 1);
  click(on('https://x.com/khannib', { ctrlKey: true }));   // left to the browser: a tab of its own
  click(on('https://x.com/khannib', { button: 1 }));
  click(on('https://example.com/'));
  click(on('https://x.com/khannib/status/1'));
  click(on(null));
  assert.equal(opened.length, 1);
  assert.equal(prevented, 1);
  // Plotly's own link colour (#447adb) all but vanished on the chart: the names take the line's, underlined when
  // pointed at so they still read as links.
  assert.match(decls('#chart .annotation-text a:hover'), /text-decoration:\s*underline/);
  assert.doesNotMatch(decls('#chart .annotation-text a:hover'), /fill/);
});

test('the language button is named by the label it shows', () => {
  assert.match(html, /<button id="langBtn" aria-label="中文 — Change language">中文<\/button>/);
  const { c, element } = app(), btn = element('langBtn');
  for (const l of ['zh', 'ja', 'en']) {
    c.lang = l; c.applyLang();
    assert.equal(btn.attributes['aria-label'], btn.textContent + ' — ' + c.T[l].ariaLang, l);
  }
});

test('a toolbar button clicked with the mouse lets go of focus, so no focus ring appears when the arrow keys are used', () => {
  const { c, element } = app(), btn = element('btnCoin'), click = element('controls').listeners('click')[0];
  let blurred = 0;
  btn.blur = () => blurred++;
  const on = el => ({ closest: sel => (sel === 'button, a' ? el : null) });
  c.document.activeElement = btn;
  click({ detail: 0, target: on(btn) });
  assert.equal(blurred, 0, 'pressed with Enter or Space: focus stays for the keyboard');
  click({ detail: 1, target: on(btn) });
  assert.equal(blurred, 1, 'clicked: focus goes');
  c.document.activeElement = element('dateInput');
  click({ detail: 1, target: on(btn) });
  assert.equal(blurred, 1, 'nothing to let go of when something else has focus');
  click({ detail: 1, target: on(null) });
  assert.equal(blurred, 1);
});

test('the page\'s own error messages are in the page\'s language, and follow it', async () => {
  const h = app({ fetch: () => new Promise(() => {}) }), { c, timers, runTimer } = h;
  c.lang = 'zh';
  const failed = c.fetchJSON('/x').catch(e => e);
  runTimer([...timers.keys()][0]);
  const e = await failed;
  assert.equal(e.message, '请求超时（15 秒）');
  c.lang = 'ja';
  assert.equal(c.errorText(e), 'リクエストがタイムアウトしました（15 秒）');
  assert.throws(() => c.cleanDates('x'), { message: c.T.ja.errDates });
  assert.throws(() => c.cleanCohort(null), { message: c.T.ja.errCostBasis });
  await assert.rejects(c.fetchRaw('../x'), { message: c.T.ja.errNotDate + '../x' });
  c.fetchJSON = url => Promise.resolve(url.endsWith('/all/dates') ? [] : null);
  await c.init();
  assert.equal(h.element('dateDisplay').textContent, c.T.ja.errPrefix + c.T.ja.errNoDates);
  assert.equal(c.errorText(new Error('HTTP 404')), 'HTTP 404', 'technical messages stay as they are');
});

test('pins RAW saved before it had keys of its own are dropped once, and every other pin stays', () => {
  const stored = { bsd_peaks_v2: JSON.stringify({ 'btc|b625|s0': ['2025-01-01', 1.85e6], 'usd|b625|s0': ['2025-01-01', 9e9],
    'btc|b625|s0|raw': ['2025-02-01', 5], 'usd|b625|s0.24': ['2025-03-01', 7], 'btc|b400|s0': ['2025-04-01', 8] }) };
  const localStorage = { getItem: k => (k in stored ? stored[k] : null), setItem: (k, v) => { stored[k] = String(v); } };
  const kept = ['btc|b400|s0', 'btc|b625|s0|raw', 'usd|b625|s0.24'];
  const { c } = app({ localStorage });
  assert.deepEqual(Object.keys(c.peakStore).sort(), kept);
  assert.deepEqual(Object.keys(JSON.parse(stored.bsd_peaks_v2)).sort(), kept);
  assert.ok(stored.bsd_peaks_raw_split);
  // Once only: a pin made afterwards in normal mode at Bins 625 and Smoothing 0 survives the next visit.
  stored.bsd_peaks_v2 = JSON.stringify({ 'usd|b625|s0': ['2026-01-01', 3] });
  assert.deepEqual(Object.keys(app({ localStorage }).c.peakStore), ['usd|b625|s0']);
});
