# Bitcoin Supply Chart

Every bitcoin that exists last moved at some price. Sort them into price buckets,
add up the supply in each, and you get this chart. A tall bar is a price where a lot
of supply last changed position; a gap is a price where almost none did. The formal
name is URPD, the UTXO Realised Price Distribution.

What is unusual here is the history: most published versions show only today, this
one steps through every day back to 2009-01-03, with each bar split into 23 age
cohorts.

**Live: <https://bitcoinsupplychart.com>**

## Reading it

- **Bottom axis** is the price each coin last moved at, not today’s price.
- **Left axis** is how much supply sits in each bucket: dollars in USD mode, coins in BTC mode.
- **Right axis** belongs to the cyan line, a running share of the day’s supply at or below each price.
- **White line** is bitcoin’s own price on its own hidden time axis, 275 days either side of the selected day.
- **Dashed vertical** is the spot price. Supply to its left is held at a paper profit.
- **Colour** is age: yellow is fresh, deep blue is ancient, logarithmic in between. Lightness alone carries the order, and the ramp never passes through green, so it survives greyscale and red-green colour blindness.

Press **?** in the toolbar for the full explainer, in English, Chinese or Japanese.

## Controls

Keyboard:

- **A / D** or **← / →** — previous / next date
- **1 / 2 / 3 / 4** — step interval: 1D / 1W / 1M / 1Y
- **W / S** or **↑ / ↓** — switch USD / BTC weighting
- **Home / End** — first / last date

Toolbar, left to right:

- Interval, date navigation, a **YYYY-MM-DD** box, and a **CYCLE TOP/BTM** dropdown for cycle tops and bottoms
- **USD / BTC** — weight by dollar value at last move, or by coins
- **PIN SCALE** — freeze the y-axis on the day you are viewing so other days can be compared against it
- **Bottom signal** — fires when the share of value held at a loss passes your threshold
- **Bins**, **Smoothing**, **Y-max** — bucket count, a Gaussian spread that hides source quantisation, and a percentile cap on the axis (100 by default in USD mode, 99.8 in BTC mode)
- **GitHub** icon linking to the source, **?** explainer, **▶** video export, and a language toggle

The toolbar stays on one row. Scroll it horizontally when the controls do not fit the window.

On a phone the toolbar is hidden to give the chart the whole screen. Drag sideways
with one finger to move through the calendar, pinch with two to zoom the price axis,
double-tap to undo the zoom.

## How it works

One HTML file, no build step, no dependencies to install. Charts render with
[Plotly.js](https://plotly.com/javascript/) from a CDN with an SRI hash. Data is
fetched per day from the Bitcoin Research Kit API mirrored at
[bitview.space](https://bitview.space), one request per age cohort
(`/api/series/cost-basis/<cohort>/<date>`). Loaded days are cached in memory, so
scrubbing backwards is instant.

Video export renders each frame offscreen, holds them as blobs rather than data URLs
(a few thousand data URLs is gigabytes of heap), and records at 30 fps to MP4 where
the browser supports H.264, WebM otherwise.

To deploy: push to GitHub and enable Pages on `main` at the repository root. That is
the whole deployment.

## Development checks

The site still deploys directly from the single HTML file with no build step.
Run the regression tests with Node.js 24 or newer:

```sh
node --test tests/*.test.cjs
```

The tests execute the application source with controlled network, rendering, and
recording interfaces. They cover navigation races, date and value calculations,
render completion, and export failures and cleanup. GitHub Actions runs the same
checks on pushes and pull requests.

## Credits

- **URPD** — introduced by [Renato Shirakashi](https://x.com/renato_shira) in April 2020, popularised and extended by [James Check](https://x.com/_checkmatey_)
- **Data** — [Bitcoin Research Kit](https://github.com/bitcoinresearchkit/mono) by [Antoine Le Calvez / @_nym21_](https://x.com/_nym21_), served via [bitview.space](https://bitview.space), built on [Bitcoin Core](https://bitcoin.org)
- **Charting** — [Plotly.js](https://plotly.com/javascript/) (MIT)

## Licence

MIT. See [LICENSE](LICENSE).
