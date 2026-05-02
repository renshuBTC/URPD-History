# URPD-History

A single-file, open-source, interactive viewer for Bitcoin's UTXO Realised
Price Distribution from genesis to today. Scrub through every day, switch
between Profit/Loss / Long-Term & Short-Term Holders / 21 age cohorts, dim
the in-loss supply, overlay the BTC price line, jump to any cycle top or
bottom, and switch the UI between five languages.

This is the live, browse-yourself counterpart to the 4K time-lapse render at
[The-Life-Cycle-of-Bitcoin](https://github.com/renshuBTC/The-Life-Cycle-of-Bitcoin).

## Try it

Open `index.html` in any browser. No build step, no dependencies installed
locally — Plotly loads from jsDelivr, data is fetched from
[bitview.space](https://bitview.space) (a public mirror of the Bitcoin
Research Kit API).

To deploy on GitHub Pages: push this folder to a repo and turn Pages on for
the `main` branch root. That's the entire deploy.

## Controls

Keyboard:
- **A / D / ←/→** — previous / next frame (step size below)
- **1 / 2 / 3 / 4 / 5** — interval: 1D / 1W / 1M / 1Y / 5Y
- **Home / End** — jump to first / last date
- **Spacebar** — hide / show the control panel

Buttons & dropdowns:
- **P/L · LTH/STH · AGE** — split the histogram by profit/loss, holder
  duration, or 21 UTXO age cohorts
- **DIM LOSS** — fade bars at cost basis above spot price
- **X-AXIS · Y-AXIS** — toggle each axis title + tick labels (so the bars
  reclaim that space when off)
- **BTC LINE** — overlay the BTC price line in pure white, endpoint
  horizontally centered, with cycle tops/bottoms labeled as triangles
- **CYCLE…** — jump straight to any cycle top or bottom date
- **Language picker** — EN / 中文 / 日本語 / FR / فارسی (Persian renders RTL)

## URL params

- `?date=2017-12-17` — open at a specific date
- `?split=age` — start in age-cohort mode (`pl` | `lthsth` | `age`)
- `?btc=1` — start with the BTC price overlay on
- `?lang=zh` — start in another language (`en` | `zh` | `ja` | `fr` | `fa`)

## How it works

Every frame fetches up to 22 endpoints from BRK in parallel
(`/api/urpd/all/<date>` plus 21 cohort endpoints in age mode, or `/api/urpd/lth`
+ `/api/urpd/sth` in LTH/STH mode). Per-fetch results are coalesced via a
URL-keyed promise cache, and every loaded frame is kept in memory so scrubbing
backwards is free. Bars are linear-binned at 500 bins per frame and the y-axis
caps at the 98th-percentile bin so a few tall bars don't squash the rest.

The visual treatment — pure-black background, amber Bloomberg-style controls,
centered price + DD/Mon/YYYY readout — is borrowed from the Life Cycle view at
[bitcointerminal.net](https://bitcointerminal.net), which itself uses the same
data source.

## Data source

[bitview.space](https://bitview.space) is a public mirror of the
[Bitcoin Research Kit](https://bitcoinresearchkit.org). It rate-limits at high
concurrency; if you're rendering or doing anything intensive, run BRK locally
and edit the `BASE` constant in `index.html`.

## License

MIT — see `LICENSE`. The data is BRK's; the code is open. Inspired by the
URPD work of [@\_Checkonchain](https://x.com/_checkonchain).
