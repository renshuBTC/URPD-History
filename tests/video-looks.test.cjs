// The two videos, AGE and <150D/>150D: each colours its bars as the site does (tools/video/looks.mjs against index.html),
// the Weekly videos workflow draws them once a week, renders, publishes and posts both, and its record step keeps
// each video's last viewable upload in data/youtube.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
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

test('each video colours its bars exactly as the site does, and is titled as the site titles that view in USD', async () => {
  const { LOOKS, AGE_LABELS, AGE_COLORS, STH_BANDS, titleStart, youtubeTitleStart, look } = await load();
  const { c } = app();
  assert.deepEqual(AGE_LABELS, Array.from(c.AGE_BANDS, b => b.label));
  assert.deepEqual(AGE_COLORS, Array.from(c.AGE_BAND_COLORS));
  assert.equal(STH_BANDS, c.STH_BANDS);
  assert.deepEqual(Object.keys(LOOKS), ['age', 'lthsth', 'raw']);
  assert.deepEqual(LOOKS.age.ends, AGE_LABELS.map((_, k) => k + 1), 'AGE: every band a layer of its own');
  // RAW: the store's unsmoothed bars, one layer, the site's black on its light chart, and no bar in the legend.
  assert.deepEqual([LOOKS.raw.source, LOOKS.raw.theme, LOOKS.raw.ends, LOOKS.raw.labels, LOOKS.raw.colors], ['raw', 'light', [1], [], [c.RAW_BAR_COLOR]]);
  assert.equal(titleStart('raw'), c.T.en.titleUSDRaw);
  for (const k of ['age', 'lthsth']) assert.equal(LOOKS[k].source, undefined, k + ': the smoothed bands');
  assert.deepEqual(LOOKS.lthsth.ends, [c.STH_BANDS, c.AGE_BANDS.length], '<150D/>150D: the bands under 150 days, then all of them');
  assert.deepEqual(LOOKS.lthsth.colors, [c.STH_COLOR, c.LTH_COLOR]);
  assert.deepEqual(LOOKS.lthsth.labels, [c.T.en.sth, c.T.en.lth]);
  for (const k of ['age', 'lthsth']) assert.equal(LOOKS[k].labels.length, LOOKS[k].colors.length, k);
  assert.equal(titleStart('age'), c.T.en.titleUSDAge);
  assert.equal(titleStart('lthsth'), c.T.en.titleUSDSplit);
  // YouTube refuses < and >: there the split is written out, and nothing else changes.
  assert.equal(youtubeTitleStart('age'), titleStart('age'));
  assert.equal(youtubeTitleStart('lthsth'), titleStart('lthsth').replace('<150D/>150D', 'Under/Over 150D'));
  for (const k of Object.keys(LOOKS)) assert.doesNotMatch(youtubeTitleStart(k), /[<>]/, k);
  assert.throws(() => look('__proto__'), /no look/);
  // The drawing takes its layers, their names and colours and the title from the frame, never a list of its own.
  const page = fs.readFileSync(path.join(ROOT, 'tools', 'video', 'page.html'), 'utf8');
  assert.doesNotMatch(page, /var LABELS|<1h|Bitcoin Supply by Price/);
  for (const s of ['sp.labels', 'sp.colors', 'sp.title', 'sp.legendSize']) assert.ok(page.includes(s), s);
  const render = fs.readFileSync(path.join(ROOT, 'tools', 'video', 'render.mjs'), 'utf8');
  assert.match(render, /const LOOK_NAME = process\.env\.LOOK \|\| "age", LOOK = look\(LOOK_NAME\), TITLE = titleStart\(LOOK_NAME\);/);
  assert.doesNotMatch(render, /PALETTE|#f8f919/, 'the colours come from looks.mjs');
});

test('the workflow renders and vets both videos on runners of their own, publishes them together and posts each on its own', async () => {
  const { LOOKS } = await load();
  const env = Object.fromEntries([...workflow.matchAll(/^ {2}(VIDEO\w*): (\S+)$/gm)].map(m => [m[1], m[2]]));
  // Each file names its look; the split is written as in its YouTube title, since a file name can hold no < or >.
  assert.deepEqual(env, { VIDEO: 'BitcoinSupplyChart.com-AGE.mp4', VIDEO_LTHSTH: 'BitcoinSupplyChart.com-Under-Over-150D.mp4', VIDEO_RAW: 'BitcoinSupplyChart.com-RAW.mp4' });
  assert.doesNotMatch(workflow, /BitcoinSupplyChart\.com\.mp4|LTH-STH/);
  // One leg a video, from the update job (the looks the run draws, named as in env); one failing leg does not cancel
  // the others.
  const matrix = `      fail-fast: false
      matrix:
        include: \${{ fromJSON(needs.update.outputs.include) }}
`;
  for (const name of ['render', 'vet']) assert.ok(job(name).includes(matrix), name);
  assert.match(job('vet'), /needs: \[update, render\]/);
  // Scheduled: all three. By hand: all three, or only the one asked for; anything else stops the run.
  for (const [ONLY, looks] of [['', ['age', 'lthsth', 'raw']], ['all', ['age', 'lthsth', 'raw']], ['raw', ['raw']], ['age', ['age']], ['lthsth', ['lthsth']]]) {
    const out = only(ONLY, env);
    assert.equal(out.status, 0, ONLY);
    assert.deepEqual(JSON.parse(out.looks), looks, ONLY);
    assert.deepEqual(JSON.parse(out.include), looks.map((l) => ({ look: l, file: { age: env.VIDEO, lthsth: env.VIDEO_LTHSTH, raw: env.VIDEO_RAW }[l] })), ONLY);
    assert.equal(out.only, ONLY || 'all');
  }
  assert.notEqual(only('everything', env).status, 0, 'no such video');
  assert.match(workflow, /workflow_dispatch:\n\s+inputs:\n\s+only:\n\s+description: .*\n\s+type: choice\n\s+options: \[all, age, lthsth, raw\]\n\s+default: all\n/);
  // A run for one video leaves the release, and so the week, as they are.
  assert.match(job('publish'), /- name: Publish the videos\n\s+if: needs\.update\.outputs\.only == 'all'\n/);
  assert.deepEqual(Object.keys(LOOKS), ['age', 'lthsth', 'raw']);
  const render = job('render');
  assert.match(render, /LOOK: \$\{\{ matrix\.look \}\}/);
  assert.match(render, /run: node tools\/video\/render\.mjs "\$RUNNER_TEMP\/store" "\$RUNNER_TEMP\/\$FILE"/);
  assert.match(render, /name: video-\$\{\{ matrix\.look \}\}/);
  assert.match(job('vet'), /name: video-vetted-\$\{\{ matrix\.look \}\}\n.*\n.*\n\s+retention-days: 7 /, 'kept a week, for re-runs');
  // After vet, every artifact is taken by its exact name: a pattern also took in any artifact of the run whose name
  // matched, and the render job (third-party code) could have made one to replace a vetted file.
  assert.doesNotMatch(workflow, /pattern:|merge-multiple/);
  const downloads = (block) => [...block.matchAll(/uses: actions\/download-artifact@\S+ # v[\d.]+\n(?:\s+if: .*\n)?\s+with:\n\s+name: (\S+)\n\s+path: (\S+)/g)].map(m => m[1] + ' -> ' + m[2]);
  assert.deepEqual(downloads(job('publish')), ['video-vetted-age -> ${{', 'video-vetted-lthsth -> ${{', 'video-vetted-raw -> ${{']);
  assert.match(job('publish'), /name: video-vetted-age\n\s+path: \$\{\{ runner\.temp \}\}\/vetted\n[\s\S]*name: video-vetted-lthsth\n\s+path: \$\{\{ runner\.temp \}\}\/vetted\n/);
  // Each video posted from a job of its own with its own look and file, so a failed post can be run again alone.
  for (const [look, file] of [['age', 'VIDEO'], ['lthsth', 'VIDEO_LTHSTH'], ['raw', 'VIDEO_RAW']]) {
    const yt = job('youtube-' + look);
    assert.match(yt, new RegExp(`needs: \\[update, publish\\]\\n\\s+if: contains\\(fromJSON\\(needs\\.update\\.outputs\\.looks\\), '${look}'\\)\\n`), look + ': posted when the run drew it');
    assert.match(job('publish'), new RegExp(`if: contains\\(fromJSON\\(needs\\.update\\.outputs\\.looks\\), '${look}'\\)\\n\\s+with:\\n\\s+name: video-vetted-${look}\\n`), look + ': downloaded when the run drew it');
    assert.deepEqual(downloads(yt), [`video-vetted-${look} -> \${{`], look);
    assert.equal((yt.match(/run: node tools\/video\/youtube\.mjs /g) || []).length, 1, look);
    assert.ok(yt.includes(`run: node tools/video/youtube.mjs "$RUNNER_TEMP/vetted/$${file}" "$START" "$END" ${look} >> "$GITHUB_OUTPUT"`), look);
    assert.match(yt, /outputs:\n\s+id: \$\{\{ steps\.post\.outputs\.id \}\}\n\s+privacy: \$\{\{ steps\.post\.outputs\.privacy \}\}\n/, look);
    assert.match(yt, /- name: Post the \S+ video to YouTube\n\s+id: post\n\s+if: steps\.creds\.outputs\.found == 'yes'\n/, look);
  }
  assert.doesNotMatch(workflow, /^ {2}youtube:$/m, 'no job posts both');
  // The record job runs once either video is viewable, also when the other's post failed, never on a cancelled run,
  // and names each from its own job's outputs; it starts from the latest main.
  const record = job('record');
  assert.ok(record.includes(`    needs: [update, youtube-age, youtube-lthsth, youtube-raw]
    if: >-
      \${{ !cancelled() && (
        needs.youtube-age.outputs.privacy == 'unlisted' || needs.youtube-age.outputs.privacy == 'public' ||
        needs.youtube-lthsth.outputs.privacy == 'unlisted' || needs.youtube-lthsth.outputs.privacy == 'public' ||
        needs.youtube-raw.outputs.privacy == 'unlisted' || needs.youtube-raw.outputs.privacy == 'public') }}
`), 'the whole condition');
  for (const [v, out] of [['AGE_ID', 'youtube-age.outputs.id'], ['AGE_PRIVACY', 'youtube-age.outputs.privacy'], ['LTHSTH_ID', 'youtube-lthsth.outputs.id'], ['LTHSTH_PRIVACY', 'youtube-lthsth.outputs.privacy'],
    ['RAW_ID', 'youtube-raw.outputs.id'], ['RAW_PRIVACY', 'youtube-raw.outputs.privacy']])
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
  const all3 = { END: '2026-09-25', AGE_ID: 'AAAAAAAAAAA', AGE_PRIVACY: 'unlisted', LTHSTH_ID: 'BBBBBBBBBBB', LTHSTH_PRIVACY: 'public', RAW_ID: 'CCCCCCCCCCC', RAW_PRIVACY: 'unlisted' };
  const both = JSON.parse(record(all3, before));
  assert.deepEqual(Object.keys(both), ['about', 'age', 'lthsth', 'raw'], 'the committed file\'s layout');
  assert.match(both.about, /^The latest videos on YouTube for the site's three video buttons: .* Written by \.github\/workflows\/video\.yml /);
  assert.deepEqual({ age: both.age, lthsth: both.lthsth, raw: both.raw }, { age: { id: 'AAAAAAAAAAA', end: '2026-09-25' }, lthsth: { id: 'BBBBBBBBBBB', end: '2026-09-25' }, raw: { id: 'CCCCCCCCCCC', end: '2026-09-25' } });
  const written = record(all3, before);
  assert.equal(written, JSON.stringify(both, null, 2) + '\n', 'the same layout as the committed file');
  // The committed file is what the step writes, the RAW video not yet posted.
  const now = JSON.parse(before);
  assert.equal(record({ END: '2026-09-24', AGE_ID: now.age.id, AGE_PRIVACY: 'unlisted', LTHSTH_ID: now.lthsth.id, LTHSTH_PRIVACY: 'unlisted' }, before), before);
  // A file from before RAW, without a "raw" entry: RAW recorded once viewable, null until then.
  const two = JSON.stringify({ about: 'x', age: now.age, lthsth: now.lthsth });
  assert.equal(JSON.parse(record({ END: '2026-10-01', AGE_ID: 'AAAAAAAAAAA', AGE_PRIVACY: 'unlisted' }, two)).raw, null);
  // A private upload, a failed post and a malformed id all leave that video's entry as it was.
  const earlier = JSON.stringify({ about: 'x', age: { id: 'OldAgeVideo', end: '2026-09-24' }, lthsth: { id: 'OldSplitVid', end: '2026-09-24' } });
  for (const [age, split] of [[['CCCCCCCCCCC', 'private'], ['', '']], [['', ''], ['DDDDDDDDDDD', 'unlisted']], [['EEEEEEEEEE"', 'unlisted'], ['bad', 'public']]]) {
    const r = JSON.parse(record({ END: '2026-09-25', AGE_ID: age[0], AGE_PRIVACY: age[1], LTHSTH_ID: split[0], LTHSTH_PRIVACY: split[1] }, earlier));
    assert.deepEqual(r.age, age[1] === 'unlisted' && /^[A-Za-z0-9_-]{11}$/.test(age[0]) ? { id: age[0], end: '2026-09-25' } : { id: 'OldAgeVideo', end: '2026-09-24' }, JSON.stringify(age));
    assert.deepEqual(r.lthsth, split[1] === 'unlisted' ? { id: split[0], end: '2026-09-25' } : { id: 'OldSplitVid', end: '2026-09-24' }, JSON.stringify(split));
  }
  assert.throws(() => record({ END: 'x', AGE_ID: 'AAAAAAAAAAA', AGE_PRIVACY: 'unlisted' }, before), 'a day that is not a date stops it');
});

// The publish job's release notes for videos from START to END, as it writes them (bash, sha256sum).
function notes(START, END) {
  const block = job('publish'), a = block.indexOf('          SHA=$(sha256sum'), b = block.indexOf('(see SECURITY.md)"\n', a);
  assert.ok(a > 0 && b > a, 'the notes');
  const script = block.slice(a, b + '(see SECURITY.md)"\n'.length).split('\n').map(l => l.slice(10)).join('\n') + 'printf "%s" "$NOTES"\n';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));
  fs.mkdirSync(path.join(dir, 'vetted'));
  const env = Object.fromEntries([...workflow.matchAll(/^ {2}(VIDEO\w*): (\S+)$/gm)].map(m => [m[1], m[2]]));
  for (const f of Object.values(env)) fs.writeFileSync(path.join(dir, 'vetted', f), f);
  return execFileSync('bash', ['-e', '-c', script], { env: { PATH: process.env.PATH, RUNNER_TEMP: dir, START, END, GITHUB_REPOSITORY: 'o/r', ...env }, encoding: 'utf8' });
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
  const text = notes('2010-05-18', '2026-09-24');
  assert.match(text, /^Every day from 2010-05-18 \(the first with anything on the chart\) to 2026-09-24, /);
  assert.match(text, /in three videos: BitcoinSupplyChart\.com-AGE\.mp4 with the bars coloured by age band, BitcoinSupplyChart\.com-Under-Over-150D\.mp4 split at 150 days \(<150D and >150D\), and BitcoinSupplyChart\.com-RAW\.mp4 as recorded, unsmoothed, black on a light chart\./);
  assert.match(text, /\nSHA-256 of BitcoinSupplyChart\.com-AGE\.mp4: [0-9a-f]{64}\nSHA-256 of BitcoinSupplyChart\.com-Under-Over-150D\.mp4: [0-9a-f]{64}\nSHA-256 of BitcoinSupplyChart\.com-RAW\.mp4: [0-9a-f]{64}\n/);
  const r = due({ END: '2026-09-30', NOTES: text });
  assert.deepEqual([r.render, r.calls], [false, ['api repos/o/r/releases/tags/video --jq .body']]);
  assert.match(r.said, /The published videos run to 2026-09-24;/, 'the last date, not the first');
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
