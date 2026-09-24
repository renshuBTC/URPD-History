// The site's defences against being used to hand visitors anything harmful: what the page may run and load, what it
// offers to download, what it accepts from the API, and how the workflows that build and publish it are locked down.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { html, scripts, app } = require('./helpers.cjs');
const { scriptHashes, readPolicy } = require('../tools/update-csp.cjs');

const ROOT = path.join(__dirname, '..');
const VIDEO_URL = 'https://github.com/renshuBTC/URPD-History/releases/download/video/BitcoinSupplyChart.com.mp4';
const PLOTLY = 'https://cdn.plot.ly/plotly-2.27.0.min.js';
const plain = v => JSON.parse(JSON.stringify(v));   // out of the page's realm, for deepEqual

test('the page may run only its own inline scripts and the pinned Plotly, and connect only to its own data', () => {
  const policy = readPolicy(html), d = policy.directives;
  assert.ok(html.indexOf(policy.tag) < html.search(/<script\b/i), 'the policy has to come before the first script');
  assert.deepEqual(d['default-src'], ["'none'"]);
  assert.deepEqual(d['script-src'], [...scriptHashes(html), PLOTLY], 'an inline script changed: run node tools/update-csp.cjs');
  assert.deepEqual(d['connect-src'], ["'self'", 'https://bitview.space']);
  assert.deepEqual(d['base-uri'], ["'none'"]);
  assert.deepEqual(d['form-action'], ["'none'"]);
  for (const [name, values] of Object.entries(d)) {
    for (const v of values) assert.ok(!["'unsafe-eval'", "'unsafe-hashes'", "'strict-dynamic'", '*', 'http:', 'https:'].includes(v), `${name} ${v} is too broad`);
  }
  assert.ok(!d['script-src'].includes("'unsafe-inline'"));
  // Nothing may slip past the policy as markup: no inline event handlers and no javascript: addresses.
  assert.doesNotMatch(html, /<[^>]+\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /javascript:/i);
});

test('Plotly is the one outside script, pinned by its integrity hash', () => {
  const tags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)];
  assert.deepEqual(tags.map(t => t[1]), [PLOTLY]);
  assert.match(tags[0][0], /\bintegrity="sha384-[A-Za-z0-9+/]{64}"/);
  assert.match(tags[0][0], /\bcrossorigin="anonymous"/);
});

test('the only download the page offers is the official .mp4 video, and its code starts none of its own', () => {
  const links = [...html.matchAll(/<a\b[^>]*>/gi)].map(m => m[0]);
  const downloads = links.filter(a => /\sdownload[\s>=]/.test(a));
  assert.equal(downloads.length, 1);
  assert.match(downloads[0], /\bid="videoBtn"/);
  assert.equal(downloads[0].match(/\bhref="([^"]*)"/)[1], VIDEO_URL);
  for (const a of links.filter(a => /target="_blank"/.test(a))) assert.match(a, /\brel="[^"]*\bnoopener\b/);
  // A programmatic download or redirect would bypass the link above; any new one has to be added here on purpose.
  const code = scripts.join('\n');
  for (const pattern of [/\.click\(\s*\)/, /location\.(href|assign|replace)\b/, /createObjectURL/, /\.download\s*=/, /setAttribute\(\s*["']download/]) {
    assert.doesNotMatch(code, pattern);
  }
  // One window.open, on purpose: the credit line's links, and only to an account on x.com.
  assert.equal(code.match(/window\.open\s*\(/g).length, 1);
  assert.match(code, /if \(!\/\^https:\\\/\\\/x\\\.com\\\/\[A-Za-z0-9_\]\{1,15\}\$\/\.test\(url \|\| ""\)\) return;\s*e\.preventDefault\(\);\s*window\.open\(url, "_blank", "noopener"\);/);
});

test('every address in the page is one of the few it is meant to use', () => {
  const allowed = new Set([VIDEO_URL, PLOTLY, 'https://github.com/renshuBTC/URPD-History', 'https://bitview.space',
    'https://fonts.googleapis.com', 'https://fonts.googleapis.com/css2?family=Source+Code+Pro:wght@400;700&display=swap',
    'https://fonts.gstatic.com', 'http://www.w3.org/2000/svg', 'https://x.com/']);
  const found = [...html.matchAll(/https?:\/\/[^\s"'<>`)]+/g)].map(m => m[0].replace(/[;,.]+$/, ''));
  assert.ok(found.length >= allowed.size);
  for (const u of found) assert.ok(allowed.has(u), 'unexpected address in index.html: ' + u);
});

test('whatever the API sends, the page keeps only real dates and finite amounts', () => {
  const { c } = app();
  assert.deepEqual(plain(c.cleanDates(['2009-01-03', '<a href="https://x">x</a>', '2009-01-04', '2009-01-04', '2009-01-02', 5, null, '2009-01-05T00:00', '2009-01-05'])),
    ['2009-01-03', '2009-01-04', '2009-01-05']);
  assert.throws(() => c.cleanDates({ length: 1, 0: '2009-01-03' }), /Unexpected/);
  const cohort = JSON.parse('{"0":1.5,"100":2,"1e2":7,"abc":3,"200":"5","300":-1,"400":null,"":4,"__proto__":9,"500":{"x":1}}');
  assert.deepEqual(plain(c.cleanCohort(cohort)), { 0: 1.5, 100: 2, '1e2': 7 });
  for (const bad of [null, [], '<script>', 5]) assert.throws(() => c.cleanCohort(bad), /Unexpected/);
  assert.deepEqual(plain(c.cleanSeries([1, 'x', -2, 3, null, Infinity], c.isAmount)), [1, null, null, 3, null, null]);
  assert.equal(c.cleanSeries('nope', c.isAmount), null);
});

test('cost-basis data is cleaned before it reaches the chart, and nothing that is not a date is ever requested', async () => {
  const urls = [];
  const { c } = app({ fetch: async url => { urls.push(url); return { ok: true, json: async () => JSON.parse('{"100":5,"200":"<img src=x onerror=alert(1)>"}') }; } });
  const raw = await c.fetchRaw('2020-01-01');
  assert.equal(urls.length, c.AGE_BANDS.length);
  assert.ok(urls.every(u => /^https:\/\/bitview\.space\/api\/series\/cost-basis\/utxos_[a-z0-9_]+\/2020-01-01$/.test(u)));
  assert.deepEqual(plain(raw.age[0]), { 100: 5 });
  assert.deepEqual(plain(raw.all), { 100: 5 * c.AGE_BANDS.length });
  await assert.rejects(c.fetchRaw('../../other'), /Not a date/);
  assert.equal(urls.length, c.AGE_BANDS.length);
});

test('startup keeps only real dates and prices from the API', async () => {
  const { c } = app();
  c.fetchJSON = url => {
    if (url.endsWith('/all/dates')) return Promise.resolve(['2009-01-03', '<b>2009-01-04</b>']);
    if (url.endsWith('/price_close/day1')) return Promise.resolve([0, 'x', '<a href="https://x">10</a>']);
    if (url.endsWith('/date/day1')) return Promise.resolve(['2009-01-01', 'javascript:alert(1)', '2009-01-03']);
    return Promise.resolve({ 5: 2, 20: 1 });
  };
  c.loadAndRender = async () => {};
  await c.init();
  assert.deepEqual(plain(c.allDates), ['2009-01-03']);
  assert.deepEqual(plain(c.priceArray), [null, null, null]);
  assert.deepEqual(plain(c.priceDates), ['2009-01-01', null, '2009-01-03']);
  assert.equal(c.priceDateAt(1), '2009-01-02');   // a gap falls back to the calendar
});

test('the repository holds no file that bitcoinsupplychart.com could serve as a program, and nothing large', t => {
  // GitHub Pages publishes every file in the repository, so an executable committed anywhere would be downloadable
  // from the site's own address. Only these kinds of file may be committed.
  let files;
  try { files = require('node:child_process').execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean); }
  catch (e) { t.skip('not a git checkout'); return; }
  const kinds = /\.(html|md|json|cjs|mjs|js|svg|yml|sh)$/, names = new Set(['CNAME', 'LICENSE', '.gitignore', '.gitattributes', '.nojekyll']);
  for (const f of files) {
    assert.ok(kinds.test(f) || names.has(path.basename(f)), `${f}: not a kind of file this repository holds`);
    assert.ok(fs.statSync(path.join(ROOT, f)).size < 1e6, `${f}: over 1 MB (large files belong on a release, not in Git)`);
  }
});

// ---- the workflows -----------------------------------------------------------------------------------------------
const workflows = fs.readdirSync(path.join(ROOT, '.github', 'workflows')).filter(f => /\.ya?ml$/.test(f))
  .map(f => ({ f, text: fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8') }));
// One job's block of a workflow: from its "  name:" line to the next job or the end.
function job(text, name) {
  const lines = text.split('\n'), start = lines.findIndex(l => l === `  ${name}:`);
  assert.ok(start >= 0, 'no job ' + name);
  let end = lines.findIndex((l, i) => i > start && /^ {2}[a-z][\w-]*:$/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

test('every action a workflow uses is pinned to a full commit hash, and nothing runs on pull_request_target', () => {
  assert.ok(workflows.length >= 3);
  for (const { f, text } of workflows) {
    const uses = [...text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/gm)];
    for (const [, ref, comment] of uses) {
      assert.match(ref, /^actions\/[\w-]+@[0-9a-f]{40}$/, `${f}: ${ref} must be a GitHub action pinned to a commit`);
      assert.match(comment, /#\s*v\d+\.\d+\.\d+/, `${f}: ${ref} needs its version as a comment`);
    }
    assert.doesNotMatch(text, /pull_request_target|workflow_run/, f);
    assert.match(text, /^permissions:/m, `${f} must set its token's permissions`);
  }
});

test('the jobs that run third-party code or parse its output can read the repository and nothing else', () => {
  const video = workflows.find(w => w.f === 'video.yml').text;
  assert.match(video, /^permissions: \{\}/m);
  for (const name of ['render', 'vet']) {
    const block = job(video, name);
    assert.match(block, /permissions:\n\s+contents: read\s*(#.*)?\n\s+steps:/, name);
    assert.doesNotMatch(block, /GH_TOKEN|secrets\.|github\.token/, name);
    assert.match(block, /persist-credentials: false/, name);
  }
  assert.match(job(video, 'render'), /npm ci --ignore-scripts/);
  // The vet job checks the rendered file, rewrites it keeping only the picture, and decodes every frame.
  const vet = job(video, 'vet');
  assert.match(vet, /check-video\.sh "\$RUNNER_TEMP\/rendered\/\$VIDEO"/);
  assert.match(vet, /filter_units=pass_types=/);
  assert.match(vet, /check-video\.sh "\$RUNNER_TEMP\/vetted\/\$VIDEO" --decode/);
  // The jobs that can write never parse the video, and the publish job attests before it publishes.
  for (const name of ['update', 'publish']) assert.doesNotMatch(job(video, name), /ffmpeg|ffprobe|check-video/, name);
  const publish = job(video, 'publish');
  assert.match(publish, /needs: \[update, vet\]/);
  assert.match(publish, /uses: actions\/attest@/);
  assert.ok(publish.indexOf('actions/attest@') < publish.indexOf('replace-asset.sh video'), 'attest before publishing');
});
