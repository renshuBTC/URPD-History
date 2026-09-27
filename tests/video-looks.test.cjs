// The four videos, one for each of the site's weightings (USD and BTC) and colourings (AGE and LTH/STH): each draws its
// bars and its left axis as the site does in that weighting by default (Y-max 100 in USD, 99.8 in BTC, with the ▲ figure
// for the bars it cuts), colours them as the site does and words its chart as the site's English does
// (tools/video/looks.mjs and render.mjs against index.html); the Weekly videos workflow draws them once a week, renders,
// publishes and posts all four, and its record step keeps each video's last viewable upload in data/youtube.json. The videos before them stay on the release under their
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

test('each video draws one of the site\'s weightings and colourings as the site does by default: its bars coloured, its left axis set and its chart worded as the site does', async () => {
  const { LOOKS, AGE_LABELS, AGE_COLORS, HOLDER_LABELS, HOLDER_COLORS, STH_BANDS, titleStart, look, axisLevel } = await load();
  const { c } = app(), en = c.T.en;
  assert.deepEqual(AGE_LABELS, Array.from(c.AGE_BANDS, b => b.label));
  assert.deepEqual(AGE_COLORS, Array.from(c.AGE_BAND_COLORS));
  // LTH/STH as the site draws it: the same eight young bands, colours and English names.
  assert.equal(STH_BANDS, c.STH_BANDS);
  assert.deepEqual(HOLDER_COLORS, [c.STH_COLOR, c.LTH_COLOR]);
  assert.deepEqual(HOLDER_LABELS, [en.sth, en.lth]);
  assert.deepEqual(Object.keys(LOOKS), ['usd-age', 'btc-age', 'usd-lthsth', 'btc-lthsth'], 'in the order of the site\'s video buttons');
  for (const [k, L] of Object.entries(LOOKS)) {
    // Each look is one of the site's weightings (VIEW_MODES), with the Y-max the site starts it at (yMaxByMode), and
    // one of its colourings.
    const v = L.coin ? 1 : 0, T = L.coin ? 'BTC' : 'USD', unit = L.coin ? 'btc' : 'usd';
    assert.equal(k, unit + (L.split ? '-lthsth' : '-age'));
    assert.equal(L.coin, c.VIEW_MODES[v].coin, k);
    assert.equal(L.yPct, c.yMaxByMode[v], k);
    assert.equal(titleStart(k), en['title' + T + (L.split ? 'Split' : 'Age')], k);
    assert.equal(L.tag, '% ' + T + '-' + en[L.split ? 'lthsth' : 'age'], k + ': named as its button');
    assert.equal(L.yTitle, en[L.coin ? 'btcSupply' : 'usdInvested'], k);
    assert.equal(L.profit, en[unit + 'Profit'], k);
    assert.equal(L.loss, en[unit + 'Loss'], k);
    // The bottom signal at the site's default threshold for the weighting, in the site's words.
    assert.equal(L.bottom, c.BOTTOM_DEFAULTS[v], k);
    assert.equal(L.signal, en.bottomSignal, k);
    assert.doesNotMatch(titleStart(k), /[<>]|Y-Max|150D/, k + ': nothing YouTube refuses, no Y-MAX mode, and LTH/STH by name');
    assert.deepEqual(Object.keys(L).sort(), ['bottom', 'coin', 'loss', 'profit', 'signal', 'split', 'tag', 'title', 'yPct', 'yTitle'], k);
  }
  assert.throws(() => look('__proto__'), /no look/);
  for (const gone of ['usd', 'btc', 'ath', 'fit', 'age', 'lthsth', 'raw', 'pct', 'pctusd', 'pctbtc'])
    assert.throws(() => look(gone), new RegExp(`no look "${gone}": usd-age, btc-age, usd-lthsth, btc-lthsth`));
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
  assert.match(render, /const LOOK_NAME = process\.env\.LOOK \|\| "usd-age", LOOK = look\(LOOK_NAME\), TITLE = titleStart\(LOOK_NAME\);/);
  assert.match(render, /labels: LOOK\.split \? HOLDER_LABELS : AGE_LABELS, colors: LOOK\.split \? HOLDER_COLORS : AGE_COLORS, legendSize: LOOK\.split \? 12 : 9,/, 'every bar in its 23 age bands, or short- and long-term holders, as the site draws them');
  // LTH/STH draws two layers: the short-term holders' top (the first STH_BANDS bands added up) and the whole bar.
  assert.ok(render.includes('const LAYERS = LOOK.split ? [STH_BANDS - 1, A - 1] : Array.from({ length: A }, (_, k) => k);\n'));
  assert.ok(render.includes('  for (const k of LAYERS) { const x = a.cum[k], y = b.cum[k],'));
  assert.doesNotMatch(render, /PALETTE|#f8f919|store\.raw|LOOK\.source|LOOK\.theme|LOOK\.fit|yRun/, 'the colours come from looks.mjs');
  // The bars in dollars or coins as the look says; the left axis where the look's Y-max puts it, on each frame and each
  // still, with the bars above it counted for the ▲ figure; labelled as the site labels it.
  assert.ok(render.includes('const S = startIndex(store, LOOK.coin ? "btc" : "usd"), dayBars = LOOK.coin ? store.coins : store.bars;\n'));
  assert.ok(render.includes('    const level = axisLevel(whole, LOOK.yPct);\n    Y[t] = level > 0 ? level : 1;\n    [CUTN[t], CUTV[t]] = cutOf(whole, Y[t]);\n'));
  assert.ok(render.includes('  const ymax = exact === undefined ? Y[t] : axisLevel(a.cum[A - 1], LOOK.yPct) || 1;\n'));
  assert.ok(render.includes('  const yt = axisTicks(ymax), ytt = axisLabels(yt, "%");\n'), 'the left axis in percent, as on the site');
  // Each day's bars as its shares, adding up to 100%, as on the site.
  assert.ok(render.includes('  const toPct = total > 0 ? 100 / total : 0;\n  for (const c of cum) for (let j = 0; j < NB; j++) c[j] *= toPct;\n'));
  // render.mjs's own copies of the site's axis labels and of its ▲ figure print what the site prints.
  const a = render.indexOf("// ---- the site's axis labels"), b = render.indexOf('// ---- frame t:');
  const ctx = vm.createContext({ Math, String, Number, Array });
  vm.runInContext(render.slice(a, b) + '\n;globalThis.fns = { axisTicks, axisLabels };', ctx);
  const f = ctx.fns;
  for (const unit of [false, true, '%']) for (const end of [1, 7.3, 1100, 126000, 125650, 2.2e5, 2.77e6, 3.1e10, 0.37, 1.46, 14.6, 100])
    assert.deepEqual(Array.from(f.axisLabels(f.axisTicks(end), unit)), Array.from(c.axisLabels(c.axisTicks(end), unit)), unit + ' ' + end);
  const cutDefs = render.slice(render.indexOf('const cutOf ='), render.indexOf('\n{\n', render.indexOf('const cutOf =')));
  for (const coin of [false, true]) {
    const cctx = vm.createContext({ Math, String, Number, NB: 3, LOOK: { coin } });   // (the ▲ figure is a share either way)
    vm.runInContext(cutDefs + '\n;globalThis.fns = { cutOf, cutText };', cctx);
    for (const [n, v] of [[1, 13.93], [3, 2.4125], [2, 0.07254]]) {
      const want = '▲ ' + c.pctCompact(v) + (n > 1 ? ' (+' + (n - 1) + ')' : '');
      assert.equal(cctx.fns.cutText(n, v), want, n + ' ' + v);
    }
    assert.equal(cctx.fns.cutText(0, 0), null);
    assert.deepEqual(Array.from(cctx.fns.cutOf([5, 1, 3], 2)), [2, 5]);
  }
});

test('the workflow renders and vets the four videos on runners of their own, publishes them together and posts each on its own', async () => {
  const { LOOKS } = await load();
  const env = Object.fromEntries([...workflow.matchAll(/^ {2}(VIDEO\w*): (\S+)$/gm)].map(m => [m[1], m[2]]));
  // Each file names its weighting and colouring, under the site's new name.
  assert.deepEqual(env, { VIDEO_USD_AGE: 'BitcoinURPD.com-USD-AGE.mp4', VIDEO_BTC_AGE: 'BitcoinURPD.com-BTC-AGE.mp4',
    VIDEO_USD_LTHSTH: 'BitcoinURPD.com-USD-LTH-STH.mp4', VIDEO_BTC_LTHSTH: 'BitcoinURPD.com-BTC-LTH-STH.mp4' });
  const ALL = ['usd-age', 'btc-age', 'usd-lthsth', 'btc-lthsth'];
  const ENV = { 'usd-age': 'VIDEO_USD_AGE', 'btc-age': 'VIDEO_BTC_AGE', 'usd-lthsth': 'VIDEO_USD_LTHSTH', 'btc-lthsth': 'VIDEO_BTC_LTHSTH' };
  const FILE = Object.fromEntries(ALL.map(l => [l, env[ENV[l]]]));
  assert.doesNotMatch(workflow, /BitcoinSupplyChart\.com\.mp4|BitcoinURPD\.com-(USD|BTC)\.mp4|Under-Over-150D|150D|-RAW\.mp4|VIDEO_RAW|VIDEO_ATH|VIDEO_FIT|VIDEO_PCT|VIDEO_(USD|BTC)(?!_)|youtube-(usd|btc)(?![\w-])|youtube-age|youtube-raw|youtube-ath|youtube-fit|youtube-pct|video-vetted-(ath|fit|usd|btc)(?![\w-])|pctusd|pctbtc/);
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
  // Scheduled: all four. By hand: all four, or only the one asked for; anything else stops the run.
  for (const [ONLY, looks] of [['', ALL], ['all', ALL], ...ALL.map(l => [l, [l]])]) {
    const out = only(ONLY, env);
    assert.equal(out.status, 0, ONLY);
    assert.deepEqual(JSON.parse(out.looks), looks, ONLY);
    assert.deepEqual(JSON.parse(out.include), looks.map((l) => ({ look: l, file: FILE[l] })), ONLY);
    assert.equal(out.only, ONLY || 'all');
  }
  for (const bad of ['everything', 'usd', 'btc', 'age', 'raw', 'lthsth', 'ath', 'fit', 'pct', 'pctusd', 'pctbtc']) assert.notEqual(only(bad, env).status, 0, bad + ': no such video');
  assert.match(workflow, /workflow_dispatch:\n\s+inputs:\n\s+only:\n\s+description: .*\n\s+type: choice\n\s+options: \[all, usd-age, btc-age, usd-lthsth, btc-lthsth\]\n\s+default: all\n/);
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
  assert.ok(job('publish').includes('replace-asset.sh video "$RUNNER_TEMP/vetted/$VIDEO_USD_AGE" "$RUNNER_TEMP/vetted/$VIDEO_BTC_AGE" \\\n' +
    '            "$RUNNER_TEMP/vetted/$VIDEO_USD_LTHSTH" "$RUNNER_TEMP/vetted/$VIDEO_BTC_LTHSTH"\n'), 'all four, together');
  // Each video posted from a job of its own with its own look, file and first day, so a failed post can be run again alone.
  for (const [look, file, start, name] of [['usd-age', 'VIDEO_USD_AGE', 'start_usd', 'USD-AGE'], ['btc-age', 'VIDEO_BTC_AGE', 'start', 'BTC-AGE'],
    ['usd-lthsth', 'VIDEO_USD_LTHSTH', 'start_usd', 'USD-LTH/STH'], ['btc-lthsth', 'VIDEO_BTC_LTHSTH', 'start', 'BTC-LTH/STH']]) {
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
  // The record job runs once any video is viewable, also when others' posts failed, never on a cancelled run, and
  // names each from its own job's outputs; it starts from the latest main.
  const record = job('record');
  assert.ok(record.includes(`    needs: [update, youtube-usd-age, youtube-btc-age, youtube-usd-lthsth, youtube-btc-lthsth]
    if: >-
      \${{ !cancelled() && (
` + ALL.map(l => `        needs.youtube-${l}.outputs.privacy == 'unlisted' || needs.youtube-${l}.outputs.privacy == 'public'`).join(' ||\n') + `) }}
`), 'the whole condition');
  for (const l of ALL) for (const [v, out] of [['_ID', 'id'], ['_PRIVACY', 'privacy']])
    assert.ok(record.includes(`          ${l.toUpperCase().replace('-', '_')}${v}: \${{ needs.youtube-${l}.outputs.${out} }}\n`), l + v);
  assert.match(record, /uses: actions\/checkout@\S+ # v[\d.]+\n\s+with:\n\s+ref: main\n/);
  // Only runs on main wait for each other; a run by hand on another branch (which does nothing) has a group of its own.
  assert.match(workflow, /^concurrency:\n {2}group: \$\{\{ github\.ref == 'refs\/heads\/main' && 'daily-video' \|\| format\('video-\{0\}', github\.run_id\) \}\}\n {2}cancel-in-progress: false$/m);
});

test('the videos show the bottom signal as the site does: at the look\'s threshold in loss, a yellow dashed line and border and a fourth line', async () => {
  const { LOOKS } = await load();
  const page = fs.readFileSync(path.join(ROOT, 'tools', 'video', 'page.html'), 'utf8');
  const render = fs.readFileSync(path.join(ROOT, 'tools', 'video', 'render.mjs'), 'utf8');
  // Every frame and every figure boxNeeds is given carries the look's threshold and words.
  assert.ok(render.includes('    signalAt: LOOK.bottom, signalText: LOOK.signal,\n'), 'each frame');
  assert.ok(render.includes('lossLabel: LOOK.loss, signalAt: LOOK.bottom, signalText: LOOK.signal, nb: NB'), 'the price box\'s moves');
  assert.match(page, /line: \{ color: pb\.on \? TH\.signal : TH\.dash, width: 1, dash: "dash" \}/);
  assert.match(page, /bordercolor: pb\.on \? TH\.signal : TH\.boxBorder, borderwidth: 1/);
  // page.html's price box, run as the frame runs it.
  const vm = require('node:vm');
  const c = vm.createContext({ window: { devicePixelRatio: 2 }, document: {}, Math, Date, String, Number, JSON });
  vm.runInContext([...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n'), c);
  for (const L of Object.values(LOOKS)) {
    const sp = (redPct) => ({ spot: 16000, redPct, nb: 626, w: 200, win: ['2022-01-01 00:00:00', '2023-01-01 00:00:00'], date: '2022-11-21', pr: [0, 70000],
      profitLabel: L.profit, lossLabel: L.loss, signalAt: L.bottom, signalText: L.signal });
    const at = c.priceBox(sp(L.bottom)), below = c.priceBox(sp(L.bottom - 0.1)), none = c.priceBox(sp(null));
    assert.equal(at.on, true, L.tag + ': at the threshold, as printed');
    const rows = at.txt.split('<br>');
    assert.equal(rows.length, 4);
    assert.equal(rows[3], `<span style='color:#FFE600'>BOTTOM SIGNAL \u2014 In Loss \u2265 ${L.bottom}%</span>`, L.tag);
    assert.equal(at.box.h, 4 * 17 + 12, 'the box grows by the line (and boxNeeds with it)');
    assert.equal(below.on, false); assert.equal(below.txt.split('<br>').length, 3);
    assert.equal(none.on, false, 'no share, no signal');
  }
  assert.deepEqual(Object.values(LOOKS).map(L => L.bottom), [80, 50, 80, 50], 'USD 80, BTC 50');
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

test('the record step writes all four videos, and keeps a video\'s last viewable upload when today\'s is not', { skip: !haveJq() && 'needs bash and jq' }, () => {
  const before = fs.readFileSync(path.join(ROOT, 'data', 'youtube.json'), 'utf8');
  const ALL = ['usd-age', 'btc-age', 'usd-lthsth', 'btc-lthsth'], K = l => l.toUpperCase().replace('-', '_');
  const ids = { 'usd-age': 'AAAAAAAAAAA', 'btc-age': 'BBBBBBBBBBB', 'usd-lthsth': 'CCCCCCCCCCC', 'btc-lthsth': 'DDDDDDDDDDD' };
  const every = { END: '2026-09-25' };
  for (const l of ALL) { every[K(l) + '_ID'] = ids[l]; every[K(l) + '_PRIVACY'] = l === 'btc-age' ? 'public' : 'unlisted'; }
  const all = JSON.parse(record(every, before));
  assert.deepEqual(Object.keys(all), ['about', ...ALL], 'the committed file\'s layout');
  assert.match(all.about, /^The latest videos on YouTube for the site's four video buttons, one for each weighting and colouring: .* Written by \.github\/workflows\/video\.yml /);
  assert.equal(all.about, JSON.parse(before).about, 'the committed file says the same');
  for (const l of ALL) assert.deepEqual(all[l], { id: ids[l], end: '2026-09-25' }, l);
  assert.equal(record(every, before), JSON.stringify(all, null, 2) + '\n', 'the same layout as the committed file');
  // The committed file is what the step writes: recording again any video it names leaves it byte for byte as it is,
  // and a post that failed for all of them leaves it as it is too.
  const now = JSON.parse(before);
  for (const k of ALL) {
    if (!now[k]) continue;
    assert.equal(record({ END: now[k].end, [K(k) + '_ID']: now[k].id, [K(k) + '_PRIVACY']: 'unlisted' }, before), before, k);
  }
  assert.equal(record({ END: '2026-09-25' }, before), before, 'nothing viewable: nothing changes');
  // A private upload and a malformed id each leave that video's entry as it was; a failed post too, beside one that is new.
  const earlier = JSON.stringify({ about: 'x', 'usd-age': { id: 'OldUsdVideo', end: '2026-09-24' }, 'btc-age': { id: 'OldBtcVideo', end: '2026-09-24' }, 'usd-lthsth': null, 'btc-lthsth': null });
  let r = JSON.parse(record({ END: '2026-09-25', USD_AGE_ID: 'CCCCCCCCCCC', USD_AGE_PRIVACY: 'private', BTC_AGE_ID: 'DDDDDDDDDDD', BTC_AGE_PRIVACY: 'unlisted' }, earlier));
  assert.deepEqual(r['usd-age'], { id: 'OldUsdVideo', end: '2026-09-24' }, 'a private upload');
  assert.deepEqual(r['btc-age'], { id: 'DDDDDDDDDDD', end: '2026-09-25' }, 'a viewable one beside it');
  r = JSON.parse(record({ END: '2026-09-25', USD_AGE_ID: 'EEEEEEEEEE"', USD_AGE_PRIVACY: 'unlisted', BTC_AGE_ID: '', BTC_AGE_PRIVACY: '' }, earlier));
  assert.deepEqual(r['usd-age'], { id: 'OldUsdVideo', end: '2026-09-24' }, 'a malformed id');
  assert.deepEqual(r['btc-age'], { id: 'OldBtcVideo', end: '2026-09-24' }, 'a failed post');
  for (const [id, privacy] of [['bad', 'public'], ['FFFFFFFFFFF', 'public']]) {
    const one = JSON.parse(record({ END: '2026-09-25', BTC_LTHSTH_ID: id, BTC_LTHSTH_PRIVACY: privacy }, earlier));
    assert.deepEqual(one['btc-lthsth'], id === 'bad' ? null : { id, end: '2026-09-25' }, id);
    assert.deepEqual(one['btc-age'], { id: 'OldBtcVideo', end: '2026-09-24' }, id + ': the others as they were');
  }
  // A file with nothing for a video yet keeps null there until one is viewable; the videos a file from before names
  // under other keys (usd and btc, ath and fit) are not carried over.
  for (const old of [{ about: 'x', usd: { id: 'I53s3vHbcFI', end: '2026-09-26' }, btc: null }, { about: 'x', ath: { id: 'YqGYoIqKJ5s', end: '2026-09-26' }, fit: { id: 'I53s3vHbcFI', end: '2026-09-26' } }]) {
    const fromBefore = JSON.parse(record({ END: '2026-10-01', USD_LTHSTH_ID: 'AAAAAAAAAAA', USD_LTHSTH_PRIVACY: 'unlisted' }, JSON.stringify(old)));
    assert.deepEqual(fromBefore, { about: all.about, 'usd-age': null, 'btc-age': null, 'usd-lthsth': { id: 'AAAAAAAAAAA', end: '2026-10-01' }, 'btc-lthsth': null });
  }
  assert.throws(() => record({ END: 'x', USD_AGE_ID: 'AAAAAAAAAAA', USD_AGE_PRIVACY: 'unlisted' }, before), 'a day that is not a date stops it');
});

// The publish job's release notes for videos from START (BTC) and START_USD to END, as it writes them (bash, sha256sum).
function notes(START, END, START_USD = '2011-01-31') {
  const block = job('publish'), a = block.indexOf('          sha() { sha256sum'), b = block.indexOf('(see SECURITY.md)"\n', a);
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
  assert.ok(text.startsWith("Four videos, one for each of the site's weightings and colourings, as the site draws it by default: BitcoinURPD.com-USD-AGE.mp4 and BitcoinURPD.com-USD-LTH-STH.mp4 " +
    "(the bars in dollars, the left axis at each day's tallest bar), every day from 2011-01-31 (the first with a realized cap above zero), and BitcoinURPD.com-BTC-AGE.mp4 and " +
    "BitcoinURPD.com-BTC-LTH-STH.mp4 (the bars in coins, the left axis at the 99.8th percentile of each day's bars, the first bar running off the top with its height printed there), " +
    "every day from 2010-05-18 (the first with anything on the chart), the -AGE ones stacked in 23 age bands and the -LTH-STH ones split into short- and long-term holders at 150 days, " +
    "all four to 2026-09-24. "), text.slice(0, 600));
  assert.match(text, /\nSHA-256 of BitcoinURPD\.com-USD-AGE\.mp4: [0-9a-f]{64}\nSHA-256 of BitcoinURPD\.com-BTC-AGE\.mp4: [0-9a-f]{64}\nSHA-256 of BitcoinURPD\.com-USD-LTH-STH\.mp4: [0-9a-f]{64}\nSHA-256 of BitcoinURPD\.com-BTC-LTH-STH\.mp4: [0-9a-f]{64}\nCheck any file here: gh attestation verify FILE --repo o\/r \(see SECURITY\.md\)$/);
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
