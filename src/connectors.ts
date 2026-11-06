// The socket every channel plugs into. Each channel reads its own shape; everything after this file sees one message shape.
// Sample channels feed saved comments through the same path until each platform approves Swayu.
// The platform shapes below are written from memory of each API and are unverified until a live adapter replaces them.
// Facebook, Instagram and Google reviews are live through the connector gateway since 4 Nov 2026: Cedar decides,
// the route table picks Composio or Zernio, and every call writes a ledger row. Every provider answers one item shape.
// WhatsApp is live on Meta's test number since 30 Oct 2026. Meta pushes its messages to our webhook, so it has no fetch.
import { z } from 'zod';
import type { InboxMessage } from './parse';
import { checkMessages } from './message';
import { leadGateway } from './gateway/setup';
import { TENANT } from './tenant';
import { RateLimited } from './gateway/limiter';

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
};

/** Any timestamp a platform gives, as UTC YYYY-MM-DDTHH:MM, or null. */
function minute(value: string): string | null {
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16) : null;
}

const WhatsApp = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  text: z.object({ body: z.string() }),
  profile: z.object({ name: z.string() }).optional(),
});

/** The one shape every provider behind the gateway answers. `id` is the platform's own id; `ref` is the reply handle. */
const GatewayItem = z.object({ id: z.string().min(1), ref: z.string().min(1), author: z.string().min(1), text: z.string(), at: z.string(), stars: z.number().int().min(1).max(5).optional(), link: z.string().optional(), answered: z.boolean().optional() });

/**
 * Reads one channel through the gateway as the replies lead. A refusal or a provider failure throws, so the channel shows broken.
 * A provider that only asked us to wait throws RateLimited instead: the channel works, and the next check reads it.
 */
function throughGateway(channel: Channel) {
  return async (): Promise<unknown[]> => {
    const out = await leadGateway().call({ tenant: TENANT, lead: 'replies', channel, action: 'read', args: {} });
    if (!out.ok && out.waitSeconds !== undefined) throw new RateLimited(ADAPTERS[channel].label, out.waitSeconds, out.reason);
    if (!out.ok) throw new Error(out.reason);
    return out.result as unknown[];
  };
}

function reader<T>(shape: z.ZodType<T>, pick: (item: T) => { platformId: string; author: string; at: string; text: string; stars?: number; replyRef?: string; link?: string; answeredElsewhere?: boolean }) {
  return (raw: unknown) => {
    const parsed = shape.safeParse(raw);
    if (!parsed.success) return null;
    const { at, ...rest } = pick(parsed.data);
    const receivedAt = minute(at);
    return receivedAt ? { ...rest, receivedAt } : null;
  };
}

const fromGateway = reader(GatewayItem, i => ({ platformId: i.id, replyRef: i.ref, author: i.author, at: i.at, text: i.text, stars: i.stars, link: i.link, ...(i.answered ? { answeredElsewhere: true } : {}) }));

export const ADAPTERS: Record<Channel, Adapter> = {
  whatsapp: {
    label: 'WhatsApp',
    mode: 'live',
    // A reply needs the customer's number as well as the message it quotes, so the id carries both.
    read: reader(WhatsApp, m => ({ platformId: `${m.from}|${m.id}`, author: m.profile?.name ?? m.from, at: m.timestamp, text: m.text.body })),
  },
  instagram: { label: 'Instagram', mode: 'live', read: fromGateway, fetch: throughGateway('instagram') },
  facebook: { label: 'Facebook', mode: 'live', read: fromGateway, fetch: throughGateway('facebook') },
  google_reviews: { label: 'Google reviews', mode: 'live', read: fromGateway, fetch: throughGateway('google_reviews') },
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
