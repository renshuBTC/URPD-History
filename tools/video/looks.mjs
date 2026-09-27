// The four videos, one for each weighting and colouring the site draws (index.html: the USD and BTC buttons,
// setViewMode, and AGE and LTH/STH, setBarsMode), each as the site draws that choice by default (its Y-max, yMaxByMode
// there):
// Every bar is drawn as its share of the day in percent, as on the site (% USD, % BTC): of the realized cap in dollars, of
// all the coins in coins.
//   usd-age     % USD: each bar's share of the realized cap (every coin's value when it last moved), the left axis at
//               each frame's own tallest bar (Y-max 100), every bar in its 23 age bands (AGE_BANDS and AGE_BAND_COLORS
//               there), stacked from the youngest coins up
//   btc-age     % BTC: each bar's share of all the coins, the left axis at the 99.8th percentile of each frame's bars
//               (Y-max 99.8): the first bar, every coin last moved for less than one bar's width, is around ten times any
//               other and runs off the top, with its share printed there (the ▲ figure), as on the site; in the same 23
//               age bands
//   usd-lthsth  as usd-age, with the bands added up into short-term holders (STH, the first STH_BANDS bands: coins that
//               moved within the last 150 days) under long-term holders (LTH, the rest), as the site's LTH/STH does
//   btc-lthsth  as btc-age, split the same way
// Each shows the site's bottom signal at the site's default threshold for its weighting (index.html BOTTOM_DEFAULTS:
// 80% of the value in loss in USD, 50% of the coins in BTC): the dashed line and the price box's border turn yellow and
// the box adds a line naming the threshold. The USD ones run from 2011-01-31, the first day with a realized cap above
// $0; the BTC ones from 2010-05-18, when the first price comes into view (store.mjs startIndex). tests/video-looks.test.cjs holds all of this to the site's own
// values.
export const AGE_LABELS = ["<1h", "1h-1d", "1d-1w", "1w-1m", "1m-2m", "2m-3m", "3m-4m", "4m-5m", "5m-6m", "6m-9m", "9m-1y", "1y-18m",
  "18m-2y", "2y-3y", "3y-4y", "4y-5y", "5y-6y", "6y-7y", "7y-8y", "8y-10y", "10y-12y", "12y-15y", ">15y"];
export const AGE_COLORS = ["#f8f919", "#ffbc86", "#fe60a4", "#f20bdb", "#cc0ffc", "#b430fe", "#a43afe", "#983ffe", "#8e42fe", "#8046fe",
  "#6e48fe", "#5a49fe", "#434afe", "#224bfd", "#0353ed", "#0258e0", "#035bd5", "#035dcc", "#035fc5", "#0360bb", "#0361b0", "#0361a5", "#03619a"];
// LTH/STH (index.html STH_BANDS, STH_COLOR, LTH_COLOR and its English sth and lth): the first eight bands, under an hour
// to 4m-5m, are the short-term holders, the other fifteen the long-term holders.
export const STH_BANDS = 8;
export const HOLDER_LABELS = ["Short-Term Holders (STH)", "Long-Term Holders (LTH)"];
export const HOLDER_COLORS = ["#e6a817", "#5599ff"];

const SIGNAL = "BOTTOM SIGNAL \u2014 In Loss \u2265 ";   // the site's English bottomSignal, then the threshold and %
const USD = { coin: false, yPct: 100, bottom: 80, signal: SIGNAL, yTitle: "Value When Last Moved [% of Realized Cap]",
  profit: "USD Value Last Moved In Profit: ", loss: "USD Value Last Moved In Loss: " };
const BTC = { coin: true, yPct: 99.8, bottom: 50, signal: SIGNAL, yTitle: "Supply [% of Total Supply]",
  profit: "BTC Supply Last Moved In Profit: ", loss: "BTC Supply Last Moved In Loss: " };
export const LOOKS = {
  // tag: the video's name on its button and on YouTube; coin: whether the bars are coins; split: short- and long-term
  // holders rather than the age bands; yPct: the Y-max, the percentile of the frame's bars where the left axis ends (the
  // site's default for the weighting); bottom: the bottom signal's threshold, the share in loss (the site's default for
  // the weighting); the chart's words as the site's English writes them (titleUSDAge, usdInvested, usdProfit,
  // bottomSignal, ... there)
  "usd-age": { tag: "% USD-AGE", split: false, title: "Bitcoin URPD (% USD, AGE) as of ", ...USD },
  "btc-age": { tag: "% BTC-AGE", split: false, title: "Bitcoin URPD (% BTC, AGE) as of ", ...BTC },
  "usd-lthsth": { tag: "% USD-LTH/STH", split: true, title: "Bitcoin URPD (% USD, LTH/STH) as of ", ...USD },
  "btc-lthsth": { tag: "% BTC-LTH/STH", split: true, title: "Bitcoin URPD (% BTC, LTH/STH) as of ", ...BTC },
};

export function look(name) {
  if (!Object.hasOwn(LOOKS, name)) throw new Error(`no look "${name}": ${Object.keys(LOOKS).join(", ")}`);
  return LOOKS[name];
}

// The chart's title up to its date, as the site's English titles word it. YouTube takes it as it is.
export const titleStart = (name) => look(name).title;

// Where the left axis ends for a set of whole bars, as the site's axisLevel works it out: the tallest bar or, below 100,
// that percentile of all the bars, empty ones included (so 99.8 of 626 bars is always the second tallest).
export function axisLevel(values, pct) {
  let max = 0;
  for (const v of values) if (v > max) max = v;
  if (pct < 100) {
    const sorted = Array.from(values).sort((a, b) => a - b);
    const pN = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * pct / 100))] : 0;
    if (pN > 0 && pN < max) return pN;
  }
  return max;
}
