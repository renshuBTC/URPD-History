// The four videos, one for each view the site draws (index.html, the USD, BTC, % USD and % BTC buttons: setViewMode):
//   usd     the bars in dollars (every coin's value when it last moved), the left axis at each frame's own tallest bar
//   btc     the bars in coins, the left axis at each frame's own tallest bar (the first, on every day, as on the site)
//   pctusd  every bar as its percent of the day's realized cap, on a left axis fixed at 0 to PCT_TOP percent
//   pctbtc  every bar as its percent of the day's supply, on the same fixed axis
// The USD ones run from 2011-01-31, the first day with a realized cap above $0; the BTC ones from 2010-05-18, when the
// first price comes into view (store.mjs startIndex). All draw every bar in its 23 age bands (AGE_BANDS and
// AGE_BAND_COLORS there), stacked from the youngest coins up. tests/video-looks.test.cjs holds all of this to the site's
// own values.
export const AGE_LABELS = ["<1h", "1h-1d", "1d-1w", "1w-1m", "1m-2m", "2m-3m", "3m-4m", "4m-5m", "5m-6m", "6m-9m", "9m-1y", "1y-18m",
  "18m-2y", "2y-3y", "3y-4y", "4y-5y", "5y-6y", "6y-7y", "7y-8y", "8y-10y", "10y-12y", "12y-15y", ">15y"];
export const AGE_COLORS = ["#f8f919", "#ffbc86", "#fe60a4", "#f20bdb", "#cc0ffc", "#b430fe", "#a43afe", "#983ffe", "#8e42fe", "#8046fe",
  "#6e48fe", "#5a49fe", "#434afe", "#224bfd", "#0353ed", "#0258e0", "#035bd5", "#035dcc", "#035fc5", "#0360bb", "#0361b0", "#0361a5", "#03619a"];

// The % looks' left axis top, in percent of the day's total: the site's PCT_TOP.
export const PCT_TOP = 4;
const USD = { coin: false, profit: "USD Value Last Moved In Profit: ", loss: "USD Value Last Moved In Loss: " };
const BTC = { coin: true, profit: "BTC Supply Last Moved In Profit: ", loss: "BTC Supply Last Moved In Loss: " };
export const LOOKS = {
  // tag: the video's name on its button and on YouTube (vidusd, vidbtc, vidpctusd and vidpctbtc on the site); coin:
  // whether the bars are coins; pct: whether each is its percent of the day's total; the chart's words as the site's
  // English writes them (titleUSD, usdInvested, pctUsdAxis, usdProfit, ... there)
  usd: { ...USD, tag: "USD Value", pct: false, title: "Bitcoin Supply by Price When Last Moved (USD Value) as of ",
    yTitle: "Value When Last Moved [USD]" },
  btc: { ...BTC, tag: "BTC", pct: false, title: "Bitcoin Supply by Price When Last Moved (BTC) as of ", yTitle: "Supply [BTC]" },
  pctusd: { ...USD, tag: "% USD Value", pct: true, title: "Bitcoin: Percent of Realized Cap by Price When Last Moved as of ",
    yTitle: "Percent of Realized Cap per Bar [%]" },
  pctbtc: { ...BTC, tag: "% BTC", pct: true, title: "Bitcoin: Percent of Supply by Price When Last Moved as of ",
    yTitle: "Percent of Supply per Bar [%]" },
};

export function look(name) {
  if (!Object.hasOwn(LOOKS, name)) throw new Error(`no look "${name}": usd, btc, pctusd or pctbtc`);
  return LOOKS[name];
}

// The chart's title up to its date, as the site's English titles word it. YouTube takes it as it is.
export const titleStart = (name) => look(name).title;
