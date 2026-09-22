/* ============================================================================
   RESEARCH EXPORT CORE

   Pure functions for the reproducible research handoff. Nothing here touches
   the DOM, the network, localStorage or any module-level chart state, so the
   same call always returns the same answer and the whole layer is unit
   testable without a browser.

   These deliberately do NOT reuse aggregate() from index.html. That function
   bins against an implicit uniform grid derived from the selected day's maximum
   price, returns NUM_BINS + 1 entries, folds the Gaussian kernel in, and
   silently drops anything it cannot interpret. Every one of those is correct
   for the interactive chart and wrong for an archive: a bin has to mean the
   same price on every date of a job, a declared B has to produce B values, and
   an observation we cannot interpret has to be reported rather than discarded.

   Nothing in index.html imports this yet, so the public chart is unchanged.
   ========================================================================== */

var RESEARCH_SCHEMA_VERSION = "1.0.0";

/* Edges for the linear USD view: e[j] = j * pMax / B, j = 0 .. B.
   Computed from j rather than by repeated addition so the array is exactly
   reproducible and the final edge is exactly pMax rather than pMax plus
   accumulated float error. */
function researchLinearEdges(pMax, B) {
  if (!(pMax > 0) || !isFinite(pMax)) throw new Error("researchLinearEdges: pMax must be finite and > 0, got " + pMax);
  if (!(B >= 1) || B !== Math.floor(B)) throw new Error("researchLinearEdges: B must be a positive integer, got " + B);
  var e = new Array(B + 1);
  for (var j = 0; j <= B; j++) e[j] = j * pMax / B;
  e[B] = pMax;
  return e;
}

/* Edges for the log-price companion: e[j] = pMin * exp(j * ln(pMax/pMin) / B).
   Only defined for strictly positive prices. Zero-price mass is never given an
   invented epsilon to make it fit here; it is carried as its own category. */
function researchLogEdges(pMin, pMax, B) {
  if (!(pMin > 0) || !isFinite(pMin)) throw new Error("researchLogEdges: pMin must be finite and > 0, got " + pMin);
  if (!(pMax > pMin) || !isFinite(pMax)) throw new Error("researchLogEdges: pMax must be finite and > pMin, got " + pMax);
  if (!(B >= 1) || B !== Math.floor(B)) throw new Error("researchLogEdges: B must be a positive integer, got " + B);
  var lr = Math.log(pMax / pMin), e = new Array(B + 1);
  for (var j = 0; j <= B; j++) e[j] = pMin * Math.exp(j * lr / B);
  e[0] = pMin; e[B] = pMax;
  return e;
}

/* Assert an edge array is usable before a long job commits to it. */
function researchAssertEdges(edges, B) {
  if (!edges || edges.length !== B + 1) throw new Error("edges must have B+1 = " + (B + 1) + " entries, got " + (edges && edges.length));
  for (var j = 0; j <= B; j++) if (!isFinite(edges[j])) throw new Error("edge " + j + " is not finite");
  for (j = 0; j < B; j++) if (!(edges[j + 1] > edges[j])) throw new Error("edges must be strictly increasing; failed at " + j);
  return true;
}

/* Bin containing price, or -1 if it lies outside [e[0], e[B]].
   Half-open [e[j], e[j+1]) everywhere except the last bin, which is closed so
   that a price exactly equal to pMax is counted rather than dropped. Binary
   search: this runs once per source price per date, and a full-history job is
   tens of millions of calls. */
function researchBinIndex(edges, price) {
  var B = edges.length - 1;
  if (!isFinite(price) || price < edges[0] || price > edges[B]) return -1;
  if (price === edges[B]) return B - 1;
  var lo = 0, hi = B - 1;
  while (lo < hi) {
    var mid = (lo + hi + 1) >> 1;
    if (edges[mid] <= price) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/* Bin one date's raw {price: amount} map onto a frozen edge array.

   Returns exactly B supply values and B invested values, empty bins included.
   Everything that is not an ordinary positive-price observation is kept in its
   own labelled category instead of being folded into a boundary bin:

     sourceZero  amount whose source price is the literal 0. Real mass, but its
                 price semantics are unresolved upstream, so it must never be
                 silently mixed with priced mass. The linear view additionally
                 places it in bin 0 when includeZeroInFirstBin is set; it stays
                 counted here too, and the metadata records the overlap so a
                 reader cannot double count.
     outOfRange  finite positive price outside the frozen grid. If this is ever
                 non-zero the preflight picked pMax too low and the job is void.
     rejected    negative, non-finite or unparseable. Reported, never binned.

   invested is sum(price * amount) using each observation's own source price,
   not the bin centre times the bin total, which would be a different number
   whenever a bin holds more than one price. */
function researchBin(raw, edges, opts) {
  opts = opts || {};
  var B = edges.length - 1;
  researchAssertEdges(edges, B);
  var supply = new Float64Array(B), invested = new Float64Array(B);
  var zero = { supply: 0, invested: 0, count: 0 };
  var out = { supply: 0, count: 0, examples: [] };
  var rej = { count: 0, examples: [] };
  var totalSupply = 0, totalInvested = 0;
  var keys = Object.keys(raw);

  for (var k = 0; k < keys.length; k++) {
    var price = parseFloat(keys[k]);
    var amt = raw[keys[k]];

    if (typeof amt !== "number" || !isFinite(amt) || amt < 0 || !isFinite(price) || price < 0) {
      rej.count++;
      if (rej.examples.length < 8) rej.examples.push({ price: keys[k], amount: amt });
      continue;
    }
    if (amt === 0) continue;            // an explicit empty entry is not an error
    totalSupply += amt;
    totalInvested += price * amt;

    if (price === 0) {
      zero.supply += amt; zero.invested += 0; zero.count++;
      if (opts.includeZeroInFirstBin) { supply[0] += amt; }
      continue;
    }
    var j = researchBinIndex(edges, price);
    if (j < 0) {
      out.supply += amt; out.count++;
      if (out.examples.length < 8) out.examples.push({ price: price, amount: amt });
      continue;
    }
    supply[j] += amt;
    invested[j] += price * amt;
  }

  return {
    bins: B,
    supply: supply,
    invested: invested,
    sourceZero: zero,
    outOfRange: out,
    rejected: rej,
    totalSupply: totalSupply,
    totalInvested: totalInvested,
    zeroAlsoInFirstBin: !!opts.includeZeroInFirstBin
  };
}

/* Sum a date's cohorts into one stacked profile on the same frozen grid. */
function researchBinDate(cohortMaps, edges, opts) {
  var B = edges.length - 1;
  var stacked = new Float64Array(B);
  var per = [], agg = { sourceZero: 0, outOfRange: 0, rejected: 0, totalSupply: 0, totalInvested: 0 };
  for (var i = 0; i < cohortMaps.length; i++) {
    var r = researchBin(cohortMaps[i] || {}, edges, opts);
    per.push(r);
    for (var j = 0; j < B; j++) stacked[j] += r.supply[j];
    agg.sourceZero += r.sourceZero.supply;
    agg.outOfRange += r.outOfRange.supply;
    agg.rejected += r.rejected.count;
    agg.totalSupply += r.totalSupply;
    agg.totalInvested += r.totalInvested;
  }
  agg.stacked = stacked;
  agg.perCohort = per;
  agg.maxStacked = 0;
  for (j = 0; j < B; j++) if (stacked[j] > agg.maxStacked) agg.maxStacked = stacked[j];
  return agg;
}

/* Preflight: one pass over the frozen archive to choose the constants that
   every frame will then share. Nothing may be recomputed per date afterwards,
   which is the whole point, and is what stops a peak drifting across the screen
   when only the axis moved. */
function researchPreflight(archive, opts) {
  opts = opts || {};
  var B = opts.bins || 625;
  var headroom = opts.priceHeadroom == null ? 0.01 : opts.priceHeadroom;
  var yHeadroom = opts.yHeadroom == null ? 0.05 : opts.yHeadroom;

  var maxPrice = 0, minPositive = Infinity, maxPositive = 0, dates = [], nObs = 0, sawPositive = false;
  for (var d = 0; d < archive.length; d++) {
    var rec = archive[d];
    dates.push(rec.date);
    for (var c = 0; c < rec.cohorts.length; c++) {
      var m = rec.cohorts[c] || {}, keys = Object.keys(m);
      for (var k = 0; k < keys.length; k++) {
        var p = parseFloat(keys[k]), a = m[keys[k]];
        if (!isFinite(p) || p < 0 || typeof a !== "number" || !(a > 0)) continue;
        nObs++;
        if (p > maxPrice) maxPrice = p;
        if (p > 0) { sawPositive = true; if (p < minPositive) minPositive = p; if (p > maxPositive) maxPositive = p; }
      }
    }
    if (rec.spot != null && isFinite(rec.spot) && rec.spot > maxPrice) maxPrice = rec.spot;
  }
  if (!(maxPrice > 0)) throw new Error("researchPreflight: archive contains no positive price; cannot freeze a grid");

  var pMax = maxPrice * (1 + headroom);
  var linear = researchLinearEdges(pMax, B);

  var logEdges = null, pMin = null, logDegenerate = null;
  if (!sawPositive) {
    logDegenerate = "no strictly positive price in archive";
    pMin = null;
  } else if (minPositive === maxPositive) {
    // Compare against the largest price actually observed, not pMax: pMax carries
    // headroom, so a single observation would otherwise produce a "valid" grid of
    // 625 bins spanning a 1% range with every bin but one empty.
    logDegenerate = "only one distinct positive price (" + minPositive + "); log grid undefined";
    pMin = minPositive;
  } else {
    pMin = opts.pMin != null ? opts.pMin : minPositive;
    logEdges = researchLogEdges(pMin, pMax, B);
  }

  // One Y-limit for the whole job, from the tallest stacked bin anywhere in it.
  var yMaxLinear = 0, yMaxLog = 0;
  for (d = 0; d < archive.length; d++) {
    var lin = researchBinDate(archive[d].cohorts, linear, { includeZeroInFirstBin: true });
    if (lin.maxStacked > yMaxLinear) yMaxLinear = lin.maxStacked;
    if (logEdges) {
      var lg = researchBinDate(archive[d].cohorts, logEdges, { includeZeroInFirstBin: false });
      if (lg.maxStacked > yMaxLog) yMaxLog = lg.maxStacked;
    }
  }

  return Object.freeze({
    schemaVersion: RESEARCH_SCHEMA_VERSION,
    bins: B,
    dates: dates,
    observationCount: nObs,
    priceMaxObserved: maxPrice,
    priceHeadroom: headroom,
    pMax: pMax,
    pMin: pMin,
    linearEdges: linear,
    logEdges: logEdges,
    logDegenerateReason: logDegenerate,
    yHeadroom: yHeadroom,
    yMaxLinear: yMaxLinear * (1 + yHeadroom),
    yMaxLog: logEdges ? yMaxLog * (1 + yHeadroom) : null,
    yMaxLinearObserved: yMaxLinear,
    yMaxLogObserved: logEdges ? yMaxLog : null,
    smoothing: "none",
    weighting: opts.weighting || "btc",
    clipping: "none"
  });
}

/* Geometric centres for plotting, and the widths that go with them. For the
   log view the centre is the geometric mean, which is the midpoint once the
   axis is drawn in log space; the arithmetic mean would sit visibly right of
   centre in every bin. */
function researchBinCentres(edges, geometric) {
  var B = edges.length - 1, c = new Array(B);
  for (var j = 0; j < B; j++) {
    c[j] = geometric ? Math.sqrt(edges[j] * edges[j + 1]) : (edges[j] + edges[j + 1]) / 2;
  }
  return c;
}
function researchBinWidths(edges) {
  var B = edges.length - 1, w = new Array(B);
  for (var j = 0; j < B; j++) w[j] = edges[j + 1] - edges[j];
  return w;
}

/* The figure geometry, resolved once and then reused verbatim for every frame.
   Deriving any of this from offsetWidth, devicePixelRatio, browser zoom or the
   phone layout would make the output depend on the machine that rendered it. */
var RESEARCH_FIGURE = Object.freeze({
  width: 3840, height: 2160,
  margin: Object.freeze({ l: 190, r: 170, t: 230, b: 220 }),
  font: Object.freeze({ title: 40, label: 30, axis: 26, legend: 24, footnote: 22 })
});

function researchPlotRect(fig) {
  fig = fig || RESEARCH_FIGURE;
  return {
    width: fig.width - fig.margin.l - fig.margin.r,
    height: fig.height - fig.margin.t - fig.margin.b
  };
}

/* Build the Plotly traces and layout for one observation.

   view      "linear" | "log"
   variant   "annotated" (labels, legend, spot marker) | "clean" (bars only)

   Every cohort gets a trace whether or not it holds anything on this date, in
   the frozen palette order, with visible:true written explicitly: the public
   chart carries hidden-legend state across redraws and an export must not
   inherit it. The price-history overlay, cycle landmarks, cumulative curve,
   bottom signal and watermark are not built at all here, rather than being
   built and then hidden. A legend entry can be toggled back on; a trace that
   was never created cannot. */
function researchFigureSpec(cfg, frame, opts) {
  opts = opts || {};
  var view = opts.view || "linear";
  var variant = opts.variant || "annotated";
  var fig = opts.figure || RESEARCH_FIGURE;
  var isLog = view === "log";

  var edges = isLog ? cfg.logEdges : cfg.linearEdges;
  if (!edges) throw new Error("researchFigureSpec: no " + view + " grid in this config" +
    (cfg.logDegenerateReason ? " (" + cfg.logDegenerateReason + ")" : ""));
  var B = cfg.bins;
  var yMax = isLog ? cfg.yMaxLog : cfg.yMaxLinear;

  // Log view is drawn in transformed coordinates on a linear axis: equal bar
  // widths, geometric centres, and USD numbers on the ticks.
  var centres = researchBinCentres(edges, isLog);
  var widths = researchBinWidths(edges);
  var x = new Array(B), w = new Array(B);
  var lo = isLog ? Math.log10(edges[0]) : edges[0];
  var hi = isLog ? Math.log10(edges[B]) : edges[B];
  var step = (hi - lo) / B;
  for (var j = 0; j < B; j++) {
    x[j] = isLog ? Math.log10(centres[j]) : centres[j];
    w[j] = isLog ? step : widths[j];
  }

  var traces = [];
  for (var c = 0; c < frame.cohorts.length; c++) {
    traces.push({
      type: "bar",
      name: frame.cohortLabels[c],
      meta: "cohort:" + frame.cohortIds[c],
      x: x,
      y: Array.prototype.slice.call(frame.cohorts[c]),
      width: w,
      marker: { color: frame.cohortColors[c], line: { width: 0 } },
      visible: true,
      hoverinfo: "skip",
      showlegend: variant === "annotated"
    });
  }

  var showText = variant === "annotated";
  var layout = {
    width: fig.width,
    height: fig.height,
    margin: { l: fig.margin.l, r: fig.margin.r, t: fig.margin.t, b: fig.margin.b, pad: 0 },
    barmode: "stack",
    bargap: 0,
    paper_bgcolor: frame.paperBg || "#000000",
    plot_bgcolor: frame.plotBg || "#000000",
    showlegend: showText,
    xaxis: {
      range: [lo, hi],
      autorange: false,
      fixedrange: true,
      type: "linear",
      title: showText ? { text: isLog ? "Price [USD, log scale]" : "Price [USD]", font: { size: fig.font.axis } } : undefined,
      tickfont: { size: fig.font.axis },
      showgrid: false,
      automargin: false
    },
    yaxis: {
      range: [0, yMax],
      autorange: false,
      fixedrange: true,
      title: showText ? { text: isLog ? "BTC amount per log-price bin" : "BTC amount per price bin", font: { size: fig.font.axis } } : undefined,
      tickfont: { size: fig.font.axis },
      showgrid: false,
      automargin: false
    },
    annotations: [],
    shapes: []
  };

  if (showText) {
    layout.title = {
      text: frame.date + "  -  BTC amount  -  " + (isLog ? "fixed log-price bins" : "fixed linear USD bins"),
      font: { size: fig.font.title },
      x: 0.5, xanchor: "center", yref: "container"
    };
    layout.legend = { font: { size: fig.font.legend }, orientation: "h", traceorder: "normal" };
    if (frame.credit) {
      layout.annotations.push({
        text: frame.credit, xref: "paper", yref: "paper", x: 0, y: -0.075,
        showarrow: false, font: { size: fig.font.footnote }, xanchor: "left"
      });
    }
    // Thin spot marker, annotated view only, and only when the date has one.
    if (frame.spot != null && isFinite(frame.spot) && frame.spot > 0) {
      var sx = isLog ? Math.log10(frame.spot) : frame.spot;
      if (sx >= lo && sx <= hi) {
        layout.shapes.push({
          type: "line", x0: sx, x1: sx, y0: 0, y1: 1,
          xref: "x", yref: "paper",
          line: { color: "#ffffff", width: 2, dash: "dash" }
        });
      }
    }
  }

  return { traces: traces, layout: layout, view: view, variant: variant, xLo: lo, xHi: hi, yMax: yMax };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    RESEARCH_SCHEMA_VERSION: RESEARCH_SCHEMA_VERSION,
    RESEARCH_FIGURE: RESEARCH_FIGURE,
    researchLinearEdges: researchLinearEdges,
    researchLogEdges: researchLogEdges,
    researchAssertEdges: researchAssertEdges,
    researchBinIndex: researchBinIndex,
    researchBin: researchBin,
    researchBinDate: researchBinDate,
    researchPreflight: researchPreflight,
    researchBinCentres: researchBinCentres,
    researchBinWidths: researchBinWidths,
    researchPlotRect: researchPlotRect,
    researchFigureSpec: researchFigureSpec
  };
}
