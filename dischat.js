/* dischat — turn a GitHub Discussions page into a Slack-style chat overlay.
 * Loaded by a bookmarklet. Re-running the bookmarklet toggles the overlay off. */
(function () {
  'use strict';

  const ROOT_ID = 'dischat-root';
  const STYLE_ID = 'dischat-styles';
  const HTML_FLAG = 'dischat-active';

  // Toggle off if overlay is already mounted.
  if (document.getElementById(ROOT_ID)) {
    document.getElementById(ROOT_ID).remove();
    const s = document.getElementById(STYLE_ID);
    if (s) s.remove();
    document.documentElement.classList.remove(HTML_FLAG);
    return;
  }

  const singleMatch = location.pathname.match(/^\/([^/]+)\/([^/]+)\/discussions\/(\d+)/);
  const indexMatch = location.pathname.match(/^\/([^/]+)\/([^/]+)\/discussions\/?$/);

  if (!singleMatch && !indexMatch) {
    alert(
      'Dischat needs a GitHub Discussions page.\n\n' +
        'Navigate to:\n' +
        '  github.com/OWNER/REPO/discussions\n' +
        '  github.com/OWNER/REPO/discussions/123'
    );
    return;
  }

  // ---------- tiny DOM helpers ----------
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));
  const txt = (n) => (n ? (n.textContent || '').trim() : '');

  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k[0] === 'o' && k[1] === 'n' && typeof v === 'function')
          el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) {
        for (const cc of c) if (cc != null && cc !== false) el.append(cc.nodeType ? cc : document.createTextNode(cc));
      } else {
        el.append(c.nodeType ? c : document.createTextNode(c));
      }
    }
    return el;
  }

  function timeLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay) return time;
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday at ' + time;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' at ' + time;
  }

  function channelize(s) {
    return (
      (s || 'discussion')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'discussion'
    );
  }

  function dayLabel(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // ---------- styles ----------
  const STYLES = `
    html.${HTML_FLAG}, html.${HTML_FLAG} body { overflow: hidden !important; }
    #${ROOT_ID} {
      position: fixed; inset: 0; z-index: 2147483646;
      background: #1a1d21; color: #d1d2d3;
      display: grid; grid-template-columns: 260px 1fr 0fr;
      font: 14px/1.46668 -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      animation: dcIn .18s ease;
    }
    #${ROOT_ID}.thread-open { grid-template-columns: 260px 1fr 420px; }
    @keyframes dcIn { from { opacity: 0 } to { opacity: 1 } }
    @media (max-width: 900px) {
      #${ROOT_ID} { grid-template-columns: 0fr 1fr 0fr; }
      #${ROOT_ID}.thread-open { grid-template-columns: 0fr 0fr 1fr; }
    }
    #${ROOT_ID} * { box-sizing: border-box; }

    #${ROOT_ID} .dc-side { background: #19171d; color: #fff; border-right: 1px solid #2c2d30; display: flex; flex-direction: column; overflow: hidden; }
    #${ROOT_ID} .dc-side h2 { font: 900 15px/1 inherit; margin: 0; padding: 16px; border-bottom: 1px solid #2c2d30; display: flex; flex-direction: column; gap: 4px; color: #fff; }
    #${ROOT_ID} .dc-side h2 small { color: #b9b9b9; font-weight: 400; font-size: 12px; }
    #${ROOT_ID} .dc-channels { flex: 1; overflow-y: auto; padding: 10px 0; }
    #${ROOT_ID} .dc-group { color: #b9b9b9; font: 600 13px/1 inherit; padding: 12px 16px 4px; }
    #${ROOT_ID} .dc-ch { display: flex; align-items: center; gap: 6px; padding: 4px 16px; cursor: pointer; color: #b9b9b9; font-size: 14px; text-decoration: none; line-height: 1.4; }
    #${ROOT_ID} .dc-ch:hover { background: #27242c; color: #fff; }
    #${ROOT_ID} .dc-ch.on { background: #1164a3; color: #fff; }
    #${ROOT_ID} .dc-ch .pfx { color: #6a6772; flex-shrink: 0; }
    #${ROOT_ID} .dc-ch.on .pfx { color: #fff; }
    #${ROOT_ID} .dc-ch .ch-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${ROOT_ID} .dc-side-foot { padding: 10px 12px; border-top: 1px solid #2c2d30; display: flex; gap: 6px; flex-wrap: wrap; }
    #${ROOT_ID} .dc-side-foot button, #${ROOT_ID} .dc-side-foot a { background: #27242c; border: 0; color: #d1d2d3; cursor: pointer; padding: 6px 10px; border-radius: 4px; font: 12px/1 inherit; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
    #${ROOT_ID} .dc-side-foot button:hover, #${ROOT_ID} .dc-side-foot a:hover { background: #383640; color: #fff; }

    #${ROOT_ID} .dc-main { background: #1a1d21; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
    #${ROOT_ID} .dc-head { padding: 12px 20px; border-bottom: 1px solid #383b40; display: flex; align-items: center; gap: 12px; background: #1a1d21; flex-shrink: 0; }
    #${ROOT_ID} .dc-head .ttl { font: 900 18px/1.2 inherit; color: #fff; }
    #${ROOT_ID} .dc-head .meta { font-size: 13px; color: #9a9b9e; }
    #${ROOT_ID} .dc-status { padding: 3px 8px; border-radius: 12px; background: #007a5a; color: #fff; font: 700 10px/1.2 inherit; text-transform: uppercase; letter-spacing: .5px; }
    #${ROOT_ID} .dc-status.closed { background: #6f4e3a; }

    #${ROOT_ID} .dc-msgs { flex: 1; overflow-y: auto; padding: 16px 0 8px; min-height: 0; }
    #${ROOT_ID} .dc-day { text-align: center; margin: 12px 16px 16px; position: relative; color: #d1d2d3; font: 700 13px/1.2 inherit; }
    #${ROOT_ID} .dc-day::before { content: ''; position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: #383b40; z-index: 0; }
    #${ROOT_ID} .dc-day span { background: #1a1d21; position: relative; padding: 0 12px; z-index: 1; border: 1px solid #383b40; border-radius: 12px; }

    #${ROOT_ID} .dc-msg { display: grid; grid-template-columns: 36px 1fr; gap: 10px; padding: 6px 20px; }
    #${ROOT_ID} .dc-msg:hover { background: #222529; }
    #${ROOT_ID} .dc-msg.cont { padding-top: 1px; padding-bottom: 1px; }
    #${ROOT_ID} .dc-msg.cont .av { visibility: hidden; }
    #${ROOT_ID} .dc-msg.cont .meta { display: none; }
    #${ROOT_ID} .dc-msg.op { background: linear-gradient(to right, rgba(29,155,209,.08), transparent); border-left: 3px solid #1d9bd1; padding-left: 17px; }
    #${ROOT_ID} .av { grid-column: 1; }
    #${ROOT_ID} .av img, #${ROOT_ID} .av .ph { width: 36px; height: 36px; border-radius: 4px; display: block; }
    #${ROOT_ID} .av .ph { background: #4a4a4a; }
    #${ROOT_ID} .body { min-width: 0; grid-column: 2; }
    #${ROOT_ID} .meta { display: flex; align-items: baseline; gap: 8px; line-height: 1.2; flex-wrap: wrap; }
    #${ROOT_ID} .who { font-weight: 900; color: #fff; text-decoration: none; }
    #${ROOT_ID} .who:hover { text-decoration: underline; }
    #${ROOT_ID} .when { font-size: 12px; color: #9a9b9e; }
    #${ROOT_ID} .op-badge { font: 700 9px/1 inherit; background: #1d9bd1; color: #fff; padding: 3px 5px; border-radius: 3px; text-transform: uppercase; letter-spacing: .5px; }
    #${ROOT_ID} .answer-badge { font: 700 9px/1 inherit; background: #007a5a; color: #fff; padding: 3px 5px; border-radius: 3px; text-transform: uppercase; letter-spacing: .5px; }

    #${ROOT_ID} .md { color: #d1d2d3; word-wrap: break-word; line-height: 1.46668; margin-top: 2px; }
    #${ROOT_ID} .md > *:first-child { margin-top: 0; }
    #${ROOT_ID} .md > *:last-child { margin-bottom: 0; }
    #${ROOT_ID} .md p { margin: 4px 0; }
    #${ROOT_ID} .md pre { background: #0e0e0e; border: 1px solid #353a40; padding: 8px 10px; border-radius: 6px; overflow-x: auto; font: 12px/1.5 SFMono-Regular, Consolas, "Liberation Mono", monospace; margin: 6px 0; }
    #${ROOT_ID} .md code { background: #2c2d30; padding: 1px 4px; border-radius: 3px; font: 12px/1.4 SFMono-Regular, Consolas, monospace; color: #e8912d; }
    #${ROOT_ID} .md pre code { background: transparent; padding: 0; color: inherit; }
    #${ROOT_ID} .md a { color: #1d9bd1; }
    #${ROOT_ID} .md img { max-width: 480px; height: auto; border-radius: 4px; }
    #${ROOT_ID} .md blockquote { border-left: 4px solid #4a4a4a; padding-left: 10px; color: #b9b9b9; margin: 6px 0; }
    #${ROOT_ID} .md h1, #${ROOT_ID} .md h2, #${ROOT_ID} .md h3, #${ROOT_ID} .md h4 { color: #fff; margin: 8px 0 4px; line-height: 1.2; }
    #${ROOT_ID} .md ul, #${ROOT_ID} .md ol { margin: 4px 0; padding-left: 24px; }
    #${ROOT_ID} .md table { border-collapse: collapse; margin: 8px 0; }
    #${ROOT_ID} .md th, #${ROOT_ID} .md td { border: 1px solid #383b40; padding: 4px 8px; }
    #${ROOT_ID} .md hr { border: 0; border-top: 1px solid #383b40; margin: 8px 0; }
    #${ROOT_ID} .md .task-list-item { list-style: none; margin-left: -20px; }
    #${ROOT_ID} .md input[type=checkbox] { margin-right: 6px; }

    #${ROOT_ID} .thr-btn { display: inline-flex; align-items: center; gap: 8px; margin-top: 6px; padding: 4px 8px 4px 6px; background: transparent; border: 1px solid transparent; border-radius: 6px; color: #1d9bd1; font: 13px/1.2 inherit; cursor: pointer; max-width: 100%; }
    #${ROOT_ID} .thr-btn:hover { background: #1a1d21; border-color: #2c2d30; }
    #${ROOT_ID} .thr-btn .av-mini { width: 20px; height: 20px; border-radius: 4px; display: inline-block; background: #4a4a4a; flex-shrink: 0; }
    #${ROOT_ID} .thr-btn .av-mini + .av-mini { margin-left: -6px; border: 2px solid #1a1d21; }
    #${ROOT_ID} .dc-msg:hover .thr-btn { background: #1a1d21; border-color: #2c2d30; }
    #${ROOT_ID} .thr-btn .ct-n { font-weight: 700; }
    #${ROOT_ID} .thr-btn .last { color: #9a9b9e; font-weight: 400; }

    #${ROOT_ID} .dc-thr { background: #1a1d21; border-left: 1px solid #383b40; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
    #${ROOT_ID}:not(.thread-open) .dc-thr { display: none; }
    #${ROOT_ID} .dc-thr-head { padding: 12px 20px; border-bottom: 1px solid #383b40; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
    #${ROOT_ID} .dc-thr-head .ttl { font: 900 16px/1.2 inherit; color: #fff; flex: 1; }
    #${ROOT_ID} .dc-thr-head button { background: transparent; border: 0; color: #d1d2d3; cursor: pointer; font-size: 22px; padding: 0 4px; line-height: 1; }
    #${ROOT_ID} .dc-thr-head button:hover { color: #fff; }
    #${ROOT_ID} .dc-thr-msgs { flex: 1; overflow-y: auto; padding: 0 0 8px; min-height: 0; }
    #${ROOT_ID} .dc-thr-divider { padding: 4px 20px 8px; font-size: 12px; color: #9a9b9e; border-bottom: 1px solid #383b40; margin: 4px 0 8px; display: flex; align-items: center; gap: 8px; }
    #${ROOT_ID} .dc-thr-divider::after { content: ''; flex: 1; height: 1px; }

    #${ROOT_ID} .dc-compose { padding: 0 20px 16px; background: #1a1d21; flex-shrink: 0; }
    #${ROOT_ID} .dc-compose .row { background: transparent; border: 1px solid #565856; border-radius: 8px; padding: 8px 10px 8px 14px; display: flex; align-items: end; gap: 8px; transition: border-color .1s ease; }
    #${ROOT_ID} .dc-compose .row:focus-within { border-color: #1d9bd1; }
    #${ROOT_ID} .compose-input { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: #fff; font: inherit; resize: none; min-height: 22px; max-height: 200px; line-height: 1.46; padding: 3px 0; }
    #${ROOT_ID} .compose-input::placeholder { color: #6a6772; }
    #${ROOT_ID} .compose-send { background: transparent; border: 1px solid #1d9bd1; color: #1d9bd1; min-width: 32px; height: 32px; border-radius: 4px; cursor: pointer; font: 600 13px/1 inherit; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 0 10px; }
    #${ROOT_ID} .compose-send:hover { background: #1d9bd1; color: #fff; }
    #${ROOT_ID} .compose-send:disabled { opacity: .4; cursor: not-allowed; }
    #${ROOT_ID} .compose-hint { font-size: 11px; color: #6a6772; padding: 4px 4px 0; }
    #${ROOT_ID} .compose-hint kbd { background: #2c2d30; border: 1px solid #383b40; border-radius: 3px; padding: 0 4px; font: 10px/1.5 SFMono-Regular, Consolas, monospace; color: #d1d2d3; }
    #${ROOT_ID} .compose-busy { opacity: .5; pointer-events: none; }

    #${ROOT_ID} .dc-empty { padding: 60px 20px; color: #9a9b9e; text-align: center; font-size: 14px; }
    #${ROOT_ID} .dc-empty h3 { color: #fff; margin: 0 0 10px; font-size: 18px; }
    #${ROOT_ID} .dc-empty code { background: #2c2d30; padding: 1px 6px; border-radius: 3px; font-size: 12px; color: #e8912d; }
    #${ROOT_ID} .dc-empty button { margin-top: 14px; background: #1164a3; color: #fff; border: 0; padding: 8px 16px; border-radius: 4px; cursor: pointer; font: 700 13px/1 inherit; }
    #${ROOT_ID} .dc-empty button:hover { background: #1976cd; }
  `;

  function injectStyles() {
    document.head.appendChild(h('style', { id: STYLE_ID, html: STYLES }));
  }

  // ---------- DOM scraping ----------
  function scrapeMessage(el) {
    const authorEl =
      el.querySelector('.timeline-comment-header a.author') ||
      el.querySelector('a.author') ||
      el.querySelector('a[data-hovercard-type="user"]');
    const avatarEl =
      el.querySelector('img.avatar-user') ||
      el.querySelector('img.avatar') ||
      el.querySelector('img[class*="avatar" i]');
    const bodyEl =
      el.querySelector('.comment-body') ||
      el.querySelector('.js-comment-body') ||
      el.querySelector('[data-testid="comment-body"]') ||
      el.querySelector('.markdown-body') ||
      el.querySelector('[class*="MarkdownContent"]');
    const timeEl = el.querySelector('relative-time, time-ago, time');
    const isAnswer =
      !!el.querySelector('.color-bg-success-emphasis, [class*="MarkedAsAnswer"]') ||
      el.classList.contains('color-bg-success-emphasis') ||
      /marked.*answer|chosen.*answer/i.test(el.getAttribute('aria-label') || '');

    return {
      author: txt(authorEl) || 'unknown',
      authorUrl: authorEl ? authorEl.href : '',
      avatar: avatarEl ? avatarEl.src : '',
      bodyHtml: bodyEl ? bodyEl.innerHTML : '<p><em>(no body found)</em></p>',
      ts: timeEl ? timeEl.getAttribute('datetime') || '' : '',
      isAnswer,
      node: el,
    };
  }

  function findCommentElements() {
    // GitHub Discussions DOM has changed several times; try a few selectors.
    const sels = [
      '.timeline-comment',
      '.js-comment',
      '[data-testid="comment-viewer-outer-box"]',
      '[data-testid="comment"]',
    ];
    for (const sel of sels) {
      const items = $$(sel).filter(
        (el) =>
          el.querySelector('.comment-body, .js-comment-body, .markdown-body, [class*="MarkdownContent"]') &&
          el.querySelector('a.author, a[data-hovercard-type="user"]')
      );
      if (items.length) return items;
    }
    // Last-resort: walk for any element that has both an author and a markdown body
    // and isn't nested inside another candidate.
    const cands = $$('div, article, li').filter(
      (el) =>
        el.querySelector('a[data-hovercard-type="user"]') &&
        el.querySelector('.markdown-body, [class*="MarkdownContent"]')
    );
    const set = new Set(cands);
    return cands.filter((c) => {
      let p = c.parentElement;
      while (p) {
        if (set.has(p)) return false;
        p = p.parentElement;
      }
      return true;
    });
  }

  function scrapeSingle() {
    const titleNode =
      $('bdi.js-issue-title') ||
      $('h1.gh-header-title') ||
      $('h1 [class*="title"]') ||
      $('main h1');
    const title = txt(titleNode) || 'discussion';

    const catNode = $('a[href*="/discussions/categories/"]');
    const category = txt(catNode);

    const stateNode = $('.State, [class*="State-"], [data-testid="discussion-state"]');
    let state = txt(stateNode);
    if (state.length > 16) state = '';

    const comments = findCommentElements();

    // Group: a comment whose ancestor is also a comment is a reply.
    const set = new Set(comments);
    const tops = [];
    const repliesByOwner = new Map();
    for (const c of comments) {
      let p = c.parentElement;
      let owner = null;
      while (p) {
        if (set.has(p)) { owner = p; break; }
        p = p.parentElement;
      }
      if (!owner) tops.push(c);
      else {
        if (!repliesByOwner.has(owner)) repliesByOwner.set(owner, []);
        repliesByOwner.get(owner).push(c);
      }
    }

    const messages = tops.map((t) => {
      const m = scrapeMessage(t);
      m.replies = (repliesByOwner.get(t) || []).map(scrapeMessage);
      return m;
    });

    return { title, category, state, messages };
  }

  function scrapeIndex() {
    const links = $$('a[href]').filter((a) =>
      /\/discussions\/\d+/.test(a.getAttribute('href') || '')
    );
    const seen = new Set();
    const items = [];
    for (const a of links) {
      const href = a.getAttribute('href');
      if (seen.has(href)) continue;
      const title = txt(a);
      if (!title || title.length < 2) continue;
      seen.add(href);

      const row = a.closest('li, .Box-row, .js-navigation-item, [role="listitem"]') || a.parentElement;
      const authorEl = row && row.querySelector('a[data-hovercard-type="user"]');
      const avatarEl = row && (row.querySelector('img.avatar-user') || row.querySelector('img.avatar'));
      const timeEl = row && row.querySelector('relative-time, time');
      const catEl = row && row.querySelector('a[href*="/categories/"]');
      const countEl = row && row.querySelector('[class*="comments"], [aria-label*="comment" i]');

      items.push({
        title,
        href,
        author: txt(authorEl),
        authorUrl: authorEl ? authorEl.href : '',
        avatar: avatarEl ? avatarEl.src : '',
        ts: timeEl ? timeEl.getAttribute('datetime') || '' : '',
        category: txt(catEl),
        count: txt(countEl).replace(/[^0-9]/g, '') || '',
      });
    }
    return items;
  }

  // ---------- rendering ----------
  function renderMessage(m, opts) {
    opts = opts || {};
    const av = m.avatar
      ? h('img', { src: m.avatar, alt: m.author, loading: 'lazy' })
      : h('div', { class: 'ph' });

    const metaBits = [
      m.authorUrl
        ? h('a', { class: 'who', href: m.authorUrl, target: '_blank', rel: 'noopener' }, m.author)
        : h('span', { class: 'who' }, m.author),
      opts.isOp ? h('span', { class: 'op-badge', title: 'Original poster' }, 'OP') : null,
      m.isAnswer ? h('span', { class: 'answer-badge', title: 'Marked as answer' }, 'Answer') : null,
      h('span', { class: 'when' }, timeLabel(m.ts)),
    ];

    const body = h(
      'div',
      { class: 'body' },
      h('div', { class: 'meta' }, metaBits),
      h('div', { class: 'md', html: m.bodyHtml }),
      opts.threadBtn || null
    );

    const cls = 'dc-msg' + (opts.cont ? ' cont' : '') + (opts.isOp ? ' op' : '');
    return h('div', { class: cls }, h('div', { class: 'av' }, av), body);
  }

  function renderThreadButton(m, channelName) {
    const avs = m.replies.slice(0, 3).map((r) =>
      r.avatar
        ? h('img', { class: 'av-mini', src: r.avatar, alt: r.author })
        : h('span', { class: 'av-mini' })
    );
    const last = m.replies[m.replies.length - 1];
    return h(
      'button',
      { class: 'thr-btn', onclick: () => openThread(m, channelName) },
      avs,
      h('span', { class: 'ct-n' }, m.replies.length + (m.replies.length === 1 ? ' reply' : ' replies')),
      last && last.ts ? h('span', { class: 'last' }, 'Last reply ' + timeLabel(last.ts)) : null
    );
  }

  function openThread(m, channelName) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.classList.add('thread-open');
    const thr = root.querySelector('.dc-thr');
    thr.innerHTML = '';
    thr.append(
      h(
        'div',
        { class: 'dc-thr-head' },
        h('span', { class: 'ttl' }, 'Thread'),
        h('span', { class: 'when' }, '#' + channelName),
        h('button', { onclick: closeThread, title: 'Close thread' }, '×')
      ),
      h(
        'div',
        { class: 'dc-thr-msgs' },
        renderMessage(m, { isOp: false }),
        h(
          'div',
          { class: 'dc-thr-divider' },
          m.replies.length + (m.replies.length === 1 ? ' reply' : ' replies')
        ),
        m.replies.map((r) => renderMessage(r))
      ),
      buildCompose({ placeholder: 'Reply…', mode: 'thread', ctxNode: m.node })
    );
  }

  function closeThread() {
    const root = document.getElementById(ROOT_ID);
    if (root) root.classList.remove('thread-open');
  }

  function dayDivider(iso) {
    const label = dayLabel(iso);
    if (!label) return null;
    return h('div', { class: 'dc-day' }, h('span', null, label));
  }

  function renderMessageList(messages, channelName) {
    const wrap = h('div', { class: 'dc-msgs' });
    if (!messages.length) {
      wrap.append(
        h(
          'div',
          { class: 'dc-empty' },
          h('h3', null, 'No messages found'),
          h(
            'p',
            null,
            'Dischat couldn’t parse this page. GitHub may have changed its DOM. Try the ',
            h('a', { href: location.href, style: 'color:#1d9bd1' }, 'original view'),
            '.'
          ),
          h('button', { onclick: closeChat }, 'Close')
        )
      );
      return wrap;
    }

    let lastAuthor = null;
    let lastTime = 0;
    let lastDay = null;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const isOp = i === 0;
      const t = m.ts ? new Date(m.ts).getTime() : 0;
      const day = m.ts ? new Date(m.ts).toDateString() : null;
      if (day && day !== lastDay) {
        const div = dayDivider(m.ts);
        if (div) wrap.append(div);
        lastDay = day;
        lastAuthor = null;
      }
      const cont = !isOp && lastAuthor === m.author && lastTime && t - lastTime < 5 * 60 * 1000;
      const threadBtn = m.replies && m.replies.length ? renderThreadButton(m, channelName) : null;
      wrap.append(renderMessage(m, { cont, isOp, threadBtn }));
      lastAuthor = m.author;
      lastTime = t;
    }
    return wrap;
  }

  function renderSingle(root, org, repo, num) {
    const data = scrapeSingle();
    const channelName = channelize(data.title);

    const side = h(
      'div',
      { class: 'dc-side' },
      h(
        'h2',
        null,
        h('span', null, org + '/' + repo),
        h('small', null, 'discussions')
      ),
      h(
        'div',
        { class: 'dc-channels' },
        h('div', { class: 'dc-group' }, 'channel'),
        h(
          'a',
          { class: 'dc-ch on', href: location.pathname, onclick: (e) => e.preventDefault() },
          h('span', { class: 'pfx' }, '#'),
          h('span', { class: 'ch-name' }, channelName)
        ),
        data.category ? h('div', { class: 'dc-group' }, 'category') : null,
        data.category
          ? h(
              'div',
              { class: 'dc-ch' },
              h('span', { class: 'pfx' }, '@'),
              h('span', { class: 'ch-name' }, data.category)
            )
          : null
      ),
      h(
        'div',
        { class: 'dc-side-foot' },
        h('a', { href: '/' + org + '/' + repo + '/discussions', title: 'All discussions' }, 'All channels'),
        h('button', { onclick: closeChat, title: 'Close (Esc)' }, 'Close')
      )
    );

    const statusKind =
      data.state && /clos/i.test(data.state) ? 'closed' : '';
    const head = h(
      'div',
      { class: 'dc-head' },
      h('span', { style: { color: '#9a9b9e', fontWeight: 'bold' } }, '#'),
      h('span', { class: 'ttl' }, channelName),
      data.state ? h('span', { class: 'dc-status' + (statusKind ? ' ' + statusKind : '') }, data.state) : null,
      data.category ? h('span', { class: 'meta' }, 'in ' + data.category) : null,
      h('span', { style: { flex: '1' } }),
      h(
        'span',
        { class: 'meta' },
        data.messages.length + (data.messages.length === 1 ? ' message' : ' messages')
      )
    );

    const compose = buildCompose({
      placeholder: 'Message #' + channelName,
      mode: 'top',
    });

    const main = h(
      'div',
      { class: 'dc-main' },
      head,
      renderMessageList(data.messages, channelName),
      compose
    );

    const thr = h('div', { class: 'dc-thr' });

    root.append(side, main, thr);
  }

  function renderIndex(root, org, repo) {
    const items = scrapeIndex();

    const side = h(
      'div',
      { class: 'dc-side' },
      h(
        'h2',
        null,
        h('span', null, org + '/' + repo),
        h('small', null, 'discussions')
      ),
      h(
        'div',
        { class: 'dc-channels' },
        h('div', { class: 'dc-group' }, 'channels (' + items.length + ')'),
        items.map((it) =>
          h(
            'a',
            { class: 'dc-ch', href: it.href, title: it.title },
            h('span', { class: 'pfx' }, '#'),
            h('span', { class: 'ch-name' }, channelize(it.title))
          )
        )
      ),
      h(
        'div',
        { class: 'dc-side-foot' },
        h('button', { onclick: closeChat, title: 'Close (Esc)' }, 'Close')
      )
    );

    const head = h(
      'div',
      { class: 'dc-head' },
      h('span', { class: 'ttl' }, 'All discussions'),
      h('span', { style: { flex: '1' } }),
      h('span', { class: 'meta' }, items.length + ' channels')
    );

    const msgs = h('div', { class: 'dc-msgs' });
    if (!items.length) {
      msgs.append(
        h(
          'div',
          { class: 'dc-empty' },
          h('h3', null, 'No discussions found'),
          h('p', null, 'Try scrolling so list items are rendered, then re-run the bookmarklet.')
        )
      );
    } else {
      let lastDay = null;
      for (const it of items) {
        const day = it.ts ? new Date(it.ts).toDateString() : null;
        if (day && day !== lastDay) {
          const div = dayDivider(it.ts);
          if (div) msgs.append(div);
          lastDay = day;
        }
        const ch = channelize(it.title);
        const html =
          '<p><a href="' +
          it.href +
          '" style="color:#1d9bd1; font-weight:700; text-decoration:none">#' +
          ch +
          '</a> &middot; ' +
          escapeHtml(it.title) +
          '</p>' +
          (it.category || it.count
            ? '<p style="color:#9a9b9e; font-size:12px; margin-top:2px;">' +
              (it.category ? 'in ' + escapeHtml(it.category) : '') +
              (it.count ? ' &middot; ' + it.count + ' comment' + (it.count === '1' ? '' : 's') : '') +
              '</p>'
            : '');
        msgs.append(
          renderMessage({
            author: it.author || 'unknown',
            authorUrl: it.authorUrl,
            avatar: it.avatar,
            ts: it.ts,
            bodyHtml: html,
            isAnswer: false,
          })
        );
      }
    }

    const main = h('div', { class: 'dc-main' }, head, msgs);
    const thr = h('div', { class: 'dc-thr' });
    root.append(side, main, thr);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------- compose / post ----------
  function buildCompose(opts) {
    opts = opts || {};
    const textarea = h('textarea', {
      class: 'compose-input',
      placeholder: opts.placeholder || 'Message',
      rows: '1',
      spellcheck: 'true',
    });

    function autoGrow() {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    }

    function send() {
      const v = textarea.value.trim();
      if (!v) return;
      postToGithub(v, opts);
    }

    textarea.addEventListener('input', autoGrow);
    textarea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        send();
      }
    });

    const sendBtn = h(
      'button',
      { class: 'compose-send', onclick: send, title: 'Send (Enter)', type: 'button' },
      'Send'
    );

    return h(
      'div',
      { class: 'dc-compose' },
      h('div', { class: 'row' }, textarea, sendBtn),
      h(
        'div',
        { class: 'compose-hint' },
        '↵ to send · Shift+↵ for newline · posts via GitHub\'s comment form'
      )
    );
  }

  // Set the value on a React-controlled textarea such that React notices.
  function setReactValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function visible(el) {
    if (!el || !el.offsetParent) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findGithubTextarea(ctxNode) {
    const root = document.getElementById(ROOT_ID);
    const isExternal = (el) => el && (!root || !root.contains(el));

    // Try the context-specific area first (for thread replies).
    if (ctxNode) {
      const tas = Array.from(ctxNode.querySelectorAll('textarea')).filter(isExternal).filter(visible);
      if (tas.length) return tas[tas.length - 1];
      // Also look at next siblings — GH renders reply form below the comment.
      let sib = ctxNode.nextElementSibling;
      for (let i = 0; sib && i < 3; i++, sib = sib.nextElementSibling) {
        const ta = sib.querySelector && sib.querySelector('textarea');
        if (ta && isExternal(ta) && visible(ta)) return ta;
      }
    }

    const sels = [
      'form.js-new-comment-form textarea',
      'textarea[name="comment[body]"]',
      'textarea[name="commentBody"]',
      'textarea[name="discussion_comment[body]"]',
      'textarea.js-comment-field',
      'textarea[aria-label*="comment body" i]',
      'textarea[aria-label*="reply" i]',
      'textarea[placeholder*="reply" i]',
      'textarea[placeholder*="comment" i]',
      'textarea',
    ];
    for (const sel of sels) {
      const cands = Array.from(document.querySelectorAll(sel)).filter(isExternal).filter(visible);
      if (cands.length) return cands[cands.length - 1];
    }
    return null;
  }

  function findSubmitButton(textarea) {
    if (!textarea) return null;
    const form = textarea.closest('form');
    if (form) {
      const btn = form.querySelector('button[type=submit]:not([disabled])') ||
                  form.querySelector('button[type=submit]');
      if (btn) return btn;
    }
    // Walk up and look for a nearby Comment/Reply/Post button.
    let scope = textarea.closest('form, [class*="CommentBox"], [class*="comment-box" i], section, article') || document.body;
    const btns = Array.from(scope.querySelectorAll('button')).filter((b) => {
      const t = (b.textContent || '').trim();
      return /^(comment|reply|post|send)$/i.test(t);
    });
    return btns[btns.length - 1] || null;
  }

  function postToGithub(text, opts) {
    const root = document.getElementById(ROOT_ID);
    const ctxNode = opts && opts.ctxNode;
    const composeEl = root && root.querySelector('.dc-compose');

    const ta = findGithubTextarea(ctxNode);
    if (!ta) {
      alert(
        'Dischat: couldn\'t find GitHub\'s comment box on this page.\n' +
          'Make sure you\'re signed in and that the page has a reply form.'
      );
      return;
    }

    if (composeEl) composeEl.classList.add('compose-busy');

    setReactValue(ta, text);
    const btn = findSubmitButton(ta);

    if (!btn) {
      if (composeEl) composeEl.classList.remove('compose-busy');
      alert(
        'Dischat: your message is in GitHub\'s reply box, but the Comment button isn\'t findable. Closing the overlay so you can click Comment yourself.'
      );
      closeChat();
      ta.focus();
      ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    // Give React a tick to enable the submit button after the input event.
    setTimeout(function () {
      if (btn.disabled) {
        // Try once more after a slightly longer delay.
        setTimeout(function () {
          if (btn.disabled) {
            if (composeEl) composeEl.classList.remove('compose-busy');
            alert(
              'Dischat: GitHub\'s Comment button is still disabled (validation pending). Closing the overlay so you can submit manually.'
            );
            closeChat();
            ta.focus();
            ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
          }
          btn.click();
          setTimeout(function () { location.reload(); }, 1800);
        }, 400);
        return;
      }
      btn.click();
      setTimeout(function () { location.reload(); }, 1800);
    }, 80);
  }

  function closeChat() {
    const r = document.getElementById(ROOT_ID);
    if (r) r.remove();
    const s = document.getElementById(STYLE_ID);
    if (s) s.remove();
    document.documentElement.classList.remove(HTML_FLAG);
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    const root = document.getElementById(ROOT_ID);
    if (root && root.classList.contains('thread-open')) closeThread();
    else closeChat();
  }

  // ---------- go ----------
  injectStyles();
  const root = h('div', { id: ROOT_ID });
  document.body.appendChild(root);
  document.documentElement.classList.add(HTML_FLAG);
  document.addEventListener('keydown', onKey);

  if (singleMatch) renderSingle(root, singleMatch[1], singleMatch[2], singleMatch[3]);
  else renderIndex(root, indexMatch[1], indexMatch[2]);
})();
