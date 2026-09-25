// The two videos, one for each way the site colours its bars (index.html, the AGE and LTH/STH switches):
//   age     each bar in its 23 age bands (AGE_BANDS and AGE_BAND_COLORS there)
//   lthsth  the same bands added up into short-term holders, the first STH_BANDS of them (coins that moved within the
//           last 150 days), and long-term holders, the rest (STH_BANDS, STH_COLOR and LTH_COLOR there)
// A look's layer k is the bands before ends[k] added up; page.html paints the layers from the last back to the first,
// each from zero, so every layer shows only its own share of the bar. tests/video-looks.test.cjs holds all of this to
// the site's own values.
export const AGE_LABELS = ["<1h", "1h-1d", "1d-1w", "1w-1m", "1m-2m", "2m-3m", "3m-4m", "4m-5m", "5m-6m", "6m-9m", "9m-1y", "1y-18m",
  "18m-2y", "2y-3y", "3y-4y", "4y-5y", "5y-6y", "6y-7y", "7y-8y", "8y-10y", "10y-12y", "12y-15y", ">15y"];
export const AGE_COLORS = ["#f8f919", "#ffbc86", "#fe60a4", "#f20bdb", "#cc0ffc", "#b430fe", "#a43afe", "#983ffe", "#8e42fe", "#8046fe",
  "#6e48fe", "#5a49fe", "#434afe", "#224bfd", "#0353ed", "#0258e0", "#035bd5", "#035dcc", "#035fc5", "#0360bb", "#0361b0", "#0361a5", "#03619a"];
export const STH_BANDS = 8;   // <1h to 4m-5m: 150 days, Bitcoin Research Kit's line between short- and long-term holders

export const LOOKS = {
  age: { tag: "AGE", labels: AGE_LABELS, colors: AGE_COLORS, ends: AGE_LABELS.map((_, k) => k + 1), legendSize: 9 },
  lthsth: { tag: "LTH/STH", labels: ["Short-Term Holders", "Long-Term Holders"], colors: ["#e6a817", "#5599ff"],
    ends: [STH_BANDS, AGE_LABELS.length], legendSize: 12 },
};

export function look(name) {
  if (!Object.hasOwn(LOOKS, name)) throw new Error(`no look "${name}": age or lthsth`);
  return LOOKS[name];
}

// The chart's title up to its date, worded as the site's English titles (titleUSDAge and titleUSDSplit there): the
// videos are drawn in USD.
export const titleStart = (name) => `Bitcoin Supply by Price When Last Moved (USD Value, ${look(name).tag}) as of `;
