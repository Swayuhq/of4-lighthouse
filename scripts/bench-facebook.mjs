// Build vs buy: the same Facebook Page read and reply, once straight through Meta and once through Composio.
// Keys come from 1Password at run time and are never printed. Run: node scripts/bench-facebook.mjs [--write]
// Without --write it only reads. With --write each path posts one reply on the test Page and reads it back.
import { execFileSync } from 'node:child_process';

const PAGE = 'Sujit Test Cafe';
const COMPOSIO_ACCOUNT = 'facebook_hellen-peril';
const GRAPH = 'https://graph.facebook.com/v26.0';
const ROUNDS = 5;
const POSTS = 5;

const secret = name => execFileSync('op', ['read', `op://Engineering/${name}/credential`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function graph(path, token, init) {
  const res = await fetch(`${GRAPH}/${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...init?.headers } });
  const body = await res.json();
  if (body.error) throw new Error(`Meta: ${body.error.message}`);
  return body;
}

async function composio(key, slug, args) {
  const res = await fetch('https://connect.composio.dev/mcp', {
    method: 'POST',
    headers: { 'x-consumer-api-key': key, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'COMPOSIO_MULTI_EXECUTE_TOOL', arguments: { tools: [{ tool_slug: slug, arguments: args, account: COMPOSIO_ACCOUNT }] } } }),
  });
  const line = (await res.text()).split('\n').find(l => l.startsWith('data: '));
  if (!line) throw new Error(`Composio: HTTP ${res.status} with no answer`);
  const text = JSON.parse(line.slice(6)).result?.content?.[0]?.text;
  const out = JSON.parse(text);
  const first = out.data?.results?.[0];
  if (!out.successful || first?.error) throw new Error(`Composio: ${first?.error ?? out.error}`);
  return first.response?.data ?? first.response ?? first;
}

/** Every comment on the Page's newest posts, as id, author and text. */
const paths = {
  direct: {
    async setup() {
      const user = secret('SWAYU_META_PAGE_TOKEN');
      const pages = await graph('me/accounts?fields=id,name,access_token', user);
      const page = pages.data.find(p => p.name === PAGE);
      if (!page) throw new Error(`Meta: the token cannot see ${PAGE}`);
      return { pageId: page.id, token: page.access_token };
    },
    async read({ pageId, token }) {
      const feed = await graph(`${pageId}/feed?fields=id,comments.limit(100){id,message,from,created_time}&limit=${POSTS}`, token);
      return feed.data.flatMap(p => (p.comments?.data ?? []).map(c => ({ id: c.id, author: c.from?.name, text: c.message })));
    },
    async reply({ token }, commentId, message) {
      return (await graph(`${commentId}/comments`, token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }) })).id;
    },
  },
  composio: {
    async setup() {
      const key = secret('SWAYU_COMPOSIO_API_KEY');
      const pages = await composio(key, 'FACEBOOK_LIST_MANAGED_PAGES', {});
      const page = JSON.stringify(pages).includes(PAGE) && [pages].flat(3).flatMap(x => x?.data ?? x).find(p => p?.name === PAGE);
      if (!page) throw new Error(`Composio: the connection cannot see ${PAGE}`);
      return { pageId: page.id, key };
    },
    async read({ pageId, key }) {
      const posts = await composio(key, 'FACEBOOK_GET_PAGE_POSTS', { page_id: pageId, limit: POSTS, fields: 'id' });
      const ids = (posts.data ?? posts).map(p => p.id);
      const lists = await Promise.all(ids.map(id => composio(key, 'FACEBOOK_GET_COMMENTS', { object_id: id, limit: 100, fields: 'id,message,from,created_time' })));
      return lists.flatMap(l => (l.data ?? l).map(c => ({ id: c.id, author: c.from?.name, text: c.message })));
    },
    async reply({ key }, commentId, message) {
      // Composio reads the part before the underscore as a Page id, so it takes the comment's own number alone.
      const out = await composio(key, 'FACEBOOK_CREATE_COMMENT', { object_id: commentId.split('_').at(-1), message });
      return out.id ?? out.data?.id;
    },
  },
};

async function timed(fn) {
  const t = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t) };
}

const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const write = process.argv.includes('--write');
const report = {};

const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);

for (const [name, path] of Object.entries(paths).filter(([n]) => !only || n === only)) {
  const r = (report[name] = { errors: [] });
  try {
    const setup = await timed(() => path.setup());
    r.setupMs = setup.ms;
    const reads = [];
    for (let i = 0; i < ROUNDS; i++) {
      try {
        reads.push(await timed(() => path.read(setup.value)));
      } catch (e) {
        r.errors.push(`read ${i + 1}: ${e.message}`);
      }
    }
    r.readsOk = `${reads.length}/${ROUNDS}`;
    r.readMedianMs = reads.length ? median(reads.map(x => x.ms)) : null;
    r.readMaxMs = reads.length ? Math.max(...reads.map(x => x.ms)) : null;
    const comments = reads.at(-1)?.value ?? [];
    r.comments = comments.length;
    if (write) {
      const target = comments.find(c => c.text && !/^Thank you/.test(c.text));
      if (!target) throw new Error('no comment to reply to');
      const sent = await timed(() => path.reply(setup.value, target.id, `Thank you, glad you liked it! (${name} test)`));
      r.replyMs = sent.ms;
      r.replyId = sent.value;
      // The reply counts only once a fresh read through Meta shows it on the Page.
      const check = await paths.direct.setup();
      const seen = await graph(`${target.id}/comments?fields=id,message`, check.token);
      // Composio returns the reply id under the comment's number, Meta lists it under the post's, so match the reply's own number.
      const own = id => String(id).split('_').at(-1);
      r.replySeenOnPage = seen.data.some(c => own(c.id) === own(sent.value));
    }
  } catch (e) {
    r.errors.push(e.message);
  }
}

console.log(JSON.stringify({ at: new Date().toISOString(), page: PAGE, rounds: ROUNDS, write, report }, null, 2));
