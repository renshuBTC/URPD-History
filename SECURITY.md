# Security

Bitcoin Supply Chart is a static page. It has no accounts, takes no payments and needs nothing installed. It will
never ask for a seed phrase, a private key, a wallet connection or a signature, and the only file it offers is the
full-history video. Anything that asks for more is not this site.

## The video

The download button (the arrow icon in the toolbar) downloads one file, always from this address:

<https://github.com/renshuBTC/URPD-History/releases/download/video/BitcoinSupplyChart.com.mp4>

It is always an `.mp4` video served by GitHub from this repository's
[`video` release](https://github.com/renshuBTC/URPD-History/releases/tag/video). A copy from anywhere else, or a
file of any other kind (`.exe`, `.dmg`, `.zip`, `.scr`, `.apk`, …), did not come from here.

Every day's file is built by the [Daily video](.github/workflows/video.yml) workflow, and GitHub keeps a signed
record of the run that built it (a build provenance attestation, logged by Sigstore). To check a downloaded copy:

- **SHA-256:** compare it with the one in the release notes: `shasum -a 256 FILE` on macOS, `sha256sum FILE` on
  Linux, `Get-FileHash FILE` in Windows PowerShell.
- **Attestation**, with the [GitHub CLI](https://cli.github.com):

  ```sh
  gh attestation verify BitcoinSupplyChart.com.mp4 --repo renshuBTC/URPD-History \
    --signer-workflow renshuBTC/URPD-History/.github/workflows/video.yml --source-ref refs/heads/main
  ```

  This passes only for a file built by that workflow in this repository from its `main` branch.

## How the site and the video are protected

- **The page** allows only its own inline scripts (by SHA-256) and Plotly from its CDN (by integrity hash) to run,
  and connects only to this site and bitview.space: a Content-Security-Policy refuses every other script, frame,
  plugin, form and connection. It writes text, never markup, and everything from the data API is checked before use,
  so the API can at worst put wrong numbers on the chart. Its one download link is fixed, and the tests fail if any
  other download, redirect or outside address appears (`tests/security.test.cjs`).
- **The build** is split by trust. Only this repository's own code runs with a token that can write, and that code
  never parses the video. The renderer, which runs third-party code (Playwright, Chromium, ffmpeg), and the job that
  vets its file get a read-only token and no credentials. The file is published only if it is exactly the expected
  video (`tools/video/check-video.sh`: an MP4 with a single 3840×2160, 60 fps H.264 stream of 18,000 frames, every
  frame decoded), after its container is rewritten to hold nothing but the picture, and with an attestation. The
  axis history refuses values from the data API far outside anything in the real history rather than commit them.
  Actions are pinned to full commit hashes and npm packages to exact versions and hashes, with install scripts off.
- **A watch:** the [Site check](.github/workflows/site-check.yml) workflow checks four times a day that
  www.bitcoinsupplycharts.com serves this repository's `index.html` byte for byte, and that the video behind the button
  verifies as above. If anything differs it fails, and GitHub emails the owner.

## Reporting a problem

Please don't open a public issue for a security problem. Report it privately with **Report a vulnerability** on
this repository's [Security tab](https://github.com/renshuBTC/URPD-History/security), or message
[@RenshuBTC](https://x.com/RenshuBTC) on X.
