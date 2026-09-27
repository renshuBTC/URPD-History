// The two videos, one for each place the site can end its left axis (index.html, the Y-MAX EXPANDS ON ATH and Y-MAX ALWAYS AT 100%
// buttons: setYMaxMode):
//   ath  Y-MAX EXPANDS ON ATH: the axis at the tallest bar shown so far, which grows only when a bar reaches a new all-time
//        high and never shrinks
//   fit  Y-MAX ALWAYS AT 100%: the axis at each frame's own tallest bar, so that bar always reaches the top
// Both draw every bar in its 23 age bands (AGE_BANDS and AGE_BAND_COLORS there), stacked from the youngest coins up.
// tests/video-looks.test.cjs holds all of this to the site's own values.
export const AGE_LABELS = ["<1h", "1h-1d", "1d-1w", "1w-1m", "1m-2m", "2m-3m", "3m-4m", "4m-5m", "5m-6m", "6m-9m", "9m-1y", "1y-18m",
  "18m-2y", "2y-3y", "3y-4y", "4y-5y", "5y-6y", "6y-7y", "7y-8y", "8y-10y", "10y-12y", "12y-15y", ">15y"];
export const AGE_COLORS = ["#f8f919", "#ffbc86", "#fe60a4", "#f20bdb", "#cc0ffc", "#b430fe", "#a43afe", "#983ffe", "#8e42fe", "#8046fe",
  "#6e48fe", "#5a49fe", "#434afe", "#224bfd", "#0353ed", "#0258e0", "#035bd5", "#035dcc", "#035fc5", "#0360bb", "#0361b0", "#0361a5", "#03619a"];

export const LOOKS = {
  // tag: the look's name as the site's titles write it (titleUSDAth and titleUSDFit there), on the video and on YouTube;
  // fit: whether the left axis ends at each frame's own tallest bar rather than the tallest so far
  ath: { tag: "Y-Max Expands on ATH", fit: false },
  fit: { tag: "Y-Max Always at 100%", fit: true },
};

export function look(name) {
  if (!Object.hasOwn(LOOKS, name)) throw new Error(`no look "${name}": ath or fit`);
  return LOOKS[name];
}

// The chart's title up to its date, worded as the site's English titles (titleUSDAth and titleUSDFit there): the
// videos are drawn in USD. YouTube takes it as it is.
export const titleStart = (name) => `Bitcoin Supply by Price When Last Moved (USD Value, ${look(name).tag}) as of `;
