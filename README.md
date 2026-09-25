# Bitcoin Supply Chart

Every bitcoin that exists last moved at some price. Sort them into price buckets,
add up the supply in each, and you get this chart. A tall bar is a price where a lot
of supply last changed position; a gap is a price where almost none did. The formal
name is URPD, the UTXO Realised Price Distribution.

What is unusual here is the history: most published versions show only today, this
one steps through every day back to 2009-01-03, with each bar split into 23 age
cohorts, or in two at 150 days.

**Live: <https://bitcoinsupplychart.com>**

## Reading it

- **Bottom axis** is the price each coin last moved at, not today’s price.
- **Left axis** is how much supply sits in each bucket: dollars in USD mode, coins in BTC mode. Both axes are marked at twenty equal steps from zero to their very end, labels rounded to two significant figures.
- **Both axes only grow.** Each ends at the furthest the data had reached by the day you are viewing (the highest price and the tallest bar so far), moves only when the data goes past it, and never shrinks, so scrubbing back shows every day exactly as it looked at the time. In BTC mode the first bar, the coins last moved for less than one bar’s width, is left out of this and runs off the top with its height printed.
- **Hover a bar** for its price, its age band (or its side of 150 days), the whole bar’s total (Total Value When Last Moved, or Total Supply) and Cumulative % of Total, the running share of the day at or below that price.
- **White line** is bitcoin’s own price on its own hidden axes: a year of time around the selected day, and linear from $0 to the highest close shown so far, so the line fills the chart and only rescales on a new high.
- **Dashed vertical** is the spot price. Supply to its left last moved below it, supply to its right above it.
- **Colour** is age: yellow is fresh, deep blue is ancient, logarithmic in between. The 23 colours lie on one path through OKLCH, evenly spaced to the eye, with lightness falling from young to old so the order survives greyscale, and every band at least 3:1 against the background.
- **`<150D/>150D`** instead adds the bands up into two at 150 days: `<150D` in amber (coins that moved within the last 150 days, the bands up to 4m-5m) and `>150D` in blue (150 days or more unmoved). It says how long coins have sat still, not who holds them; 150 days is where Bitcoin Research Kit splits what it calls short- from long-term holders. The bars and axes are the same either way.

Press **HOW TO READ** in the toolbar for the full explainer, in English, Chinese or Japanese.

## Controls

Keyboard:

- **A / D** or **← / →** — previous / next date
- **1 / 2 / 3 / 4** — step interval: 1D / 1W / 1M / 1Y
- **W / S** or **↑ / ↓** — step interval up / down, one size at a time (1D → 1W → 1M → 1Y, and round again)
- **Home / End** — first / last date

USD / BTC and AGE / `<150D/>150D` are switched with their toolbar buttons.

Toolbar, left to right:

- Interval, date navigation, and a **CYCLE TOP/BTM** dropdown for cycle tops and bottoms
- **USD / BTC** — weight by dollar value at last move, or by coins
- **AGE / `<150D/>150D`** — colour the bars by their 23 age bands, or in two at 150 days
- **PIN Y-AXIS** — freeze the y-axis at the tallest bar of the day you are viewing so other days can be compared against it
- **Smoothing** and **Y-max** — smoothing, which spreads each price stamp back over the dollar (ten dollars above $100K) it was rounded from and blurs it with a Gaussian of 0.24% of price by default; and Y-max, where 100 (the default) is the tallest bar so far and anything lower zooms into the day in view. The price axis is always cut into 625 bars
- **FULL HISTORY IN 5 MIN (AGE)** and **FULL HISTORY IN 5 MIN (`<150D/>150D`)** for the latest full-history videos on YouTube, one for each colouring (each opens the channel until there is a video of it others can watch), **HOW TO READ** for the explainer and **GITHUB** for the source
- the language toggle, on its own at the right-hand end

The chart's camera icon saves a PNG of it; there is no video download.

Where the controls do not fit the window on one line, the toolbar's spacing tightens, then HOW TO READ and GITHUB
go down to their icons, then the video buttons to ▶ AGE and ▶ `<150D/>150D`; only below that does it wrap onto a second row.

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

**FULL HISTORY IN 5 MIN (AGE)** and **(`<150D/>150D`)** in the toolbar each open the whole history as one video on
YouTube, coloured by age band or split at 150 days: every day from 2010-05-18, when the first price comes onto the
chart (it is empty before that), to the latest, 5:00 at 60 fps in 4K (3840×2160), drawn with the page’s default
settings. The **Weekly videos** workflow draws both again once a week on GitHub’s runners, one runner each, taking in
the week just ended, and posts them to YouTube (see [Posting to YouTube](#posting-to-youtube)).
The site offers no file to download, so that a break-in could not use it to hand anyone a file. The workflow keeps its
latest renders on the `video` release, whose notes tell the next run which day they reach; nothing links to them. A
render goes out only after it is checked to be exactly the expected video and attested (see [SECURITY.md](SECURITY.md)).
It renders with `tools/video` (Playwright, Plotly and ffmpeg, installed only there; `tools/video/looks.mjs` holds the
two colourings), from a store of every day’s bars kept on the `video-data` release: past days never change, so each
day’s run adds the new day, and once a week the 18,000 frames of each video are drawn again. Free for a public
repository.

The axes need the whole history to be a function of the date alone, which no single
day’s download contains, so `data/scales.json` (about 10 KB) carries it: for every day
since 2009-01-03, the right end of the price axis and the tallest bar so far in each
mode, as steps. `tools/build-scales.cjs` builds it with the page’s own binning code;
run again, it extends the file by each finished day (23 requests to bitview.space per
day). The Weekly videos workflow does that every day (it runs daily for this, and draws
the videos once a week) and commits the result. Days after the file’s last day still
draw, carrying on from its last values with their own data.

To deploy: push to GitHub and enable Pages on `main` at the repository root. That is
the whole deployment.

## Posting to YouTube

After publishing the videos, the **Weekly videos** workflow posts both to the [renshuBTC](https://www.youtube.com/@renshuBTC)
channel with `tools/video/youtube.mjs`, through the YouTube Data API, one after the other (the second also when the
first fails). Each week's videos go up **unlisted** (anyone with the link can watch them; they are shown neither on the
channel nor in search), titled with the chart's own title on their last day, *Bitcoin Supply by Price When Last Moved
(USD Value, AGE) as of 24 Sept 2026* and the same with *(USD Value, Under/Over 150D)* (YouTube takes no < or > in a
title). Once YouTube lets others watch one, the
workflow names it in `data/youtube.json` and its button on the site links to it; until then that button opens the
channel.

It needs the channel's OAuth credentials as three repository secrets. Without them the step does nothing. To set it up
once:

1. In the [Google Cloud console](https://console.cloud.google.com/projectcreate), create a project and enable the
   **YouTube Data API v3** (APIs & Services → Library).
2. In **Google Auth Platform** (the OAuth consent screen), choose the **External** audience, then **Publish app** so
   its status is **In production**. An app left in *Testing* gets refresh tokens that stop working after 7 days.
3. Under **Clients**, create an OAuth client of type **Web application** with the authorised redirect URI
   `https://developers.google.com/oauthplayground`.
4. In the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground), open the settings (⚙), tick **Use your
   own OAuth credentials** and enter the client's ID and secret. Authorise the scope
   `https://www.googleapis.com/auth/youtube.upload` with the channel's Google account (past the *Google hasn't verified
   this app* notice: **Advanced**, then continue), then **Exchange authorization code for tokens**.
5. In this repository's **Settings → Secrets and variables → Actions**, add `YOUTUBE_CLIENT_ID`,
   `YOUTUBE_CLIENT_SECRET` and `YOUTUBE_REFRESH_TOKEN`. Then run **Actions → YouTube credentials check → Run
   workflow**: it asks Google for an access token with them and says whether that worked, uploading nothing.
6. Until the project passes YouTube's API compliance audit, YouTube keeps every upload **private**, whatever the
   request asks for. Ask for the audit with the
   [YouTube API Services audit form](https://support.google.com/youtube/contact/yt_api_form); once it passes, the
   uploads come out unlisted and the button links to the latest one.

To stop posting, delete the three secrets (and remove the app's access at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions)).

## Security

The site never asks you to install anything, connect a wallet or enter a seed phrase, and it offers no file to
download: the video is on YouTube, and the chart's camera icon only saves a PNG of the chart, made in your browser. [SECURITY.md](SECURITY.md) explains how the page and the build are protected, and how to report a
problem.

## Development checks

The site still deploys directly from the single HTML file with no build step.
Run the regression tests with Node.js 24 or newer:

```sh
node --test tests/*.test.cjs
```

The tests execute the application source with controlled network and rendering
interfaces. They cover navigation races, date and value calculations, binning and the
axes, render completion, the axis-history builder, the video’s store and the security
rules (`tests/security.test.cjs`). GitHub Actions runs the same checks on pushes and
pull requests. After editing an inline script in `index.html`, run
`node tools/update-csp.cjs` so the Content-Security-Policy allows the new version.

## Credits

- **URPD** — introduced by [Renato Shirakashi](https://x.com/renato_shira) in April 2020, popularised and extended by [James Check](https://x.com/_checkmatey_)
- **Data** — [Bitcoin Research Kit](https://github.com/bitcoinresearchkit/mono) by [@_nym21_](https://x.com/_nym21_), served via [bitview.space](https://bitview.space), built on [Bitcoin Core](https://bitcoin.org)
- **Charting** — [Plotly.js](https://plotly.com/javascript/) (MIT)

## Licence

MIT. See [LICENSE](LICENSE).
