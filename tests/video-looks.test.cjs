// The two videos, AGE and LTH/STH: each colours its bars as the site does (tools/video/looks.mjs against index.html),
// the Daily video workflow renders, publishes and posts both, and its record step keeps each video's last viewable
// upload in data/youtube.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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
  const { LOOKS, AGE_LABELS, AGE_COLORS, STH_BANDS, titleStart, look } = await load();
  const { c } = app();
  assert.deepEqual(AGE_LABELS, Array.from(c.AGE_BANDS, b => b.label));
  assert.deepEqual(AGE_COLORS, Array.from(c.AGE_BAND_COLORS));
  assert.equal(STH_BANDS, c.STH_BANDS);
  assert.deepEqual(Object.keys(LOOKS), ['age', 'lthsth']);
  assert.deepEqual(LOOKS.age.ends, AGE_LABELS.map((_, k) => k + 1), 'AGE: every band a layer of its own');
  assert.deepEqual(LOOKS.lthsth.ends, [c.STH_BANDS, c.AGE_BANDS.length], 'LTH/STH: the short-term bands, then all of them');
  assert.deepEqual(LOOKS.lthsth.colors, [c.STH_COLOR, c.LTH_COLOR]);
  assert.deepEqual(LOOKS.lthsth.labels, [c.T.en.sth, c.T.en.lth]);
  for (const k of Object.keys(LOOKS)) assert.equal(LOOKS[k].labels.length, LOOKS[k].colors.length, k);
  assert.equal(titleStart('age'), c.T.en.titleUSDAge);
  assert.equal(titleStart('lthsth'), c.T.en.titleUSDSplit);
  assert.throws(() => look('__proto__'), /no look/);
  // The drawing takes its layers, their names and colours and the title from the frame, never a list of its own.
  const page = fs.readFileSync(path.join(ROOT, 'tools', 'video', 'page.html'), 'utf8');
  assert.doesNotMatch(page, /var LABELS|<1h|Bitcoin Supply by Price/);
  for (const s of ['sp.labels', 'sp.colors', 'sp.title', 'sp.legendSize']) assert.ok(page.includes(s), s);
  const render = fs.readFileSync(path.join(ROOT, 'tools', 'video', 'render.mjs'), 'utf8');
  assert.match(render, /const LOOK_NAME = process\.env\.LOOK \|\| "age", LOOK = look\(LOOK_NAME\), TITLE = titleStart\(LOOK_NAME\);/);
  assert.doesNotMatch(render, /PALETTE|#f8f919/, 'the colours come from looks.mjs');
});

test('the workflow renders and vets both videos on runners of their own, and publishes and posts them together', async () => {
  const { LOOKS } = await load();
  const env = Object.fromEntries([...workflow.matchAll(/^ {2}(VIDEO\w*): (\S+)$/gm)].map(m => [m[1], m[2]]));
  assert.deepEqual(env, { VIDEO: 'BitcoinSupplyChart.com.mp4', VIDEO_LTHSTH: 'BitcoinSupplyChart.com-LTH-STH.mp4' });
  const matrix = `      matrix:
        include:
          - look: age
            file: ${env.VIDEO}
          - look: lthsth
            file: ${env.VIDEO_LTHSTH}
`;
  for (const name of ['render', 'vet']) assert.ok(job(name).includes(matrix), name + ': one leg a video, named as in env');
  assert.deepEqual(Object.keys(LOOKS), ['age', 'lthsth']);
  const render = job('render');
  assert.match(render, /LOOK: \$\{\{ matrix\.look \}\}/);
  assert.match(render, /run: node tools\/video\/render\.mjs "\$RUNNER_TEMP\/store" "\$RUNNER_TEMP\/\$FILE"/);
  assert.match(render, /name: video-\$\{\{ matrix\.look \}\}/);
  assert.match(job('vet'), /name: video-vetted-\$\{\{ matrix\.look \}\}/);
  for (const name of ['publish', 'youtube']) assert.match(job(name), /pattern: video-vetted-\*\n\s+merge-multiple: true/, name);
  // Each video posted with its own look; LTH/STH also when AGE failed, and never once the run is cancelled.
  const youtube = job('youtube');
  assert.match(youtube, /run: node tools\/video\/youtube\.mjs "\$RUNNER_TEMP\/vetted\/\$VIDEO" "\$START" "\$END" age >> "\$GITHUB_OUTPUT"/);
  assert.match(youtube, /if: \$\{\{ !cancelled\(\) && steps\.videos\.outcome == 'success' \}\}\n[\s\S]*?run: node tools\/video\/youtube\.mjs "\$RUNNER_TEMP\/vetted\/\$VIDEO_LTHSTH" "\$START" "\$END" lthsth >> "\$GITHUB_OUTPUT"/);
  for (const k of ['age_id', 'age_privacy', 'lthsth_id', 'lthsth_privacy']) assert.match(youtube, new RegExp(`${k}: \\$\\{\\{ steps\\.${k.split('_')[0]}\\.outputs\\.${k.split('_')[1]} \\}\\}`), k);
  assert.match(job('record'), /if: >-\n\s+\$\{\{ !cancelled\(\) && \(/);
});

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
  const before = fs.readFileSync(path.join(ROOT, 'data', 'youtube.json'), 'utf8'), was = JSON.parse(before);
  const both = JSON.parse(record({ END: '2026-09-25', AGE_ID: 'AAAAAAAAAAA', AGE_PRIVACY: 'unlisted', LTHSTH_ID: 'BBBBBBBBBBB', LTHSTH_PRIVACY: 'public' }, before));
  assert.deepEqual(both, { about: was.about, age: { id: 'AAAAAAAAAAA', end: '2026-09-25' }, lthsth: { id: 'BBBBBBBBBBB', end: '2026-09-25' } });
  const written = record({ END: '2026-09-25', AGE_ID: 'AAAAAAAAAAA', AGE_PRIVACY: 'unlisted', LTHSTH_ID: 'BBBBBBBBBBB', LTHSTH_PRIVACY: 'public' }, before);
  assert.equal(written, JSON.stringify(both, null, 2) + '\n', 'the same layout as the committed file');
  // A private upload, a failed post and a malformed id all leave that video's entry as it was.
  const earlier = JSON.stringify({ about: 'x', age: { id: 'OldAgeVideo', end: '2026-09-24' }, lthsth: { id: 'OldSplitVid', end: '2026-09-24' } });
  for (const [age, split] of [[['CCCCCCCCCCC', 'private'], ['', '']], [['', ''], ['DDDDDDDDDDD', 'unlisted']], [['EEEEEEEEEE"', 'unlisted'], ['bad', 'public']]]) {
    const r = JSON.parse(record({ END: '2026-09-25', AGE_ID: age[0], AGE_PRIVACY: age[1], LTHSTH_ID: split[0], LTHSTH_PRIVACY: split[1] }, earlier));
    assert.deepEqual(r.age, age[1] === 'unlisted' && /^[A-Za-z0-9_-]{11}$/.test(age[0]) ? { id: age[0], end: '2026-09-25' } : { id: 'OldAgeVideo', end: '2026-09-24' }, JSON.stringify(age));
    assert.deepEqual(r.lthsth, split[1] === 'unlisted' ? { id: split[0], end: '2026-09-25' } : { id: 'OldSplitVid', end: '2026-09-24' }, JSON.stringify(split));
  }
  assert.throws(() => record({ END: 'x', AGE_ID: 'AAAAAAAAAAA', AGE_PRIVACY: 'unlisted' }, before), 'a day that is not a date stops it');
});
