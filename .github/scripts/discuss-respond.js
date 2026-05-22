#!/usr/bin/env node
/* discuss-respond.js — invoked by .github/workflows/discuss.yml.
 *
 * Reads the triggering GitHub event from $GITHUB_EVENT_PATH, fetches the
 * full discussion via GraphQL, calls the configured AI provider, and
 * posts the reply back via `addDiscussionComment` (threaded under the
 * triggering comment when applicable).
 *
 * Required env:
 *   PROVIDER            github | anthropic | gemini  (default: github)
 *   GITHUB_TOKEN        Auto-provided; needs discussions:write + models:read
 *   GITHUB_REPOSITORY   "owner/repo"          (set by runner)
 *   GITHUB_EVENT_PATH   Path to event JSON    (set by runner)
 *   GITHUB_EVENT_NAME   "discussion" | "discussion_comment"
 *
 * Conditional env:
 *   ANTHROPIC_API_KEY   Required when PROVIDER=anthropic
 *   GEMINI_API_KEY      Required when PROVIDER=gemini
 *
 * Optional env:
 *   MODEL               provider-specific; blank => provider default
 *   MAX_TOKENS          default 4096
 *   TRIGGER             default "@dischat-bot"
 */
'use strict';

const fs = require('fs');

const {
  PROVIDER = 'github',
  MODEL = '',
  MAX_TOKENS = '4096',
  TRIGGER = '@dischat-bot',
  GITHUB_TOKEN,
  ANTHROPIC_API_KEY,
  GEMINI_API_KEY,
  GITHUB_REPOSITORY,
  GITHUB_EVENT_PATH,
  GITHUB_EVENT_NAME,
} = process.env;

const DEFAULT_MODELS = {
  github: 'openai/gpt-4o-mini',
  anthropic: 'claude-opus-4-7',
  gemini: 'gemini-2.0-flash',
};

const PROVIDER_LABELS = {
  github: 'GitHub Models',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
};

function die(msg) {
  console.error(msg);
  process.exit(1);
}

if (!GITHUB_TOKEN) die('GITHUB_TOKEN not set');
if (!GITHUB_REPOSITORY) die('GITHUB_REPOSITORY not set');
if (!GITHUB_EVENT_PATH) die('GITHUB_EVENT_PATH not set');
if (!DEFAULT_MODELS[PROVIDER]) die(`unknown provider: "${PROVIDER}" (expected github | anthropic | gemini)`);
if (PROVIDER === 'anthropic' && !ANTHROPIC_API_KEY) die('ANTHROPIC_API_KEY is required when provider=anthropic');
if (PROVIDER === 'gemini' && !GEMINI_API_KEY) die('GEMINI_API_KEY is required when provider=gemini');

const model = MODEL || DEFAULT_MODELS[PROVIDER];
const maxTokens = parseInt(MAX_TOKENS, 10) || 4096;

const event = JSON.parse(fs.readFileSync(GITHUB_EVENT_PATH, 'utf8'));
const isComment = GITHUB_EVENT_NAME === 'discussion_comment';
const triggerObj = isComment ? event.comment : event.discussion;
const sender = event.sender;

if (sender && sender.type === 'Bot') {
  console.log('skip: triggered by a bot');
  process.exit(0);
}
if (!triggerObj || !triggerObj.body) {
  console.log('skip: no body on triggering object');
  process.exit(0);
}
if (!triggerObj.body.includes(TRIGGER)) {
  console.log(`skip: trigger "${TRIGGER}" not in body`);
  process.exit(0);
}

const [owner, repo] = GITHUB_REPOSITORY.split('/');
const discussionNumber = event.discussion.number;
const triggerNodeId = isComment ? event.comment.node_id : null;
const senderLogin = sender && sender.login;

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dischat-discuss/1.0',
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${text}`);
  const json = JSON.parse(text);
  if (json.errors) throw new Error('GraphQL errors: ' + JSON.stringify(json.errors));
  return json.data;
}

async function callGithubModels(system, user) {
  const res = await fetch('https://models.github.ai/inference/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub Models HTTP ${res.status}: ${text}`);
  const json = JSON.parse(text);
  return ((json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '').trim();
}

async function callAnthropic(system, user) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${text}`);
  const json = JSON.parse(text);
  return (json.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

async function callGemini(system, user) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=` +
    encodeURIComponent(GEMINI_API_KEY);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${text}`);
  const json = JSON.parse(text);
  const parts = (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
  return parts.map((p) => p.text || '').join('').trim();
}

const PROVIDERS = {
  github: callGithubModels,
  anthropic: callAnthropic,
  gemini: callGemini,
};

async function main() {
  // 1. Fetch the full discussion thread for context.
  const data = await gql(
    `query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        discussion(number: $number) {
          id
          title
          body
          url
          author { login }
          comments(first: 100) {
            nodes {
              id
              body
              author { login }
              replies(first: 50) {
                nodes {
                  id
                  body
                  author { login }
                }
              }
            }
          }
        }
      }
    }`,
    { owner, repo, number: discussionNumber }
  );

  const d = data.repository && data.repository.discussion;
  if (!d) die('discussion not found via GraphQL');

  // 2. Resolve the top-level parent for threading. Discussions only allow
  //    one nesting level, so a reply triggering this should still land
  //    under the original top-level comment.
  let replyToId = null;
  if (triggerNodeId) {
    for (const c of d.comments.nodes) {
      if (c.id === triggerNodeId) {
        replyToId = c.id;
        break;
      }
      if (c.replies.nodes.some((r) => r.id === triggerNodeId)) {
        replyToId = c.id;
        break;
      }
    }
  }

  // 3. Build a plain-text context blob.
  const lines = [];
  lines.push(`Repository: ${owner}/${repo}`);
  lines.push(`Discussion #${discussionNumber}: ${d.title}`);
  lines.push(`URL: ${d.url}`);
  lines.push(`Original post by @${d.author && d.author.login}:`);
  lines.push(quote(d.body));
  for (const c of d.comments.nodes) {
    lines.push('');
    lines.push(`Comment by @${c.author && c.author.login}:`);
    lines.push(quote(c.body));
    for (const r of c.replies.nodes) {
      lines.push(`  Reply by @${r.author && r.author.login}:`);
      lines.push(quote(r.body, '  > '));
    }
  }
  const context = lines.join('\n');

  // 4. Ask the configured provider for a reply.
  const system =
    `You are an AI assistant summoned via "${TRIGGER}" into a GitHub Discussion in ${owner}/${repo}.\n` +
    `Reply concisely and helpfully in GitHub-flavored Markdown.\n` +
    `Do not repeat the "${TRIGGER}" trigger phrase. Do not address yourself with it.\n` +
    `If a question is unclear, ask one focused follow-up rather than guessing widely.\n` +
    `Cite repository files using \`path/to/file.ext:LINE\` references when relevant.`;

  const userMessage =
    `Here is the full discussion thread:\n\n${context}\n\n` +
    `The latest message that summoned you was posted by @${senderLogin}. ` +
    `Reply to that message in this thread.`;

  const call = PROVIDERS[PROVIDER];
  const reply = await call(system, userMessage);
  if (!reply) {
    console.log('provider returned an empty response — nothing to post');
    return;
  }

  // Wrap @senderLogin in backticks so GitHub doesn't auto-link it (which
  // would both ping the user every time and confuse downstream scrapers
  // that pick the first `a[data-hovercard-type="user"]` they see).
  const footer =
    '\n\n<sub><em>— Replying via ' +
    PROVIDER_LABELS[PROVIDER] +
    ' (`' +
    model +
    '`). Triggered by `' +
    TRIGGER +
    '` in `@' +
    senderLogin +
    "`'s message.</em></sub>";
  const body = reply + footer;

  // 5. Post.
  const mutation = replyToId
    ? `mutation($discussionId: ID!, $body: String!, $replyToId: ID!) {
        addDiscussionComment(input: {discussionId: $discussionId, body: $body, replyToId: $replyToId}) {
          comment { id url }
        }
      }`
    : `mutation($discussionId: ID!, $body: String!) {
        addDiscussionComment(input: {discussionId: $discussionId, body: $body}) {
          comment { id url }
        }
      }`;

  const vars = replyToId
    ? { discussionId: d.id, body, replyToId }
    : { discussionId: d.id, body };

  const posted = await gql(mutation, vars);
  console.log('posted:', posted.addDiscussionComment.comment.url);
}

function quote(s, prefix) {
  prefix = prefix || '> ';
  return (s || '').split('\n').map((l) => prefix + l).join('\n');
}

main().catch((err) => {
  console.error(err && (err.stack || err.message || String(err)));
  process.exit(1);
});
