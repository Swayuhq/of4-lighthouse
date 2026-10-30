// Facebook through Composio: Composio holds the owner's Facebook login and its own Meta app, which Meta has already reviewed.
// Chosen for the prototype on 30 Oct 2026 (docs/artifacts/connectors-build-vs-buy.html). Our own Meta connector replaces this file later.
// The key is read from the environment on each call and never logged.

const ENDPOINT = 'https://connect.composio.dev/mcp';
/** The Facebook login connected in Composio for the test Page. One per owner once Lighthouse has more than one business. */
const ACCOUNT = 'facebook_hellen-peril';
const POSTS = 25;
const TIMEOUT_MS = 20_000;

type Answer = { data?: unknown[]; id?: string };

/** Runs one Composio action and returns what Facebook answered. Any refusal throws with Composio's own reason. */
async function run(slug: string, args: Record<string, unknown>): Promise<Answer> {
  const key = process.env.SWAYU_COMPOSIO_API_KEY;
  if (!key) throw new Error('SWAYU_COMPOSIO_API_KEY is not set. Start Lighthouse with pnpm start:op.');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-consumer-api-key': key, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'COMPOSIO_MULTI_EXECUTE_TOOL', arguments: { tools: [{ tool_slug: slug, arguments: args, account: ACCOUNT }] } } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const line = (await res.text()).split('\n').find(l => l.startsWith('data: '));
  if (!line) throw new Error(`Composio answered HTTP ${res.status} with nothing to read`);
  const out = JSON.parse(JSON.parse(line.slice(6)).result?.content?.[0]?.text ?? '{}');
  const first = out.data?.results?.[0];
  if (!out.successful || first?.error || !first?.response?.successful) throw new Error(`Composio: ${first?.error ?? out.error ?? 'the action failed'}`);
  return first.response.data ?? {};
}

/** Every top level comment on the newest posts of the first Page the login manages, exactly as Meta writes them. */
export async function facebookComments(): Promise<unknown[]> {
  const pages = (await run('FACEBOOK_LIST_MANAGED_PAGES', {})).data as { id: string }[] | undefined;
  const page = pages?.[0];
  if (!page) throw new Error('No Facebook Page is managed by this login. Connect a Page you run.');
  const posts = ((await run('FACEBOOK_GET_PAGE_POSTS', { page_id: page.id, limit: POSTS, fields: 'id' })).data ?? []) as { id: string }[];
  const lists = await Promise.all(posts.map(p => run('FACEBOOK_GET_COMMENTS', { object_id: p.id, limit: 100, fields: 'id,message,from,created_time' })));
  return lists.flatMap(l => l.data ?? []);
}

/** Posts a reply under one comment and returns the reply's id. Throws unless Facebook confirms it. */
export async function facebookReply(commentId: string, message: string): Promise<string> {
  // Meta names a comment postNumber_commentNumber; Composio reads the part before the underscore as a Page, so send the comment number alone.
  const { id } = await run('FACEBOOK_CREATE_COMMENT', { object_id: commentId.split('_').at(-1), message });
  if (!id) throw new Error('Facebook did not confirm the reply');
  return id;
}
