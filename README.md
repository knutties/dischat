# dischat

A `javascript:` bookmarklet that turns any GitHub Discussions page into a Slack-style group chat — channels in the sidebar, messages in the middle, threaded replies in a side panel.

The whole script is inlined into the bookmarklet URL (GitHub's Content Security Policy blocks external `<script src>` loads), so installation is a single drag-and-drop and there's no network round-trip when you click it.

## Install

1. Open [`index.html`](./index.html) in a browser. (Easiest path: enable GitHub Pages from the repo settings — *Settings → Pages → Source: Deploy from a branch → `main` / root* — then visit `https://<owner>.github.io/dischat/`.)
2. Drag the **▸ dischat** button onto your bookmarks bar.

If dragging doesn't work, copy the contents of [`bookmarklet.txt`](./bookmarklet.txt) into a new bookmark's URL field manually.

## Use

1. Navigate to any GitHub Discussions page:
   - A single discussion: `github.com/OWNER/REPO/discussions/N`
   - The discussions index: `github.com/OWNER/REPO/discussions`
2. Click the **dischat** bookmark.
3. Press <kbd>Esc</kbd> — or click the bookmark again — to dismiss.

You need to be signed in to GitHub to post.

## What you get

**Single-discussion view**
- The original post becomes the first message in the channel (with an `OP` badge).
- Top-level comments are listed below as messages in the channel.
- Hovering a message reveals a **Reply** action at the top right — clicking opens a Slack-style thread panel where nested replies live.
- Comments already marked as the accepted answer get an `Answer` badge.
- Day separators, grouped consecutive messages from the same author, accurate timestamps.

**Discussions index view**
- Each discussion shows up as a channel in the sidebar and as a preview row in the main pane.

**Real compose**
- The compose box is a real `<textarea>` — <kbd>Enter</kbd> sends, <kbd>Shift</kbd>+<kbd>Enter</kbd> inserts a newline.
- Your message is forwarded to GitHub's own comment form on the page (the bookmarklet runs in the page context, so it can drive the React textarea via the native value setter and click GitHub's Submit button).
- On submit, the overlay polls for the new comment to appear in the DOM and re-renders in place — no page reload.

**Threaded replies**
- The thread panel has its own compose. When you reply, the bookmarklet locates (and if necessary expands) GitHub's per-comment reply form, drives it, and refreshes the thread panel when the new reply lands.

## How it works

1. The bookmarklet runs `dischat.js` (inlined into the `javascript:` URL).
2. The script scrapes the rendered DOM — discussion title, author / avatar / timestamp / body for the OP, each top-level comment, and nested replies inside each `.js-timeline-item` container.
3. It mounts a fixed-position overlay (`#dischat-root` with scoped CSS) on top of the existing page. The underlying GitHub markup is left untouched.
4. Compose actions reach into GitHub's own form on the page and submit through it, then re-scrape and re-render the overlay.

The script is idempotent — re-running the bookmarklet detects an existing mount and removes it.

## Repo layout

```
dischat.js        the overlay (source)
build.js          minifies dischat.js, URL-encodes it, splices into index.html
bookmarklet.txt   the generated `javascript:` URL (output of build.js)
index.html        drag-to-install landing page
```

## Develop

```sh
# Edit dischat.js, then regenerate the bookmarklet URL + install page:
node build.js
```

The build pipeline is a single Node script that shells out to terser (`npx --yes terser`). No package manifest, no install step.

## Caveats

- **Auth required for posting.** GitHub only renders the reply form for signed-in users.
- **GitHub DOM changes.** Selectors are best-effort with fallbacks. If a layout change breaks parsing, the overlay shows an explicit empty state — selectors live in `findCommentElements` / `scrapeOP` / `scrapeSingle` in `dischat.js`.
- **Comment HTML is reused as-is** from GitHub's already-rendered markdown output. It inherits GitHub's server-side sanitization.
- **CSP.** A loader-style bookmarklet that pulls the script from a CDN won't work on `github.com` — the site's `script-src` header blocks external sources. That's why the script is inlined.
