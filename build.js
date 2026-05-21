#!/usr/bin/env node
/* build.js — minify dischat.js, encode it as a `javascript:` URL, and write
 * the result to bookmarklet.txt + splice it into index.html.
 *
 * Usage:  node build.js
 * Requires: terser (run via `npx --yes terser`).
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

const BEGIN = '<!-- BOOKMARKLET_BEGIN -->';
const END = '<!-- BOOKMARKLET_END -->';
const BEGIN_RAW = '<!-- BOOKMARKLET_RAW_BEGIN -->';
const END_RAW = '<!-- BOOKMARKLET_RAW_END -->';
const BEGIN_VER = '<!-- VERSION_BEGIN -->';
const END_VER = '<!-- VERSION_END -->';

function gitInfo() {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const full = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    let dirty = '';
    try {
      const out = execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      // Ignore changes to files we're about to rewrite ourselves.
      const tracked = out
        .split('\n')
        .filter(Boolean)
        .filter((l) => {
          const p = l.slice(3);
          return p !== 'index.html' && p !== 'bookmarklet.txt';
        });
      if (tracked.length) dirty = '-dirty';
    } catch (_) {}
    return { sha: sha + dirty, full };
  } catch (_) {
    return { sha: 'dev', full: '' };
  }
}

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

const { sha, full } = gitInfo();
const buildDate = new Date().toISOString().slice(0, 10);

const minified = minify(fs.readFileSync(SRC, 'utf8'));
const url = 'javascript:' + encodeURIComponent(minified);

fs.writeFileSync(OUT_TXT, url + '\n');

const anchor =
  `        <a class="bookmarklet" title="Drag me to your bookmarks bar" href="${htmlEscape(url)}">▸ dischat</a>`;

const verHref = full
  ? `https://github.com/knutties/dischat/commit/${full}`
  : 'https://github.com/knutties/dischat';
const versionLine =
  `      <span class="version">built <span class="version-date">${buildDate}</span> · ` +
  `<a class="version-sha" href="${htmlEscape(verHref)}" target="_blank" rel="noopener">` +
  `${htmlEscape(sha)}</a></span>`;

let html = fs.readFileSync(HTML, 'utf8');
html = splice(html, BEGIN, END, anchor);
html = splice(html, BEGIN_RAW, END_RAW, `      <pre><code>${htmlEscape(url)}</code></pre>`);
html = splice(html, BEGIN_VER, END_VER, versionLine);
fs.writeFileSync(HTML, html);

console.log(`commit:   ${sha}`);
console.log(`minified: ${minified.length} bytes`);
console.log(`encoded:  ${url.length} bytes`);
console.log(`wrote:    bookmarklet.txt, index.html`);
