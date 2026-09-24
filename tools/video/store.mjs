// The video's store: every day's bars (23 age bands x 626 bins, in dollars) binned by index.html's own code on the
// growing price axis of data/scales.json, plus the day's axis end, price and share of value held at a loss. A past day
// never changes (its axis is fixed once the day has passed), so the store only ever gains days. It is kept as
// meta.json plus one gzipped Float32Array per year (bars-YYYY.f32.gz), and lives as files on the "video-data" release.
//
//   node tools/video/store.mjs DIR [--cache RAWDIR] [--until DATE] [--seconds N]
//
// Adds every finished day that data/scales.json already covers (run tools/build-scales.cjs first, with the same
// --cache, so each day is downloaded once). Prints the files it changed, one per line, for the workflow to upload.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { loadSite } = require("../build-scales.cjs");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BANDS = 23, BINS = 626, PER_DAY = BANDS * BINS;

export async function getJSON(url, tries = 5) {
  for (let k = 1; ; k++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
      return await r.json();
    } catch (e) {
      if (k >= tries) throw e;
      await new Promise((res) => setTimeout(res, 2000 * k));
    }
  }
}

export function readStore(dir) {
  const metaFile = path.join(dir, "meta.json");
  // Year files without meta.json are a store that lost its index, not a new one: starting again from 2009 would mean
  // about 150,000 requests to bitview.space.
  if (!fs.existsSync(metaFile) && fs.existsSync(dir) && fs.readdirSync(dir).some((f) => /^bars-\d{4}\.f32\.gz$/.test(f))) {
    throw new Error(dir + " has year files but no meta.json: put meta.json back rather than starting again");
  }
  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8"))
    : { about: "Per-day bars for the full-history video (tools/video). days: [date, axis end X, price, % of value at a loss].", version: 1, bands: BANDS, bins: BINS, days: [] };
  const years = {};
  for (const [date] of meta.days) years[date.slice(0, 4)] = (years[date.slice(0, 4)] || 0) + 1;
  const chunks = {};
  for (const y of Object.keys(years)) {
    const b = zlib.gunzipSync(fs.readFileSync(path.join(dir, `bars-${y}.f32.gz`)));
    const f = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
    if (f.length < years[y] * PER_DAY) throw new Error(`bars-${y}.f32.gz holds ${f.length / PER_DAY} days, meta.json lists ${years[y]}`);
    // A longer year file is one whose meta.json never followed it onto the release (the workflow uploads the year
    // files first and meta.json last): its extra days are left out here and simply added again.
    chunks[y] = f.subarray(0, years[y] * PER_DAY);
  }
  // bars(i): the i-th day's 23 x 626 values, band-major
  const offsets = []; const seen = {};
  for (const [date] of meta.days) { const y = date.slice(0, 4); offsets.push([y, (seen[y] = (seen[y] || 0) + 1) - 1]); }
  const bars = (i) => { const [y, k] = offsets[i]; return chunks[y].subarray(k * PER_DAY, (k + 1) * PER_DAY); };
  return { meta, chunks, bars };
}

// The first day with bars on the chart, where the video starts (render.mjs): 2011-01-31. Before it every coin's
// recorded price rounds to $0 (bitcoin had not yet traded above about 50 cents), so there is no dollar value to draw
// and the chart holds only the price line and the date. Starting when the first price came into view (2010-05-18) that
// took the video's first 13 seconds, and starting on 2009-01-03 its first 35.
export function firstShownIndex(meta, bars) {
  for (let i = 0; i < meta.days.length; i++) if (bars(i).some((v) => v > 0)) return i;
  return 0;
}

function writeAtomic(file, buf) { fs.writeFileSync(file + ".tmp", buf); fs.renameSync(file + ".tmp", file); }

async function main() {
  const argv = process.argv.slice(2), opt = { dir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cache") opt.cache = argv[++i];
    else if (argv[i] === "--until") opt.until = argv[++i];
    else if (argv[i] === "--seconds") opt.seconds = Number(argv[++i]);   // stop early; running again carries on
    else if (!opt.dir) opt.dir = argv[i];
    else throw new Error("unknown argument " + argv[i]);
  }
  if (!opt.dir) throw new Error("usage: store.mjs DIR [--cache RAWDIR] [--until DATE]");
  fs.mkdirSync(opt.dir, { recursive: true });
  const until = opt.until || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const scales = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "scales.json"), "utf8"));
  const site = loadSite();
  const [dates, close, priceDates] = await Promise.all([
    getJSON(site.BASE + "/api/series/cost-basis/all/dates"),
    getJSON(site.BASE + "/api/series/price_close/day1"),
    getJSON(site.BASE + "/api/series/date/day1")
  ]);
  site.setPrices(close.data || close, priceDates.data || priceDates);   // checked as the page checks them
  site.setBinning(site.BINS_DEFAULT, site.KERNEL_DEFAULT);
  site.setScales(scales);

  const { meta, chunks } = readStore(opt.dir);
  const last = meta.days.length ? meta.days[meta.days.length - 1][0] : "";
  // Only days the axis history already covers, so every bar sits on the axis the site draws for that day.
  const todo = site.cleanDates(dates).filter((d) => d > last && d <= until && d <= scales.end);
  const changed = new Set();
  const added = {}, deadline = opt.seconds ? Date.now() + opt.seconds * 1000 : Infinity;
  let n = 0;
  for (const date of todo) {
    if (Date.now() > deadline) break;
    n++;
    const cached = opt.cache && path.join(opt.cache, date + ".json.gz");
    let res;
    if (cached && fs.existsSync(cached)) res = JSON.parse(zlib.gunzipSync(fs.readFileSync(cached))).map(site.cleanCohort);
    else {
      res = [];
      for (let i = 0; i < site.AGE_BANDS.length; i += 6) {
        res.push(...(await Promise.all(site.AGE_BANDS.slice(i, i + 6).map((b) => getJSON(site.BASE + "/api/series/cost-basis/" + b.cohort + "/" + date)))).map(site.cleanCohort));
      }
      if (cached) { fs.mkdirSync(opt.cache, { recursive: true }); fs.writeFileSync(cached, zlib.gzipSync(JSON.stringify(res))); }
    }
    const all = {};
    for (const c of res) for (const k in c) all[k] = (all[k] || 0) + c[k];
    const data = site.buildData(date, { all, age: res });
    if (!data.aggAge || data.aggAge.length !== BANDS) throw new Error(date + ": expected " + BANDS + " age bands");
    const f = new Float32Array(PER_DAY);
    data.aggAge.forEach((c, a) => { for (let j = 0; j < BINS; j++) f[a * BINS + j] = c.agg[j].invested; });
    const y = date.slice(0, 4);
    (added[y] = added[y] || []).push(f);
    meta.days.push([date, +(data.binWidth * site.BINS_DEFAULT).toPrecision(9), data.spot > 0 ? data.spot : null,
      data.redPct === null ? null : +data.redPct.toFixed(4)]);
  }
  for (const y of Object.keys(added)) {
    const old = chunks[y] || new Float32Array(0), f = new Float32Array(old.length + added[y].length * PER_DAY);
    f.set(old); added[y].forEach((d, k) => f.set(d, old.length + k * PER_DAY));
    const file = path.join(opt.dir, `bars-${y}.f32.gz`);
    writeAtomic(file, zlib.gzipSync(Buffer.from(f.buffer, f.byteOffset, f.byteLength), { level: 9 }));
    changed.add(file);
  }
  if (n) { writeAtomic(path.join(opt.dir, "meta.json"), JSON.stringify(meta)); changed.add(path.join(opt.dir, "meta.json")); }
  process.stderr.write(`store: ${n} day(s) added, ${meta.days.length} in all, through ${meta.days.length ? meta.days[meta.days.length - 1][0] : "-"}` +
    (n < todo.length ? `; ${todo.length - n} still to do (run again)` : "") + "\n");
  for (const f of changed) process.stdout.write(f + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
