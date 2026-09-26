# Bitcoin Supply Chart

Every bitcoin that exists last moved at some price. Sort them into price buckets,
add up the supply in each, and you get this chart. A tall bar is a price where a lot
of supply last changed position; a gap is a price where almost none did. The formal
name is URPD, the UTXO Realised Price Distribution.

What is unusual here is the history: most published versions show only today, this
one steps through every day back to 2009-01-03, with each bar split into 23 age
cohorts, and its left axis either growing with the tallest bar so far or refitted to
each day's own tallest bar.

**Live: <https://bitcoinsupplychart.com>**

## Reading it

- **Bottom axis** is the price each coin last moved at, not today’s price.
- **Left axis** is how much supply sits in each bucket: dollars in USD mode, coins in BTC mode. Both axes are marked at twenty equal steps from zero to their very end, labels rounded to two significant figures.
- **The price axis only grows.** It ends at the highest price the data had reached by the day you are viewing, moves only when the data goes past it, and never shrinks, so scrubbing back shows every day exactly as it looked at the time.
- **The left axis follows the Y-MAX buttons.** **Y-MAX EXPANDS ON ATH** (the default) ends it at the tallest bar so far: it grows only when a bar reaches a new all-time high and never shrinks, like the price axis. **Y-MAX ALWAYS AT 100%** ends it at each day’s own tallest bar, so that bar always reaches the top and every day’s shape fills the same frame; the scale changes from day to day, so the bars bounce as you scrub. Either way a day’s axis depends on that day alone, whichever way you reach it. In BTC mode the first bar, the coins last moved for less than one bar’s width, is left out of the left axis and runs off the top with its height printed.
- **Hover a bar** for its price, its age band, the whole bar’s total (Total Value When Last Moved, or Total Supply) and Cumulative % of Total, the running share of the day at or below that price.
- **White line** is bitcoin’s own price on its own hidden axes: a year of time around the selected day, and linear from $0 to the highest close shown so far, so the line fills the chart and only rescales on a new high.
- **Dashed vertical** is the spot price. Supply to its left last moved below it, supply to its right above it.
- **Colour** is age: yellow is fresh, deep blue is ancient, logarithmic in between. The 23 colours lie on one path through OKLCH, evenly spaced to the eye, with lightness falling from young to old so the order survives greyscale, and every band at least 3:1 against the background.

Press **HOW TO READ** in the toolbar for the full explainer, in English, Chinese or Japanese.

## Controls

Keyboard:

- **A / D** or **← / →** — previous / next date
- **1 / 2 / 3 / 4** — step interval: 1D / 1W / 1M / 1Y
- **W / S** or **↑ / ↓** — step interval up / down, one size at a time (1D → 1W → 1M → 1Y, and round again)
- **Home / End** — first / last date

USD / BTC and the two Y-MAX buttons are switched with their toolbar buttons.

Toolbar, left to right:

- Interval, date navigation, and a **CYCLE TOP/BTM** dropdown for cycle tops and bottoms
- **USD / BTC** — weight by dollar value at last move, or by coins
- **Y-MAX EXPANDS ON ATH / Y-MAX ALWAYS AT 100%** — end the left axis at the tallest bar so far, or at each day’s
  own tallest bar
- **PIN Y-AXIS** — freeze the y-axis at the tallest bar of the day you are viewing so other days can be compared against it
- **Smoothing** and **Y-max** — smoothing, which spreads each price stamp back over the dollar (ten dollars above $100K) it was rounded from and blurs it with a Gaussian of 0.24% of price by default; and Y-max, where 100 (the default) is where the Y-MAX buttons put the axis and anything lower zooms into the day in view. The price axis is always cut into 626 bars
- **FULL HISTORY (Y-MAX EXPANDS ON ATH)** and **FULL HISTORY (Y-MAX ALWAYS AT 100%)** for the latest 5-minute full-history videos on YouTube, one for each Y-MAX button (each opens the channel until there is a video of it others can watch)
- together at the right-hand end: **?** for the explainer and the GitHub mark for the source, as icons, and the language toggle

The chart's camera icon saves a PNG of it; there is no video download.

The toolbar is always one row and never scrolls. Where the controls do not fit the window, its spacing tightens, then
its type goes a size down, then the video buttons’ names drop their Y-MAX, then the buttons go down to ▶ EXPANDS ON
ATH and ▶ ALWAYS AT 100%, and past that the whole bar is drawn smaller.

On a phone the toolbar is hidden to give the chart the whole screen. Tap the left or
right quarter of the screen to step back or forward a day, or drag the orange dot along
the price line; the chart itself does not pan or zoom.

## How it works

One HTML file, no build step, no dependencies to install. Charts render with
[Plotly.js](https://plotly.com/javascript/) from a CDN with an SRI hash. Data is
fetched per day from the Bitcoin Research Kit API mirrored at
[bitview.space](https://bitview.space), one request per age cohort
(`/api/series/cost-basis/<cohort>/<date>`). Loaded days are cached in memory, so
scrubbing backwards is instant.

**FULL HISTORY (Y-MAX EXPANDS ON ATH)** and **FULL HISTORY (Y-MAX ALWAYS AT 100%)** in the toolbar each open the
whole history as one video on YouTube, its left axis ending at the tallest bar so far or at each day’s own tallest bar
(each frame’s, as the days blend into each other): every day from 2010-05-18, when the first price comes onto the chart
(it is empty before that), to the latest, 5:00 at 60 fps in 4K (3840×2160), drawn with the page’s default settings.
The **Weekly videos** workflow draws both again once a week on GitHub’s runners, one runner each, taking in the week
just ended, and posts them to YouTube (see [Posting to YouTube](#posting-to-youtube)). Run by hand (**Actions → Weekly
videos → Run workflow**), it draws both at once, or with **only** (`ath` or `fit`) just one of them: run with `all`,
it publishes and posts both and starts a new week; with one, that one is posted and its button updated, while the
release and its week stay as they are until the next weekly run draws both together.
The site offers no file to download, so that a break-in could not use it to hand anyone a file. The workflow keeps its
latest renders on the `video` release, whose notes tell the next run which day they reach; nothing links to them. A
render goes out only after it is checked to be exactly the expected video and attested (see [SECURITY.md](SECURITY.md)).
It renders with `tools/video` (Playwright, Plotly and ffmpeg, installed only there; `tools/video/looks.mjs` holds the
two looks), from a store of every day’s bars in their age bands, kept on the `video-data` release: past days never change, so each day’s run adds the new day, and once a week the 18,000 frames
of each video are drawn again. Free for a public
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
channel with `tools/video/youtube.mjs`, through the YouTube Data API, each from a job of its own: one video's trouble
does not hold back the other, and a failed post can be run again (**Re-run failed jobs**, within a week) without
posting the other twice. Each week's videos go up **unlisted** (anyone with the link can watch them; they are shown neither on the
channel nor in search), titled with the chart's own title on their last day, *Bitcoin Supply by Price When Last Moved
(USD Value, Y-Max Expands on ATH) as of 24 Sept 2026* and the same with *(USD Value, Y-Max Always at 100%)*. Once
YouTube lets others watch one, the
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
