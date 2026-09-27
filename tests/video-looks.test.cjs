// The two videos, USD VALUE and BTC: each draws every bar as its percent of the day's total on the site's fixed left
// axis, colours its bars as the site does and words its chart as the site's English does (tools/video/looks.mjs and
// render.mjs against index.html); the Weekly videos workflow draws them once a week, renders, publishes and posts both,
// and its record step keeps each video's last viewable upload in data/youtube.json. The Y-MAX videos before them stay
// on the release under their own names, which nothing here writes.
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

test('each video colours its bars exactly as the site does, draws each bar as its percent on the site\'s fixed axis, and words its chart as the site\'s English does', async () => {
  const { LOOKS, AGE_LABELS, AGE_COLORS, PCT_TOP, titleStart, look } = await load();
  const { c } = app(), en = c.T.en;
  assert.deepEqual(AGE_LABELS, Array.from(c.AGE_BANDS, b => b.label));
  assert.deepEqual(AGE_COLORS, Array.from(c.AGE_BAND_COLORS));
  assert.equal(PCT_TOP, c.PCT_TOP);
  assert.deepEqual(Object.keys(LOOKS), ['usd', 'btc']);
  assert.deepEqual([LOOKS.usd.coin, LOOKS.btc.coin], [false, true], 'usd: of the realized cap; btc: of the supply');
  for (const [k, K] of [['usd', 'USD'], ['btc', 'BTC']]) {
    const L = LOOKS[k];
    assert.equal(titleStart(k), en['title' + K], k);
    assert.equal(L.tag, en['vid' + k], k + ': named as its button');
    assert.equal(L.yTitle, en[k === 'usd' ? 'pctUsdAxis' : 'pctBtcAxis'], k);
    assert.equal(L.total, en['readTotal' + K], k);
    assert.equal(L.profit, en[k + 'Profit'], k);
    assert.equal(L.loss, en[k + 'Loss'], k);
    assert.doesNotMatch(titleStart(k), /[<>]/, k + ': nothing YouTube refuses');
  }
  assert.equal(titleStart('usd'), 'Bitcoin: Percent of Realized Cap by Price When Last Moved as of ');
  assert.equal(titleStart('btc'), 'Bitcoin: Percent of Supply by Price When Last Moved as of ');
  assert.throws(() => look('__proto__'), /no look/);
  for (const gone of ['ath', 'fit', 'age']) assert.throws(() => look(gone), new RegExp(`no look "${gone}": usd or btc`));
  // The drawing takes its layers, their names and colours and the chart's words from the frame, never a list of its own.
  const page = fs.readFileSync(path.join(ROOT, 'tools', 'video', 'page.html'), 'utf8');
  assert.doesNotMatch(page, /var LABELS|<1h|Bitcoin Supply by Price|Bitcoin: Percent|Realized Cap|THEMES|light|Value When Last Moved \[USD\]/);
  for (const s of ['sp.labels', 'sp.colors', 'sp.title', 'sp.legendSize', 'sp.ymax', 'sp.ytt', 'esc(sp.yTitle)', 'sp.read', 'sp.first']) assert.ok(page.includes(s), s);
  const render = fs.readFileSync(path.join(ROOT, 'tools', 'video', 'render.mjs'), 'utf8');
  assert.match(render, /const LOOK_NAME = process\.env\.LOOK \|\| "usd", LOOK = look\(LOOK_NAME\), TITLE = titleStart\(LOOK_NAME\);/);
  assert.match(render, /labels: AGE_LABELS, colors: AGE_COLORS, legendSize: 9,/, 'every bar in its 23 age bands, as the site draws them');
  assert.doesNotMatch(render, /PALETTE|#f8f919|store\.raw|LOOK\.source|LOOK\.theme|LOOK\.fit|yRun|Y\[t\]/, 'the colours come from looks.mjs; one fixed left axis');
  // The left axis on every frame: 0 to PCT_TOP, labelled as the site labels it; each bar its percent of the day's total,
  // in dollars or coins as its look says.
  assert.ok(render.includes('  const ymax = PCT_TOP, yt = axisTicks(ymax), ytt = axisLabels(yt, "pct");\n'));
  assert.ok(render.includes('const S = startIndex(store, LOOK_NAME), dayBars = LOOK.coin ? store.coins : store.bars;\n'));
  assert.ok(render.includes('  const toPct = total > 0 ? 100 / total : 0;\n'));
  // The readout at the top left, as the site words it.
  assert.equal(en.readTallest, 'Tallest Bar: ');
  assert.ok(render.includes('read.push("Tallest Bar: " + pctText(whole[top]) + " \\u00b7 " + money(whole[top] * total / 100) + " \\u00b7 " + priceText(top * w, w) + "\\u2013" + priceText((top + 1) * w, w));'));
  assert.ok(render.includes('const first = LOOK.coin && whole[0] > ymax ? "\\u25b2 " + pctText(whole[0]) : null;'), 'in BTC the first bar\'s ▲ figure, as on the site');
  // render.mjs's own copies of the site's figures print what the site prints.
  const a = render.indexOf("// ---- the site's axis labels"), b = render.indexOf('// ---- frame t:');
  const ctx = vm.createContext({ Math, String, Number, Array });
  vm.runInContext(render.slice(a, b) + '\n;globalThis.fns = { axisTicks, axisLabels, peakCompact, pctText };', ctx);
  const f = ctx.fns;
  assert.deepEqual(Array.from(f.axisLabels(f.axisTicks(PCT_TOP), 'pct')), Array.from(c.axisLabels(c.axisTicks(4), 'pct')));
  for (const end of [1, 7.3, 1100, 126000, 125650, 2.2e5]) assert.deepEqual(Array.from(f.axisLabels(f.axisTicks(end), false)), Array.from(c.axisLabels(c.axisTicks(end), false)), String(end));
  for (const v of [0, 0.5, 999.994, 1234.5, 2.5e6, 3.1e9, 1.06e12, 20.09e6]) assert.equal(f.peakCompact(v), c.peakCompact(v), String(v));
  for (const v of [0.012345, 1.5, 2.3249, 13.84, 99.96, 100]) assert.equal(f.pctText(v), c.pctText(v), String(v));
});

test('the workflow renders and vets both videos on runners of their own, publishes them together and posts each on its own', async () => {
  const { LOOKS } = await load();
  const env = Object.fromEntries([...workflow.matchAll(/^ {2}(VIDEO\w*): (\S+)$/gm)].map(m => [m[1], m[2]]));
  // Each file names what its bars are a percent of, with % written Percent (a link to the file would have to write it %25).
  assert.deepEqual(env, { VIDEO_USD: 'BitcoinSupplyChart.com-Percent-of-Realized-Cap.mp4', VIDEO_BTC: 'BitcoinSupplyChart.com-Percent-of-Supply.mp4' });
  assert.doesNotMatch(workflow, /BitcoinSupplyChart\.com\.mp4|-AGE\.mp4|Under-Over-150D|-RAW\.mp4|lthsth|VIDEO_RAW|VIDEO_LTHSTH|VIDEO_ATH|VIDEO_FIT|youtube-age|youtube-raw|youtube-ath|youtube-fit|video-vetted-ath|video-vetted-fit/);
  // The Y-MAX videos are named only in comments and in the release notes, which keep their SHA-256: never uploaded,
  // renamed or deleted.
  const ymax = workflow.split('\n').filter(l => /Y-Max/.test(l));
  assert.ok(ymax.length >= 3);
  for (const l of ymax) assert.match(l, /^\s*#|^\s+NOTES="|^\s+SHA-256 of BitcoinSupplyChart\.com-Y-Max-[A-Za-z0-9-]+\.mp4: [0-9a-f]{64}$/, l);
  // One leg a video, from the update job (the looks the run draws, named as in env); one failing leg does not cancel
  // the other.
  const matrix = `      fail-fast: false
      matrix:
        include: \${{ fromJSON(needs.update.outputs.include) }}
`;
  for (const name of ['render', 'vet']) assert.ok(job(name).includes(matrix), name);
  assert.match(job('vet'), /needs: \[update, render\]/);
  // Scheduled: both. By hand: both, or only the one asked for; anything else stops the run.
  for (const [ONLY, looks] of [['', ['usd', 'btc']], ['all', ['usd', 'btc']], ['usd', ['usd']], ['btc', ['btc']]]) {
    const out = only(ONLY, env);
    assert.equal(out.status, 0, ONLY);
    assert.deepEqual(JSON.parse(out.looks), looks, ONLY);
    assert.deepEqual(JSON.parse(out.include), looks.map((l) => ({ look: l, file: { usd: env.VIDEO_USD, btc: env.VIDEO_BTC }[l] })), ONLY);
    assert.equal(out.only, ONLY || 'all');
  }
  for (const bad of ['everything', 'age', 'raw', 'lthsth', 'ath', 'fit']) assert.notEqual(only(bad, env).status, 0, bad + ': no such video');
  assert.match(workflow, /workflow_dispatch:\n\s+inputs:\n\s+only:\n\s+description: .*\n\s+type: choice\n\s+options: \[all, usd, btc\]\n\s+default: all\n/);
  // A run for one video leaves the release, and so the week, as they are.
  assert.match(job('publish'), /- name: Publish the videos\n\s+if: needs\.update\.outputs\.only == 'all'\n/);
  assert.deepEqual(Object.keys(LOOKS), ['usd', 'btc']);
  const render = job('render');
  assert.match(render, /LOOK: \$\{\{ matrix\.look \}\}/);
  assert.match(render, /run: node tools\/video\/render\.mjs "\$RUNNER_TEMP\/store" "\$RUNNER_TEMP\/\$FILE"/);
  assert.match(render, /name: video-\$\{\{ matrix\.look \}\}/);
  assert.match(job('vet'), /name: video-vetted-\$\{\{ matrix\.look \}\}\n.*\n.*\n\s+retention-days: 7 /, 'kept a week, for re-runs');
  // Each video starts on its own first day: BTC where the chart first shows anything, USD at the first realized cap
  // above zero (tools/video/store.mjs startIndex), and the update job hands both on.
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
  assert.deepEqual(downloads(job('publish')), ['video-vetted-usd -> ${{', 'video-vetted-btc -> ${{']);
  assert.match(job('publish'), /name: video-vetted-usd\n\s+path: \$\{\{ runner\.temp \}\}\/vetted\n[\s\S]*name: video-vetted-btc\n\s+path: \$\{\{ runner\.temp \}\}\/vetted\n/);
  assert.match(job('publish'), /replace-asset\.sh video "\$RUNNER_TEMP\/vetted\/\$VIDEO_USD" "\$RUNNER_TEMP\/vetted\/\$VIDEO_BTC"\n/, 'both, together');
  // Each video posted from a job of its own with its own look, file and first day, so a failed post can be run again alone.
  for (const [look, file, start, name] of [['usd', 'VIDEO_USD', 'start_usd', 'USD VALUE'], ['btc', 'VIDEO_BTC', 'start', 'BTC']]) {
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
  assert.doesNotMatch(workflow, /^ {2}youtube:$/m, 'no job posts both');
  // The record job runs once either video is viewable, also when the other's post failed, never on a cancelled run,
  // and names each from its own job's outputs; it starts from the latest main.
  const record = job('record');
  assert.ok(record.includes(`    needs: [update, youtube-usd, youtube-btc]
    if: >-
      \${{ !cancelled() && (
        needs.youtube-usd.outputs.privacy == 'unlisted' || needs.youtube-usd.outputs.privacy == 'public' ||
        needs.youtube-btc.outputs.privacy == 'unlisted' || needs.youtube-btc.outputs.privacy == 'public') }}
`), 'the whole condition');
  for (const [v, out] of [['USD_ID', 'youtube-usd.outputs.id'], ['USD_PRIVACY', 'youtube-usd.outputs.privacy'], ['BTC_ID', 'youtube-btc.outputs.id'], ['BTC_PRIVACY', 'youtube-btc.outputs.privacy']])
    assert.ok(record.includes(`          ${v}: \${{ needs.${out} }}\n`), v);
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
  const both2 = { END: '2026-09-25', USD_ID: 'AAAAAAAAAAA', USD_PRIVACY: 'unlisted', BTC_ID: 'BBBBBBBBBBB', BTC_PRIVACY: 'public' };
  const both = JSON.parse(record(both2, before));
  assert.deepEqual(Object.keys(both), ['about', 'usd', 'btc'], 'the committed file\'s layout');
  assert.match(both.about, /^The latest videos on YouTube for the site's two video buttons: .* Written by \.github\/workflows\/video\.yml /);
  assert.equal(both.about, JSON.parse(before).about, 'the committed file says the same');
  assert.deepEqual({ usd: both.usd, btc: both.btc }, { usd: { id: 'AAAAAAAAAAA', end: '2026-09-25' }, btc: { id: 'BBBBBBBBBBB', end: '2026-09-25' } });
  const written = record(both2, before);
  assert.equal(written, JSON.stringify(both, null, 2) + '\n', 'the same layout as the committed file');
  // The committed file is what the step writes: recording again any video it names leaves it byte for byte as it is
  // (whichever videos it names at the time: the record job commits it after every post), and with none yet, a post
  // that failed for both leaves it as it is too.
  const now = JSON.parse(before);
  for (const k of ['usd', 'btc']) {
    if (!now[k]) continue;
    const K = k.toUpperCase();
    assert.equal(record({ END: now[k].end, [K + '_ID']: now[k].id, [K + '_PRIVACY']: 'unlisted' }, before), before, k);
  }
  assert.equal(record({ END: '2026-09-25' }, before), before, 'nothing viewable: nothing changes');
  // A private upload, a failed post and a malformed id all leave that video's entry as it was.
  const earlier = JSON.stringify({ about: 'x', usd: { id: 'OldUsdVideo', end: '2026-09-24' }, btc: { id: 'OldBtcVideo', end: '2026-09-24' } });
  for (const [usd, btc] of [[['CCCCCCCCCCC', 'private'], ['', '']], [['', ''], ['DDDDDDDDDDD', 'unlisted']], [['EEEEEEEEEE"', 'unlisted'], ['bad', 'public']]]) {
    const r = JSON.parse(record({ END: '2026-09-25', USD_ID: usd[0], USD_PRIVACY: usd[1], BTC_ID: btc[0], BTC_PRIVACY: btc[1] }, earlier));
    assert.deepEqual(r.usd, usd[1] === 'unlisted' && /^[A-Za-z0-9_-]{11}$/.test(usd[0]) ? { id: usd[0], end: '2026-09-25' } : { id: 'OldUsdVideo', end: '2026-09-24' }, JSON.stringify(usd));
    assert.deepEqual(r.btc, btc[1] === 'unlisted' ? { id: btc[0], end: '2026-09-25' } : { id: 'OldBtcVideo', end: '2026-09-24' }, JSON.stringify(btc));
  }
  // A file with nothing for a video yet keeps null there until one is viewable; the Y-MAX videos a file from before
  // names are not carried over.
  assert.equal(JSON.parse(record({ END: '2026-10-01', USD_ID: 'AAAAAAAAAAA', USD_PRIVACY: 'unlisted' }, JSON.stringify({ about: 'x', usd: null, btc: null }))).btc, null);
  const fromBefore = JSON.parse(record({ END: '2026-10-01', USD_ID: 'AAAAAAAAAAA', USD_PRIVACY: 'unlisted' }, JSON.stringify({ about: 'x', ath: { id: 'YqGYoIqKJ5s', end: '2026-09-26' }, fit: { id: 'I53s3vHbcFI', end: '2026-09-26' } })));
  assert.deepEqual(fromBefore, { about: both.about, usd: { id: 'AAAAAAAAAAA', end: '2026-10-01' }, btc: null });
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
  assert.match(text, /^Two videos, every bar drawn as its percent of the day's total on a left axis fixed at 0 to 4%: BitcoinSupplyChart\.com-Percent-of-Realized-Cap\.mp4, of the realized cap, every day from 2011-01-31 \(the first with a realized cap above zero\), and BitcoinSupplyChart\.com-Percent-of-Supply\.mp4, of the supply, every day from 2010-05-18 \(the first with anything on the chart\), both to 2026-09-24\. /);
  assert.match(text, /\nSHA-256 of BitcoinSupplyChart\.com-Percent-of-Realized-Cap\.mp4: [0-9a-f]{64}\nSHA-256 of BitcoinSupplyChart\.com-Percent-of-Supply\.mp4: [0-9a-f]{64}\n/);
  // The Y-MAX videos kept on the release, with the SHA-256 their own notes gave them.
  assert.match(text, /\nSHA-256 of BitcoinSupplyChart\.com-Y-Max-Expands-On-ATH\.mp4: 70b66800dbf61eaefb35658f4274b60e7cc095487e4c4196ebfb3bd1614345b4\nSHA-256 of BitcoinSupplyChart\.com-Y-Max-Always-At-100-Percent\.mp4: fbc491f51f289eaafa515cdb99113cd4871850c5b7d7ef5c11d446845eceea9e\nCheck any file here: gh attestation verify FILE --repo o\/r \(see SECURITY\.md\)$/);
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
