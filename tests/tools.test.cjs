// The build tools' guards: data/scales.json is committed by the daily workflow without review, and the axes it
// records only grow, so one absurd value from the API would stretch every later day's axis for good.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DAY = 864e5, iso = t => new Date(t).toISOString().slice(0, 10);
// Runs build-scales against a fake API: `stamps` per day for the first cohort, `closes` per calendar day from
// 2009-01-01. The API also lists the day after the last one, as the real one lists the day in progress.
async function build(stamps, closes) {
  const { main } = require('../tools/build-scales.cjs');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-')), 'scales.json');
  const dates = Object.keys(stamps), priceDates = closes.map((_, i) => iso(Date.UTC(2009, 0, 1) + i * DAY));
  const listed = dates.concat(iso(Date.parse(dates[dates.length - 1] + 'T00:00:00Z') + DAY));
  const realFetch = global.fetch;
  global.fetch = async url => {
    const u = String(url), body =
      u.endsWith('/cost-basis/all/dates') ? listed :
      u.endsWith('/price_close/day1') ? { data: closes } :
      u.endsWith('/date/day1') ? { data: priceDates } :
      /utxos_under_1h_old\/(\d{4}-\d\d-\d\d)$/.test(u) ? stamps[u.slice(-10)] : {};
    return { ok: true, json: async () => body };
  };
  try { return await main(['--rebuild', '--until', dates[dates.length - 1], '--out', out]); }
  finally { global.fetch = realFetch; }
}

test('build-scales records ordinary days', async () => {
  const file = await build({ '2009-01-03': { 0: 50, 3: 10 }, '2009-01-04': { 0: 50, 3: 12 }, '2009-01-05': { 0: 50, 4: 12 } }, [5, 5, 5, 5, 5, 6, 6]);
  assert.equal(file.end, '2009-01-05');
});

test('build-scales refuses a cost basis far above every close so far', async () => {
  await assert.rejects(build({ '2009-01-03': { 0: 50, 3: 10 }, '2009-01-04': { 0: 50, 3: 10, 1e12: 1e-8 }, '2009-01-05': { 0: 50 } }, [5, 5, 5, 5, 5, 5, 5]),
    /2009-01-04: a cost basis of \$1000000000000/);
});

test('build-scales refuses a close far above every close before it', async () => {
  // A close ten times too high (a slip of units) on the newest day: it would stretch the price axis for good.
  await assert.rejects(build({ '2009-01-03': { 0: 50, 3: 10 }, '2009-01-04': { 0: 50, 3: 10 }, '2009-01-05': { 0: 50, 3: 10 } }, [5, 5, 5, 5, 50, 5, 5]),
    /2009-01-05: a close of \$50 is over three times/);
});
