// Zernio pushes each new comment and review to Lighthouse within seconds, so the inbox no longer has to keep asking.
// Read from docs.zernio.com/webhooks and /webhooks/inbox on 5 Nov 2026: the X-Zernio-Signature header is the lowercase hex
// HMAC-SHA256 of the raw body keyed by the endpoint secret; the top level id stays the same across retries and is the dedupe
// key; a delivery needs a 2xx within 5 seconds or Zernio tries again, up to 7 times. The review shape is the
// ReviewWebhookReview model of the zernio crate on docs.rs, read the same day.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { commentLink, type Item } from './gateway/providers';
import type { Channel } from './connectors';

/** True only when Zernio signed this exact body with our endpoint secret. */
export function pushSignatureOk(body: string, header: string | null, secret: string | undefined): boolean {
  if (!header || !secret || !/^[0-9a-f]{64}$/.test(header)) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(Buffer.from(header, 'hex'), expected);
}

/** Why a readable push stores no message. */
export type Skip = 'event' | 'platform' | 'own' | 'shape';

export type Push = {
  eventId: string;
  kind: string;
  /** When Zernio made the event. With the comment's own time and ours, it gives the hop times. */
  sentAt: string | null;
  /** A sample send from the Zernio dashboard. It is recorded and never stored as a customer message. */
  test: boolean;
  channel: Channel | null;
  item: Item | null;
  skip?: Skip;
};

const Envelope = z.object({ id: z.string().min(1).max(200), event: z.string().min(1).max(100), timestamp: z.string().optional(), test: z.boolean().optional() });

const Comment = z.object({
  comment: z.object({
    id: z.string().min(1),
    postId: z.string().nullable(),
    platformPostId: z.string().min(1),
    platform: z.string(),
    text: z.string(),
    author: z.object({ id: z.string().optional(), username: z.string().optional(), name: z.string().optional(), isOwnAccount: z.boolean().optional() }),
    createdAt: z.string(),
  }),
  post: z.object({ permalink: z.string().nullable().optional() }).optional(),
  account: z.object({ id: z.string().min(1) }),
});

const Review = z.object({
  review: z.object({
    id: z.string().min(1),
    platform: z.string(),
    rating: z.number().int().min(0).max(5).optional(),
    text: z.string().optional(),
    reviewer: z.object({ name: z.string().optional() }).optional(),
    createdAt: z.string(),
    hasReply: z.boolean().optional(),
  }),
  account: z.object({ id: z.string().min(1) }),
});

/** Zernio's platform names, for the channels Lighthouse reads. */
const COMMENT_CHANNEL: Record<string, Channel> = { instagram: 'instagram', facebook: 'facebook' };

/**
 * One push as Lighthouse reads it, or null when it has no event id to dedupe on.
 * A message gets the same id and reply handle a check through the gateway would give it, so one comment is never counted twice.
 */
export function readPush(payload: unknown): Push | null {
  const env = Envelope.safeParse(payload);
  if (!env.success) return null;
  const base = { eventId: env.data.id, kind: env.data.event, sentAt: env.data.timestamp ?? null, test: env.data.test === true };
  const none = (skip: Skip, channel: Channel | null = null): Push => ({ ...base, channel, item: null, skip });

  if (env.data.event === 'comment.received') {
    const p = Comment.safeParse(payload);
    if (!p.success) return none('shape');
    const { comment: c, post, account } = p.data;
    const channel = COMMENT_CHANNEL[c.platform];
    if (!channel) return none('platform');
    if (c.author.isOwnAccount) return none('own', channel);
    const link = commentLink(c.platform, post?.permalink ?? undefined, c.id);
    return {
      ...base, channel,
      item: {
        // Zernio takes its own post id or the platform's, and a post made outside Zernio has only the platform's.
        id: c.id, ref: `${account.id}|${c.postId ?? c.platformPostId}|${c.id}`,
        author: c.author.name || c.author.username || 'Someone', text: c.text, at: c.createdAt,
        ...(link ? { link } : {}),
      },
    };
  }

  // A changed review has the same shape as a new one (docs.zernio.com/webhooks/inbox, read 6 Nov 2026).
  if (env.data.event === 'review.new' || env.data.event === 'review.updated') {
    const p = Review.safeParse(payload);
    if (!p.success) return none('shape');
    const { review: r, account } = p.data;
    if (r.platform !== 'googlebusiness') return none('platform');
    return {
      ...base, channel: 'google_reviews',
      item: {
        id: r.id, ref: `${account.id}|${r.id}`, author: r.reviewer?.name || 'A Google user', text: r.text ?? '', at: r.createdAt,
        // Zernio sends 0 when Google gave no rating; 0 is not a star count.
        ...(r.rating ? { stars: r.rating } : {}),
        ...(r.hasReply ? { answered: true } : {}),
      },
    };
  }

  return none('event');
}
