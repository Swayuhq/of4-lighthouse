// Facebook and Instagram through Composio: Composio holds the owner's logins and its own Meta app, which Meta has already reviewed.
// Chosen for the prototype on 30 Oct 2026 (docs/artifacts/connectors-build-vs-buy.html). Our own Meta connector replaces this file later.
// The key is read from the environment on each call and never logged.
import { LIMITS, RateLimited, retryAfter } from './gateway/limiter';

const ENDPOINT = 'https://connect.composio.dev/mcp';
/** The logins connected in Composio for the test business. One set per owner once Lighthouse has more than one business. */
const ACCOUNTS = { facebook: 'facebook_hellen-peril', instagram: 'instagram_stunt-iritic' } as const;
type Toolkit = keyof typeof ACCOUNTS;
const POSTS = 25;
const TIMEOUT_MS = 20_000;

type Answer = { data?: unknown[]; id?: string };

/** Runs one Composio action and returns what Meta answered. Any refusal throws with Composio's own reason. */
export async function run(slug: string, args: Record<string, unknown>, toolkit: Toolkit = 'facebook', again = false): Promise<Answer> {
  const key = process.env.SWAYU_COMPOSIO_API_KEY;
  if (!key) throw new Error('SWAYU_COMPOSIO_API_KEY is not set. Start Lighthouse with pnpm start:op.');
  await LIMITS.composio.take();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-consumer-api-key': key, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'COMPOSIO_MULTI_EXECUTE_TOOL', arguments: { tools: [{ tool_slug: slug, arguments: args, account: ACCOUNTS[toolkit] }] } } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  LIMITS.composio.learn(res.headers.get('x-ratelimit'));
  if (res.status === 429) {
    // Composio refused before running the action, so sending it once more cannot post twice.
    const seconds = retryAfter(res.headers.get('retry-after'));
    LIMITS.composio.pause(seconds);
    if (!again) return run(slug, args, toolkit, true);
    throw new RateLimited('Composio', seconds);
  }
  const line = (await res.text()).split('\n').find(l => l.startsWith('data: '));
  if (!line) throw new Error(`Composio answered HTTP ${res.status} with nothing to read`);
  const out = JSON.parse(JSON.parse(line.slice(6)).result?.content?.[0]?.text ?? '{}');
  const first = out.data?.results?.[0];
  if (!out.successful || first?.error || !first?.response?.successful) throw new Error(`Composio: ${first?.error ?? out.error ?? 'the action failed'}`);
  return first.response.data ?? {};
}

/** Every top level customer comment on the newest posts of the first Page the login manages, as Meta writes them. */
export async function facebookComments(): Promise<unknown[]> {
  const pages = (await run('FACEBOOK_LIST_MANAGED_PAGES', {})).data as { id: string }[] | undefined;
  const page = pages?.[0];
  if (!page) throw new Error('No Facebook Page is managed by this login. Connect a Page you run.');
  const posts = ((await run('FACEBOOK_GET_PAGE_POSTS', { page_id: page.id, limit: POSTS, fields: 'id' })).data ?? []) as { id: string }[];
  const lists = await Promise.all(posts.map(p => run('FACEBOOK_GET_COMMENTS', { object_id: p.id, limit: 100, fields: 'id,message,from,created_time' })));
  // The Page's own comments are not customer comments. Zernio flags them as the owner's; Meta through Composio only names the Page as author.
  return lists.flatMap(l => (l.data ?? []) as { from?: { id?: string } }[]).filter(c => c.from?.id !== page.id);
}

type IgMedia = { id: string; username?: string; comments_count?: number };
type IgComment = { id: string; text?: string; username?: string; timestamp?: string; from?: { id?: string; username?: string } };

/** Every top level customer comment on the newest posts of the connected Instagram professional account. */
export async function instagramComments(): Promise<IgComment[]> {
  const media = ((await run('INSTAGRAM_GET_IG_USER_MEDIA', { ig_user_id: 'me', limit: POSTS, fields: 'id,username,comments_count' }, 'instagram')).data ?? []) as IgMedia[];
  const withComments = media.filter(m => (m.comments_count ?? 0) > 0);
  const lists = await Promise.all(withComments.map(async m => {
    const { data } = await run('INSTAGRAM_GET_IG_MEDIA_COMMENTS', { ig_media_id: m.id, limit: 100, fields: 'id,text,username,timestamp,from' }, 'instagram');
    // The account's own comments are not customer comments, the same rule as the Facebook read.
    return ((data ?? []) as IgComment[]).filter(c => (c.username ?? c.from?.username) !== m.username);
  }));
  return lists.flat();
}

/** Posts a reply under one comment and returns the reply's id. Throws unless Facebook confirms it. */
export async function facebookReply(commentId: string, message: string): Promise<string> {
  // Meta names a comment postNumber_commentNumber; Composio reads the part before the underscore as a Page, so send the comment number alone.
  const { id } = await run('FACEBOOK_CREATE_COMMENT', { object_id: commentId.split('_').at(-1), message });
  if (!id) throw new Error('Facebook did not confirm the reply');
  return id;
}
