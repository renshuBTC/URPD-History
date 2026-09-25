// Renders a full-history video the Weekly videos workflow posts to YouTube: every day in the store (store.mjs) from the first
// with anything on the chart (2010-05-18, when the first price comes into view) to the latest, in 5:00 at 60 fps
// (18,000 frames), 3840x2160, H.264. Neighbouring days are blended so the picture moves continuously however many days
// there are; the chart is the site's, drawn by page.html, with its bars coloured one of the site's two ways (looks.mjs).
//
//   node tools/video/render.mjs STORE_DIR OUT.mp4
//   env: LOOK (age, the default: each bar in its 23 age bands; lthsth: split at 150 days, <150D and >150D; raw: the
//        store's unsmoothed bars, black on a light chart),
//        FRAMES (18000), WORKERS (browser pages drawing at once: 2 with 12 GB or more, else 1), SEG (frames per segment,
//        180: a whole number of microseconds long, so at 60 fps a multiple of 3),
//        TEST_DATES (comma list: write a still of each of those days, drawn as recorded, as PNG next to OUT instead of a
//        video; a day past the store's last shows the last)
// A run stopped part way keeps its finished segments in OUT.segments, and the next run to the same OUT carries on from
// them if they were drawn for the same video (the same look, frames, segment length, days and drawing code).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readStore, firstShownIndex } from "./store.mjs";
import { look, titleStart } from "./looks.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [STORE, OUT] = process.argv.slice(2);
if (!STORE || !OUT) throw new Error("usage: render.mjs STORE_DIR OUT.mp4");
// Two pages at once need about 5 GB (a 4K page and a 4K encoder each); GitHub's runners have 16.
const F = Number(process.env.FRAMES || 18000), FPS = 60, SEG = Number(process.env.SEG || 180);
const WORKERS = Number(process.env.WORKERS || (os.totalmem() > 12e9 ? 2 : 1));
for (const [k, v] of [["FRAMES", F], ["SEG", SEG], ["WORKERS", WORKERS]]) if (!(Number.isInteger(v) && v > 0)) throw new Error(`${k} must be a whole number above 0, not ${v}`);
// The join gives each segment its duration in whole microseconds, ffmpeg's clock: a segment that is not a whole number
// of them was cut short at every join, and the video's frame rate came out a hair off 60 (which check-video.sh refuses).
if ((SEG * 1e6) % FPS !== 0) throw new Error(`SEG=${SEG}: ${SEG} frames at ${FPS} fps is not a whole number of microseconds (use a multiple of 3)`);
const TEST = process.env.TEST_DATES ? process.env.TEST_DATES.split(",") : null;
const LOOK_NAME = process.env.LOOK || "age", LOOK = look(LOOK_NAME), TITLE = titleStart(LOOK_NAME);
// A: the bands a day's source holds, the 23 age bands of the smoothed bars, or the one unsmoothed bar (RAW).
const NB = 626, A = LOOK.source === "raw" ? 1 : 23, DAY = 864e5, DAY0 = Date.UTC(2009, 0, 1);
const dayIdx = (d) => Math.round((Date.parse(d + "T00:00:00Z") - DAY0) / DAY);
const idxDay = (i) => new Date(DAY0 + i * DAY).toISOString().slice(0, 10);
const LM = [["2011-06-08", "Cycle 1 Top", 1], ["2011-11-18", "Cycle 1 Bottom", 0], ["2013-11-29", "Cycle 2 Top", 1], ["2015-01-14", "Cycle 2 Bottom", 0],
  ["2017-12-17", "Cycle 3 Top", 1], ["2018-12-15", "Cycle 3 Bottom", 0], ["2021-11-10", "Cycle 4 Top", 1], ["2022-11-21", "Cycle 4 Bottom", 0], ["2025-10-06", "Cycle 5 Top", 1]];

// ---- the days, their prices and their price-line windows ----------------------------------------------------
const store = readStore(STORE), { meta } = store;
// Days before the first with anything on the chart are left out: an empty chart with only the date moving.
const S = firstShownIndex(meta, store.bars);
// RAW draws the store's unsmoothed bars, which every day in the video must have (store.mjs adds any that are missing).
if (LOOK.source === "raw") for (let i = S; i < meta.days.length; i++) if (!store.raw(i)) throw new Error(`the store has no unsmoothed bars for ${meta.days[i][0]}: run store.mjs on it first`);
const bars = LOOK.source === "raw" ? (i) => store.raw(i + S) : (i) => store.bars(i + S);
const days = meta.days.slice(S).map(([date, X, spot, redPct]) => ({ date, w: X / (NB - 1), spot, redPct })), N = days.length;
if (N < 2) throw new Error("the store needs at least two days");
// The price line: every day's close as the store recorded it with the day's bars (store.mjs, from the closes
// tools/build-scales.cjs checks), the very price the video's price box and the site show for that day. Nothing is
// downloaded here, so no close the API gives later reaches the video unchecked, nor the day still in progress, whose
// partial close drew the line on past the video's last day. A day without a close (before the first trade) is a gap.
const close = new Array(dayIdx(meta.days[meta.days.length - 1][0]) + 1).fill(0);
for (const [date, , spot] of meta.days) if (spot > 0) close[dayIdx(date)] = spot;
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
// cum[k]: the look's layer k, per bar: the age bands before LOOK.ends[k] added up (bands 0 to k for AGE; for
// <150D/>150D the eight bands under 150 days, then all 23).
const DAYCACHE = new Map();
function dayData(i) {
  if (DAYCACHE.has(i)) return DAYCACHE.get(i);
  const b = bars(i), cum = [], acc = new Float64Array(NB);
  for (let a = 0, k = 0; a < A; a++) {
    for (let j = 0; j < NB; j++) acc[j] += b[a * NB + j];
    if (a + 1 === LOOK.ends[k]) { cum.push(Float64Array.from(acc)); k++; }
  }
  const d = { ...days[i], cum };
  DAYCACHE.set(i, d); if (DAYCACHE.size > 16) DAYCACHE.delete(DAYCACHE.keys().next().value);
  return d;
}
const lerp = (a, b, f) => a + (b - a) * f, glerp = (a, b, f) => Math.exp(lerp(Math.log(a), Math.log(b), f));
const isoAt = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
const round5 = (v) => (v === 0 ? 0 : +v.toPrecision(5));
// Frame t's figures, without its bars: the two days it blends and how far, its bar width, price and share at a loss,
// the price line's window and the moment it shows. (With exact, the day of that index itself, unblended.)
function frameFacts(t, exact) {
  const [i0, i1, f] = exact === undefined ? frameDay(t) : [exact, exact, 0], a = days[i0], b = days[i1], near = f < 0.5 ? a : b;
  const dayMs = Date.parse(a.date + "T00:00:00Z") + f * (Date.parse(b.date + "T00:00:00Z") - Date.parse(a.date + "T00:00:00Z"));
  return { i0, i1, f, date: near.date, w: glerp(a.w, b.w, f), wl: lerp(a.wl, b.wl, f), wr: lerp(a.wr, b.wr, f), tx: isoAt(dayMs),
    spot: a.spot && b.spot ? glerp(a.spot, b.spot, f) : near.spot, redPct: a.redPct !== null && b.redPct !== null ? lerp(a.redPct, b.redPct, f) : near.redPct };
}
// spec(t, i): frame t, or with i the day i itself unblended (a still), on frame t's axes raised to fit the day's bars.
function spec(t, exact) {
  const g = frameFacts(t, exact), { f, w, wl, wr, spot, redPct } = g, a = dayData(g.i0), b = dayData(g.i1), cum = [];
  for (let k = 0; k < LOOK.ends.length; k++) { const x = a.cum[k], y = b.cum[k], o = new Array(NB); for (let j = 0; j < NB; j++) o[j] = round5(x[j] + (y[j] - x[j]) * f); cum.push(o); }
  const xSpan = NB * w, xv = axisTicks(xSpan), xt = axisLabels(xv);
  xt[0] = "\u00a0\u00a0" + xt[0];                         // off the corner, clear of the left axis's $0
  const ymax = exact === undefined ? Y[t] : Math.max(Y[t], ...a.cum[a.cum.length - 1]), yt = axisTicks(ymax), ytt = axisLabels(yt);
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
  return { date: g.date, tx: g.tx, nb: NB, w, title: TITLE, labels: LOOK.labels, colors: LOOK.colors, legendSize: LOOK.legendSize, theme: LOOK.theme || "dark",
    cum, xt: { v: xv, t: xt }, ymax, yt, ytt, spot, redPct, pd, pp,
    win: [isoAt(wl), isoAt(wr)], cStr, rStr, pr: M[t] > 0 ? [0, M[t]] : null, lm, drop: DROP ? DROP[t] : 0 };
}

// ---- the price box keeps clear of the day's dot ---------------------------------------------------------------
// Near a high the dot on the price line runs under the price box, which is drawn over it. The site then moves the box
// down to just below the dot, day by day; at 60 frames a second that would make it jump down and up for a frame or
// two at a time. Here each frame's need (page.html's boxNeeds, from the same sums it draws with) is held for a second
// either side, so nearby moments share one move, and eased over a third of a second: the box slides down before the
// dot arrives and back up after it has gone. DROP[t] is how far down it is on frame t, in pixels.
let DROP = null, dropping = null;
async function boxDrops(page) {
  const facts = Array.from({ length: F }, (_, t) => { const g = frameFacts(t);
    return { spot: g.spot, redPct: g.redPct, nb: NB, w: g.w, win: [isoAt(g.wl), isoAt(g.wr)], tx: g.tx, date: g.date, pr: M[t] > 0 ? [0, M[t]] : null, theme: LOOK.theme || "dark" }; });
  const need = await page.evaluate((fr) => window.boxNeeds(fr), facts);
  const HOLD = 60, EASE = 10, held = new Float64Array(F), drop = new Float64Array(F);
  for (let t = 0; t < F; t++) if (need[t] > 0) for (let s = Math.max(0, t - HOLD); s <= Math.min(F - 1, t + HOLD); s++) if (need[t] > held[s]) held[s] = need[t];
  for (let t = 0; t < F; t++) {
    let sum = 0; for (let s = t - EASE; s <= t + EASE; s++) sum += held[Math.max(0, Math.min(F - 1, s))];
    drop[t] = Math.round(sum / (2 * EASE + 1) * 100) / 100;
  }
  const under = need.filter((v) => v > 0).length, slides = drop.filter((v, t) => v > 0 && !(drop[t - 1] > 0)).length;
  console.log(`price box: the dot runs under it on ${under} frames; it slides clear ${slides} times, down on ${drop.filter((v) => v > 0).length} frames`);
  return drop;
}

// ---- drawing: WORKERS browser pages, each encoding whole segments ----------------------------------------------
const NM = path.join(HERE, "node_modules");
const pageFile = path.join(os.tmpdir(), `urpd-video-page-${process.pid}.html`);
process.on("exit", () => fs.rmSync(pageFile, { force: true }));   // also when the render fails
fs.writeFileSync(pageFile, fs.readFileSync(path.join(HERE, "page.html"), "utf8")
  .replace("FONT400", "file://" + path.join(NM, "@fontsource/source-code-pro/files/source-code-pro-latin-400-normal.woff2"))
  .replace("FONT700", "file://" + path.join(NM, "@fontsource/source-code-pro/files/source-code-pro-latin-700-normal.woff2"))
  .replace("PLOTLY", "file://" + path.join(NM, "plotly.js-dist-min/plotly.min.js")));
const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text", "--disable-gpu", "--allow-file-access-from-files"] });
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  await page.goto("file://" + pageFile);
  await page.evaluate(() => document.fonts.load("700 20px 'Source Code Pro'").then(() => document.fonts.load("400 11px 'Source Code Pro'")));
  // the legend's height and the plot width are fixed for the whole video: measure once, then lay out to them
  const probe = await page.evaluate((s) => window.drawFrame(s), spec(F - 1));
  await page.evaluate((t) => window.setTopMargin(t), 13 + 26 + Math.ceil(probe.legendH));
  await page.evaluate((s) => window.drawFrame(s), spec(F - 1));
  const geom = await page.evaluate(() => window.fixBars());
  if (Math.abs(geom.offset * geom.dpr - Math.round(geom.offset * geom.dpr)) > 1e-6) throw new Error("plot area not on a device pixel: " + JSON.stringify(geom));
  // The box's moves, worked out once the page has its final layout (the first page to get there; the rest wait for it).
  DROP = await (dropping = dropping || boxDrops(page));
  const cdp = await page.context().newCDPSession(page);
  const shot = async () => Buffer.from((await cdp.send("Page.captureScreenshot",
    { format: "png", optimizeForSpeed: true, clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 2 }, captureBeyondViewport: false })).data, "base64");
  return { page, shot };
}
if (TEST) {
  const { page, shot } = await openPage();
  for (const d of TEST) {
    // The first day at or after d (the last day past the store's end), drawn as recorded, on the axes of the first
    // frame that reaches it.
    const k = days.findIndex((x) => x.date >= d), i = k < 0 ? N - 1 : k;
    await page.evaluate((s) => window.drawFrame(s), spec(Math.min(F - 1, Math.ceil(i * (F - 1) / (N - 1) - 1e-9)), i));
    fs.writeFileSync(OUT.replace(/\.mp4$/, "") + `_${d}.png`, await shot());
  }
  await browser.close(); process.exit(0);
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
// Absolute, as the join's list names the segments: ffmpeg reads a relative name in it against the list's own folder.
const segDir = path.resolve(OUT) + ".segments", paramsFile = path.join(segDir, "params.json");
const code = crypto.createHash("sha256");
for (const f of ["render.mjs", "page.html", "looks.mjs"]) code.update(fs.readFileSync(path.join(HERE, f)));
const params = JSON.stringify({ look: LOOK_NAME, frames: F, seg: SEG, days: N, first: days[0].date, last: days[N - 1].date, code: code.digest("hex") });
// Segments left by a run for another video (another look, frame count, segment length, store or drawing code) are
// thrown away rather than joined into this one.
if (fs.existsSync(segDir) && !(fs.existsSync(paramsFile) && fs.readFileSync(paramsFile, "utf8") === params)) fs.rmSync(segDir, { recursive: true, force: true });
fs.mkdirSync(segDir, { recursive: true });
fs.writeFileSync(paramsFile, params);
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
await browser.close();

// ---- join: each segment's exact duration (whole microseconds, see SEG above), so the joins do not drift ----------
const quote = (p) => "'" + p.replace(/'/g, "'\\''") + "'";   // the list's quoting: a ' inside is written '\''
const list = starts.map((a) => `file ${quote(segFile(a))}\nduration ${(Math.min(F, a + SEG) - a) / FPS}`).join("\n") + "\n";
fs.writeFileSync(path.join(segDir, "list.txt"), list);
await new Promise((res, rej) => {
  const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(segDir, "list.txt"),
    "-c", "copy", "-map_metadata", "-1", "-movflags", "+faststart", OUT], { stdio: ["ignore", "inherit", "inherit"] });
  p.on("close", (c) => (c === 0 ? res() : rej(new Error("concat failed: " + c))));
});
fs.rmSync(segDir, { recursive: true, force: true });
console.log(`${OUT} (${LOOK.tag}): ${F} frames, ${days[0].date} to ${days[N - 1].date}, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB in ${Math.round((Date.now() - t0) / 60000)} min`);
