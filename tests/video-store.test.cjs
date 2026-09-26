const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const PER_DAY = 23 * 626;
// A store of `days` (dates), each day's values all equal to its position, with `extra` more days in the year file.
function store(days, extra = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-store-'));
  const f = new Float32Array((days.length + extra) * PER_DAY);
  for (let i = 0; i < days.length + extra; i++) f.fill(i + 1, i * PER_DAY, (i + 1) * PER_DAY);
  fs.writeFileSync(path.join(dir, 'bars-2026.f32.gz'), zlib.gzipSync(Buffer.from(f.buffer)));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ version: 1, bands: 23, bins: 626, days: days.map((d) => [d, 1000, 100, 10]) }));
  return dir;
}

test('the video store reads its days, and a year file that ran ahead of meta.json only as far as meta.json goes', async () => {
  const { readStore } = await import('../tools/video/store.mjs');
  const exact = readStore(store(['2026-01-01', '2026-01-02']));
  assert.equal(exact.meta.days.length, 2);
  assert.equal(exact.bars(1).length, PER_DAY);
  assert.equal(exact.bars(1)[PER_DAY - 1], 2);
  // The workflow swaps the year files in before meta.json; a run stopped in between leaves the year file a day ahead.
  const ahead = readStore(store(['2026-01-01', '2026-01-02'], 1));
  assert.equal(ahead.chunks['2026'].length, 2 * PER_DAY);
  assert.equal(ahead.bars(1)[0], 2);
});

test('the video store refuses a year file shorter than meta.json, and year files without meta.json', async () => {
  const { readStore } = await import('../tools/video/store.mjs');
  const short = store(['2026-01-01']);
  const meta = JSON.parse(fs.readFileSync(path.join(short, 'meta.json'), 'utf8'));
  meta.days.push(['2026-01-02', 1000, 100, 10]);
  fs.writeFileSync(path.join(short, 'meta.json'), JSON.stringify(meta));
  assert.throws(() => readStore(short), /holds 1 days, meta.json lists 2/);
  const lost = store(['2026-01-01']);
  fs.rmSync(path.join(lost, 'meta.json'));
  assert.throws(() => readStore(lost), /no meta.json/);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'video-store-'));
  assert.deepEqual(readStore(empty).meta.days, []);
});

test('the video starts on the first day with anything on the chart: the first close coming into view, or a bar', async () => {
  const { firstShownIndex, PRICE_AHEAD } = await import('../tools/video/store.mjs');
  assert.equal(PRICE_AHEAD, 90, 'the price line\'s window reaches 90 days ahead, as on the site');
  const day = (i) => new Date(Date.UTC(2010, 0, 1) + i * 864e5).toISOString().slice(0, 10);
  const days = Array.from({ length: 400 }, (_, i) => [day(i), 1, i >= 227 ? 0.06 : null, null]);   // the first close: 2010-08-16
  const empty = new Float32Array(PER_DAY), some = Float32Array.from({ length: PER_DAY }, (_, j) => (j === 5 ? 1 : 0));
  assert.equal(day(firstShownIndex({ days }, () => empty)), '2010-05-18', '90 days before the first close');
  assert.equal(day(firstShownIndex({ days }, (i) => (i >= 100 ? some : empty))), day(100), 'a bar before that');
  assert.equal(firstShownIndex({ days: days.map((d) => [d[0], 1, null, null]) }, () => empty), 0, 'nothing anywhere: every day');
});

test('store.mjs runs as a program however it is named, a symbolic link included', () => {
  const { spawnSync } = require('node:child_process');
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'store-link-')), 'store.mjs');
  fs.symlinkSync(path.join(__dirname, '..', 'tools', 'video', 'store.mjs'), link);
  // No arguments: it says how to run it (before anything is fetched), rather than doing nothing and exiting 0.
  const r = spawnSync(process.execPath, [link], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: store\.mjs DIR \[--cache RAWDIR\] \[--until DATE\] \[--seconds N\]/);
});

// replace-asset.sh against a stand-in gh holding one release's files as "id name" lines, every call logged.
const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$LOG"
if [ "$1 $2" = "release upload" ]; then
  name=$(basename "$4"); grep -v " $name\\$" "$STATE" > "$STATE.new" || true; mv "$STATE.new" "$STATE"
  echo "$(awk 'BEGIN { m = 0 } $1 > m { m = $1 } END { print m + 1 }' "$STATE") $name" >> "$STATE"; exit 0
fi
[ "$1" = api ] || exit 2; shift
method=GET; if [ "$1" = -X ]; then method=$2; shift 2; fi
p=$1; id=\${p##*/}
case "$method $p" in
  "GET "*/releases/tags/*) cat "$STATE" ;;
  "GET "*/releases/assets/*) grep -q "^$id " "$STATE" ;;
  "DELETE "*/releases/assets/*) grep -v "^$id " "$STATE" > "$STATE.new" || true; mv "$STATE.new" "$STATE" ;;
  "PATCH "*/releases/assets/*) awk -v i="$id" -v n="\${3#name=}" '$1 == i { $2 = n } 1' "$STATE" > "$STATE.new"; mv "$STATE.new" "$STATE" ;;
  *) exit 2 ;;
esac
`;
test('replace-asset.sh swaps each file in place: uploaded under a temporary name with its own extension, then the old one out and the new one renamed', () => {
  const { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replace-')), bin = path.join(dir, 'bin');
  fs.mkdirSync(bin); fs.mkdirSync(path.join(dir, 'vetted'));
  fs.writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
  const STATE = path.join(dir, 'state'), LOG = path.join(dir, 'log');
  fs.writeFileSync(STATE, '7 BitcoinSupplyChart.com-AGE.mp4\n8 BitcoinSupplyChart.com-Under-Over-150D.mp4\n');
  const files = ['BitcoinSupplyChart.com-AGE.mp4', 'BitcoinSupplyChart.com-Under-Over-150D.mp4'].map((f) => path.join(dir, 'vetted', f));
  for (const f of files) fs.writeFileSync(f, 'new ' + f);
  execFileSync('bash', [path.join(__dirname, '..', 'tools', 'video', 'replace-asset.sh'), 'video', ...files],
    { env: { PATH: bin + path.delimiter + process.env.PATH, STATE, LOG, GITHUB_REPOSITORY: 'o/r', RUNNER_TEMP: dir }, stdio: 'pipe' });
  assert.equal(fs.readFileSync(STATE, 'utf8'), '9 BitcoinSupplyChart.com-AGE.mp4\n10 BitcoinSupplyChart.com-Under-Over-150D.mp4\n', 'the same names, the new files');
  const log = fs.readFileSync(LOG, 'utf8').trim().split('\n');
  assert.match(log[0], /^release upload video \S+\/BitcoinSupplyChart\.com-AGE\.part\.mp4 --clobber$/, 'the same .mp4 ending, so the same content type');
  assert.deepEqual(log.filter((l) => /-X /.test(l)), ['api -X DELETE repos/o/r/releases/assets/7', 'api -X PATCH repos/o/r/releases/assets/9 -f name=BitcoinSupplyChart.com-AGE.mp4 --silent',
    'api -X DELETE repos/o/r/releases/assets/8', 'api -X PATCH repos/o/r/releases/assets/10 -f name=BitcoinSupplyChart.com-Under-Over-150D.mp4 --silent'], 'one file after the other');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('replace.')), [], 'its work folder is gone');
});

test('check-video.sh wants the 18,000 frames of a 5:00 video unless told otherwise, and leaves no file behind', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'video', 'check-video.sh'), 'utf8');
  assert.match(src, /^f=\$1; frames=\$\{FRAMES:-18000\}; err=""$/m);
  assert.match(src, /^trap 'rm -f "\$err"' EXIT/m, 'the decode\'s error log goes also when a check fails');
  const { spawnSync } = require('node:child_process');
  const r = spawnSync('bash', [path.join(__dirname, '..', 'tools', 'video', 'check-video.sh'), '/nonexistent/v.mp4'], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /no such file/);
});

test('render.mjs: segments of whole microseconds, resumed only for the same video, joined by absolute names; prices from the store', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'video', 'render.mjs'), 'utf8');
  // SEG frames at 60 fps must be a whole number of microseconds (ffmpeg's clock at the joins): a multiple of 3.
  assert.match(src, /if \(\(SEG \* 1e6\) % FPS !== 0\) throw new Error/);
  for (const [seg, ok] of [[180, true], [120, true], [3, true], [100, false], [50, false], [250, false]]) assert.equal((seg * 1e6) % 60 === 0, ok, String(seg));
  assert.match(src, /const segDir = path\.resolve\(OUT\) \+ "\.segments"/);
  assert.match(src, /JSON\.stringify\(\{ look: LOOK_NAME, frames: F, seg: SEG, days: N, first: days\[0\]\.date, last: days\[N - 1\]\.date, code: /);
  assert.match(src, /readFileSync\(paramsFile, "utf8"\) === params\)\) fs\.rmSync\(segDir/);
  assert.match(src, /process\.on\("exit", \(\) => fs\.rmSync\(pageFile, \{ force: true \}\)\)/);
  // The concat list's quoting, run: a ' in a path is written '\''.
  const quote = eval(/const quote = (\(p\) => .*?);/.exec(src)[1]);
  assert.equal(quote("/tmp/it's/v.mp4.segments/seg_000000.mp4"), "'/tmp/it'\\''s/v.mp4.segments/seg_000000.mp4'");
  // The price line is drawn from the closes the store recorded with each day, and nothing is downloaded.
  assert.doesNotMatch(src, /getJSON|bitview\.space|fetch\(/);
  assert.match(src, /for \(const \[date, , spot\] of meta\.days\) if \(spot > 0\) close\[dayIdx\(date\)\] = spot;/);
});

// page.html's own script, run without a browser: its layout helpers need no Plotly.
function pageScript() {
  const vm = require('node:vm');
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'video', 'page.html'), 'utf8');
  const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const c = vm.createContext({ window: { devicePixelRatio: 2 }, document: {}, Math, Date, String, Number, JSON });
  vm.runInContext(src, c);
  return c;
}
test('the video\'s price box: where the day\'s dot runs under it, it is moved to just below the dot, eased by render.mjs', () => {
  const c = pageScript();
  c.window.setTopMargin(68);
  // A day near a high: the price at 97% of the price line's top, the dot three quarters across the window, and the
  // dashed line far enough right that the box sits on its left, over the dot.
  const frame = { spot: 97000, redPct: 5, nb: 626, w: 110000 / 626, win: ['2025-01-01 00:00:00', '2026-01-01 00:00:00'], tx: '2025-10-01 00:00:00', date: '2025-10-01', pr: [0, 100000] };
  const pb = c.priceBox(frame);
  assert.equal(pb.flip, true, 'on the line\'s left');
  assert.ok(c.dotUnderBox(pb), 'the dot is under it');
  const [need] = c.window.boxNeeds([frame]);
  assert.equal(need, Math.ceil(pb.dot.y + 9 + 4), 'just below the dot');
  // Lower down the line, or with no price, nothing moves.
  assert.deepEqual(Array.from(c.window.boxNeeds([{ ...frame, pr: [0, 200000] }, { ...frame, spot: null }])), [0, 0]);
  // render.mjs holds each need a second either side and eases it over a third of a second, and drawFrame moves the box
  // (and what the landmark labels keep clear of) by exactly that.
  const render = fs.readFileSync(path.join(__dirname, '..', 'tools', 'video', 'render.mjs'), 'utf8');
  assert.match(render, /const need = await page\.evaluate\(\(fr\) => window\.boxNeeds\(fr\), facts\);/);
  assert.match(render, /const HOLD = 60, EASE = 10,/);
  assert.match(render, /drop: DROP \? DROP\[t\] : 0 \}/);
  const page = fs.readFileSync(path.join(__dirname, '..', 'tools', 'video', 'page.html'), 'utf8');
  assert.match(page, /spotBox = \{ x0: pb\.box\.x0, x1: pb\.box\.x1, y0: drop, h: pb\.box\.h \};/);
  assert.match(page, /yshift: -drop, yanchor: "top"/);
});

test('the store holds the smoothed age bands only: raw-YYYY files left from the RAW video are neither read nor written', async () => {
  const { readStore } = await import('../tools/video/store.mjs');
  const dir = store(['2026-01-01', '2026-01-02']);
  fs.writeFileSync(path.join(dir, 'raw-2026.f32.gz'), zlib.gzipSync(Buffer.from(new Float32Array(700).buffer)));   // not whole days: never looked at
  const s = readStore(dir);
  assert.deepEqual(Object.keys(s), ['meta', 'chunks', 'bars']);
  assert.equal(s.bars(1)[0], 2);
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'video', 'store.mjs'), 'utf8');
  assert.doesNotMatch(src.replace(/^\/\/.*$/gm, ''), /raw-|RAW_PER_DAY|rawBars|backfill/, 'nothing but comments names them');
  assert.match(src, /for \(const y of Object\.keys\(added\)\) appendYear\("bars", y, /);
});
