// The two videos, one for each weighting the site draws (index.html, the USD and BTC buttons: setViewMode), each as the
// site draws that weighting by default (its Y-max, yMaxByMode there):
//   usd  the bars in dollars (every coin's value when it last moved), the left axis at each frame's own tallest bar
//        (Y-max 100)
//   btc  the bars in coins, the left axis at the 99.8th percentile of each frame's bars (Y-max 99.8): the first bar,
//        every coin last moved for less than one bar's width, is around ten times any other and runs off the top, with
//        its height printed there (the ▲ figure), as on the site
// The USD one runs from 2011-01-31, the first day with a realized cap above $0; the BTC one from 2010-05-18, when the
// first price comes into view (store.mjs startIndex). Both draw every bar in its 23 age bands (AGE_BANDS and
// AGE_BAND_COLORS there), stacked from the youngest coins up. tests/video-looks.test.cjs holds all of this to the site's
// own values.
export const AGE_LABELS = ["<1h", "1h-1d", "1d-1w", "1w-1m", "1m-2m", "2m-3m", "3m-4m", "4m-5m", "5m-6m", "6m-9m", "9m-1y", "1y-18m",
  "18m-2y", "2y-3y", "3y-4y", "4y-5y", "5y-6y", "6y-7y", "7y-8y", "8y-10y", "10y-12y", "12y-15y", ">15y"];
export const AGE_COLORS = ["#f8f919", "#ffbc86", "#fe60a4", "#f20bdb", "#cc0ffc", "#b430fe", "#a43afe", "#983ffe", "#8e42fe", "#8046fe",
  "#6e48fe", "#5a49fe", "#434afe", "#224bfd", "#0353ed", "#0258e0", "#035bd5", "#035dcc", "#035fc5", "#0360bb", "#0361b0", "#0361a5", "#03619a"];

export const LOOKS = {
  // tag: the video's name on its button and on YouTube; coin: whether the bars are coins; yPct: the Y-max, the
  // percentile of the frame's bars where the left axis ends (the site's default for the weighting); the chart's words as
  // the site's English writes them (titleUSD, usdInvested, usdProfit, ... there)
  usd: { tag: "USD", coin: false, yPct: 100, title: "Bitcoin URPD (USD Value) as of ", yTitle: "Value When Last Moved [USD]",
    profit: "USD Value Last Moved In Profit: ", loss: "USD Value Last Moved In Loss: " },
  btc: { tag: "BTC", coin: true, yPct: 99.8, title: "Bitcoin URPD (BTC) as of ", yTitle: "Supply [BTC]",
    profit: "BTC Supply Last Moved In Profit: ", loss: "BTC Supply Last Moved In Loss: " },
};

export function look(name) {
  if (!Object.hasOwn(LOOKS, name)) throw new Error(`no look "${name}": usd or btc`);
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
