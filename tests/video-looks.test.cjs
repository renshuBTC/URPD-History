// The two videos, one for each of the site's weightings (USD and BTC): each draws its bars and its left axis as the site
// does in that weighting by default (Y-max 100 in USD, 99.8 in BTC, with the ▲ figure for the bars it cuts), colours
// them as the site does and words its chart as the site's English does (tools/video/looks.mjs and render.mjs against
// index.html); the Weekly videos workflow draws them once a week, renders, publishes and posts both, and its record step
// keeps each video's last viewable upload in data/youtube.json. The videos before them stay on the release under their
// own names, which nothing here writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const vm = require('node:vm');
const { app } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const load = () => import('../tools/video/looks.mjs');
const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'video.yml'), 'utf8');
function job(name) {
  const lines = workflow.split('\n'), start = lines.findIndex(l => l === `  ${name}:`);
  assert.ok(start >= 0, 'no job ' + name);
  const end = lines.findIndex((l, i) => i > start && /^ {2}[a-z][\w-]*:$/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

test('each video draws one of the site\'s two weightings as the site does by default: its bars coloured, its left axis set and its chart worded as the site does', async () => {
  const { LOOKS, AGE_LABELS, AGE_COLORS, titleStart, look, axisLevel } = await load();
  const { c } = app(), en = c.T.en;
  assert.deepEqual(AGE_LABELS, Array.from(c.AGE_BANDS, b => b.label));
  assert.deepEqual(AGE_COLORS, Array.from(c.AGE_BAND_COLORS));
  assert.deepEqual(Object.keys(LOOKS), ['usd', 'btc'], 'in the order of the site\'s USD and BTC buttons');
  // Each look is the site's weighting (VIEW_MODES), with the Y-max the site starts it at (yMaxByMode).
  assert.deepEqual(Object.values(LOOKS).map(L => L.coin), Array.from(c.VIEW_MODES, m => m.coin));
  assert.deepEqual(Object.values(LOOKS).map(L => L.yPct), Array.from(c.yMaxByMode));
  const KEYS = { usd: ['titleUSD', 'usdInvested', 'usd', 'USD'], btc: ['titleBTC', 'btcSupply', 'btc', 'BTC'] };
  for (const [k, [title, axis, unit, tag]] of Object.entries(KEYS)) {
    const L = LOOKS[k];
    assert.equal(titleStart(k), en[title], k);
    assert.equal(L.tag, tag, k + ': named as its button');
    assert.equal(L.yTitle, en[axis], k);
    assert.equal(L.profit, en[unit + 'Profit'], k);
    assert.equal(L.loss, en[unit + 'Loss'], k);
    assert.doesNotMatch(titleStart(k), /[<>]|Y-Max/, k + ': nothing YouTube refuses, and no Y-MAX mode');
    assert.deepEqual(Object.keys(L).sort(), ['coin', 'loss', 'profit', 'tag', 'title', 'yPct', 'yTitle'], k);
  }
  assert.throws(() => look('__proto__'), /no look/);
  for (const gone of ['ath', 'fit', 'age', 'raw', 'pct', 'pctusd', 'pctbtc']) assert.throws(() => look(gone), new RegExp(`no look "${gone}": usd or btc`));
  // The video's axisLevel is the site's, percentile for percentile.
  const rnd = (n, seed) => Array.from({ length: n }, (_, i) => ((i * 7919 + seed * 104729) % 1000) / 7 + (i % 5 === 0 ? 0 : 1));
  for (const vals of [rnd(626, 1), rnd(626, 2).map((v, i) => (i === 0 ? 1e6 : v)), rnd(626, 3).map((v, i) => (i % 3 ? 0 : v)), Array(626).fill(0), [5], []])
    for (const pct of [100, 99.8, 99, 90, 50, 1]) assert.equal(axisLevel(vals, pct), c.axisLevel(vals, pct), pct + '');
  // The drawing takes its layers, their names and colours and the chart's words from the frame, never a list of its own.
  const page = fs.readFileSync(path.join(ROOT, 'tools', 'video', 'page.html'), 'utf8');
  assert.doesNotMatch(page, /var LABELS|<1h|Bitcoin Supply by Price|Bitcoin URPD|Realized Cap|THEMES|light|Value When Last Moved \[USD\]/);
  for (const s of ['sp.labels', 'sp.colors', 'sp.title', 'sp.legendSize', 'sp.ymax', 'sp.ytt', 'esc(sp.yTitle)', 'esc(sp.cut)']) assert.ok(page.includes(s), s);
  // The ▲ figure at the top left, as on the site, and the price box and the landmarks keep clear of it.
  assert.match(page, /if \(cb\) ann\.push\(\{ x: 0, xref: "x", xanchor: "left", y: 1, yref: "paper", yanchor: "top", yshift: -2, text: esc\(sp\.cut\), showarrow: false,\s+font: \{ color: TH\.ink, size: 11, family: FONT \}, bgcolor: TH\.tagBg, borderpad: 2 \}\);/);
  assert.match(page, /var cb = cutBlock\(sp\), need = cb && pb\.box\.x0 < cb\.x1 \? cb\.y1 \+ 4 : 0;/);
  assert.match(page, /if \(cb\) blocks\.push\(cb\);/);
  assert.doesNotMatch(page, /sp\.read|sp\.first|topLeftBox|FIRST_W|PCT/);
  const render = fs.readFileSync(path.join(ROOT, 'tools', 'video', 'render.mjs'), 'utf8');
  assert.doesNotMatch(render, /Tallest Bar|read\.push|FIRST|pctText|PCT_TOP|LOOK\.pct|topOf/, 'no readout, no % views');
  assert.match(render, /const LOOK_NAME = process\.env\.LOOK \|\| "usd", LOOK = look\(LOOK_NAME\), TITLE = titleStart\(LOOK_NAME\);/);
  assert.match(render, /labels: AGE_LABELS, colors: AGE_COLORS, legendSize: 9,/, 'every bar in its 23 age bands, as the site draws them');
  assert.doesNotMatch(render, /PALETTE|#f8f919|store\.raw|LOOK\.source|LOOK\.theme|LOOK\.fit|yRun/, 'the colours come from looks.mjs');
  // The bars in dollars or coins as the look says; the left axis where the look's Y-max puts it, on each frame and each
  // still, with the bars above it counted for the ▲ figure; labelled as the site labels it.
  assert.ok(render.includes('const S = startIndex(store, LOOK.coin ? "btc" : "usd"), dayBars = LOOK.coin ? store.coins : store.bars;\n'));
  assert.ok(render.includes('    const level = axisLevel(whole, LOOK.yPct);\n    Y[t] = level > 0 ? level : 1;\n    [CUTN[t], CUTV[t]] = cutOf(whole, Y[t]);\n'));
  assert.ok(render.includes('  const ymax = exact === undefined ? Y[t] : axisLevel(a.cum[A - 1], LOOK.yPct) || 1;\n'));
  assert.ok(render.includes('  const yt = axisTicks(ymax), ytt = axisLabels(yt, LOOK.coin);\n'));
  // render.mjs's own copies of the site's axis labels and of its ▲ figure print what the site prints.
  const a = render.indexOf("// ---- the site's axis labels"), b = render.indexOf('// ---- frame t:');
  const ctx = vm.createContext({ Math, String, Number, Array });
  vm.runInContext(render.slice(a, b) + '\n;globalThis.fns = { axisTicks, axisLabels };', ctx);
  const f = ctx.fns;
  for (const unit of [false, true]) for (const end of [1, 7.3, 1100, 126000, 125650, 2.2e5, 2.77e6, 3.1e10])
    assert.deepEqual(Array.from(f.axisLabels(f.axisTicks(end), unit)), Array.from(c.axisLabels(c.axisTicks(end), unit)), unit + ' ' + end);
  const cutDefs = render.slice(render.indexOf('const cutOf ='), render.indexOf('\n{\n', render.indexOf('const cutOf =')));
  for (const coin of [false, true]) {
    const cctx = vm.createContext({ Math, String, Number, NB: 3, LOOK: { coin } });
    vm.runInContext(cutDefs + '\n;globalThis.fns = { cutOf, cutText };', cctx);
    for (const [n, v] of [[1, 2.77e6], [3, 6.1e9], [2, 12345]]) {
      const want = '▲ ' + (coin ? c.peakCompact(v) + ' BTC' : '$' + c.peakCompact(v)) + (n > 1 ? ' (+' + (n - 1) + ')' : '');
      assert.equal(cctx.fns.cutText(n, v), want, n + ' ' + v);
    }
    assert.equal(cctx.fns.cutText(0, 0), null);
    assert.deepEqual(Array.from(cctx.fns.cutOf([5, 1, 3], 2)), [2, 5]);
  }
});

test('the workflow renders and vets the two videos on runners of their own, publishes them together and posts each on its own', async () => {
  const { LOOKS } = await load();
  const env = Object.fromEntries([...workflow.matchAll(/^ {2}(VIDEO\w*): (\S+)$/gm)].map(m => [m[1], m[2]]));
  // Each file names its weighting, under the site's new name.
  assert.deepEqual(env, { VIDEO_USD: 'BitcoinURPD.com-USD.mp4', VIDEO_BTC: 'BitcoinURPD.com-BTC.mp4' });
  const ALL = ['usd', 'btc'], FILE = { usd: env.VIDEO_USD, btc: env.VIDEO_BTC };
  assert.doesNotMatch(workflow, /BitcoinSupplyChart\.com\.mp4|-AGE\.mp4|Under-Over-150D|-RAW\.mp4|lthsth|VIDEO_RAW|VIDEO_LTHSTH|VIDEO_ATH|VIDEO_FIT|VIDEO_PCT|youtube-age|youtube-raw|youtube-ath|youtube-fit|youtube-pct|video-vetted-ath|video-vetted-fit|pctusd|pctbtc/);
  // The videos before them are named only in comments and in the release notes: never uploaded, renamed or deleted.
  for (const l of workflow.split('\n').filter(l => /BitcoinSupplyChart\.com/.test(l))) assert.match(l, /^\s*#|^\s+NOTES="/, l);
  // One leg a video, from the update job (the looks the run draws, named as in env); one failing leg does not cancel
  // the other.
  const matrix = `      fail-fast: false
      matrix:
        include: \${{ fromJSON(needs.update.outputs.include) }}
`;
  for (const name of ['render', 'vet']) assert.ok(job(name).includes(matrix), name);
  assert.match(job('vet'), /needs: \[update, render\]/);
  // Scheduled: both. By hand: both, or only the one asked for; anything else stops the run.
  for (const [ONLY, looks] of [['', ALL], ['all', ALL], ...ALL.map(l => [l, [l]])]) {
    const out = only(ONLY, env);
    assert.equal(out.status, 0, ONLY);
    assert.deepEqual(JSON.parse(out.looks), looks, ONLY);
    assert.deepEqual(JSON.parse(out.include), looks.map((l) => ({ look: l, file: FILE[l] })), ONLY);
    assert.equal(out.only, ONLY || 'all');
  }
  for (const bad of ['everything', 'age', 'raw', 'lthsth', 'ath', 'fit', 'pct', 'pctusd', 'pctbtc']) assert.notEqual(only(bad, env).status, 0, bad + ': no such video');
  assert.match(workflow, /workflow_dispatch:\n\s+inputs:\n\s+only:\n\s+description: .*\n\s+type: choice\n\s+options: \[all, usd, btc\]\n\s+default: all\n/);
  // A run for one video leaves the release, and so the week, as they are.
  assert.match(job('publish'), /- name: Publish the videos\n\s+if: needs\.update\.outputs\.only == 'all'\n/);
  assert.deepEqual(Object.keys(LOOKS), ALL);
  const render = job('render');
  assert.match(render, /LOOK: \$\{\{ matrix\.look \}\}/);
  assert.match(render, /run: node tools\/video\/render\.mjs "\$RUNNER_TEMP\/store" "\$RUNNER_TEMP\/\$FILE"/);
  assert.match(render, /name: video-\$\{\{ matrix\.look \}\}/);
  assert.match(job('vet'), /name: video-vetted-\$\{\{ matrix\.look \}\}\n.*\n.*\n\s+retention-days: 7 /, 'kept a week, for re-runs');
  // Each video starts on its own first day: in coins where the chart first shows anything, in dollars at the first
  // realized cap above zero (tools/video/store.mjs startIndex), and the update job hands both on.
  const update = job('update');
  assert.match(update, /start: \$\{\{ steps\.store\.outputs\.start \}\}[^\n]*\n\s+start_usd: \$\{\{ steps\.store\.outputs\.start_usd \}\}/);
  assert.match(update, /console\.log\(s\.meta\.days\[startIndex\(s, 'btc'\)\]\[0\], s\.meta\.days\[startIndex\(s, 'usd'\)\]\[0\]\);/);
  assert.match(update, /gh release download video-store-2 /);
  assert.match(update, /bash tools\/video\/replace-asset\.sh video-store-2 "\$\{CHANGED\[@\]\}"/);
  assert.doesNotMatch(workflow, /release (download|view|upload) video-store(?!-2)|video-data/, 'the stores before it are never read or written');
  // After vet, every artifact is taken by its exact name: a pattern also took in any artifact of the run whose name
  // matched, and the render job (third-party code) could have made one to replace a vetted file.
  assert.doesNotMatch(workflow, /pattern:|merge-multiple/);
  const downloads = (block) => [...block.matchAll(/uses: actions\/download-artifact@\S+ # v[\d.]+\n(?:\s+if: .*\n)?\s+with:\n\s+name: (\S+)\n\s+path: (\S+)/g)].map(m => m[1] + ' -> ' + m[2]);
  assert.deepEqual(downloads(job('publish')), ALL.map(l => `video-vetted-${l} -> \${{`));
  for (const l of ALL) assert.match(job('publish'), new RegExp(`name: video-vetted-${l}\\n\\s+path: \\$\\{\\{ runner\\.temp \\}\\}/vetted\\n`), l);
  assert.ok(job('publish').includes('replace-asset.sh video "$RUNNER_TEMP/vetted/$VIDEO_USD" "$RUNNER_TEMP/vetted/$VIDEO_BTC"\n'), 'both, together');
  // Each video posted from a job of its own with its own look, file and first day, so a failed post can be run again alone.
  for (const [look, file, start, name] of [['usd', 'VIDEO_USD', 'start_usd', 'USD'], ['btc', 'VIDEO_BTC', 'start', 'BTC']]) {
    const yt = job('youtube-' + look);
    assert.match(yt, new RegExp(`needs: \\[update, publish\\]\\n\\s+if: contains\\(fromJSON\\(needs\\.update\\.outputs\\.looks\\), '${look}'\\)\\n`), look + ': posted when the run drew it');
    assert.match(job('publish'), new RegExp(`if: contains\\(fromJSON\\(needs\\.update\\.outputs\\.looks\\), '${look}'\\)\\n\\s+with:\\n\\s+name: video-vetted-${look}\\n`), look + ': downloaded when the run drew it');
    assert.deepEqual(downloads(yt), [`video-vetted-${look} -> \${{`], look);
    assert.equal((yt.match(/run: node tools\/video\/youtube\.mjs /g) || []).length, 1, look);
    assert.ok(yt.includes(`run: node tools/video/youtube.mjs "$RUNNER_TEMP/vetted/$${file}" "$START" "$END" ${look} >> "$GITHUB_OUTPUT"`), look);
    assert.ok(yt.includes(`          START: \${{ needs.update.outputs.${start} }}\n`), look + ': its own first day');
    assert.match(yt, /outputs:\n\s+id: \$\{\{ steps\.post\.outputs\.id \}\}\n\s+privacy: \$\{\{ steps\.post\.outputs\.privacy \}\}\n/, look);
    assert.ok(yt.includes(`      - name: Post the ${name} video to YouTube\n        id: post\n        if: steps.creds.outputs.found == 'yes'\n`), look);
  }
  assert.doesNotMatch(workflow, /^ {2}youtube:$/m, 'no job posts them all');
  // The record job runs once either video is viewable, also when the other's post failed, never on a cancelled run,
  // and names each from its own job's outputs; it starts from the latest main.
  const record = job('record');
  assert.ok(record.includes(`    needs: [update, youtube-usd, youtube-btc]
    if: >-
      \${{ !cancelled() && (
        needs.youtube-usd.outputs.privacy == 'unlisted' || needs.youtube-usd.outputs.privacy == 'public' ||
        needs.youtube-btc.outputs.privacy == 'unlisted' || needs.youtube-btc.outputs.privacy == 'public') }}
`), 'the whole condition');
  for (const l of ALL) for (const [v, out] of [['_ID', 'id'], ['_PRIVACY', 'privacy']])
    assert.ok(record.includes(`          ${l.toUpperCase()}${v}: \${{ needs.youtube-${l}.outputs.${out} }}\n`), l + v);
  assert.match(record, /uses: actions\/checkout@\S+ # v[\d.]+\n\s+with:\n\s+ref: main\n/);
  // Only runs on main wait for each other; a run by hand on another branch (which does nothing) has a group of its own.
  assert.match(workflow, /^concurrency:\n {2}group: \$\{\{ github\.ref == 'refs\/heads\/main' && 'daily-video' \|\| format\('video-\{0\}', github\.run_id\) \}\}\n {2}cancel-in-progress: false$/m);
});

test('the uploader writes exactly the two lines the youtube jobs read as their outputs', async () => {
  const { githubOutput } = await import('../tools/video/youtube.mjs');
  assert.equal(githubOutput({ id: 'AAAAAAAAAAA', privacy: 'unlisted' }), 'id=AAAAAAAAAAA\nprivacy=unlisted\n');
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'video', 'youtube.mjs'), 'utf8');
  assert.match(src, /\n {2}process\.stdout\.write\(githubOutput\(\{ id, privacy \}\)\);\n\}\n$/, 'the only thing it prints to stdout, last');
  assert.equal((src.match(/process\.stdout\.write/g) || []).length, 1);
});

// The update job's choice of videos, run as the workflow runs it (bash -e, jq), for a given ONLY (inputs.only).
function only(ONLY, env) {
  const block = job('update'), a = block.indexOf('          # Which videos:'), b = block.indexOf('          } >> "$GITHUB_OUTPUT"\n', a);
  assert.ok(a > 0 && b > a, 'the choice');
  const script = block.slice(a, b + '          } >> "$GITHUB_OUTPUT"\n'.length).split('\n').map(l => l.slice(10)).join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'only-')), out = path.join(dir, 'out');
  fs.writeFileSync(out, '');
  const r = spawnSync('bash', ['-e', '-c', script], { env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, ONLY, ...env }, encoding: 'utf8' });
  const kv = Object.fromEntries(fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  return { status: r.status, ...kv };
}

// The record job's script, run as the workflow runs it (bash -e), with jq, in a copy of the repository's data folder.
function record(env, before) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data', 'youtube.json'), before);
  const block = job('record'), run = block.slice(block.indexOf('        run: |\n') + '        run: |\n'.length);
  const script = run.split('\n').map(l => l.slice(10)).join('\n').split('git config user.name')[0];
  execFileSync('bash', ['-e', '-c', script], { cwd: dir, env: { PATH: process.env.PATH, RUNNER_TEMP: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  return fs.readFileSync(path.join(dir, 'data', 'youtube.json'), 'utf8');
}
function haveJq() { try { execFileSync('jq', ['--version'], { stdio: 'ignore' }); execFileSync('bash', ['-c', 'true']); return true; } catch (e) { return false; } }

test('the record step writes both videos, and keeps a video\'s last viewable upload when today\'s is not', { skip: !haveJq() && 'needs bash and jq' }, () => {
  const before = fs.readFileSync(path.join(ROOT, 'data', 'youtube.json'), 'utf8');
  const ALL = ['usd', 'btc'], ids = { usd: 'AAAAAAAAAAA', btc: 'BBBBBBBBBBB' };
  const both = { END: '2026-09-25' };
  for (const l of ALL) { both[l.toUpperCase() + '_ID'] = ids[l]; both[l.toUpperCase() + '_PRIVACY'] = l === 'btc' ? 'public' : 'unlisted'; }
  const all = JSON.parse(record(both, before));
  assert.deepEqual(Object.keys(all), ['about', ...ALL], 'the committed file\'s layout');
  assert.match(all.about, /^The latest videos on YouTube for the site's two video buttons, one for each weighting: .* Written by \.github\/workflows\/video\.yml /);
  assert.equal(all.about, JSON.parse(before).about, 'the committed file says the same');
  for (const l of ALL) assert.deepEqual(all[l], { id: ids[l], end: '2026-09-25' }, l);
  assert.equal(record(both, before), JSON.stringify(all, null, 2) + '\n', 'the same layout as the committed file');
  // The committed file is what the step writes: recording again any video it names leaves it byte for byte as it is,
  // and a post that failed for both leaves it as it is too.
  const now = JSON.parse(before);
  for (const k of ALL) {
    if (!now[k]) continue;
    const K = k.toUpperCase();
    assert.equal(record({ END: now[k].end, [K + '_ID']: now[k].id, [K + '_PRIVACY']: 'unlisted' }, before), before, k);
  }
  assert.equal(record({ END: '2026-09-25' }, before), before, 'nothing viewable: nothing changes');
  // A private upload and a malformed id each leave that video's entry as it was; a failed post too, beside one that is new.
  const earlier = JSON.stringify({ about: 'x', usd: { id: 'OldUsdVideo', end: '2026-09-24' }, btc: { id: 'OldBtcVideo', end: '2026-09-24' } });
  let r = JSON.parse(record({ END: '2026-09-25', USD_ID: 'CCCCCCCCCCC', USD_PRIVACY: 'private', BTC_ID: 'DDDDDDDDDDD', BTC_PRIVACY: 'unlisted' }, earlier));
  assert.deepEqual(r.usd, { id: 'OldUsdVideo', end: '2026-09-24' }, 'a private upload');
  assert.deepEqual(r.btc, { id: 'DDDDDDDDDDD', end: '2026-09-25' }, 'a viewable one beside it');
  r = JSON.parse(record({ END: '2026-09-25', USD_ID: 'EEEEEEEEEE"', USD_PRIVACY: 'unlisted', BTC_ID: '', BTC_PRIVACY: '' }, earlier));
  assert.deepEqual(r.usd, { id: 'OldUsdVideo', end: '2026-09-24' }, 'a malformed id');
  assert.deepEqual(r.btc, { id: 'OldBtcVideo', end: '2026-09-24' }, 'a failed post');
  for (const [id, privacy] of [['bad', 'public'], ['FFFFFFFFFFF', 'public']]) {
    const one = JSON.parse(record({ END: '2026-09-25', BTC_ID: id, BTC_PRIVACY: privacy }, earlier));
    assert.deepEqual(one.btc, id === 'bad' ? { id: 'OldBtcVideo', end: '2026-09-24' } : { id, end: '2026-09-25' }, id);
  }
  // A file with nothing for a video yet keeps null there until one is viewable; the videos a file from before names
  // under other keys are not carried over.
  assert.equal(JSON.parse(record({ END: '2026-10-01', USD_ID: 'AAAAAAAAAAA', USD_PRIVACY: 'unlisted' }, JSON.stringify({ about: 'x', usd: null, btc: null }))).btc, null);
  const fromBefore = JSON.parse(record({ END: '2026-10-01', USD_ID: 'AAAAAAAAAAA', USD_PRIVACY: 'unlisted' }, JSON.stringify({ about: 'x', ath: { id: 'YqGYoIqKJ5s', end: '2026-09-26' }, fit: { id: 'I53s3vHbcFI', end: '2026-09-26' } })));
  assert.deepEqual(fromBefore, { about: all.about, usd: { id: 'AAAAAAAAAAA', end: '2026-10-01' }, btc: null });
  assert.throws(() => record({ END: 'x', USD_ID: 'AAAAAAAAAAA', USD_PRIVACY: 'unlisted' }, before), 'a day that is not a date stops it');
});

// The publish job's release notes for videos from START (BTC) and START_USD to END, as it writes them (bash, sha256sum).
function notes(START, END, START_USD = '2011-01-31') {
  const block = job('publish'), a = block.indexOf('          SHA_USD=$(sha256sum'), b = block.indexOf('(see SECURITY.md)"\n', a);
  assert.ok(a > 0 && b > a, 'the notes');
  const script = block.slice(a, b + '(see SECURITY.md)"\n'.length).split('\n').map(l => l.slice(10)).join('\n') + 'printf "%s" "$NOTES"\n';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));
  fs.mkdirSync(path.join(dir, 'vetted'));
  const env = Object.fromEntries([...workflow.matchAll(/^ {2}(VIDEO\w*): (\S+)$/gm)].map(m => [m[1], m[2]]));
  for (const f of Object.values(env)) fs.writeFileSync(path.join(dir, 'vetted', f), f);
  return execFileSync('bash', ['-e', '-c', script], { env: { PATH: process.env.PATH, RUNNER_TEMP: dir, START, START_USD, END, GITHUB_REPOSITORY: 'o/r', ...env }, encoding: 'utf8' });
}
// The update job's reading of the published videos' day and its decision whether new ones are due, run as the
// workflow runs it (bash -e, GNU date), with a stand-in gh that answers from the notes given (or fails as told), a
// sleep that does not wait, and the axis history ending on SCALES_END.
function due({ NOTES = '', GH_ERR = '', SCALES_END = '2026-12-31', ...env }) {
  const block = job('update'), a = block.indexOf("          # The published videos' last day"), b = block.indexOf('\n          fi\n', a);
  assert.ok(a > 0 && b > a, 'the decision block');
  const script = block.slice(a, b + '\n          fi\n'.length).split('\n').map(l => l.slice(10)).join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'due-')), out = path.join(dir, 'out'), bin = path.join(dir, 'bin'), calls = path.join(dir, 'calls');
  fs.mkdirSync(bin); fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data', 'scales.json'), JSON.stringify({ end: SCALES_END }));
  fs.writeFileSync(path.join(bin, 'gh'), '#!/usr/bin/env bash\necho "$*" >> "$CALLS"\n' +
    'if [ -n "$GH_ERR" ]; then echo "gh: $GH_ERR" >&2; exit 1; fi\nprintf "%s\\n" "$NOTES"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(out, ''); fs.writeFileSync(calls, '');
  const res = spawnSync('bash', ['-e', '-c', script], { cwd: dir, encoding: 'utf8',
    env: { PATH: bin + path.delimiter + process.env.PATH, GITHUB_OUTPUT: out, GITHUB_EVENT_NAME: 'schedule', GITHUB_REPOSITORY: 'o/r', RUNNER_TEMP: dir, CALLS: calls, NOTES, GH_ERR, ...env } });
  return { render: fs.readFileSync(out, 'utf8').includes('render=yes'), said: res.stdout + res.stderr, status: res.status,
    calls: fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean) };
}
function haveGnuDate() { try { return execFileSync('date', ['-u', '-d', '2026-09-24 + 7 days', '+%F'], { encoding: 'utf8' }).trim() === '2026-10-01'; } catch (e) { return false; } }

test('new videos are drawn once a week: seven days after the published ones, at once if there are none, and on a run started by hand', { skip: !haveGnuDate() && 'needs GNU date' }, () => {
  const shown = (day) => notes('2010-05-18', day);   // the notes the publish job wrote for videos through that day
  assert.equal(due({ END: '2026-09-30', NOTES: shown('2026-09-24') }).render, false, 'six days on');
  assert.match(due({ END: '2026-09-30', NOTES: shown('2026-09-24') }).said, /the next are drawn once the store reaches 2026-10-01/);
  assert.equal(due({ END: '2026-10-01', NOTES: shown('2026-09-24') }).render, true, 'seven days on');
  assert.equal(due({ END: '2026-10-04', NOTES: shown('2026-09-24') }).render, true, 'after missed runs');
  assert.equal(due({ END: '2027-01-04', NOTES: shown('2026-12-28') }).render, true, 'across a year');
  assert.equal(due({ END: '2026-09-20', NOTES: shown('2026-09-24') }).render, false, 'a store still catching up');
  assert.match(due({ END: '2026-09-20', NOTES: shown('2026-09-24') }).said, /behind the published videos/);
  // By hand: new videos whenever the store is not behind, the same days included.
  for (const [END, want] of [['2026-09-24', true], ['2026-09-26', true], ['2026-09-20', false]]) {
    assert.equal(due({ END, NOTES: shown('2026-09-24'), GITHUB_EVENT_NAME: 'workflow_dispatch' }).render, want, END);
  }
  // The schedule itself stays daily: the axis history needs every day.
  assert.match(workflow, /^name: Weekly videos$/m);
  assert.match(workflow, /- cron: "23 1 \* \* \*"\n\s+- cron: "23 5 \* \* \*"/);
});

test('the published videos\' day is the last date in the notes the publish job writes, whatever else they hold', { skip: !haveGnuDate() && 'needs GNU date' }, () => {
  const text = notes('2010-05-18', '2026-09-24', '2011-01-31');
  assert.ok(text.startsWith("Two videos, one for each of the site's weightings, as the site draws it by default: BitcoinURPD.com-USD.mp4 (the bars in dollars, the left axis at each day's tallest bar), " +
    "every day from 2011-01-31 (the first with a realized cap above zero), and BitcoinURPD.com-BTC.mp4 (the bars in coins, the left axis at the 99.8th percentile of each day's bars, " +
    "the first bar running off the top with its height printed there), every day from 2010-05-18 (the first with anything on the chart), both to 2026-09-24. "), text.slice(0, 400));
  assert.match(text, /\nSHA-256 of BitcoinURPD\.com-USD\.mp4: [0-9a-f]{64}\nSHA-256 of BitcoinURPD\.com-BTC\.mp4: [0-9a-f]{64}\nCheck any file here: gh attestation verify FILE --repo o\/r \(see SECURITY\.md\)$/);
  const r = due({ END: '2026-09-30', NOTES: text });
  assert.deepEqual([r.render, r.calls], [false, ['api repos/o/r/releases/tags/video --jq .body']]);
  assert.match(r.said, /The published videos run to 2026-09-24;/, 'the last date, not the first');
  // The notes the Y-MAX videos left on the release, which the first run of these reads: they run to 2026-09-26.
  const ymax = 'Every day from 2010-05-18 (the first with anything on the chart) to 2026-09-26, 5 minutes at 60 fps, 3840x2160, H.264, in two videos: ' +
    'BitcoinSupplyChart.com-Y-Max-Expands-On-ATH.mp4 with the left axis at the tallest bar so far (Y-MAX EXPANDS ON ATH), and BitcoinSupplyChart.com-Y-Max-Always-At-100-Percent.mp4 ' +
    "with it at each day's own tallest bar (Y-MAX ALWAYS AT 100%). Drawn again once a week by the Weekly videos workflow, which posts them to YouTube; the site does not link to these files.\n\n" +
    'SHA-256 of BitcoinSupplyChart.com-Y-Max-Expands-On-ATH.mp4: 70b66800dbf61eaefb35658f4274b60e7cc095487e4c4196ebfb3bd1614345b4\n' +
    'SHA-256 of BitcoinSupplyChart.com-Y-Max-Always-At-100-Percent.mp4: fbc491f51f289eaafa515cdb99113cd4871850c5b7d7ef5c11d446845eceea9e\n' +
    'Check either: gh attestation verify FILE --repo renshuBTC/URPD-History (see SECURITY.md)';
  assert.match(due({ END: '2026-09-27', NOTES: ymax }).said, /The published videos run to 2026-09-26; the next are drawn once the store reaches 2026-10-03\./);
  assert.equal(due({ END: '2026-09-27', NOTES: ymax, GITHUB_EVENT_NAME: 'workflow_dispatch' }).render, true, 'by hand, at once');
});

test('no published videos: only a 404 says so, and then the videos wait for a store with every day; any other failure stops the run', { skip: !haveGnuDate() && 'needs GNU date' }, () => {
  const none = due({ END: '2026-09-24', GH_ERR: 'Not Found (HTTP 404)', SCALES_END: '2026-09-24' });
  assert.deepEqual([none.status, none.render, none.calls.length], [0, true, 1], 'no release: the first videos, at once');
  const rebuilding = due({ END: '2026-03-01', GH_ERR: 'Not Found (HTTP 404)', SCALES_END: '2026-09-24' });
  assert.deepEqual([rebuilding.status, rebuilding.render], [0, false], 'but not from a store still being rebuilt');
  assert.match(rebuilding.said, /No videos are published yet, and the store runs to 2026-03-01 of 2026-09-24: it catches up first\./);
  // A server error is tried again, and in the end stops the run instead of passing for "no videos".
  const down = due({ END: '2026-09-24', GH_ERR: 'HTTP 502', SCALES_END: '2026-09-24' });
  assert.deepEqual([down.status, down.render, down.calls.length], [1, false, 5]);
  assert.match(down.said, /gh: HTTP 502/);
});
