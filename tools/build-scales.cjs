#!/usr/bin/env node
// Builds data/scales.json, the history the chart's axes need to be a function of the date alone (see "Axes
// that only grow" in index.html). Every day is binned by index.html's own code, loaded here unchanged, so the
// file and the page cannot disagree.
//
//   node tools/build-scales.cjs             extend data/scales.json to the last finished day (UTC); 23 requests
//                                           to bitview.space per new day
//   node tools/build-scales.cjs --rebuild   start again from 2009-01-03 (about 150,000 requests: use --cache)
//
//   --cache DIR     read each day's 23 cohort responses from DIR/<date>.json.gz when present, and save new ones there
//   --until DATE    stop after DATE (default: yesterday, UTC; today is still changing)
//   --seconds N     stop cleanly after about N seconds; running again carries on where it stopped
//   --out FILE      write somewhere other than data/scales.json (the tests use this)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'data', 'scales.json');
const START = '2009-01-03';

// index.html's main script, run as the body of a function rather than in a vm context: its top-level variables
// are then ordinary locals, which V8 keeps fast (as vm globals every read is an interceptor call, ten times slower).
function loadSite() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const main = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).find(s => s.includes('var BASE ='));
  if (!main) throw new Error('index.html: main script not found');
  // The page wires up its toolbar as it loads; here every element is a stand-in that accepts anything.
  const any = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : any),
    set: () => true, apply: () => any, construct: () => any
  });
  const window = { addEventListener() {} };
  const localStorage = { getItem() { return null; }, setItem() {} };
  const body = main.replace(/\ninit\(\);\s*$/, '') + `
    return {
      BASE: BASE, AGE_BANDS: AGE_BANDS, BINS_DEFAULT: BINS_DEFAULT, KERNEL_DEFAULT: KERNEL_DEFAULT,
      aggregate: aggregate, buildData: buildData, setScales: setScales, xAxisEnd: xAxisEnd, axisLevel: axisLevel,
      barValues: barValues,
      setPrices: function (close, dates) {
        priceArray = close; priceDates = dates; priceIndexByDate = {};
        for (var i = 0; i < dates.length; i++) priceIndexByDate[dates[i]] = i;
        spotCache = {};
      },
      setBinning: function (bins, pct) { NUM_BINS = bins; KERNEL_PCT = pct; }
    };`;
  // eslint-disable-next-line no-new-func
  return new Function('window', 'document', 'localStorage', 'Plotly', 'setTimeout', 'clearTimeout', body)(
    window, any, localStorage, any, () => 0, () => {});
}

async function getJSON(url, tries = 5) {
  for (let k = 1; ; k++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return await r.json();
    } catch (e) {
      if (k >= tries) throw e;
      await new Promise(res => setTimeout(res, 2000 * k));
    }
  }
}

const dayOf = date => Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(START + 'T00:00:00Z')) / 86400000);
// Rounded up, so a stored axis always clears what it was computed from.
function ceilSig(v, digits) {
  if (!(v > 0)) return 0;
  const q = Math.pow(10, Math.floor(Math.log10(v)) - digits + 1);
  return +(Math.ceil(v / q - 1e-9) * q).toPrecision(digits);
}
function lastValue(steps) { return steps.length ? steps[steps.length - 1][1] : 0; }

async function main(argv = process.argv.slice(2)) {
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rebuild') opt.rebuild = true;
    else if (argv[i] === '--cache') opt.cache = argv[++i];
    else if (argv[i] === '--until') opt.until = argv[++i];
    else if (argv[i] === '--seconds') opt.seconds = Number(argv[++i]);
    else if (argv[i] === '--out') opt.out = path.resolve(argv[++i]);
    else throw new Error('unknown option ' + argv[i]);
  }
  const OUT = opt.out || DEFAULT_OUT;
  const deadline = opt.seconds ? Date.now() + opt.seconds * 1000 : Infinity;
  const until = opt.until || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const site = loadSite();
  const [dates, close, priceDates] = await Promise.all([
    getJSON(site.BASE + '/api/series/cost-basis/all/dates'),
    getJSON(site.BASE + '/api/series/price_close/day1'),
    getJSON(site.BASE + '/api/series/date/day1')
  ]);
  const closes = close.data || close, closeDates = priceDates.data || priceDates, closeIndex = {};
  closeDates.forEach((d, i) => { closeIndex[d] = i; });
  site.setPrices(closes, closeDates);
  site.setBinning(site.BINS_DEFAULT, site.KERNEL_DEFAULT);

  let file = null;
  if (!opt.rebuild && fs.existsSync(OUT)) file = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  if (!file) file = { start: START, end: null, bins: site.BINS_DEFAULT, smoothing: site.KERNEL_DEFAULT, x: [], usd: [], btc: [] };
  if (file.bins !== site.BINS_DEFAULT || file.smoothing !== site.KERNEL_DEFAULT) throw new Error('data/scales.json was built with other defaults: use --rebuild');
  const todo = dates.filter(d => d >= START && d <= until && (!file.end || d > file.end)).sort();

  async function day(date) {
    const cached = opt.cache && path.join(opt.cache, date + '.json.gz');
    if (cached && fs.existsSync(cached)) return JSON.parse(zlib.gunzipSync(fs.readFileSync(cached)));
    const res = [];
    for (let i = 0; i < site.AGE_BANDS.length; i += 6) {   // six requests at a time, gently
      const part = await Promise.all(site.AGE_BANDS.slice(i, i + 6).map(b => getJSON(site.BASE + '/api/series/cost-basis/' + b.cohort + '/' + date)));
      res.push(...part);
    }
    if (cached) { fs.mkdirSync(opt.cache, { recursive: true }); fs.writeFileSync(cached, zlib.gzipSync(JSON.stringify(res))); }
    return res;
  }
  function save() {
    const out = Object.assign({ about: 'Axis history for index.html, one [day, value] step per change; day 0 is start. Built by tools/build-scales.cjs.' }, file);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const text = '{\n' + Object.keys(out).map(k => '"' + k + '":' + JSON.stringify(out[k])).join(',\n') + '\n}\n';
    fs.writeFileSync(OUT + '.tmp', text);
    fs.renameSync(OUT + '.tmp', OUT);
  }

  let done = 0;
  for (const date of todo) {
    if (Date.now() > deadline) break;
    const res = await day(date);
    const all = {};
    for (const c of res) for (const k in c) all[k] = (all[k] || 0) + c[k];
    const raw = { all: all, age: res };
    // The day's axis end first, stored as the page will read it, then the day binned on exactly that axis.
    let maxStamp = 0;
    for (const k in all) { const p = parseFloat(k); if (p > maxStamp && all[k] > 0) maxStamp = p; }
    site.setScales(file.end ? file : null);
    const spot = closes[closeIndex[date]];
    const X = ceilSig(site.xAxisEnd(date, maxStamp, typeof spot === 'number' && spot > 0 ? spot : null), 6);
    const d = dayOf(date);
    if (X > lastValue(file.x)) file.x.push([d, X]);
    file.end = date;
    site.setScales(file);
    const data = site.buildData(date, raw);
    for (const coin of [false, true]) {
      const level = ceilSig(site.axisLevel(site.barValues(data, coin), coin, 100), 4);
      const steps = coin ? file.btc : file.usd;
      if (level > lastValue(steps)) steps.push([d, level]);
    }
    if (++done % 50 === 0) save();
  }
  save();
  const left = todo.length - done;
  console.log(`scales: ${done} day(s) added, through ${file.end}; ${left ? left + ' still to do (run again)' : 'up to date'}; ` +
    `${file.x.length} x, ${file.usd.length} usd, ${file.btc.length} btc steps`);
  return file;
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { loadSite, ceilSig, main };
