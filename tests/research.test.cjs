const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../research/core.js');

/* Acceptance tests for the research export core.

   IDs match sections 11 and 12 of the implementation brief. Every check is
   reported as pass, fail or unverified; an external check that cannot run here
   is skipped with its reason rather than quietly converted into a pass. */

const B = 625;
const PMAX = 126198;

/* D01 - exact bin count */
test('D01 B=625 yields 625 amounts and 626 strictly ordered edges', () => {
  const e = R.researchLinearEdges(PMAX, B);
  assert.equal(e.length, B + 1);
  R.researchAssertEdges(e, B);
  assert.equal(e[0], 0);
  assert.equal(e[B], PMAX);
  const r = R.researchBin({ 100: 1, 50000: 2 }, e, {});
  assert.equal(r.supply.length, B);
  assert.equal(r.invested.length, B);

  const lg = R.researchLogEdges(0.01, PMAX, B);
  assert.equal(lg.length, B + 1);
  R.researchAssertEdges(lg, B);
  assert.equal(lg[0], 0.01);
  assert.equal(lg[B], PMAX);
});

/* D02 - boundary assignment */
test('D02 zero, every edge, interiors and the final upper endpoint land in one declared bin', () => {
  const e = R.researchLinearEdges(1000, 10);   // edges 0,100,...,1000
  assert.equal(R.researchBinIndex(e, 0), 0);
  for (let j = 0; j < 10; j++) {
    assert.equal(R.researchBinIndex(e, e[j]), j, 'left edge of bin ' + j);
    assert.equal(R.researchBinIndex(e, (e[j] + e[j + 1]) / 2), j, 'interior of bin ' + j);
  }
  // the last bin is closed so pMax itself is counted, not dropped
  assert.equal(R.researchBinIndex(e, 1000), 9);
  assert.equal(R.researchBinIndex(e, 1000.0001), -1);
  assert.equal(R.researchBinIndex(e, -1), -1);
  assert.equal(R.researchBinIndex(e, NaN), -1);
  assert.equal(R.researchBinIndex(e, Infinity), -1);

  // every observation lands in exactly one place: bins + categories = total
  const raw = { 0: 5, 100: 7, 999.9: 3, 1000: 11, 1500: 2, '-4': 1, abc: 9 };
  const r = R.researchBin(raw, e, { includeZeroInFirstBin: true });
  const binned = r.supply.reduce((a, b) => a + b, 0);
  assert.equal(binned, 5 + 7 + 3 + 11);           // zero is in bin 0 by policy
  assert.equal(r.outOfRange.supply, 2);            // 1500 is above pMax
  assert.equal(r.rejected.count, 2);               // -4 and abc
  assert.equal(r.sourceZero.supply, 5);
});

/* D03 - conservation */
test('D03 binned mass plus explicit categories reconciles with the source', () => {
  const e = R.researchLinearEdges(PMAX, B);
  const raw = { 0: 50, 0.01: 1.23, 200: 4.56, 99999: 12.34, 100000: 56.78, 126198: 90.12 };
  const r = R.researchBin(raw, e, { includeZeroInFirstBin: true });
  const expected = Object.values(raw).reduce((a, b) => a + b, 0);
  const binned = r.supply.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(binned - expected) <= expected * 1e-12, 'linear: ' + binned + ' vs ' + expected);
  assert.equal(r.outOfRange.count, 0);
  assert.equal(r.rejected.count, 0);

  // log view: zero is excluded from positive-price bins and reported separately
  const lg = R.researchLogEdges(0.01, PMAX, B);
  const rl = R.researchBin(raw, lg, { includeZeroInFirstBin: false });
  const binnedLog = rl.supply.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs((binnedLog + rl.sourceZero.supply) - expected) <= expected * 1e-12,
    'log: ' + binnedLog + ' + ' + rl.sourceZero.supply + ' vs ' + expected);
  assert.equal(rl.sourceZero.supply, 50);
});

/* D04 - independent totals. Needs the provider's separate all-supply endpoint.
   CI has no network, and comparing our own cohort sum against itself would not
   be independent validation, so this is reported unverified. */
test('D04 independent all-supply reconciliation',
  { skip: 'unverified: requires provider all-supply endpoint; no network in CI' }, () => {});

/* D05 - a fixed peak does not move when the date changes */
test('D05 a fixed source peak keeps its bin index across dates', () => {
  const e = R.researchLinearEdges(PMAX, B);
  const peak = { 64000: 1000 };
  const dayA = Object.assign({}, peak, { 10: 5 });
  const dayB = Object.assign({}, peak, { 120000: 900 });
  const jA = R.researchBin(dayA, e, {}).supply.findIndex(v => v === 1000);
  const jB = R.researchBin(dayB, e, {}).supply.findIndex(v => v === 1000);
  assert.equal(jA, jB);
  assert.equal(jA, R.researchBinIndex(e, 64000));
});

/* D06 - heights are a fixed linear mapping of amount */
test('D06 identical amounts give identical heights; larger amounts scale proportionally', () => {
  const e = R.researchLinearEdges(PMAX, B);
  const one = R.researchBin({ 64000: 100 }, e, {});
  const two = R.researchBin({ 64000: 100 }, e, {});
  const big = R.researchBin({ 64000: 250 }, e, {});
  const j = R.researchBinIndex(e, 64000);
  assert.equal(one.supply[j], two.supply[j]);
  assert.equal(big.supply[j] / one.supply[j], 2.5);
});

/* D07 - no clipping */
test('D07 the frozen Y-limit covers every stacked height in the job', () => {
  const archive = [
    { date: '2020-01-01', cohorts: [{ 100: 10, 64000: 40 }, { 100: 5 }] },
    { date: '2020-01-02', cohorts: [{ 64000: 900 }, { 64000: 100 }] }
  ];
  const cfg = R.researchPreflight(archive, { bins: 64 });
  for (const rec of archive) {
    const d = R.researchBinDate(rec.cohorts, cfg.linearEdges, { includeZeroInFirstBin: true });
    assert.ok(d.maxStacked <= cfg.yMaxLinear, rec.date + ': ' + d.maxStacked + ' > ' + cfg.yMaxLinear);
  }
  assert.ok(cfg.yMaxLinear >= 1000);
  assert.equal(cfg.clipping, 'none');
});

/* D08 - identity smoothing */
test('D08 research binning never spreads mass into neighbouring bins', () => {
  const e = R.researchLinearEdges(PMAX, B);
  const r = R.researchBin({ 64000: 123.456 }, e, {});
  const nonEmpty = [...r.supply].filter(v => v !== 0);
  assert.equal(nonEmpty.length, 1);
  assert.equal(nonEmpty[0], 123.456);
});

/* D09 - USD arithmetic uses each observation's own price */
test('D09 invested is sum(price x BTC), not bin centre x total BTC', () => {
  const e = R.researchLinearEdges(1000, 1);      // one bin spanning [0,1000]
  const r = R.researchBin({ 100: 2, 900: 1 }, e, {});
  assert.equal(r.supply[0], 3);
  assert.equal(r.invested[0], 100 * 2 + 900 * 1);    // 1100
  assert.notEqual(r.invested[0], ((0 + 1000) / 2) * 3);  // 1500, the wrong answer
});

/* D10 - source-zero, empty cohorts and failures stay distinct */
test('D10 zero price, zero amount, empty cohort and malformed data are separable', () => {
  const e = R.researchLinearEdges(PMAX, B);

  const zeroPrice = R.researchBin({ 0: 42 }, e, { includeZeroInFirstBin: true });
  assert.equal(zeroPrice.sourceZero.supply, 42);
  assert.equal(zeroPrice.supply[0], 42);
  assert.equal(zeroPrice.zeroAlsoInFirstBin, true);   // the overlap is declared

  const zeroPriceLog = R.researchBin({ 0: 42 }, R.researchLogEdges(0.01, PMAX, B), {});
  assert.equal(zeroPriceLog.sourceZero.supply, 42);
  assert.equal(zeroPriceLog.supply.reduce((a, b) => a + b, 0), 0);  // no invented epsilon
  assert.equal(zeroPriceLog.outOfRange.supply, 0);    // and not miscounted as out of range

  const emptyCohort = R.researchBin({}, e, {});       // a legitimate 200 with {}
  assert.equal(emptyCohort.totalSupply, 0);
  assert.equal(emptyCohort.rejected.count, 0);

  const zeroAmount = R.researchBin({ 500: 0 }, e, {});
  assert.equal(zeroAmount.totalSupply, 0);
  assert.equal(zeroAmount.rejected.count, 0);

  const malformed = R.researchBin({ 500: null, 600: 'x', '-1': 5 }, e, {});
  assert.equal(malformed.rejected.count, 3);
  assert.equal(malformed.totalSupply, 0);
});

/* Grid integrity guards the preflight relies on */
test('edge arrays are rejected when malformed', () => {
  assert.throws(() => R.researchLinearEdges(0, 10), /finite and > 0/);
  assert.throws(() => R.researchLinearEdges(100, 0), /positive integer/);
  assert.throws(() => R.researchLinearEdges(100, 2.5), /positive integer/);
  assert.throws(() => R.researchLogEdges(0, 100, 10), /finite and > 0/);
  assert.throws(() => R.researchLogEdges(100, 100, 10), /> pMin/);
  assert.throws(() => R.researchAssertEdges([0, 5, 3], 2), /strictly increasing/);
});

test('preflight freezes a grid that contains every observed price', () => {
  const archive = [
    { date: '2011-01-30', cohorts: [{ 0: 5269900 }] },              // all-zero-price era
    { date: '2021-07-14', cohorts: [{ 0.01: 1, 64000: 10 }], spot: 32000 },
    { date: '2026-09-18', cohorts: [{ 126198: 3 }] }
  ];
  const cfg = R.researchPreflight(archive, { bins: 100 });
  assert.equal(cfg.priceMaxObserved, 126198);
  assert.ok(cfg.pMax > 126198);
  assert.equal(cfg.pMin, 0.01);
  assert.equal(cfg.linearEdges.length, 101);
  assert.equal(cfg.logEdges.length, 101);
  assert.equal(cfg.smoothing, 'none');
  assert.ok(Object.isFrozen(cfg));
  for (const rec of archive) {
    const d = R.researchBinDate(rec.cohorts, cfg.linearEdges, { includeZeroInFirstBin: true });
    assert.equal(d.outOfRange, 0, rec.date);
  }
});

test('preflight reports the degenerate log case instead of inventing a grid', () => {
  const cfg = R.researchPreflight([{ date: 'd', cohorts: [{ 500: 1 }] }], { bins: 10 });
  assert.equal(cfg.logEdges, null);
  assert.match(cfg.logDegenerateReason, /one distinct positive price|no strictly positive/);
  assert.throws(() => R.researchPreflight([{ date: 'd', cohorts: [{ 0: 1 }] }], { bins: 10 }),
    /no positive price/);
});

/* ---- figure-level acceptance tests -------------------------------------- */

const ARCHIVE = [
  { date: '2024-01-01', cohorts: [{ 100: 10, 40000: 30 }, { 100: 5, 60000: 20 }], spot: 42000 },
  { date: '2024-01-02', cohorts: [{ 100: 12, 40000: 28 }, { 60000: 25 }], spot: 43000 }
];
const IDS = ['utxos_under_1h_old', 'utxos_over_15y_old'];
const LABELS = ['<1h', '>15y'];
const COLORS = ['#ffd700', '#1e90ff'];

function frameFor(cfg, rec, view) {
  const edges = view === 'log' ? cfg.logEdges : cfg.linearEdges;
  const zeroPolicy = { includeZeroInFirstBin: view !== 'log' };
  return {
    date: rec.date,
    spot: rec.spot,
    cohortIds: IDS, cohortLabels: LABELS, cohortColors: COLORS,
    cohorts: rec.cohorts.map(m => R.researchBin(m, edges, zeroPolicy).supply),
    credit: 'Powered by Bitcoin Research Kit'
  };
}

test('V01 the figure is exactly 3840x2160 regardless of any browser geometry', () => {
  const cfg = R.researchPreflight(ARCHIVE, { bins: 64 });
  const s = R.researchFigureSpec(cfg, frameFor(cfg, ARCHIVE[0], 'linear'), { view: 'linear' });
  assert.equal(s.layout.width, 3840);
  assert.equal(s.layout.height, 2160);
  const rect = R.researchPlotRect();
  assert.equal(rect.width, 3480);
  assert.equal(rect.height, 1710);
});

test('V02 plot rectangle, ranges and bin positions are identical across frames', () => {
  const cfg = R.researchPreflight(ARCHIVE, { bins: 64 });
  const a = R.researchFigureSpec(cfg, frameFor(cfg, ARCHIVE[0], 'linear'), { view: 'linear' });
  const b = R.researchFigureSpec(cfg, frameFor(cfg, ARCHIVE[1], 'linear'), { view: 'linear' });
  assert.deepEqual(a.layout.margin, b.layout.margin);
  assert.deepEqual(a.layout.xaxis.range, b.layout.xaxis.range);
  assert.deepEqual(a.layout.yaxis.range, b.layout.yaxis.range);
  assert.equal(a.layout.xaxis.autorange, false);
  assert.equal(a.layout.yaxis.autorange, false);
  assert.deepEqual(a.traces[0].x, b.traces[0].x);
  assert.deepEqual(a.traces[0].width, b.traces[0].width);
});

test('V03 every cohort is present and visible even when empty on that date', () => {
  const cfg = R.researchPreflight(ARCHIVE, { bins: 64 });
  const rec = { date: '2024-01-03', cohorts: [{ 40000: 10 }, {}], spot: 41000 };
  const s = R.researchFigureSpec(cfg, frameFor(cfg, rec, 'linear'), { view: 'linear' });
  assert.equal(s.traces.length, IDS.length);
  for (const t of s.traces) {
    assert.equal(t.visible, true);          // explicit, never inherited from the page
    assert.equal(t.y.length, cfg.bins);     // empty bins preserved
  }
  assert.equal(s.traces[1].y.reduce((a, b) => a + b, 0), 0);
});

test('V04 no hindsight, cumulative curve, watermark or hover UI is built at all', () => {
  const cfg = R.researchPreflight(ARCHIVE, { bins: 64 });
  const s = R.researchFigureSpec(cfg, frameFor(cfg, ARCHIVE[0], 'linear'), { view: 'linear' });
  for (const t of s.traces) {
    assert.equal(t.type, 'bar');            // no scatter overlay exists to be re-enabled
    assert.equal(t.hoverinfo, 'skip');
  }
  const text = JSON.stringify(s.layout);
  for (const banned of ['BTC/USD', '% of Total', 'RenshuBTC', 'Cycle', 'BOTTOM SIGNAL']) {
    assert.ok(text.indexOf(banned) < 0, 'layout still mentions ' + banned);
  }
  const clean = R.researchFigureSpec(cfg, frameFor(cfg, ARCHIVE[0], 'linear'), { view: 'linear', variant: 'clean' });
  assert.equal(clean.layout.showlegend, false);
  assert.equal(clean.layout.title, undefined);
  assert.equal(clean.layout.shapes.length, 0);
  assert.equal(clean.layout.annotations.length, 0);
  // identical geometry, so it is not a cropped screenshot of the annotated frame
  assert.deepEqual(clean.layout.xaxis.range, s.layout.xaxis.range);
  assert.deepEqual(clean.layout.yaxis.range, s.layout.yaxis.range);
  assert.deepEqual(clean.layout.margin, s.layout.margin);
});

test('log view uses equal widths in transformed coordinates with a linear axis', () => {
  const cfg = R.researchPreflight(ARCHIVE, { bins: 64 });
  const s = R.researchFigureSpec(cfg, frameFor(cfg, ARCHIVE[0], 'log'), { view: 'log' });
  assert.equal(s.layout.xaxis.type, 'linear');
  const w = s.traces[0].width;
  for (let j = 1; j < w.length; j++) assert.ok(Math.abs(w[j] - w[0]) < 1e-12);
  assert.ok(s.layout.yaxis.title.text.includes('log-price bin'));  // not density per dollar
  assert.ok(Math.abs(s.layout.xaxis.range[0] - Math.log10(cfg.pMin)) < 1e-12);
});

test('a config without a log grid refuses to build a log figure rather than guessing', () => {
  const cfg = R.researchPreflight([{ date: 'd', cohorts: [{ 500: 1 }] }], { bins: 8 });
  assert.equal(cfg.logEdges, null);
  assert.throws(
    () => R.researchFigureSpec(cfg, frameFor(cfg, { date: 'd', cohorts: [{ 500: 1 }] }, 'linear'), { view: 'log' }),
    /no log grid/);
});

test('log bin centres are geometric, so they sit mid-bin on a log axis', () => {
  const e = R.researchLogEdges(1, 100, 2);      // edges 1, 10, 100
  const c = R.researchBinCentres(e, true);
  assert.ok(Math.abs(c[0] - Math.sqrt(1 * 10)) < 1e-12);
  assert.ok(Math.abs(c[1] - Math.sqrt(10 * 100)) < 1e-12);
  const lin = R.researchBinCentres(e, false);
  assert.ok(Math.abs(lin[0] - 5.5) < 1e-9);     // arithmetic centre, for contrast
  const w = R.researchBinWidths(e);
  assert.ok(Math.abs(w[0] - 9) < 1e-12);
  assert.ok(Math.abs(w[1] - 90) < 1e-12);
});
