# URPD History

An interactive, single-file viewer for Bitcoin's **UTXO Realised Price
Distribution (URPD)** across its full history. Scrub through every day since
genesis, split the distribution by Profit/Loss or Long-Term vs Short-Term
Holders, weight it by BTC supply or USD invested, overlay the BTC price line
with cycle tops and bottoms, and watch an adjustable bottom signal fire when
enough USD invested goes underwater.

**Live:** https://renshubtc.github.io/URPD-History/

## Controls

Keyboard:

- **A / D** or **← / →** — previous / next date
- **1 / 2 / 3 / 4** — step interval: 1D / 1W / 1M / 1Y
- **W / S** or **↑ / ↓** — toggle view
- **Home / End** — jump to first / last date

Toolbar:

- Interval buttons and a **YYYY-MM-DD** date picker
- **Landmarks** dropdown — jump straight to any cycle top or bottom
- **P/L · LTH/STH** — split the histogram by profit/loss or holder duration
- **USD · BTC** — weight bars by USD invested (realized cap) or BTC supply
- **Adjustable bottom signal** — fires when the chosen % of USD invested is in loss
- **中文 / EN** — language toggle

## How it works

One HTML file, no build step. Charts render with
[Plotly.js](https://plotly.com/javascript/) (loaded from cdn.plot.ly) and data
is fetched per-day from the Bitcoin Research Kit API mirrored at
[bitview.space](https://bitview.space) (`/api/urpd/all/<date>`). Loaded frames
are cached in memory, so scrubbing backwards is instant.

To deploy: push this repo to GitHub and enable Pages on the `main` branch
root. That's the entire deploy.

## Credits

- **Original URPD chart** — created by
  [Renato Shira (@renato_shira)](https://x.com/renato_shira) at Glassnode;
  popularized and extended by
  [James Check (@_Checkmatey_)](https://x.com/_checkmatey_) of
  [checkonchain.com](https://charts.checkonchain.com)
- **Data** — [Bitcoin Research Kit (BRK)](https://github.com/bitcoinresearchkit/brk)
  by [@_nym21_](https://x.com/_nym21_), served via [bitview.space](https://bitview.space)
- **Charting** — [Plotly.js](https://plotly.com/javascript/) (MIT)
- Built by [@RenshuBTC](https://x.com/RenshuBTC)

## License

MIT — see [LICENSE](LICENSE).
