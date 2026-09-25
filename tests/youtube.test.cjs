// tools/video/youtube.mjs, the weekly posts to YouTube, against a stand-in for Google's token and upload endpoints.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const load = () => import('../tools/video/youtube.mjs');
const CREDS = { clientId: 'cid', clientSecret: 'secret', refreshToken: 'refresh' };

// A stand-in for oauth2.googleapis.com/token and the resumable upload endpoint. `plan` makes it misbehave:
//   start: status codes for the session-start requests, in turn;  put: what to do on each upload PUT, in turn
//   ('ok', 'drop' to hang up before reading, or { keep: n, status } to keep only the first n bytes and answer status).
async function google(plan = {}) {
  const seen = { token: [], start: [], puts: [], status: 0 }, stored = [];
  let starts = 0, puts = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks), url = new URL(req.url, 'http://x');
      if (url.pathname === '/token') {
        seen.token.push(Object.fromEntries(new URLSearchParams(body.toString())));
        if (plan.token === 'expired') { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end('{"error":"invalid_grant","error_description":"Token has been expired or revoked."}'); }
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"access_token":"at","expires_in":3599}');
      }
      if (url.pathname === '/upload' && req.method === 'POST') {
        seen.start.push({ query: url.search, headers: req.headers, meta: JSON.parse(body.toString()) });
        const code = (plan.start || [])[starts++] || 200;
        if (code !== 200) { res.writeHead(code); return res.end('{"error":{"message":"nope"}}'); }
        res.writeHead(200, { Location: `http://127.0.0.1:${server.address().port}/session/1` }); return res.end();
      }
      if (url.pathname === '/session/1' && req.method === 'PUT') {
        const total = Number(req.headers['content-range'] ? req.headers['content-range'].split('/')[1] : req.headers['content-length']);
        const have = stored.reduce((n, b) => n + b.length, 0);
        const done = () => { res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'Abc_123-xyZ', status: { privacyStatus: plan.privacy || 'private' } })); };
        if (req.headers['content-range'] && req.headers['content-range'].startsWith('bytes */')) {
          seen.status++;
          if (have >= total) return done();
          res.writeHead(308, have ? { Range: `bytes=0-${have - 1}` } : {}); return res.end();
        }
        const step = (plan.put || [])[puts++] || 'ok';
        seen.puts.push({ range: req.headers['content-range'] || null, length: Number(req.headers['content-length']), auth: req.headers.authorization });
        const from = req.headers['content-range'] ? Number(/bytes (\d+)-/.exec(req.headers['content-range'])[1]) : 0;
        if (from !== have) { res.writeHead(400); return res.end('not contiguous'); }
        if (typeof step === 'object') { stored.push(body.subarray(0, step.keep)); res.writeHead(step.status); return res.end(); }
        stored.push(body);
        return have + body.length >= total ? done() : (res.writeHead(308, { Range: `bytes=0-${have + body.length - 1}` }), res.end());
      }
      res.writeHead(404); res.end();
    });
    if (req.url.startsWith('/session/') && (plan.put || [])[puts] === 'drop' && !String(req.headers['content-range'] || '').startsWith('bytes */')) {
      puts++; seen.puts.push({ dropped: true }); req.socket.destroy();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { endpoints: { token: base + '/token', upload: base + '/upload' }, seen, received: () => Buffer.concat(stored), close: () => server.close() };
}

function video(bytes = 3 * 1024 * 1024 + 17) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yt-')), 'v.mp4');
  fs.writeFileSync(file, crypto.randomBytes(bytes));
  return file;
}
const quiet = { wait: async () => {}, log: () => {} };

test('the title is the chart\'s own title on the video\'s last day, naming its look, and nothing in the text is refused by YouTube', async () => {
  const { videoTitle, metadata } = await load();
  assert.equal(videoTitle('2026-09-24'), 'Bitcoin Supply by Price When Last Moved (USD Value, AGE) as of 24 Sept 2026');
  assert.equal(videoTitle('2026-06-07', 'age'), 'Bitcoin Supply by Price When Last Moved (USD Value, AGE) as of 07 Jun 2026');
  assert.equal(videoTitle('2026-09-24', 'lthsth'), 'Bitcoin Supply by Price When Last Moved (USD Value, Under/Over 150D) as of 24 Sept 2026');
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const [key, look] of [['titleUSDAge', 'age'], ['titleUSDSplit', 'lthsth']]) {
    // The site's own chart title, with <150D/>150D written out, since YouTube takes no < or >.
    const site = new RegExp(key + ': "([^"]+)"').exec(index)[1].replace('<150D/>150D', 'Under/Over 150D');
    assert.ok(videoTitle('2026-09-24', look).startsWith(site), look + ': the video is titled with the site\'s own chart title');
  }
  for (const look of ['age', 'lthsth']) {
    const m = metadata('2011-01-31', '2026-09-24', look);
    assert.ok(m.snippet.title.length <= 100);
    assert.match(m.snippet.description, /every day from 31 January 2011 to 24 September 2026\./);
    assert.match(m.snippet.description, /https:\/\/bitcoinsupplychart\.com/);
    for (const text of [m.snippet.title, m.snippet.description, ...m.snippet.tags]) assert.doesNotMatch(text, /[<>]/, 'YouTube refuses < and >');
    assert.ok(Buffer.byteLength(m.snippet.description) < 5000);
    assert.ok(m.snippet.tags.join(',').length <= 500, 'YouTube\'s limit on tags');
    assert.deepEqual(m.status, { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false, embeddable: true, license: 'youtube' },
      'unlisted: open to anyone with the link, not listed on the channel or in search');
  }
  assert.match(metadata('2011-01-31', '2026-09-24').snippet.description, /each bar split into 23 age bands/);
  assert.match(metadata('2011-01-31', '2026-09-24', 'lthsth').snippet.description,
    /each bar split in two at 150 days, the coins that moved within the last 150 days and the coins unmoved for 150 days or more/);
  assert.throws(() => metadata('2011-01-31', '2026-09-24', 'nope'), /no look "nope"/);
});

test('a clean upload: token, session, the whole file in one request, and the id and privacy YouTube recorded', async () => {
  const { post } = await load(), g = await google(), file = video();
  try {
    const r = await post({ file, start: '2011-01-31', end: '2026-09-24', credentials: CREDS, endpoints: g.endpoints, ...quiet });
    assert.deepEqual(r, { id: 'Abc_123-xyZ', privacy: 'private' }, 'until the audit YouTube keeps every upload private');
    assert.deepEqual(g.seen.token, [{ client_id: 'cid', client_secret: 'secret', refresh_token: 'refresh', grant_type: 'refresh_token' }]);
    const s = g.seen.start[0];
    assert.equal(s.query, '?uploadType=resumable&part=snippet,status');
    assert.equal(s.headers.authorization, 'Bearer at');
    assert.equal(Number(s.headers['x-upload-content-length']), fs.statSync(file).size);
    assert.equal(s.headers['x-upload-content-type'], 'video/mp4');
    assert.equal(s.meta.snippet.title, 'Bitcoin Supply by Price When Last Moved (USD Value, AGE) as of 24 Sept 2026');
    assert.equal(g.seen.puts.length, 1);
    assert.ok(g.received().equals(fs.readFileSync(file)), 'every byte, in order');
  } finally { g.close(); }
});

test('the <150D/>150D video is posted under its own title, and an unknown look sends nothing at all', async () => {
  const { post } = await load(), file = video(1000);
  let g = await google({ privacy: 'unlisted' });
  try {
    const r = await post({ file, start: '2010-05-18', end: '2026-09-24', name: 'lthsth', credentials: CREDS, endpoints: g.endpoints, ...quiet });
    assert.deepEqual(r, { id: 'Abc_123-xyZ', privacy: 'unlisted' });
    assert.equal(g.seen.start[0].meta.snippet.title, 'Bitcoin Supply by Price When Last Moved (USD Value, Under/Over 150D) as of 24 Sept 2026');
  } finally { g.close(); }
  g = await google();
  try {
    await assert.rejects(post({ file, start: '2010-05-18', end: '2026-09-24', name: 'toString', credentials: CREDS, endpoints: g.endpoints, ...quiet }), /no look/);
    assert.equal(g.seen.token.length, 0, 'not even a token asked for');
  } finally { g.close(); }
});

test('after a failure halfway through, it asks how much arrived and sends only the rest', async () => {
  const { post } = await load(), g = await google({ put: [{ keep: 1234567, status: 503 }], privacy: 'unlisted' }), file = video();
  try {
    const r = await post({ file, start: '2011-01-31', end: '2026-09-24', credentials: CREDS, endpoints: g.endpoints, ...quiet });
    assert.deepEqual(r, { id: 'Abc_123-xyZ', privacy: 'unlisted' });
    const size = fs.statSync(file).size;
    assert.equal(g.seen.status, 1);
    assert.deepEqual(g.seen.puts.map((p) => [p.range, p.length]), [[null, size], [`bytes 1234567-${size - 1}/${size}`, size - 1234567]]);
    assert.ok(g.received().equals(fs.readFileSync(file)));
  } finally { g.close(); }
});

test('a dropped connection is retried from wherever YouTube got to (here: nothing)', async () => {
  const { post } = await load(), g = await google({ put: ['drop'] }), file = video();
  try {
    const r = await post({ file, start: '2011-01-31', end: '2026-09-24', credentials: CREDS, endpoints: g.endpoints, ...quiet });
    assert.equal(r.id, 'Abc_123-xyZ');
    assert.ok(g.received().equals(fs.readFileSync(file)));
  } finally { g.close(); }
});

test('a refused upload or an expired refresh token stops with the reason, and a 5xx at the start is retried', async () => {
  const { post } = await load(), file = video(1000);
  let g = await google({ start: [503, 200] });
  try {
    assert.equal((await post({ file, start: '2011-01-31', end: '2026-09-24', credentials: CREDS, endpoints: g.endpoints, ...quiet })).id, 'Abc_123-xyZ');
    assert.equal(g.seen.start.length, 2);
  } finally { g.close(); }
  g = await google({ start: [403] });
  try {
    await assert.rejects(post({ file, start: '2011-01-31', end: '2026-09-24', credentials: CREDS, endpoints: g.endpoints, ...quiet }), /start: HTTP 403/);
    assert.equal(g.seen.start.length, 1, 'not retried');
  } finally { g.close(); }
  g = await google({ token: 'expired' });
  try {
    const e = await post({ file, start: '2011-01-31', end: '2026-09-24', credentials: CREDS, endpoints: g.endpoints, ...quiet }).catch((x) => x);
    assert.match(e.message, /token: HTTP 400 invalid_grant/);
    assert.doesNotMatch(e.message, /secret|refresh/, 'the error names no credential');
    assert.equal(g.seen.start.length, 0);
  } finally { g.close(); }
});

test('the secrets are trimmed, and which had spaces around them is said without their values', async () => {
  const { credentialsFrom } = await load();
  const r = credentialsFrom({ YOUTUBE_CLIENT_ID: 'cid', YOUTUBE_CLIENT_SECRET: ' secret ', YOUTUBE_REFRESH_TOKEN: '1//refresh\n' });
  assert.deepEqual(r.credentials, { clientId: 'cid', clientSecret: 'secret', refreshToken: '1//refresh' });
  assert.deepEqual(r.padded, ['YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN']);
  assert.deepEqual(credentialsFrom({}).credentials, { clientId: '', clientSecret: '', refreshToken: '' });
});

test('--check asks for an access token and nothing else, and passes on what Google said', async () => {
  const { checkToken } = await load();
  let g = await google();
  try {
    assert.equal(await checkToken({ credentials: CREDS, endpoints: g.endpoints, wait: async () => {}, log: () => {} }), true);
    assert.equal(g.seen.token.length, 1);
    assert.deepEqual(g.seen.token[0], { client_id: 'cid', client_secret: 'secret', refresh_token: 'refresh', grant_type: 'refresh_token' });
    assert.equal(g.seen.start.length, 0, 'no upload started');
  } finally { await g.close(); }
  g = await google({ token: 'expired' });
  try {
    await assert.rejects(checkToken({ credentials: CREDS, endpoints: g.endpoints, wait: async () => {}, log: () => {} }), /invalid_grant Token has been expired or revoked/);
  } finally { await g.close(); }
});

test('the credentials check workflow is run by hand, reads the repository only, and gives the secrets to one step', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'youtube-check.yml'), 'utf8');
  assert.match(wf, /^on:\n  workflow_dispatch:\n/m);
  assert.match(wf, /^permissions: \{\}/m);
  assert.match(wf, /permissions:\n      contents: read\n/);
  assert.equal((wf.match(/secrets\.YOUTUBE_/g) || []).length, 3);
  assert.match(wf, /run: node tools\/video\/youtube\.mjs --check\n/);
  assert.doesNotMatch(wf, /npm |upload-artifact|GITHUB_TOKEN|contents: write/);
});
