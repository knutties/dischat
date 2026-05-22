#!/usr/bin/env node
/* claude-respond.js — invoked by .github/workflows/claude.yml.
 *
 * Reads the triggering GitHub event from $GITHUB_EVENT_PATH, fetches the
 * full discussion via GraphQL, calls the Anthropic Messages API, and posts
 * Claude's reply back as a discussion comment (threaded under the
 * triggering comment when applicable).
 *
 * Required env:
 *   ANTHROPIC_API_KEY   API key from https://console.anthropic.com/
 *   GITHUB_TOKEN        Auto-provided by the runner; needs discussions:write
 *   GITHUB_REPOSITORY   "owner/repo"  (set by runner)
 *   GITHUB_EVENT_PATH   Path to event payload JSON (set by runner)
 *   GITHUB_EVENT_NAME   "discussion" | "discussion_comment"
 *
 * Optional env:
 *   MODEL               default "claude-opus-4-7"
 *   MAX_TOKENS          default 4096
 *   TRIGGER             default "@claude"
 */
'use strict';

const fs = require('fs');

const {
  ANTHROPIC_API_KEY,
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  GITHUB_EVENT_PATH,
  GITHUB_EVENT_NAME,
  MODEL = 'claude-opus-4-7',
  MAX_TOKENS = '4096',
  TRIGGER = '@claude',
} = process.env;

function die(msg) {
  console.error(msg);
  process.exit(1);
}

if (!ANTHROPIC_API_KEY) die('ANTHROPIC_API_KEY not set');
if (!GITHUB_TOKEN) die('GITHUB_TOKEN not set');
if (!GITHUB_REPOSITORY) die('GITHUB_REPOSITORY not set');
if (!GITHUB_EVENT_PATH) die('GITHUB_EVENT_PATH not set');

const event = JSON.parse(fs.readFileSync(GITHUB_EVENT_PATH, 'utf8'));

const isComment = GITHUB_EVENT_NAME === 'discussion_comment';
const triggerObj = isComment ? event.comment : event.discussion;
const sender = event.sender;

if (sender && sender.type === 'Bot') {
  console.log('skipping: triggered by a bot');
  process.exit(0);
}
if (!triggerObj || !triggerObj.body) {
  console.log('skipping: no body on triggering object');
  process.exit(0);
}
if (!triggerObj.body.includes(TRIGGER)) {
  console.log(`skipping: trigger "${TRIGGER}" not in body`);
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
      'User-Agent': 'dischat-claude/1.0',
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${text}`);
  const json = JSON.parse(text);
  if (json.errors) throw new Error('GraphQL errors: ' + JSON.stringify(json.errors));
  return json.data;
}

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

  // 2. Figure out which comment we should thread under. Discussions only
  //    support one level of nesting: top-level comments, plus replies to a
  //    top-level. A reply to a reply just lands as another sibling reply,
  //    so resolve to the top-level parent if the trigger was a reply.
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

  // 3. Build a plain-text context blob for Claude.
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

  // 4. Ask Claude for a reply.
  const system =
    `You are Claude, summoned via "${TRIGGER}" into a GitHub Discussion in ${owner}/${repo}.\n` +
    `Reply concisely and helpfully in GitHub-flavored Markdown.\n` +
    `Do not repeat the "${TRIGGER}" trigger phrase. Do not address yourself with "@Claude".\n` +
    `If a question is unclear, ask one focused follow-up rather than guessing widely.\n` +
    `Cite repository files using \`path/to/file.ext:LINE\` references when relevant.`;

  const userMessage =
    `Here is the full discussion thread:\n\n${context}\n\n` +
    `The latest message that summoned you was posted by @${senderLogin}. ` +
    `Reply to that message in this thread.`;

  const anth = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: parseInt(MAX_TOKENS, 10) || 4096,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  const anthText = await anth.text();
  if (!anth.ok) throw new Error(`Anthropic HTTP ${anth.status}: ${anthText}`);
  const anthJson = JSON.parse(anthText);
  const reply = (anthJson.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!reply) {
    console.log('Claude returned an empty response — nothing to post');
    return;
  }

  const footer =
    '\n\n<sub><em>— Replying via Claude (`' +
    MODEL +
    '`). Triggered by `' +
    TRIGGER +
    '` in @' +
    senderLogin +
    "'s message.</em></sub>";
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
