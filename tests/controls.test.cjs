// The toolbar's controls: the date box, the step sizes, the settings fields, pins, AGE or <150D/>150D, the two video
// buttons and the languages. Each test here pins down a bug the 2026-09-24 audit found.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { html, scripts, app, flush } = require('./helpers.cjs');

const plain = v => JSON.parse(JSON.stringify(v));   // out of the page's realm, for deepEqual
// The page's stylesheet, comments stripped, as rules; decls(sel) is every declaration given to exactly that selector.
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const rules = css.split('}').map(r => r.split('{')).filter(r => r.length === 2)
  .map(([sel, body]) => ({ sels: sel.split(',').map(x => x.trim().replace(/\s+/g, ' ')), body: body.trim() }));
const decls = sel => {
  const found = rules.filter(r => r.sels.includes(sel));
  assert.ok(found.length, 'no rule for ' + sel);
  return found.map(r => r.body).join('; ');
};
const props = sel => Object.fromEntries(decls(sel).split(';').map(d => d.split(':')).filter(p => p.length > 1)
  .map(([k, ...v]) => [k.trim(), v.join(':').trim()]));
const main = scripts.find(s => s.includes('var BASE ='));
function section(start, end) {
  const a = main.indexOf(start), b = main.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing ${start} .. ${end}`);
  return main.slice(a, b);
}
function days(from, to) {
  const out = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 864e5) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
// The app with its date list, drawing stubbed out: navigation only records where it was sent.
function navApp(dates) {
  const h = app(), loads = [];
  h.c.allDates = dates;
  h.c.loadAndRender = () => { loads.push(h.c.allDates[h.c.currentIdx]); h.c.lastRenderedData = { dateStr: h.c.allDates[h.c.currentIdx] }; return Promise.resolve(); };
  return Object.assign(h, { loads });
}

test('1W, 1M and 1Y are calendar steps, and never skip a listed day or stall on a gap', () => {
  const dates = ['2009-01-03', '2009-01-09', '2009-01-10', '2009-01-11'].concat(days('2009-01-12', '2011-03-31'));
  const h = navApp(dates), { c } = h;
  const at = d => dates.indexOf(d), step = (from, dir) => dates[Math.max(0, Math.min(dates.length - 1, c.stepTarget(at(from), dir)))];
  c.setInterval1(2);   // 1M
  assert.equal(step('2010-01-31', 1), '2010-02-28', 'February is not skipped');
  assert.equal(step('2010-03-31', -1), '2010-02-28');
  assert.equal(step('2010-02-28', 1), '2010-03-28');
  c.setInterval1(3);   // 1Y
  assert.equal(step('2009-01-03', 1), '2010-01-03', 'a year from the first day, across the gap in early 2009');
  assert.equal(step('2010-06-15', -1), '2009-06-15');
  assert.equal(step('2009-01-09', -1), '2009-01-03', 'before the history starts: its first day');
  c.setInterval1(1);   // 1W
  assert.equal(step('2009-01-03', 1), '2009-01-10', 'the first listed day on or after a week on');
  assert.equal(step('2009-01-12', -1), '2009-01-03', 'the last listed day on or before a week back');
  c.setInterval1(0);   // 1D: the next listed day
  assert.equal(step('2009-01-03', 1), '2009-01-09');
});

test('prefetch fetches the next steps of the selected size, not the neighbouring days', async () => {
  const dates = days('2022-01-01', '2026-09-20');
  const h = navApp(dates), { c } = h, fetched = [];
  vm.runInContext(section('var PREFETCH_AHEAD = 2;', 'function loadAndRender('), c);
  c.fetchRaw = d => { fetched.push(d); return Promise.resolve({}); };
  c.setInterval1(3);
  c.currentIdx = dates.indexOf('2026-09-20');
  c.prefetchPrev = dates.indexOf('2026-09-20') + 1;   // walking back
  c.schedulePrefetch();
  h.runTimer([...h.timers.keys()].at(-1));
  await flush();
  assert.deepEqual(fetched, ['2025-09-20', '2024-09-20']);
});

test('a failed first draw can be retried with the same key, and an already drawn day is not reloaded', () => {
  const h = navApp(days('2026-09-01', '2026-09-10')), { c } = h;
  c.currentIdx = 9; c.lastRenderedData = null;
  c.goTo(9);
  assert.equal(h.loads.length, 1, 'nothing on screen yet: pressing End again retries');
  c.goTo(9);
  assert.equal(h.loads.length, 1, 'now it is drawn: nothing to do');
});

test('Up and Down, or W and S, change the step size one at a time, round and round; the weighting stays as it is', () => {
  const { c, docListeners } = app();
  const press = (key, extra = {}) => { let prevented = false; docListeners.keydown[0]({ key, target: { tagName: 'BODY' }, preventDefault() { prevented = true; }, ...extra }); return prevented; };
  const up = [], down = [];
  for (const k of ['ArrowUp', 'w', 'W', 'ArrowUp']) { assert.ok(press(k), k); up.push(c.stepIdx); }
  assert.deepEqual(up, [1, 2, 3, 0], '1W, 1M, 1Y, then 1D again');
  for (const k of ['ArrowDown', 's', 'S', 'ArrowDown']) { assert.ok(press(k), k); down.push(c.stepIdx); }
  assert.deepEqual(down, [3, 2, 1, 0], '1Y, 1M, 1W, 1D');
  assert.equal(c.coinMode, false, 'USD/BTC is left to its buttons');
  assert.equal(c.viewIdx, 0);
  assert.equal(c.splitMode, false);
  // The browser keeps its own shortcuts (Ctrl+S saves the page).
  assert.equal(press('s', { ctrlKey: true }), false);
  assert.equal(c.stepIdx, 0);
});

test('the settings fields take a number and nothing else', () => {
  const { c } = app();
  const cases = { '1,000': NaN, '1e3': 1000, '400abc': NaN, ' 625 ': 625, '６２５': 625, '': NaN, '0.24': 0.24, '-': NaN };
  for (const [typed, want] of Object.entries(cases)) assert.ok(Object.is(c.fieldNumber(typed), want), typed);
});

test('a pin is kept per weighting, bin count and smoothing, and PIN Y-AXIS does nothing before the first chart', () => {
  const { c, element } = app();
  c.coinMode = true;
  assert.equal(c.peakKey({ numBins: 625, kernelPct: 0 }), 'btc|b625|s0');
  c.coinMode = false;
  assert.equal(c.peakKey({ numBins: 400, kernelPct: 0.24 }), 'usd|b400|s0.24');
  c.lastRenderedData = null;
  c.peakStore = { 'usd|b625|s0.24': ['2026-01-01', 5] };
  element('btnPeak').onclick();
  assert.deepEqual(plain(c.peakStore), { 'usd|b625|s0.24': ['2026-01-01', 5] }, 'a saved pin is not deleted');
});

test('every text has all three languages', () => {
  const { c } = app();
  const langs = ['en', 'zh', 'ja'], keys = new Set(langs.flatMap(l => Object.keys(c.T[l])));
  for (const l of langs) for (const k of keys) assert.ok(typeof c.T[l][k] === 'string' && c.T[l][k].length, `${l}.${k}`);
});

test('there is no download button, and the bar is drawn like the favicon: black and white, square, the chosen option inverted', () => {
  assert.doesNotMatch(html, /id="videoBtn"|#videoBtn/, 'no video download (security.test.cjs checks every link)');
  // The bar is the greyish black it always had (#1a1a1a), drawn in black and white on it.
  assert.match(decls('#controls'), /background:\s*#1a1a1a;/);
  // Every button and link: the bar's grey, a 1px outline of white at 35% (#595959), solid white under the mouse,
  // square corners; the chosen option is a white block with black text.
  for (const sel of ['#controls button', '#controls #githubLink', '#controls .yt-btn']) {
    assert.match(decls(sel), /background:\s*#1a1a1a;\s*color:\s*#fff;\s*border:\s*1px solid #595959;\s*border-radius:\s*0;/, sel);
  }
  for (const sel of ['#controls button:hover', '#controls #githubLink:hover', '#controls .yt-btn:hover', '#explainBtn:hover', '#langBtn:hover']) {
    assert.match(decls(sel), /border-color:\s*#fff/, sel);
  }
  assert.match(decls('#controls .mode-toggle button.active'), /background:\s*#fff;\s*color:\s*#000;\s*border-color:\s*#fff/);
  assert.match(decls('#intervalBar .iv.active'), /background:\s*#fff;\s*color:\s*#000/);
  // The step bar and the cycle list are framed the same way; the list's frame doubles while it has focus.
  assert.match(decls('#intervalBar'), /border:\s*1px solid #595959;\s*border-radius:\s*0/);
  assert.match(decls('#landmarks'), /background:\s*#1a1a1a;.*border:\s*1px solid #595959;.*border-radius:\s*0/);
  assert.match(decls('#landmarks:hover'), /border-color:\s*#fff/);
  assert.match(decls('#landmarks:focus'), /border-color:\s*#fff;\s*box-shadow:\s*inset 0 0 0 1px #fff/);
  // Nothing in the bar is orange, lighter grey or rounded any more.
  const bar = rules.filter(r => r.sels.some(x => /^(#controls|#intervalBar|#landmarks|#dateDisplay|\.yt-|#githubLink|#explainBtn|#langBtn|\.ctrl-sep|\.mode-toggle)/.test(x)));
  for (const r of bar) assert.doesNotMatch(r.body, /#ff8c00|#ffaa33|#3a3a3a|#252525|#1e1e1e|#d4d4d4|#555\b|#888|border-radius:\s*[1-9]/, r.sels.join(','));
  // The favicon stays the tab's icon only: no mark in the bar, which starts with the step sizes.
  assert.match(html, /<div id="controls">\s*<div id="intervalBar">/);
  assert.doesNotMatch(html, /brandMark/);
  // Keyboard focus: the browser's ring on buttons, a white ring on the links. (A mouse click lets go of focus, so
  // none of this is ever drawn for the mouse; see ui.test.cjs.)
  assert.ok(!rules.some(r => r.sels.some(x => /^#controls (button|a|select):focus$/.test(x))), 'focus rings are not switched off');
  for (const sel of ['#githubLink:focus-visible', '.yt-btn:focus-visible']) assert.match(decls(sel), /outline:\s*2px solid #fff/, sel);
  assert.equal(rules.filter(r => /background-color:\s*#(4a4a4a|ffc266)/.test(r.body)).length, 0, 'no focus fills');
});

test('the day counter looks like the cycle list: same frame, grey text, normal weight, and a box that holds still', async () => {
  const counter = props('#dateDisplay'), list = props('#landmarks');
  for (const k of ['background', 'color', 'border', 'border-radius']) assert.equal(counter[k], list[k], k);
  assert.equal(counter['font-weight'], 'normal');
  assert.equal(counter.height, '24px', 'as tall as the list and the buttons');
  assert.match(decls('#controls #dateDisplay'), /font-size:\s*12px/);
  assert.ok(!rules.some(r => r.sels.some(x => /#dateDisplay:hover/.test(x))), 'no hover state: it is not a control');
  // N/N is 2 × digits + 1 characters of a monospace font, and 18px is its padding and border (0 8px, 1px).
  assert.match(counter.padding, /^0 8px$/);
  for (const [n, width] of [[3, 'calc(3ch + 18px)'], [150, 'calc(7ch + 18px)'], [6469, 'calc(9ch + 18px)']]) {
    const h = app(), dates = days('2009-01-03', '2030-01-01').slice(0, n);
    h.c.fetchJSON = url => Promise.resolve(url.endsWith('/all/dates') ? dates : null);
    h.c.loadAndRender = () => Promise.resolve();
    await h.c.init();
    assert.equal(h.element('dateDisplay').style.minWidth, width, n + ' days');
  }
});

test('the two video buttons always show: FULL HISTORY IN 5 MIN (AGE) and (<150D/>150D), each its latest video others can watch, else the channel', async () => {
  const CHANNEL = 'https://www.youtube.com/channel/UC1jY5BEQXSetr93AbZNDbwg';
  // as the markup writes them: the <150D/>150D button also holds the short name its tag gives way to in a narrow bar
  const BUTTONS = [['ytBtn', 'ytLabel', '<span id="ytTag" class="yt-tag">([^<]+)</span>', 'AGE'],
    ['ytSplitBtn', 'ytSplitLabel', '<span class="yt-tag"><span id="ytSplitTag" class="yt-tag-full">([^<]+)</span><span class="yt-tag-short">150D</span></span>', '&lt;150D/&gt;150D']];
  for (const [id, label, tag, name] of BUTTONS) {
    const a = html.match(new RegExp(`<a id="${id}" class="yt-btn" href="([^"]+)" target="_blank" rel="noopener noreferrer" aria-label="([^"]+)" title="([^"]+)">(<svg[\\s\\S]*?</svg>)<span id="${label}" class="yt-word">Full history in 5 min</span>${tag}</a>`));
    assert.ok(a, id + ': a visible link that opens in a new tab: the play symbol, the words and which video, named for screen readers and tooltips');
    assert.equal(a[1], CHANNEL, 'the channel until the page learns of a video');
    assert.equal(a[5], name);
    assert.equal(a[2], `Full history in 5 min (${name}): on YouTube once YouTube lets others watch it; until then this opens the channel (new tab)`);
    assert.equal(a[2], a[3]);
    assert.match(a[4], /aria-hidden="true"/);
    assert.equal(a[4].replace(/<[^>]*>/g, '').trim(), '', 'the icon is only a picture');
  }
  assert.ok(html.indexOf('id="ytBtn"') < html.indexOf('id="ytSplitBtn"'), 'AGE first, <150D/>150D on its right');
  assert.doesNotMatch(html, /\.yt-btn\[hidden\]|#ytBtn\[hidden\]|el\.hidden/, 'never hidden');
  assert.match(decls('#controls .yt-btn'), /border:\s*1px solid #595959/);
  assert.match(decls('#controls .yt-btn:hover'), /border-color:\s*#fff/);
  assert.match(decls('.yt-btn:focus-visible'), /outline:\s*2px solid #fff/);
  // The bracketed name: (AGE) and (<150D/>150D) beside the words, and on their own where the words give way.
  assert.match(decls('#controls .yt-tag::before'), /content:\s*"\("/);
  assert.match(decls('#controls .yt-tag::after'), /content:\s*"\)"/);
  assert.match(decls('#controls.compact-more .yt-word'), /display:\s*none/);
  assert.match(decls('#controls.compact-more .yt-tag::before'), /content:\s*none/);
  // data/youtube.json names each video once others can watch it; anything else leaves that button on the channel.
  const { c, element } = app(), age = element('ytBtn'), split = element('ytSplitBtn');
  c.setYouTubeLinks({ age: { id: 'dQw4w9WgXcQ', end: '2026-09-24' }, lthsth: { id: 'Abc_123-xyZ', end: '2026-09-24' } });
  assert.equal(age.href, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(split.href, 'https://www.youtube.com/watch?v=Abc_123-xyZ');
  assert.equal(age.title, 'Full history in 5 min (AGE): every day since 2010 as one 4K video, the bars coloured by age band, on YouTube (opens in a new tab)');
  assert.equal(split.title, 'Full history in 5 min (<150D/>150D): every day since 2010 as one 4K video, the bars split at 150 days, on YouTube (opens in a new tab)');
  for (const el of [age, split]) assert.equal(el.getAttribute('aria-label'), el.title);
  for (const [lang, words, ageTag, splitTag, want] of [
    ['zh', '5 分钟看完整历史', '年龄', '<150D/>150D', '5 分钟看完整历史（年龄）：2010 年以来的每一天，一段 4K 视频，柱子按币龄层着色，在 YouTube 上观看（在新标签页中打开）'],
    ['ja', '全期間を5分で', '年齢', '<150D/>150D', '全期間を5分で（年齢）：2010年以降の毎日を 1 本の 4K 動画にまとめ、棒を年齢帯で色分けして YouTube で（新しいタブで開きます）']]) {
    c.lang = lang; c.labelYouTube();
    assert.equal(age.title, want, lang);
    assert.equal(element('ytLabel').textContent, words, lang);
    assert.equal(element('ytSplitLabel').textContent, words, lang);
    assert.equal(element('ytTag').textContent, ageTag, lang);
    assert.equal(element('ytSplitTag').textContent, splitTag, lang);
    assert.ok(age.title.startsWith(words) && split.title.startsWith(words), lang + ': the spoken name starts with the words on the button');
    assert.ok(split.title.includes(splitTag), lang);
  }
  c.lang = 'en'; c.labelYouTube();
  assert.equal(element('ytTag').textContent, 'AGE');
  assert.equal(element('ytSplitTag').textContent, '<150D/>150D');
  const channel = n => `Full history in 5 min (${n}): on YouTube once YouTube lets others watch it; until then this opens the channel (new tab)`;
  for (const bad of [null, {}, { id: null }, { id: 'javascript:x' }, { id: 'short' }, { id: 'dQw4w9WgXcQ"x' }, { id: 12345678901 }, 'dQw4w9WgXcQ']) {
    c.setYouTubeLinks({ age: { id: 'dQw4w9WgXcQ' }, lthsth: { id: 'dQw4w9WgXcQ' } });
    c.setYouTubeLinks({ age: bad, lthsth: bad });
    assert.equal(age.href, CHANNEL, JSON.stringify(bad));
    assert.equal(split.href, CHANNEL, JSON.stringify(bad));
    assert.equal(age.title, channel('AGE'), JSON.stringify(bad));
    assert.equal(split.title, channel('<150D/>150D'), JSON.stringify(bad));
  }
  for (const bad of [null, 'x', 5, []]) { c.setYouTubeLinks(bad); assert.equal(age.href, CHANNEL); assert.equal(split.href, CHANNEL); }
  // One video without the other: each button on its own.
  c.setYouTubeLinks({ age: null, lthsth: { id: 'Abc_123-xyZ', end: '2026-09-24' } });
  assert.equal(age.href, CHANNEL);
  assert.equal(split.href, 'https://www.youtube.com/watch?v=Abc_123-xyZ');
  // The one-video file from before (its id at the top level) was the AGE video.
  c.setYouTubeLinks({ id: 'dQw4w9WgXcQ', end: '2026-09-24' });
  assert.equal(age.href, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(split.href, CHANNEL);
  for (const [lang, want] of [['zh', '5 分钟看完整历史（<150D/>150D）：YouTube 允许其他人观看后即可在此观看；在此之前打开 YouTube 频道（在新标签页中打开）'], ['ja', '全期間を5分で（<150D/>150D）：YouTube で公開されるまでは、代わりにチャンネルを開きます（新しいタブで開きます）']]) {
    c.lang = lang; c.labelYouTube();
    assert.equal(split.title, want, lang);
    assert.equal(split.getAttribute('aria-label'), want, lang);
  }
  // The page asks for it on its own, and a missing file changes nothing else.
  for (const found of [true, false]) {
    const h = app(), asked = [];
    h.element('ytBtn').href = CHANNEL; h.element('ytSplitBtn').href = CHANNEL;   // as the page starts
    const yt = () => (found ? Promise.resolve({ age: { id: 'dQw4w9WgXcQ' }, lthsth: { id: 'Abc_123-xyZ' } }) : Promise.reject(new Error('HTTP 404')));
    h.c.fetchJSON = url => { asked.push(url); return url === 'data/youtube.json' ? yt() : Promise.resolve(url.endsWith('/all/dates') ? days('2026-09-20', '2026-09-24') : null); };
    h.c.loadAndRender = () => Promise.resolve();
    await h.c.init(); await flush();
    assert.equal(asked[0], 'data/youtube.json');
    assert.equal(h.c.allDates.length, 5, 'the chart loads either way');
    assert.equal(h.element('ytBtn').href, found ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' : CHANNEL);
    assert.equal(h.element('ytSplitBtn').href, found ? 'https://www.youtube.com/watch?v=Abc_123-xyZ' : CHANNEL);
  }
});

test('data/youtube.json names each video by its YouTube id, or none yet', () => {
  const fs = require('node:fs'), path = require('node:path');
  const yt = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'youtube.json'), 'utf8'));
  assert.deepEqual(Object.keys(yt), ['about', 'age', 'lthsth']);
  for (const k of ['age', 'lthsth']) {
    if (yt[k] === null) continue;
    assert.deepEqual(Object.keys(yt[k]), ['id', 'end'], k);
    assert.match(yt[k].id, /^[A-Za-z0-9_-]{11}$/, k);
    assert.match(yt[k].end, /^\d{4}-\d{2}-\d{2}$/, k);
  }
});

test('AGE | <150D/>150D sits right of USD | BTC and only recolours the bars: <150D amber under >150D blue', async () => {
  // The markup: its own group, after the weighting and before Pin Y-axis, AGE chosen at first.
  const group = html.match(/<div class="mode-toggle">\s*<button id="btnUSD"[\s\S]*?<\/div>\s*<div class="ctrl-sep"><\/div>\s*<div class="mode-toggle">\s*(<button id="btnAge"[^>]*>AGE<\/button>)\s*(<button id="btnSplit"[^>]*>&lt;150D\/&gt;150D<\/button>)\s*<\/div>\s*<div class="ctrl-sep"><\/div>\s*<div class="mode-toggle">\s*<button id="btnPeak"/);
  assert.ok(group, 'USD | BTC, then AGE | <150D/>150D, then Pin Y-axis');
  assert.match(group[1], /class="active" aria-pressed="true"/);
  assert.match(group[2], /aria-pressed="false"/);
  const { c, element } = app();
  assert.equal(c.STH_BANDS, 8, '<1h to 4m-5m: the coins that moved within 150 days');
  assert.deepEqual([c.AGE_BANDS[7].label, c.AGE_BANDS[8].label], ['4m-5m', '5m-6m']);
  assert.equal(c.STH_COLOR, '#e6a817');
  assert.equal(c.LTH_COLOR, '#5599ff');
  // A day whose coins sit in three bands: two young (bands 0 and 7), one old (band 8).
  const dates = days('2026-09-20', '2026-09-24');
  c.allDates = dates; c.priceDates = dates.slice(); c.priceIndexByDate = Object.fromEntries(dates.map((d, i) => [d, i]));
  c.priceArray = dates.map(() => 60000); c.currentIdx = 4;
  const age = c.AGE_BANDS.map(() => ({}));
  age[0] = { 50000: 1 }; age[7] = { 50000: 2, 70000: 1 }; age[8] = { 50000: 4 };
  const all = { 50000: 7, 70000: 1 };
  let fetched = 0;
  c.fetchRaw = () => { fetched++; return Promise.resolve({ all, age }); };
  await c.loadAndRender();
  let graph = element('chart'), bars = graph.data.filter(t => t.type === 'bar');
  assert.equal(bars.length, 23, 'AGE: one trace a band');
  assert.match(graph.layout.title.text, /^<b>Bitcoin Supply by Price When Last Moved \(USD Value, AGE\) as of /);
  const ageTotals = bars[0].y.map((_, i) => bars.reduce((s, b) => s + b.y[i], 0));
  // <150D/>150D: the same day drawn again from the cache, with two traces that add up to the same bars.
  element('btnSplit').onclick();
  await c.chartRenderPromise;
  assert.equal(c.splitMode, true);
  assert.equal(fetched, 1, 'nothing fetched again');
  assert.equal(element('btnSplit').getAttribute('aria-pressed'), 'true');
  assert.equal(element('btnAge').getAttribute('aria-pressed'), 'false');
  graph = element('chart'); bars = graph.data.filter(t => t.type === 'bar');
  assert.deepEqual(plain(bars.map(b => [b.meta, b.name, b.marker.color])), [['sth', '&lt;150D', '#e6a817'], ['lth', '&gt;150D', '#5599ff']], 'escaped: Plotly reads < as markup');
  assert.equal(graph.layout.barmode, 'stack');
  assert.equal(graph.layout.legend.font.size, 12);
  assert.match(graph.layout.title.text, /^<b>Bitcoin Supply by Price When Last Moved \(USD Value, &lt;150D\/&gt;150D\) as of /);
  const sth = bars[0].y.reduce((s, v) => s + v, 0), lth = bars[1].y.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sth - (50000 * 3 + 70000)) < 1e-3, 'bands 0 and 7, in dollars');
  assert.ok(Math.abs(lth - 50000 * 4) < 1e-3, 'band 8');
  bars[0].y.forEach((v, i) => assert.ok(Math.abs(v + bars[1].y[i] - ageTotals[i]) < 1e-6 * (1 + ageTotals[i]), 'the same bars'));
  assert.match(bars[0].hovertemplate, /<br>&lt;150D: %\{y:\$,\.0f\}<br>Total Value When Last Moved: /);
  assert.equal(bars[0].customdata, bars[1].customdata, 'the whole bar\'s hover, shared');
  // Each weighting has its title in each language.
  c.coinMode = true; await c.rerenderCurrent();
  assert.match(element('chart').layout.title.text, /^<b>Bitcoin Supply by Price When Last Moved \(BTC, &lt;150D\/&gt;150D\) as of /);
  for (const [lang, want] of [['zh', '（BTC，&lt;150D/&gt;150D）截至 '], ['ja', '（BTC、&lt;150D/&gt;150D） 基準日 ']]) {
    c.lang = lang; await c.rerenderCurrent();
    assert.ok(element('chart').layout.title.text.includes(want), lang);
    assert.deepEqual(plain(element('chart').data.filter(t => t.type === 'bar').map(b => b.name)), [c.plotlyText(c.T[lang].sth), c.plotlyText(c.T[lang].lth)], lang);
  }
  c.lang = 'en'; c.coinMode = false;
  // Back to AGE; a second press of the same button changes nothing.
  element('btnAge').onclick(); await c.chartRenderPromise;
  assert.equal(element('chart').data.filter(t => t.type === 'bar').length, 23);
  const before = c.chartRenderSeq;
  element('btnAge').onclick();
  assert.equal(c.chartRenderSeq, before, 'already AGE: no redraw');
  // The buttons are named in the page's language.
  c.lang = 'ja'; c.applyLang();
  assert.equal(element('btnAge').textContent, '年齢');
  assert.equal(element('btnSplit').textContent, '<150D/>150D');
  assert.equal(element('btnSplit').title, c.T.ja.splitTitle);
});
