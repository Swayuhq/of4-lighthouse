// The two outside providers behind the gateway, each returning the same shapes so they can be compared on real accounts.
// Zernio endpoints read from docs.zernio.com on 4 Nov 2026: base https://zernio.com/api/v1, Bearer key,
// GET /accounts, GET /inbox/comments, GET /inbox/comments/{postId}, POST /inbox/comments/{postId},
// GET /inbox/reviews, POST /inbox/reviews/{reviewId}/reply. Keys are read on each call and never logged.
import { randomUUID } from 'node:crypto';
import { facebookComments, facebookReply, instagramComments } from '../composio';
import type { Provider } from './gateway';

/** One comment or review, whichever provider read it. `ref` is what that provider needs to reply. */
export type Item = { ref: string; author: string; text: string; at: string; stars?: number };
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
    return raw.map(c => ({ ref: c.id, author: c.from?.name ?? 'Someone', text: c.message ?? '', at: c.created_time ?? '' })) satisfies Item[];
  }
  if (channel === 'instagram' && action === 'read') {
    return (await instagramComments()).map(c => ({ ref: c.id, author: c.username ?? c.from?.username ?? 'Someone', text: c.text ?? '', at: c.timestamp ?? '' })) satisfies Item[];
  }
  if (channel === 'facebook' && action === 'reply') {
    return { id: await facebookReply(String(args.ref), String(args.text)) } satisfies Sent;
  }
  throw new NotOffered(`not wired for ${channel} ${action} in Lighthouse yet`);
};

// ---------- Zernio ----------

async function zernio<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.SWAYU_ZERNIO_API_KEY;
  if (!key) throw new Error('SWAYU_ZERNIO_API_KEY is not set. Start Lighthouse with pnpm start:op.');
  const res = await fetch(`${ZERNIO}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(`HTTP ${res.status} ${body.error ?? body.message ?? ''}`.trim());
  return body;
}

type Account = { _id?: string; id?: string; platform: string };

/** The first connected account on that platform. Lighthouse has one test business. */
async function accountId(platform: string): Promise<string> {
  const { accounts } = await zernio<{ accounts: Account[] }>(`/accounts?platform=${encodeURIComponent(platform)}`);
  const found = accounts.find(a => a.platform === platform);
  const id = found?._id ?? found?.id;
  if (!id) throw new Error(`no ${platform} account is connected in Zernio`);
  return id;
}

type Post = { id: string; platform: string; isAd?: boolean; commentCount?: number };
type ZComment = { id: string; message?: string; createdTime?: string; from?: { name?: string; username?: string; isOwner?: boolean } };
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
      ref: `${account}|${p.id}|${c.id}`, author: c.from?.name ?? c.from?.username ?? 'Someone', text: c.message ?? '', at: c.createdTime ?? '',
    }));
  }));
  return lists.flat();
}

export const zernioProvider: Provider = async (channel, action, args) => {
  const platform = ZERNIO_PLATFORM[channel];
  if (platform && action === 'read') return zernioComments(platform);
  if (platform && action === 'reply') {
    const [account, postId, commentId] = String(args.ref).split('|');
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
    const { data } = await zernio<{ data: ZReview[] }>('/inbox/reviews?hasReply=false');
    return data.filter(r => r.platform !== 'facebook').map(r => ({
      ref: `${r.accountId}|${r.id}`, author: r.reviewer?.name ?? 'Someone', text: r.text ?? '', at: r.created ?? '', stars: r.rating,
    })) satisfies Item[];
  }
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
