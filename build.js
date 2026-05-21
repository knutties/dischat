#!/usr/bin/env node
/* build.js — minify dischat.js, encode it as a `javascript:` URL, splice
 * the result into index.html, and stamp the build with a CalVer version.
 *
 * Usage:
 *   node build.js          # build (compute next CalVer + embed it)
 *   node build.js --tag    # tag the current HEAD with the embedded CalVer
 *
 * Typical release flow:
 *   node build.js
 *   git add -A && git commit -m "Release vYYYY.MM.DD"
 *   node build.js --tag
 *   git push --follow-tags
 *
 * Why inline?  github.com sends a strict CSP (`script-src
 * github.githubassets.com`) which blocks `<script src=...>` from any other
 * origin. A loader bookmarklet that pulls dischat.js from a CDN therefore
 * fails. Inlining the script into the bookmarklet URL sidesteps CSP because
 * the code runs as part of the user-invoked `javascript:` URL itself.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SRC = path.join(__dirname, 'dischat.js');
const HTML = path.join(__dirname, 'index.html');
const OUT_TXT = path.join(__dirname, 'bookmarklet.txt');
const VERSION_FILE = path.join(__dirname, 'VERSION');

const BEGIN = '<!-- BOOKMARKLET_BEGIN -->';
const END = '<!-- BOOKMARKLET_END -->';
const BEGIN_RAW = '<!-- BOOKMARKLET_RAW_BEGIN -->';
const END_RAW = '<!-- BOOKMARKLET_RAW_END -->';
const BEGIN_VER = '<!-- VERSION_BEGIN -->';
const END_VER = '<!-- VERSION_END -->';

const TAG_ONLY = process.argv.includes('--tag');

function minify(src) {
  return execFileSync(
    'npx',
    ['--yes', 'terser@5', '--compress', '--mangle', '--', SRC],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  ).trim();
}

function htmlEscape(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function splice(html, begin, end, replacement) {
  const i = html.indexOf(begin);
  const j = html.indexOf(end);
  if (i < 0 || j < 0 || j < i) {
    throw new Error(`Markers ${begin}/${end} not found in index.html`);
  }
  return html.slice(0, i + begin.length) + '\n' + replacement + '\n' + html.slice(j);
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

// CalVer: YYYY.MM.DD, with `.N` suffix when same-day tags already exist
// (v2026.05.21 → v2026.05.21.2 → v2026.05.21.3 …).
function nextCalVer() {
  const d = new Date();
  const today = d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
  let same = [];
  try {
    same = execFileSync(
      'git',
      ['tag', '-l', 'v' + today, 'v' + today + '.*'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    )
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (_) {}
  if (!same.length) return today;
  // Highest suffix: v2026.05.21 → 1; v2026.05.21.3 → 3
  let max = 1;
  for (const t of same) {
    const m = t.match(/^v\d{4}\.\d{2}\.\d{2}(?:\.(\d+))?$/);
    if (!m) continue;
    const n = m[1] ? parseInt(m[1], 10) : 1;
    if (n > max) max = n;
  }
  return today + '.' + (max + 1);
}

if (TAG_ONLY) {
  if (!fs.existsSync(VERSION_FILE)) {
    console.error('No VERSION file. Run `node build.js` first.');
    process.exit(1);
  }
  const v = fs.readFileSync(VERSION_FILE, 'utf8').trim();
  if (!/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(v)) {
    console.error('VERSION file contents look invalid: ' + JSON.stringify(v));
    process.exit(1);
  }
  try {
    execFileSync('git', ['tag', '-a', 'v' + v, '-m', 'Release v' + v], {
      stdio: 'inherit',
    });
    console.log('tagged: v' + v);
  } catch (e) {
    console.error('tag failed: ' + e.message);
    process.exit(1);
  }
  process.exit(0);
}

const version = nextCalVer();
fs.writeFileSync(VERSION_FILE, version + '\n');

const minified = minify(fs.readFileSync(SRC, 'utf8'));
const url = 'javascript:' + encodeURIComponent(minified);

fs.writeFileSync(OUT_TXT, url + '\n');

const anchor =
  `        <a class="bookmarklet" title="Drag me to your bookmarks bar" href="${htmlEscape(url)}">▸ dischat</a>`;

const tagHref = 'https://github.com/knutties/dischat/releases/tag/v' + version;
const versionLine =
  '        <span class="version">' +
  '<a class="version-tag" href="' + htmlEscape(tagHref) + '" target="_blank" rel="noopener">' +
  'v' + htmlEscape(version) + '</a>' +
  '</span>';

let html = fs.readFileSync(HTML, 'utf8');
html = splice(html, BEGIN, END, anchor);
html = splice(html, BEGIN_RAW, END_RAW, `      <pre><code>${htmlEscape(url)}</code></pre>`);
html = splice(html, BEGIN_VER, END_VER, versionLine);
fs.writeFileSync(HTML, html);

console.log('version:  v' + version);
console.log('minified: ' + minified.length + ' bytes');
console.log('encoded:  ' + url.length + ' bytes');
console.log('wrote:    bookmarklet.txt, index.html, VERSION');
