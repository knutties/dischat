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

## Reply to discussions with an AI (`@ai`)

This repo also ships a reusable GitHub Actions workflow that lets any other repo summon an AI assistant into its Discussions just by `@`-mentioning it. The workflow lives in `.github/workflows/discuss.yml`, with the responder script at `.github/scripts/discuss-respond.js`.

The default provider is **GitHub Models** — free, uses the workflow's built-in `GITHUB_TOKEN`, no extra account needed. You can opt into **Anthropic** or **Google Gemini** by setting the `provider` input and supplying their API key as a secret.

### Use it from another repo (free / GitHub Models)

Drop this into `.github/workflows/discuss.yml` in the caller repo — no secrets required:

```yaml
name: AI in discussions
on:
  discussion:
    types: [created]
  discussion_comment:
    types: [created]

permissions:
  discussions: write
  contents: read
  models: read

jobs:
  ai:
    uses: knutties/dischat/.github/workflows/discuss.yml@main
```

Then open a Discussion (or post a comment) containing `@ai` somewhere in the body. The workflow runs, the model reads the full thread, and replies as a comment — threaded under the triggering comment when applicable.

### Inputs

| Input | Default | Notes |
|---|---|---|
| `provider` | `github` | `github` \| `anthropic` \| `gemini` |
| `model` | provider default | See per-provider defaults below |
| `max-tokens` | `4096` | |
| `trigger` | `@ai` | Any substring; e.g. switch to `/ask` if you prefer a slash command |

Per-provider defaults: `openai/gpt-4o-mini` (github), `claude-opus-4-7` (anthropic), `gemini-2.0-flash` (gemini). Pick alternatives from the [GitHub Models catalog](https://github.com/marketplace?type=models), the [Anthropic models list](https://docs.anthropic.com/en/docs/about-claude/models/overview), or the [Gemini models list](https://ai.google.dev/gemini-api/docs/models).

### Use Anthropic instead

Add an `ANTHROPIC_API_KEY` repo secret (get one at <https://console.anthropic.com/>), then:

```yaml
jobs:
  ai:
    uses: knutties/dischat/.github/workflows/discuss.yml@main
    with:
      provider: anthropic
      model: claude-opus-4-7    # optional
      trigger: '@claude'        # optional — match your trigger to the brand if you like
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Use Google Gemini instead

Add a `GEMINI_API_KEY` repo secret (get one at <https://aistudio.google.com/apikey>), then:

```yaml
jobs:
  ai:
    uses: knutties/dischat/.github/workflows/discuss.yml@main
    with:
      provider: gemini
      model: gemini-2.0-flash   # optional
    secrets:
      GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

### Notes

- Replies are posted by `github-actions[bot]`, with a small footer naming the provider, model, and trigger.
- Bot-authored events are ignored, so the AI never replies to itself.
- The workflow fetches the entire discussion via the GitHub GraphQL API for context, so the model sees the title, OP body, and every existing comment — not just the triggering message.
- For per-comment threaded replies, the script resolves the top-level parent (Discussions only support one level of nesting).
- The caller workflow must grant `discussions: write`, `contents: read`, and (for the default GitHub Models provider) `models: read`. Reusable workflows can't widen the caller's `GITHUB_TOKEN` scopes.
