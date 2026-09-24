#!/usr/bin/env node
// Keeps the Content-Security-Policy at the top of index.html in step with the page's inline scripts. The policy lets
// the browser run exactly those scripts, named by their SHA-256, and nothing else inline, so an edited script has to
// be hashed again or the browser refuses to run it (and the tests fail first).
//
//   node tools/update-csp.cjs           write the current hashes into index.html
//   node tools/update-csp.cjs --check   only report whether they are current (exit 1 if not)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE = path.join(__dirname, '..', 'index.html');

// The text of every <script> without a src, exactly as the browser hashes it: the HTML parser turns CRLF and lone
// CR line endings into LF first, so a Windows checkout (CRLF) must be hashed as if it had LF endings.
function inlineScripts(html) {
  return [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)].filter(m => !/\bsrc\s*=/i.test(m[1] || ''))
    .map(m => m[2].replace(/\r\n?/g, '\n'));
}
function scriptHashes(html) {
  return inlineScripts(html).map(s => "'sha256-" + crypto.createHash('sha256').update(s, 'utf8').digest('base64') + "'");
}
function readPolicy(html) {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  if (!m) throw new Error('index.html has no Content-Security-Policy meta tag');
  const directives = {};
  for (const part of m[1].split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives[name] = values;
  }
  return { tag: m[0], text: m[1], directives };
}
function withHashes(html) {
  const { tag, text } = readPolicy(html);
  const next = text.replace(/script-src[^;]*/, (d) => ['script-src', ...scriptHashes(html), ...d.split(/\s+/).slice(1).filter(v => !/^'sha256-/.test(v))].join(' '));
  return html.replace(tag, tag.replace(text, next));
}

if (require.main === module) {
  const html = fs.readFileSync(FILE, 'utf8'), next = withHashes(html);
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('The CSP hashes in index.html are out of date: run node tools/update-csp.cjs'); process.exit(1); }
    console.log('CSP hashes are current.');
  } else if (next !== html) { fs.writeFileSync(FILE, next); console.log('Updated the CSP hashes in index.html.'); }
  else console.log('CSP hashes were already current.');
}
module.exports = { inlineScripts, scriptHashes, readPolicy, withHashes };
