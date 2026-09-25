// The chart's two quiet layers, the grid and the watermark: their contrast on the dark background (and on RAW's light
// one), the watermark's place under the bars, even gridlines at fractional pixel ratios, and the video drawing them the
// same way.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { html, scripts, app } = require('./helpers.cjs');

const page = fs.readFileSync(path.join(__dirname, '..', 'tools', 'video', 'page.html'), 'utf8');
const constant = (src, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*"(#[0-9a-f]{6})"`).exec(src); assert.ok(m, name); return m[1]; };
const GRID = constant(html, 'GRID_COLOR'), WATERMARK = constant(html, 'WATERMARK_COLOR');
const THEMES = app().c.CHART_THEMES, BG = THEMES.dark.bg;

// CIE L* of a grey sRGB colour, and white at opacity a over the background, as the browser blends it
const channel = (hex) => parseInt(hex.slice(1, 3), 16);
const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const Lstar = (v) => { const Y = lin(v); return Y <= 216 / 24389 ? 903.3 * Y : 116 * Math.cbrt(Y) - 16; };
const dL = (hex) => Lstar(channel(hex)) - Lstar(channel(BG));
const alphaOf = (hex) => (channel(hex) - channel(BG)) / (255 - channel(BG));

async function drawnLayout() {
  const h = app();
  h.c.allDates = ['2026-09-20', '2026-09-21'];
  h.c.currentIdx = 1;
  const d = h.c.buildData('2026-09-21', { all: { 30000: 2, 90000: 1 }, age: [{ 30000: 2 }, { 90000: 1 }] });
  h.c.cache[h.c.dataKey(d.dateStr)] = d;
  await h.c.loadAndRender();
  return h.element('chart').layout;
}

test('grid and watermark are greys that sit in the research ranges, the watermark quieter than the grid', () => {
  for (const hex of [GRID, WATERMARK, BG]) assert.match(hex, /^#([0-9a-f]{2})\1\1$/, hex + ' is a grey');
  // Bartram and Stone: from about 0.1 a grid over mostly empty background is usable; a white grid on dark turns into
  // a fence at 0.3 to 0.5; 0.2 is safe everywhere. The old 8 % grid sat under the usable floor.
  assert.ok(alphaOf(GRID) >= 0.1 && alphaOf(GRID) <= 0.2, `grid is white at ${alphaOf(GRID).toFixed(3)}`);
  // 50 px bold letters are far easier to see than 1 px lines, so the watermark gets less contrast than the grid,
  // but stays clearly above a just-noticeable difference.
  assert.ok(dL(WATERMARK) >= 5 && dL(WATERMARK) < dL(GRID), `watermark ΔL* ${dL(WATERMARK).toFixed(1)}, grid ${dL(GRID).toFixed(1)}`);
});

test('RAW\'s light chart: its grid and watermark are as far from white as the dark ones are from the dark background', () => {
  const L = THEMES.light;
  assert.deepEqual([L.bg, L.ink], ['#ffffff', '#000000']);
  assert.deepEqual([THEMES.dark.grid, THEMES.dark.watermark], [GRID, WATERMARK]);
  const dLw = (hex) => Lstar(255) - Lstar(channel(hex));
  for (const hex of [L.grid, L.watermark]) assert.match(hex, /^#([0-9a-f]{2})\1\1$/, hex + ' is a grey');
  assert.ok(Math.abs(dLw(L.grid) - dL(GRID)) < 3, `grid ΔL* ${dLw(L.grid).toFixed(1)} on white, ${dL(GRID).toFixed(1)} on dark`);
  assert.ok(Math.abs(dLw(L.watermark) - dL(WATERMARK)) < 3, `watermark ΔL* ${dLw(L.watermark).toFixed(1)} on white, ${dL(WATERMARK).toFixed(1)} on dark`);
  const black = (255 - channel(L.grid)) / 255;
  assert.ok(black >= 0.1 && black <= 0.2, `grid is black at ${black.toFixed(3)}`);
  assert.ok(dLw(L.watermark) < dLw(L.grid), 'the watermark quieter than the grid here too');
});

test('the watermark is drawn under the grid and the bars, never as an annotation over them', async () => {
  const layout = await drawnLayout();
  assert.ok(!layout.annotations.some((a) => /RenshuBTC/.test(a.text)), 'no watermark annotation (annotations are drawn over the bars)');
  const marks = layout.shapes.filter((s) => s.label && /RenshuBTC/.test(s.label.text));
  assert.equal(marks.length, 1);
  const [wm] = marks;
  assert.equal(wm.layer, 'below', 'under the gridlines and the traces');
  assert.deepEqual([wm.xref, wm.yref, wm.x0, wm.x1, wm.y0, wm.y1], ['paper', 'paper', 0, 1, 0, 1], 'centred on the plot area');
  assert.equal(wm.line.width, 0); assert.equal(wm.fillcolor, 'rgba(0,0,0,0)');
  assert.equal(wm.label.font.color, WATERMARK); assert.equal(wm.label.font.size, 50);
  assert.equal(layout.xaxis.gridcolor, GRID); assert.equal(layout.yaxis.gridcolor, GRID);
});

test('gridlines are anti-aliased only where a CSS pixel is not a whole number of device pixels', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /html\.dpr-fractional #chart \.gridlayer path \{ shape-rendering: geometricPrecision; \}/);
  assert.doesNotMatch(css.replace(/html\.dpr-fractional #chart \.gridlayer path/, ''), /gridlayer/, 'no unconditional gridline rule');
  const head = scripts.find((s) => s.includes('dpr-fractional'));
  for (const [dpr, fractional] of [[1, false], [2, false], [3, false], [1.25, true], [1.5, true], [0.9, true], [2.625, true]]) {
    const classes = new Set(), listeners = {};
    const c = vm.createContext({
      screen: { width: 1920, height: 1080 }, devicePixelRatio: dpr, matchMedia: () => ({ matches: false }),
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      document: { documentElement: { classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } } } }
    });
    c.window = c;
    vm.runInContext(head, c);
    assert.equal(classes.has('dpr-fractional'), fractional, `devicePixelRatio ${dpr}`);
    c.devicePixelRatio = fractional ? 2 : 1.25;       // browser zoom or another screen: checked again on resize
    listeners.resize.forEach((fn) => fn());
    assert.equal(classes.has('dpr-fractional'), !fractional, `after a resize to ${c.devicePixelRatio}`);
  }
});

test('the video draws the grid and the watermark exactly as the site does, in both themes', () => {
  assert.equal(constant(page, 'GRID_COLOR'), GRID);
  assert.equal(constant(page, 'WATERMARK_COLOR'), WATERMARK);
  assert.doesNotMatch(page, /RenshuBTC<\/span>|rgba\(255,255,255,0\.08\)/, 'no old watermark annotation or grid colour');
  assert.match(page, /layer: "below", line: \{ width: 0 \}, fillcolor: "rgba\(0,0,0,0\)",\s*label: \{ text: "<b>@RenshuBTC<\/b>", textposition: "middle center", font: \{ family: FONT, size: 50, color: TH\.watermark \} \}/);
  assert.equal((page.match(/gridcolor: TH\.grid/g) || []).length, 2);
  // page.html's themes are the site's (index.html CHART_THEMES), colour for colour.
  const c = vm.createContext({ window: { devicePixelRatio: 2 }, document: {}, Math, Date, String, Number, JSON });
  vm.runInContext([...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n'), c);
  for (const theme of ['dark', 'light']) {
    const video = JSON.parse(JSON.stringify(c.THEMES[theme])), site = THEMES[theme];
    for (const [k, v] of Object.entries(video)) assert.equal(v, site[k], `${theme}.${k}`);
    assert.deepEqual(Object.keys(video).sort(), Object.keys(site).filter((k) => !['creditName', 'tagBg'].includes(k)).sort(), theme);
  }
});
