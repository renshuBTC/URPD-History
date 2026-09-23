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
