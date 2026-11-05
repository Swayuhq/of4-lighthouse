// How long a new comment takes to reach each provider after the customer posts it.
// Watches the newest post on the test Facebook Page and the test Instagram account, through Zernio and through Composio,
// and prints the gap between Meta's own comment time and the moment each provider first returns it.
// Read only: it never replies. Comments already there when it starts are ignored.
// Run with scripts/arrival.sh [minutes=10] [everySeconds=5].
import { run } from '../src/composio';
import { accountId, zernio } from '../src/gateway/providers';

const [minutes = 10, every = 5] = process.argv.slice(2).map(Number);

type Seen = { provider: string; channel: string; id: string; text: string; postedAt: number; seenAt: number };
type Watch = { provider: 'zernio' | 'composio'; channel: 'facebook' | 'instagram'; read: () => Promise<{ id: string; text: string; at: string }[]> };

/** Meta writes +0000 without a colon, which Date.parse refuses. */
const parse = (at: string) => Date.parse(at.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));

// Our clock against Meta's. Every gap below is corrected by it, so a drifting laptop clock does not show up as delay.
const metaDate = (await fetch('https://graph.facebook.com/', { method: 'HEAD' })).headers.get('date');
const skewMs = metaDate ? Date.now() - Date.parse(metaDate) : 0;

// The newest post on each channel, found once through Composio, so both providers watch the same post.
const pages = (await run('FACEBOOK_LIST_MANAGED_PAGES', {})).data as { id: string; name?: string }[];
const page = pages[0];
const fbPost = ((await run('FACEBOOK_GET_PAGE_POSTS', { page_id: page.id, limit: 1, fields: 'id,permalink_url,message' })).data as { id: string; permalink_url?: string; message?: string }[])[0];
const igPost = ((await run('INSTAGRAM_GET_IG_USER_MEDIA', { ig_user_id: 'me', limit: 1, fields: 'id,permalink,caption' }, 'instagram')).data as { id: string; permalink?: string; caption?: string }[])[0];
const fbAccount = await accountId('facebook');
const igAccount = await accountId('instagram');

type ZComment = { id: string; message?: string; createdTime?: string };
const zernioRead = (postId: string, account: string) => async () =>
  ((await zernio<{ comments: ZComment[] }>(`/inbox/comments/${encodeURIComponent(postId)}?accountId=${account}`)).comments ?? [])
    .map(c => ({ id: c.id, text: c.message ?? '', at: c.createdTime ?? '' }));

const WATCHES: Watch[] = [
  { provider: 'zernio', channel: 'facebook', read: zernioRead(fbPost.id, fbAccount) },
  { provider: 'zernio', channel: 'instagram', read: zernioRead(igPost.id, igAccount) },
  { provider: 'composio', channel: 'facebook', read: async () =>
    ((await run('FACEBOOK_GET_COMMENTS', { object_id: fbPost.id, limit: 100, fields: 'id,message,created_time' })).data as { id: string; message?: string; created_time?: string }[] ?? [])
      .map(c => ({ id: c.id, text: c.message ?? '', at: c.created_time ?? '' })) },
  { provider: 'composio', channel: 'instagram', read: async () =>
    ((await run('INSTAGRAM_GET_IG_MEDIA_COMMENTS', { ig_media_id: igPost.id, limit: 100, fields: 'id,text,timestamp' }, 'instagram')).data as { id: string; text?: string; timestamp?: string }[] ?? [])
      .map(c => ({ id: c.id, text: c.text ?? '', at: c.timestamp ?? '' })) },
];

console.log(`Clock skew against Meta: ${Math.round(skewMs / 1000)} s (corrected below)`);
console.log(`Facebook post to comment on: ${fbPost.permalink_url ?? fbPost.id}  "${(fbPost.message ?? '').slice(0, 40)}"`);
console.log(`Instagram post to comment on: ${igPost.permalink ?? igPost.id}  "${(igPost.caption ?? '').slice(0, 40)}"`);

// What each watch holds at the start. Only ids that appear after this count.
const known = new Map<Watch, Set<string>>();
const errors: Record<string, number> = {};
for (const w of WATCHES) {
  try { known.set(w, new Set((await w.read()).map(c => c.id))); }
  catch (e) { known.set(w, new Set()); console.log(`${w.provider} ${w.channel} could not be read at start: ${(e as Error).message.slice(0, 120)}`); }
}
console.log(`Watching every ${every} s for ${minutes} min. Post your comments now.\n`);

const arrivals: Seen[] = [];
const end = Date.now() + minutes * 60_000;
while (Date.now() < end) {
  const tick = Date.now();
  await Promise.all(WATCHES.map(async w => {
    try {
      for (const c of await w.read()) {
        const ids = known.get(w)!;
        if (ids.has(c.id)) continue;
        ids.add(c.id);
        const seenAt = Date.now() - skewMs;
        const postedAt = parse(c.at);
        arrivals.push({ provider: w.provider, channel: w.channel, id: c.id, text: c.text.slice(0, 30), postedAt, seenAt });
        console.log(`${new Date(seenAt).toISOString().slice(11, 19)}  ${w.provider.padEnd(8)} ${w.channel.padEnd(9)} after ${Number.isFinite(postedAt) ? Math.round((seenAt - postedAt) / 1000) + ' s' : 'unknown (no time given)'}  "${c.text.slice(0, 30)}"`);
      }
    } catch (e) {
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      const key = `${w.provider} ${w.channel}: ${(e as Error).message.slice(0, 90)}${cause ? ` (${cause.code ?? cause.message})` : ''}`;
      if (!errors[key]) console.log(`${new Date().toISOString().slice(11, 19)}  failed: ${key}`);
      errors[key] = (errors[key] ?? 0) + 1;
    }
  }));
  await new Promise(r => setTimeout(r, Math.max(0, every * 1000 - (Date.now() - tick))));
}

// One row per comment: when each provider first returned it. A dash means that provider never returned it in the window.
const byComment = new Map<string, Record<string, number | string>>();
for (const a of arrivals) {
  const row = byComment.get(a.id) ?? { channel: a.channel, text: a.text };
  row[a.provider] = Number.isFinite(a.postedAt) ? Math.round((a.seenAt - a.postedAt) / 1000) : 'no time';
  byComment.set(a.id, row);
}
console.log('\nSeconds from the customer posting to each provider returning it (resolution about ' + every + ' s):');
console.table([...byComment.values()].map(r => ({ channel: r.channel, text: r.text, zernio: r.zernio ?? '-', composio: r.composio ?? '-' })));
if (Object.keys(errors).length) console.log('Failed reads:', errors);
console.log(JSON.stringify({ at: new Date().toISOString(), minutes, every, skewMs, arrivals, errors }));
