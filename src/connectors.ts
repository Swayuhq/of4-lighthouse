// The socket every channel plugs into. Each channel reads its own shape; everything after this file sees one message shape.
// Sample channels feed saved comments through the same path until each platform approves Swayu.
// The platform shapes below are written from memory of each API and are unverified until a live adapter replaces them.
// Facebook is live through Composio since 30 Oct 2026, and its shape is checked against real answers.
import { z } from 'zod';
import type { InboxMessage } from './parse';
import { checkMessages } from './message';
import { facebookComments, facebookReply } from './composio';

export type Channel = 'whatsapp' | 'instagram' | 'facebook' | 'google_reviews';
export type ConnectionStatus = 'connected' | 'broken';
export type Connection = { channel: Channel; status: ConnectionStatus };

type Adapter = {
  label: string;
  /** sample: saved comments stand in for the platform. live: the platform itself. */
  mode: 'sample' | 'live';
  /** The platform's item, or null when it lacks what a message needs. */
  read: (raw: unknown) => Omit<InboxMessage, 'id' | 'platform'> & { platformId: string } | null;
  /** Live only: every item the platform holds now. Storing dedupes on id, so items seen before add nothing. */
  fetch?: () => Promise<unknown[]>;
  /** Live only: posts the owner's reply under one item and returns the platform's id for it. */
  send?: (platformId: string, text: string) => Promise<string>;
};

/** Any timestamp a platform gives, as UTC YYYY-MM-DDTHH:MM, or null. */
function minute(value: string): string | null {
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16) : null;
}

const Instagram = z.object({ id: z.string(), text: z.string(), timestamp: z.string(), from: z.object({ username: z.string() }) });
const Facebook = z.object({ id: z.string(), message: z.string(), created_time: z.string(), from: z.object({ name: z.string() }) });
const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 } as const;
const Google = z.object({
  reviewId: z.string(),
  reviewer: z.object({ displayName: z.string() }),
  starRating: z.enum(['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE']),
  comment: z.string().default(''),
  createTime: z.string(),
});
const WhatsApp = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  text: z.object({ body: z.string() }),
  profile: z.object({ name: z.string() }).optional(),
});

function reader<T>(shape: z.ZodType<T>, pick: (item: T) => { platformId: string; author: string; at: string; text: string; stars?: number }) {
  return (raw: unknown) => {
    const parsed = shape.safeParse(raw);
    if (!parsed.success) return null;
    const { at, ...rest } = pick(parsed.data);
    const receivedAt = minute(at);
    return receivedAt ? { ...rest, receivedAt } : null;
  };
}

export const ADAPTERS: Record<Channel, Adapter> = {
  whatsapp: {
    label: 'WhatsApp',
    mode: 'sample',
    read: reader(WhatsApp, m => ({ platformId: m.id, author: m.profile?.name ?? m.from, at: m.timestamp, text: m.text.body })),
  },
  instagram: {
    label: 'Instagram',
    mode: 'sample',
    read: reader(Instagram, c => ({ platformId: c.id, author: c.from.username, at: c.timestamp, text: c.text })),
  },
  facebook: {
    label: 'Facebook',
    mode: 'live',
    read: reader(Facebook, c => ({ platformId: c.id, author: c.from.name, at: c.created_time, text: c.message })),
    fetch: facebookComments,
    send: facebookReply,
  },
  google_reviews: {
    label: 'Google reviews',
    mode: 'sample',
    read: reader(Google, r => ({ platformId: r.reviewId, author: r.reviewer.displayName, at: r.createTime, text: r.comment, stars: STARS[r.starRating] })),
  },
};

export const CHANNELS = Object.keys(ADAPTERS) as Channel[];
export const isChannel = (value: string): value is Channel => value in ADAPTERS;

/** Platform items into messages. The id carries the channel, so two platforms never share one. */
export function toMessages(channel: Channel, raw: unknown[]): { messages: InboxMessage[]; refused: number } {
  const { label, read } = ADAPTERS[channel];
  const mapped = raw.map(item => {
    const r = read(item);
    if (!r) return null;
    const { platformId, ...rest } = r;
    return { id: `${channel}:${platformId}`, platform: label, ...rest };
  });
  const checked = checkMessages(mapped.filter(m => m !== null));
  return { messages: checked.messages, refused: raw.length - checked.messages.length };
}

/** The next comments from a saved feed. A cursor out of range starts again; dedupe on id keeps the count right. */
export function pullSample<T>(feed: T[], cursor: number, take: number): { items: T[]; cursor: number } {
  const from = Number.isInteger(cursor) && cursor >= 0 ? Math.min(cursor, feed.length) : 0;
  const items = feed.slice(from, from + take);
  return { items, cursor: from + items.length };
}

/** The count only passes when Swayu can see every channel. A broken one is unknown, never zero. */
export function coverage(connections: Connection[]): { ok: boolean; unknown: string[] } {
  const unknown = connections.filter(c => c.status !== 'connected').map(c => ADAPTERS[c.channel].label);
  return { ok: connections.length > 0 && unknown.length === 0, unknown };
}
