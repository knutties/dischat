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

const minified = minify(fs.readFileSync(SRC, 'utf8'));
const url = 'javascript:' + encodeURIComponent(minified);

fs.writeFileSync(OUT_TXT, url + '\n');

const anchor =
  `        <a class="bookmarklet" title="Drag me to your bookmarks bar" href="${htmlEscape(url)}">▸ dischat</a>`;

let html = fs.readFileSync(HTML, 'utf8');
html = splice(html, BEGIN, END, anchor);
html = splice(html, BEGIN_RAW, END_RAW, `      <pre><code>${htmlEscape(url)}</code></pre>`);
fs.writeFileSync(HTML, html);

console.log(`minified: ${minified.length} bytes`);
console.log(`encoded:  ${url.length} bytes`);
console.log(`wrote:    bookmarklet.txt, index.html`);
