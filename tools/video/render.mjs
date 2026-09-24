// Renders the full-history video the site's download button serves: every day in the store (store.mjs) from the first
// with anything on the chart (2010-05-18, when the first price comes into view) to the latest, in 5:00 at 60 fps
// (18,000 frames), 3840x2160, H.264. Neighbouring days are blended so the picture moves continuously however many days
// there are; the chart is the site's, drawn by page.html.
//
//   node tools/video/render.mjs STORE_DIR OUT.mp4
//   env: FRAMES (18000), WORKERS (browser pages drawing at once: 2 with 12 GB or more, else 1), SEG (frames per segment, 180),
//        TEST_DATES (comma list: write stills of those days as PNG next to OUT instead of a video)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readStore, getJSON, firstShownIndex } from "./store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [STORE, OUT] = process.argv.slice(2);
if (!STORE || !OUT) throw new Error("usage: render.mjs STORE_DIR OUT.mp4");
// Two pages at once need about 5 GB (a 4K page and a 4K encoder each); GitHub's runners have 16.
const F = Number(process.env.FRAMES || 18000), FPS = 60, SEG = Number(process.env.SEG || 180);
const WORKERS = Number(process.env.WORKERS || (os.totalmem() > 12e9 ? 2 : 1));
const TEST = process.env.TEST_DATES ? process.env.TEST_DATES.split(",") : null;
const NB = 626, A = 23, DAY = 864e5, DAY0 = Date.UTC(2009, 0, 1), BASE = "https://bitview.space";
const dayIdx = (d) => Math.round((Date.parse(d + "T00:00:00Z") - DAY0) / DAY);
const idxDay = (i) => new Date(DAY0 + i * DAY).toISOString().slice(0, 10);
const PALETTE = ["#a19708", "#d25005", "#c00688", "#9505c2", "#7406dd", "#6004e6", "#5305ec", "#4907f1", "#4007f4", "#3007f7", "#0f13f8", "#002ce9",
  "#0139da", "#0142cb", "#0249bc", "#014db1", "#004ea7", "#0550a0", "#02529a", "#015392", "#025388", "#015580", "#025476"];   // index.html AGE_BAND_COLORS
const LM = [["2011-06-08", "Cycle 1 Top", 1], ["2011-11-18", "Cycle 1 Bottom", 0], ["2013-11-29", "Cycle 2 Top", 1], ["2015-01-14", "Cycle 2 Bottom", 0],
  ["2017-12-17", "Cycle 3 Top", 1], ["2018-12-15", "Cycle 3 Bottom", 0], ["2021-11-10", "Cycle 4 Top", 1], ["2022-11-21", "Cycle 4 Bottom", 0], ["2025-10-06", "Cycle 5 Top", 1]];

// ---- the days, their prices and their price-line windows ----------------------------------------------------
const { meta, bars: storeBars } = readStore(STORE);
// Days before the first with anything on the chart are left out: an empty chart with only the date moving.
const S = firstShownIndex(meta, storeBars), bars = (i) => storeBars(i + S);
const days = meta.days.slice(S).map(([date, X, spot, redPct]) => ({ date, w: X / (NB - 1), spot, redPct })), N = days.length;
if (N < 2) throw new Error("the store needs at least two days");
const [closeRes, datesRes] = await Promise.all([getJSON(BASE + "/api/series/price_close/day1"), getJSON(BASE + "/api/series/date/day1")]);
const closes = closeRes.data || closeRes, closeDates = datesRes.data || datesRes;
if (closeDates[0] !== idxDay(0)) throw new Error("price series no longer starts at " + idxDay(0));
// Closes up to the store's last day only: the API also lists the day in progress, whose partial close drew the line
// on past the video's last day and could raise the price axis. Anything but a positive finite number is a gap.
const close = closes.slice(0, dayIdx(days[N - 1].date) + 1).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
// As on the site: a one-year window whose right edge is 90 days after the day, but never more than 7 past the tip.
const tip = Date.parse(days[N - 1].date + "T00:00:00Z");
days.forEach((d) => { const sel = Date.parse(d.date + "T00:00:00Z"); d.wr = Math.min(tip + 7 * DAY, sel + 90 * DAY); d.wl = d.wr - 365 * DAY; });

// ---- per-frame axes: both only grow ---------------------------------------------------------------------------
//   Y(t): the tallest bar shown so far (the displayed bars are blends of two days)
//   M(t): the price line's top: the highest close the line has passed through so far, and the blended edge itself
const totals = (i) => { const b = bars(i), t = new Float64Array(NB); for (let a = 0; a < A; a++) for (let j = 0; j < NB; j++) t[j] += b[a * NB + j]; return t; };
const frameDay = (t) => { const u = F > 1 ? t * (N - 1) / (F - 1) : 0, i0 = Math.min(N - 1, Math.floor(u + 1e-9)), i1 = Math.min(N - 1, i0 + 1); return [i0, i1, i1 === i0 ? 0 : u - i0]; };
const priceAt = (ms) => { const x = (ms - DAY0) / DAY, k = Math.floor(x), fr = x - k, a = close[k], b = close[k + 1];
  if (!(a > 0)) return b > 0 && fr > 0.999 ? b : 0; if (!(b > 0)) return a; return a + (b - a) * fr; };
const Y = new Float64Array(F), M = new Float64Array(F);
{
  // Before any bar has a height (all of 2009 in USD) the axis reads $0 to $1, as on the site.
  let yRun = 1, mRun = 0, pk = 0, pmax = 0, c0 = null, c1 = null, loaded = -1;
  for (let k = Math.floor((days[0].wl - DAY0) / DAY); k <= Math.ceil((days[0].wr - DAY0) / DAY); k++) if (close[k] > mRun) mRun = close[k];
  for (let t = 0; t < F; t++) {
    const [i0, i1, f] = frameDay(t);
    if (i0 !== loaded) { c0 = loaded === i0 - 1 && c1 ? c1 : totals(i0); c1 = totals(i1); loaded = i0; }
    let peak = 0; for (let j = 0; j < NB; j++) { const v = c0[j] + (c1[j] - c0[j]) * f; if (v > peak) peak = v; }
    Y[t] = yRun = Math.max(yRun, peak);
    const wr = days[i0].wr + (days[i1].wr - days[i0].wr) * f, kr = Math.floor((wr - DAY0) / DAY);
    while (pk <= kr && pk < close.length) { if (close[pk] > pmax) pmax = close[pk]; pk++; }
    M[t] = mRun = Math.max(mRun, priceAt(wr), pmax);
  }
}

// ---- the site's axis labels (index.html axisTicks / axisLabels) ------------------------------------------------
function compactNumber(v, sf) {
  const r = +(+v).toPrecision(sf || 3), a = Math.abs(r);
  const u = a >= 1e12 ? [1e12, "T"] : a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : a >= 1e3 ? [1e3, "K"] : [1, ""];
  return String(+(r / u[0]).toPrecision(12)) + u[1];
}
const axisNumber = (v, sf) => (v === 0 ? "$0" : "$" + compactNumber(v, sf));
const axisTicks = (end) => Array.from({ length: 21 }, (_, k) => end * k / 20);
function axisLabels(vals) {
  const end = vals[vals.length - 1], top = 10 ** Math.floor(Math.log10(end > 0 ? end : 1));
  const clash = (l) => l.some((x, i) => i > 0 && x === l[i - 1]);
  let labels = vals.map((v) => axisNumber(v, 2));
  if (clash(labels)) labels = vals.map((v) => axisNumber(v, v >= top * (1 - 1e-9) ? 3 : 2));
  if (clash(labels)) labels = vals.map((v) => axisNumber(v, 3));
  return labels;
}

// ---- frame t: the state at fractional day u, blended between the two neighbouring days ----------------------
const DAYCACHE = new Map();
function dayData(i) {
  if (DAYCACHE.has(i)) return DAYCACHE.get(i);
  const b = bars(i), cum = [], acc = new Float64Array(NB);
  for (let a = 0; a < A; a++) { for (let j = 0; j < NB; j++) acc[j] += b[a * NB + j]; cum.push(Float64Array.from(acc)); }
  const d = { ...days[i], cum };
  DAYCACHE.set(i, d); if (DAYCACHE.size > 16) DAYCACHE.delete(DAYCACHE.keys().next().value);
  return d;
}
const lerp = (a, b, f) => a + (b - a) * f, glerp = (a, b, f) => Math.exp(lerp(Math.log(a), Math.log(b), f));
const isoAt = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
const round5 = (v) => (v === 0 ? 0 : +v.toPrecision(5));
function spec(t) {
  const [i0, i1, f] = frameDay(t), a = dayData(i0), b = dayData(i1), near = f < 0.5 ? a : b;
  const w = glerp(a.w, b.w, f), cum = [];
  for (let k = 0; k < A; k++) { const x = a.cum[k], y = b.cum[k], o = new Array(NB); for (let j = 0; j < NB; j++) o[j] = round5(x[j] + (y[j] - x[j]) * f); cum.push(o); }
  const xSpan = NB * w, xv = axisTicks(xSpan), xt = axisLabels(xv);
  xt[0] = "\u00a0\u00a0" + xt[0];                         // off the corner, clear of the left axis's $0
  const ymax = Y[t], yt = axisTicks(ymax), ytt = axisLabels(yt);
  const wl = lerp(a.wl, b.wl, f), wr = lerp(a.wr, b.wr, f);
  const cStr = idxDay(Math.floor((wl - DAY0) / DAY) - 1), rStr = idxDay(Math.ceil((wr - DAY0) / DAY) + 1), pd = [], pp = [];
  for (let k = Math.max(0, dayIdx(cStr)); k <= Math.min(dayIdx(rStr), close.length - 1); k++) if (close[k] > 0) { pd.push(idxDay(k)); pp.push(close[k]); }
  // as on the site: each marker on the line's own highest (lowest) close within a week of its date, inside the window
  const lm = [];
  for (const [d, l, top] of LM) {
    if (d < cStr || d > rStr) continue;
    let best = -1;
    for (let k = Math.max(dayIdx(d) - 7, dayIdx(cStr)); k <= Math.min(dayIdx(d) + 7, dayIdx(rStr), close.length - 1); k++)
      if (close[k] > 0 && (best < 0 || (top ? close[k] > close[best] : close[k] < close[best]))) best = k;
    if (best >= 0) lm.push({ d: idxDay(best), p: close[best], l, top: !!top });
  }
  const spot = a.spot && b.spot ? glerp(a.spot, b.spot, f) : near.spot;
  const redPct = a.redPct !== null && b.redPct !== null ? lerp(a.redPct, b.redPct, f) : near.redPct;
  const dayMs = Date.parse(a.date + "T00:00:00Z") + f * (Date.parse(b.date + "T00:00:00Z") - Date.parse(a.date + "T00:00:00Z"));
  return { date: near.date, tx: isoAt(dayMs), nb: NB, w, colors: PALETTE, cum, clip: [], xt: { v: xv, t: xt }, ymax, yt, ytt, spot, redPct, pd, pp,
    win: [isoAt(wl), isoAt(wr)], cStr, rStr, pr: M[t] > 0 ? [0, M[t]] : null, lm };
}

// ---- drawing: WORKERS browser pages, each encoding whole segments ----------------------------------------------
const NM = path.join(HERE, "node_modules");
const pageFile = path.join(os.tmpdir(), `urpd-video-page-${process.pid}.html`);
fs.writeFileSync(pageFile, fs.readFileSync(path.join(HERE, "page.html"), "utf8")
  .replace("FONT400", "file://" + path.join(NM, "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2"))
  .replace("FONT700", "file://" + path.join(NM, "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2"))
  .replace("PLOTLY", "file://" + path.join(NM, "plotly.js-dist-min/plotly.min.js")));
const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text", "--disable-gpu", "--allow-file-access-from-files"] });
const frameOf = (d) => { const i = days.findIndex((x) => x.date >= d); return Math.round(Math.max(0, i) * (F - 1) / (N - 1)); };
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  await page.goto("file://" + pageFile);
  await page.evaluate(() => document.fonts.load("700 20px 'JetBrains Mono'").then(() => document.fonts.load("400 11px 'JetBrains Mono'")));
  // the legend's height and the plot width are fixed for the whole video: measure once, then lay out to them
  const probe = await page.evaluate((s) => window.drawFrame(s), spec(F - 1));
  await page.evaluate(([t, pw]) => window.setTopMargin(t, pw), [13 + 26 + Math.ceil(probe.legendH), probe.plotW]);
  await page.evaluate((s) => window.drawFrame(s), spec(F - 1));
  const geom = await page.evaluate(() => window.fixBars());
  if (Math.abs(geom.offset * geom.dpr - Math.round(geom.offset * geom.dpr)) > 1e-6) throw new Error("plot area not on a device pixel: " + JSON.stringify(geom));
  const cdp = await page.context().newCDPSession(page);
  const shot = async () => Buffer.from((await cdp.send("Page.captureScreenshot",
    { format: "png", optimizeForSpeed: true, clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 2 }, captureBeyondViewport: false })).data, "base64");
  return { page, shot };
}
if (TEST) {
  const { page, shot } = await openPage();
  for (const d of TEST) { await page.evaluate((s) => window.drawFrame(s), spec(frameOf(d))); fs.writeFileSync(OUT.replace(/\.mp4$/, "") + `_${d}.png`, await shot()); }
  await browser.close(); fs.rmSync(pageFile, { force: true }); process.exit(0);
}
function encoder(out) {
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
    "-vf", "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p",
    "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-g", String(FPS), "-keyint_min", String(FPS), "-sc_threshold", "0",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-an", "-map_metadata", "-1", "-f", "mp4", out];
  const p = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
  let err = ""; p.stderr.on("data", (d) => { err += d; });
  const done = new Promise((res, rej) => p.on("close", (c) => (c === 0 ? res() : rej(new Error("ffmpeg " + c + ": " + err)))));
  return { p, done };
}
const write = (p, buf) => new Promise((res) => { if (p.stdin.write(buf)) res(); else p.stdin.once("drain", res); });
const segDir = OUT + ".segments";
fs.mkdirSync(segDir, { recursive: true });
const starts = []; for (let f0 = 0; f0 < F; f0 += SEG) starts.push(f0);
const segFile = (a) => path.join(segDir, `seg_${String(a).padStart(6, "0")}.mp4`);
let next = 0, doneFrames = 0; const t0 = Date.now();
async function worker() {
  const { page, shot } = await openPage();
  while (next < starts.length) {
    const a = starts[next++], b = Math.min(F, a + SEG), out = segFile(a);
    if (fs.existsSync(out)) { doneFrames += b - a; continue; }
    const enc = encoder(out + ".part");
    for (let t = a; t < b; t++) { await page.evaluate((s) => window.drawFrame(s), spec(t)); await write(enc.p, await shot()); }
    enc.p.stdin.end(); await enc.done; fs.renameSync(out + ".part", out);
    doneFrames += b - a;
    const rate = doneFrames / ((Date.now() - t0) / 1000);
    console.log(`frames ${a}-${b - 1} (${days[frameDay(a)[0]].date} .. ${days[frameDay(b - 1)[0]].date}); ${doneFrames}/${F}, ${rate.toFixed(2)} frames/s, ~${Math.round((F - doneFrames) / rate / 60)} min left`);
  }
  await page.close();
}
await Promise.all(Array.from({ length: WORKERS }, worker));
await browser.close(); fs.rmSync(pageFile, { force: true });

// ---- join: each segment's exact duration, so the joins cannot drift ---------------------------------------------
const list = starts.map((a) => `file '${segFile(a)}'\nduration ${(Math.min(F, a + SEG) - a) / FPS}`).join("\n") + "\n";
fs.writeFileSync(path.join(segDir, "list.txt"), list);
await new Promise((res, rej) => {
  const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(segDir, "list.txt"),
    "-c", "copy", "-map_metadata", "-1", "-movflags", "+faststart", OUT], { stdio: ["ignore", "inherit", "inherit"] });
  p.on("close", (c) => (c === 0 ? res() : rej(new Error("concat failed: " + c))));
});
fs.rmSync(segDir, { recursive: true, force: true });
console.log(`${OUT}: ${F} frames, ${days[0].date} to ${days[N - 1].date}, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB in ${Math.round((Date.now() - t0) / 60000)} min`);
