// Posts the day's video to the channel on YouTube. The Daily video workflow's youtube job runs it once the video is
// published on GitHub. It speaks the YouTube Data API's resumable upload itself
// (https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol) with Node's own http and https,
// so the job that holds the channel's credentials runs nothing installed.
//
// The video goes up unlisted: anyone with the link can watch it (the site's YouTube button), but it is shown neither
// on the channel nor in search. Its title is the chart's own title for its last day. Until the Google Cloud project
// behind the credentials passes YouTube's API audit, YouTube records every upload as private instead, whatever is
// asked for here.
//
//   YOUTUBE_CLIENT_ID=… YOUTUBE_CLIENT_SECRET=… YOUTUBE_REFRESH_TOKEN=… node tools/video/youtube.mjs FILE START END
//
// prints id=<the video's id> and privacy=<the privacy YouTube recorded> for $GITHUB_OUTPUT.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";

export const ENDPOINTS = { token: "https://oauth2.googleapis.com/token", upload: "https://www.googleapis.com/upload/youtube/v3/videos" };
const RETRY = new Set([500, 502, 503, 504]);   // the answers YouTube says to retry (with backoff)
const PRIVACY = new Set(["private", "unlisted", "public"]);

const day = (d, opts) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });

// The chart's title on the video's last day, exactly as the site and the video print it ("… as of 24 Sept 2026").
export function videoTitle(end) {
  return "Bitcoin Supply by Price When Last Moved (USD Value) as of " + day(end, { day: "2-digit", month: "short", year: "numeric" });
}

export function videoDescription(start, end) {
  const long = (d) => day(d, { day: "numeric", month: "long", year: "numeric" });
  return [
    "Every bitcoin last moved at some price. This is the whole supply sorted by that price and weighed by what it was " +
      "worth then (the URPD, UTXO Realised Price Distribution), each bar split into 23 age bands, every day from " +
      long(start) + " to " + long(end) + ".",
    "",
    "Any day, in your browser: https://bitcoinsupplychart.com",
    "This video to download in 4K: https://github.com/renshuBTC/URPD-History/releases/tag/video",
    "",
    "Powered by Bitview.space and Bitcoin Core. Credits: Antoine Le Calvez, Renato Shirakashi, James Check, @_nym21_.",
  ].join("\n");
}

// The video resource sent with the upload (snippet and status parts).
export function metadata(start, end) {
  return {
    snippet: {
      title: videoTitle(end),
      description: videoDescription(start, end),
      tags: ["bitcoin", "URPD", "UTXO", "on-chain", "bitcoin supply", "realized price", "cost basis"],
      categoryId: "28",   // Science & Technology
      defaultLanguage: "en",
    },
    status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false, embeddable: true, license: "youtube" },
  };
}

// One HTTP request. body: a string, or { path, start } to stream a file from that byte on.
function send(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === "https:" ? https : http).request(u, { method, headers, timeout: 120000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("no progress for two minutes")));
    req.on("error", reject);
    if (body && typeof body === "object") {
      const file = fs.createReadStream(body.path, { start: body.start });
      file.on("error", (e) => req.destroy(e));
      file.pipe(req);
    } else req.end(body);
  });
}

const excerpt = (text) => String(text || "").replace(/\s+/g, " ").slice(0, 400);
function parse(text, what) {
  try { return JSON.parse(text); } catch (e) { throw new Error(`${what}: not JSON: ${excerpt(text)}`); }
}
const backoff = (k) => new Promise((r) => setTimeout(r, Math.min(64, 2 ** k) * 1000));

// A request that is simply sent again after a dropped connection or a 5xx, a few times.
async function retried(what, attempt, { tries, wait, log }) {
  for (let k = 1; ; k++) {
    let res = null, error = null;
    try { res = await attempt(); } catch (e) { error = e; }
    if (res && !RETRY.has(res.status)) return res;
    if (k >= tries) throw new Error(`${what}: ${error ? error.message : "HTTP " + res.status + " " + excerpt(res.body)}`);
    log(`${what}: ${error ? error.message : "HTTP " + res.status}; trying again`);
    await wait(k);
  }
}

async function accessToken(credentials, o) {
  const body = new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken, grant_type: "refresh_token" }).toString();
  const res = await retried("token", () => send("POST", o.endpoints.token,
    { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) }, body), o);
  const json = parse(res.body, "token");
  // Google's answer names the problem (invalid_grant: the refresh token expired or was revoked), never the secrets.
  if (res.status !== 200 || typeof json.access_token !== "string") throw new Error(`token: HTTP ${res.status} ${json.error || ""} ${json.error_description || ""}`.trim());
  return json.access_token;
}

async function startSession(token, size, meta, o) {
  const body = JSON.stringify(meta);
  const res = await retried("start", () => send("POST", o.endpoints.upload + "?uploadType=resumable&part=snippet,status", {
    Authorization: "Bearer " + token, "Content-Type": "application/json; charset=UTF-8", "Content-Length": Buffer.byteLength(body),
    "X-Upload-Content-Length": size, "X-Upload-Content-Type": "video/mp4" }, body), o);
  if (res.status !== 200 || !res.headers.location) throw new Error(`start: HTTP ${res.status} ${excerpt(res.body)}`);
  return res.headers.location;
}

// Sends the file, and after a dropped connection or a 5xx asks YouTube how much it has and sends the rest from there.
async function uploadFile(session, file, size, token, o) {
  const auth = { Authorization: "Bearer " + token };
  let offset = 0, failures = 0;
  for (;;) {
    let res = null;
    try {
      const headers = { ...auth, "Content-Type": "video/mp4", "Content-Length": size - offset };
      if (offset > 0) headers["Content-Range"] = `bytes ${offset}-${size - 1}/${size}`;
      res = await send("PUT", session, headers, { path: file, start: offset });
    } catch (e) { o.log(`upload interrupted (from byte ${offset}): ${e.message}`); }
    if (res && (res.status === 200 || res.status === 201)) return parse(res.body, "upload");
    if (res && res.status !== 308 && !RETRY.has(res.status)) throw new Error(`upload: HTTP ${res.status} ${excerpt(res.body)}`);
    for (;;) {
      if (++failures > o.tries) throw new Error(`upload: still failing after ${o.tries} tries`);
      await o.wait(failures);
      let st;
      try { st = await send("PUT", session, { ...auth, "Content-Length": 0, "Content-Range": `bytes */${size}` }); }
      catch (e) { o.log(`upload status: ${e.message}`); continue; }
      if (st.status === 200 || st.status === 201) return parse(st.body, "upload");
      if (st.status === 308) {
        const m = /^bytes=0-(\d+)$/.exec(st.headers.range || "");
        offset = m ? Number(m[1]) + 1 : 0;
        o.log(`upload: YouTube has ${offset} of ${size} bytes; sending the rest`);
        break;
      }
      if (!RETRY.has(st.status)) throw new Error(`upload status: HTTP ${st.status} ${excerpt(st.body)}`);
    }
  }
}

export async function post({ file, start, end, credentials, endpoints = ENDPOINTS, tries = 8, wait = backoff, log = console.error }) {
  const o = { endpoints, tries, wait, log };
  const size = fs.statSync(file).size;
  const token = await accessToken(credentials, o);
  const session = await startSession(token, size, metadata(start, end), o);
  const video = await uploadFile(session, file, size, token, o);
  const id = video && video.id, privacy = video && video.status && video.status.privacyStatus;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error("upload: no video id in YouTube's answer");
  return { id, privacy: PRIVACY.has(privacy) ? privacy : "unknown" };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [file, start, end] = process.argv.slice(2), isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
  if (!file || !isDay(start) || !isDay(end)) { console.error("usage: node tools/video/youtube.mjs FILE START END"); process.exit(2); }
  const credentials = { clientId: process.env.YOUTUBE_CLIENT_ID, clientSecret: process.env.YOUTUBE_CLIENT_SECRET, refreshToken: process.env.YOUTUBE_REFRESH_TOKEN };
  if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
    console.error("YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN are all needed"); process.exit(2);
  }
  const { id, privacy } = await post({ file, start, end, credentials });
  console.error(`Posted https://www.youtube.com/watch?v=${id} (${privacy})`);
  process.stdout.write(`id=${id}\nprivacy=${privacy}\n`);
}
