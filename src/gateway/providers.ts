// The two outside providers behind the gateway, each returning the same shapes so they can be compared on real accounts.
// Zernio endpoints read from docs.zernio.com on 4 Nov 2026: base https://zernio.com/api/v1, Bearer key,
// GET /accounts, GET /inbox/comments, GET /inbox/comments/{postId}, POST /inbox/comments/{postId},
// GET /inbox/reviews, POST /inbox/reviews/{reviewId}/reply. Keys are read on each call and never logged.
import { randomUUID } from 'node:crypto';
import { facebookComments, facebookReply, instagramComments } from '../composio';
import { whatsappReply } from '../whatsapp';
import type { Provider } from './gateway';
import { LIMITS, RateLimited, retryAfter } from './limiter';
import { placesStub } from './places';

/**
 * One comment or review, whichever provider read it. `id` is the platform's own id, the same through every provider,
 * so moving a channel to another provider never counts a message twice. `ref` is what the reading provider needs to reply.
 */
export type Item = { id: string; ref: string; author: string; text: string; at: string; stars?: number; link?: string; answered?: boolean };
export type Sent = { id: string };

const ZERNIO = 'https://zernio.com/api/v1';
const TIMEOUT_MS = 20_000;
const POSTS = 10;

export class NotOffered extends Error {}

// ---------- Composio ----------

type FacebookComment = { id: string; message?: string; created_time?: string; from?: { name?: string } };

export const composio: Provider = async (channel, action, args) => {
  if (channel === 'facebook' && action === 'read') {
    const raw = (await facebookComments()) as FacebookComment[];
    return raw.map(c => ({ id: c.id, ref: c.id, author: c.from?.name ?? 'Someone', text: c.message ?? '', at: c.created_time ?? '' })) satisfies Item[];
  }
  if (channel === 'instagram' && action === 'read') {
    return (await instagramComments()).map(c => ({ id: c.id, ref: c.id, author: c.username ?? c.from?.username ?? 'Someone', text: c.text ?? '', at: c.timestamp ?? '' })) satisfies Item[];
  }
  if (channel === 'facebook' && action === 'reply') {
    // facebookReply keeps only the comment number, so a ref Zernio wrote works here too.
    return { id: await facebookReply(String(args.ref), String(args.text)) } satisfies Sent;
  }
  throw new NotOffered(`not wired for ${channel} ${action} in Lighthouse yet`);
};

// ---------- Zernio ----------

/** One request to Zernio inside its budget. A 429 pauses every Zernio call; the request is sent once more only if the wait is short. */
export async function zernio<T>(path: string, init: RequestInit = {}, again = false): Promise<T> {
  const key = process.env.SWAYU_ZERNIO_API_KEY;
  if (!key) throw new Error('SWAYU_ZERNIO_API_KEY is not set. Start Lighthouse with pnpm start:op.');
  await LIMITS.zernio.take();
  const res = await fetch(`${ZERNIO}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  LIMITS.zernio.learn(res.headers.get('x-ratelimit-limit'));
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string; details?: { retryAfterSeconds?: number } };
  if (res.status === 429) {
    const seconds = retryAfter(res.headers.get('retry-after'), body);
    LIMITS.zernio.pause(seconds);
    // The same init goes again, so a reply keeps its Idempotency-Key and cannot post twice.
    if (!again) return zernio(path, init, true);
    throw new RateLimited('Zernio', seconds);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${body.error ?? body.message ?? ''}`.trim());
  return body;
}

type Account = { _id?: string; id?: string; platform: string };

/** The first connected account on that platform. Lighthouse has one test business. */
const ACCOUNT_LABEL: Record<string, string> = { facebook: 'Facebook Page', instagram: 'Instagram account', googlebusiness: 'Google Business Profile' };

export async function accountId(platform: string): Promise<string> {
  const { accounts } = await zernio<{ accounts: Account[] }>(`/accounts?platform=${encodeURIComponent(platform)}`);
  const found = accounts.find(a => a.platform === platform);
  const id = found?._id ?? found?.id;
  if (!id) throw new Error(`no ${ACCOUNT_LABEL[platform] ?? platform} is connected in Zernio`);
  return id;
}

type Post = { id: string; platform: string; isAd?: boolean; commentCount?: number; permalink?: string };

const HOME: Record<string, string> = { instagram: 'https://www.instagram.com/', facebook: 'https://www.facebook.com/' };

/** The comment's own page on the platform, or undefined. Only that platform's own https address is ever linked. */
export function commentLink(platform: string, permalink: string | undefined, commentId: string): string | undefined {
  const home = HOME[platform];
  if (!home || !permalink?.startsWith(home)) return undefined;
  if (platform === 'instagram') return `${permalink.endsWith('/') ? permalink : permalink + '/'}c/${commentId}/`;
  return `${permalink}${permalink.includes('?') ? '&' : '?'}comment_id=${commentId.split('_').at(-1)}`;
}
type ZComment = { id: string; message?: string; createdTime?: string; from?: { name?: string; username?: string; isOwner?: boolean }; replies?: { from?: { isOwner?: boolean } }[] };
type GbpReview = { id: string; reviewer?: { displayName?: string; isAnonymous?: boolean }; rating?: number; comment?: string; createTime?: string; reviewReply?: unknown };

/** Every one of the owner's reviews, with what Google says the totals are. `complete` is false when the read stopped early. */
export type ReviewSet = { total?: number; average?: number; complete: boolean; reviews: Item[] };

/** 50 reviews a page, Zernio's most, so 40 pages is 2,000 reviews. A bound, so a broken page token cannot read forever. */
export const MAX_REVIEW_PAGES = 40;

async function allOwnerReviews(): Promise<ReviewSet> {
  // With no Google profile connected this throws, so no reviews never reads as zero reviews.
  const account = await accountId('googlebusiness');
  const seen = new Map<string, Item>();
  const tokens = new Set<string>();
  let token: string | null = '';
  let total: number | undefined;
  let average: number | undefined;
  for (let page = 0; page < MAX_REVIEW_PAGES && token !== null; page++) {
    const query = `pageSize=50${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
    const body: { reviews?: GbpReview[]; totalReviewCount?: number; averageRating?: number; nextPageToken?: string | null } =
      await zernio(`/accounts/${encodeURIComponent(account)}/gmb-reviews?${query}`);
    total = body.totalReviewCount ?? total;
    average = body.averageRating ?? average;
    for (const r of body.reviews ?? []) {
      if (seen.has(r.id)) continue;
      seen.set(r.id, {
        id: r.id, ref: `${account}|${r.id}`,
        author: r.reviewer?.isAnonymous || !r.reviewer?.displayName ? 'A Google user' : r.reviewer.displayName,
        // Zernio sends 0 when Google gave no rating; 0 is not a star count.
        text: r.comment ?? '', at: r.createTime ?? '', stars: r.rating ? r.rating : undefined,
        ...(r.reviewReply ? { answered: true } : {}),
      });
    }
    // No token, or an empty one, means this was the last page.
    const next = body.nextPageToken || null;
    // A token we already followed would loop, so stop and say the set is not whole.
    if (next !== null && tokens.has(next)) break;
    if (next !== null) tokens.add(next);
    token = next;
  }
  return { total, average, complete: token === null, reviews: [...seen.values()] };
}

type ZReview = { id: string; platform: string; accountId: string; reviewer?: { name?: string }; rating?: number; text?: string; created?: string; hasReply?: boolean };

const ZERNIO_PLATFORM: Record<string, string> = { facebook: 'facebook', instagram: 'instagram' };

async function zernioComments(platform: string): Promise<Item[]> {
  const account = await accountId(platform);
  const { data: posts } = await zernio<{ data: Post[] }>(`/inbox/comments?platform=${platform}&accountId=${account}`);
  const withComments = posts.filter(p => !p.isAd && (p.commentCount ?? 0) > 0).slice(0, POSTS);
  const lists = await Promise.all(withComments.map(async p => {
    const { comments } = await zernio<{ comments: ZComment[] }>(`/inbox/comments/${encodeURIComponent(p.id)}?accountId=${account}`);
    // The owner's own replies are not customer comments.
    return comments.filter(c => !c.from?.isOwner).map(c => ({
      id: c.id, ref: `${account}|${p.id}|${c.id}`, author: c.from?.name ?? c.from?.username ?? 'Someone', text: c.message ?? '', at: c.createdTime ?? '',
      link: commentLink(platform, p.permalink, c.id),
      // The owner may have answered in the platform's own app. That counts as answered here too.
      ...((c.replies ?? []).some(r => r.from?.isOwner) ? { answered: true } : {}),
    }));
  }));
  return lists.flat();
}

export const zernioProvider: Provider = async (channel, action, args) => {
  const platform = ZERNIO_PLATFORM[channel];
  if (platform && action === 'read') return zernioComments(platform);
  if (platform && action === 'reply') {
    const [account, postId, commentId] = String(args.ref).split('|');
    if (!postId || !commentId) throw new Error('this comment was read through another provider, so Zernio cannot find it');
    const out = await zernio<{ data?: { commentId?: string } }>(`/inbox/comments/${encodeURIComponent(postId)}`, {
      method: 'POST',
      // A retry after a lost answer must not post the reply twice.
      headers: { 'Idempotency-Key': String(args.idempotencyKey ?? randomUUID()) },
      body: JSON.stringify({ accountId: account, commentId, message: String(args.text) }),
    });
    if (!out.data?.commentId) throw new Error('Zernio did not confirm the reply');
    return { id: out.data.commentId } satisfies Sent;
  }
  if (channel === 'google_reviews' && action === 'read') {
    // With no Google profile connected Zernio answers an empty list, which would read as zero reviews. Unknown is not zero.
    await accountId('googlebusiness');
    const { data } = await zernio<{ data: ZReview[] }>('/inbox/reviews?hasReply=false');
    return data.filter(r => r.platform !== 'facebook').map(r => ({
      id: r.id, ref: `${r.accountId}|${r.id}`, author: r.reviewer?.name ?? 'Someone', text: r.text ?? '', at: r.created ?? '', stars: r.rating,
    })) satisfies Item[];
  }
  if (channel === 'google_reviews' && action === 'read_all') return allOwnerReviews();
  if (channel === 'google_reviews' && action === 'reply') {
    const [account, reviewId] = String(args.ref).split('|');
    const out = await zernio<{ reply?: { id?: string } }>(`/inbox/reviews/${encodeURIComponent(reviewId)}/reply`, {
      method: 'POST',
      headers: { 'Idempotency-Key': String(args.idempotencyKey ?? randomUUID()) },
      body: JSON.stringify({ accountId: account, message: String(args.text) }),
    });
    if (!out.reply?.id) throw new Error('Zernio did not confirm the reply');
    return { id: out.reply.id } satisfies Sent;
  }
  throw new NotOffered(`not offered for ${channel} ${action}`);
};

// ---------- Swayu's own Meta app ----------

/** WhatsApp runs on Swayu's own Meta app. Messages arrive by webhook, so only replies go out through here. */
export const own: Provider = async (channel, action, args) => {
  if (channel === 'whatsapp' && action === 'reply') return { id: await whatsappReply(String(args.ref), String(args.text)) } satisfies Sent;
  if (channel === 'google_places' && action === 'read') return placesStub(args);
  throw new NotOffered(`not offered for ${channel} ${action}`);
};
