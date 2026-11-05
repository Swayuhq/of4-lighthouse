// The only module that talks to Postgres. One business for now; every row still carries its tenant id.
import { and, asc, desc, eq, inArray, isNull, like, lt, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { InboxMessage } from '../parse';
import type { Status } from '../inbox';
import type { Facts } from '../facts';
import type { Theme } from '../agents/insights';
import { business, connection, connectorCall, event, insight, message, messageFacts, pushEvent } from './schema';
import { ADAPTERS, type Channel } from '../connectors';
import { toState } from './books';

const client = postgres({
  path: process.env.LIGHTHOUSE_DB_SOCKET ?? '/var/run/postgresql/.s.PGSQL.5432',
  database: process.env.LIGHTHOUSE_DB_NAME ?? 'lighthouse',
  max: 5,
});
export const db = drizzle(client);

export const TENANT = '00000000-0000-4000-8000-000000000001';

async function ensureBusiness() {
  await db.insert(business).values({ tenantId: TENANT, name: 'Your business' }).onConflictDoNothing();
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Writes new messages and their arrived events. A message already stored is skipped. */
async function insertMessages(tx: Tx, messages: InboxMessage[], thread: string): Promise<number> {
  if (!messages.length) return 0;
  const added = await tx
    .insert(message)
    .values(messages.map(m => ({
      tenantId: TENANT,
      contentId: m.id,
      thread,
      platform: m.platform,
      author: m.author,
      receivedAt: m.receivedAt,
      body: m.text,
      stars: m.stars ?? null,
      replyRef: m.replyRef ?? null,
      link: m.link ?? null,
    })))
    .onConflictDoNothing()
    .returning({ contentId: message.contentId });
  // A message stored before links existed gets its link the next time it is read. Nothing else about it changes.
  for (const m of messages.filter(x => x.link)) {
    await tx.update(message).set({ link: m.link }).where(and(eq(message.tenantId, TENANT), eq(message.contentId, m.id), isNull(message.link)));
  }
  // Answered in the platform's own app: answered here too, unless the owner already decided something for it.
  for (const m of messages.filter(x => x.answeredElsewhere)) {
    await tx.execute(sql`insert into event (tenant_id, content_id, kind)
      select ${TENANT}, ${m.id}, 'answered'
      where exists (select 1 from message where tenant_id = ${TENANT} and content_id = ${m.id})
        and not exists (select 1 from event where tenant_id = ${TENANT} and content_id = ${m.id} and kind in ('waiting', 'answered', 'spam', 'sent'))`);
  }
  if (added.length) {
    await tx.insert(event).values(added.map(a => ({ tenantId: TENANT, contentId: a.contentId, kind: 'arrived' })));
  }
  return added.length;
}

/** Stores new messages and their arrived events together. A message already stored is skipped. */
export async function store(messages: InboxMessage[], thread: string): Promise<number> {
  if (!messages.length) return 0;
  await ensureBusiness();
  return db.transaction(tx => insertMessages(tx, messages, thread));
}

/** Connects a channel, or reconnects a broken one. The cursor is kept, so old comments are not read twice. */
export async function connect(channel: Channel) {
  await ensureBusiness();
  await db
    .insert(connection)
    .values({ tenantId: TENANT, channel, status: 'connected' })
    .onConflictDoUpdate({ target: [connection.tenantId, connection.channel], set: { status: 'connected', problem: null } });
}

export async function markBroken(channel: Channel, problem: string) {
  await db
    .update(connection)
    .set({ status: 'broken', problem })
    .where(and(eq(connection.tenantId, TENANT), eq(connection.channel, channel)));
}

export async function connections() {
  return db.select().from(connection).where(eq(connection.tenantId, TENANT)).orderBy(asc(connection.connectedAt));
}

/**
 * Stores what a channel brought and moves its cursor in one transaction.
 * The cursor update carries the connected condition itself, so a channel broken a moment ago stores nothing.
 */
export async function storeFromChannel(channel: Channel, messages: InboxMessage[], cursor: number): Promise<number> {
  return db.transaction(async tx => {
    const moved = await tx
      .update(connection)
      .set({ cursor, lastPullAt: new Date() })
      .where(and(eq(connection.tenantId, TENANT), eq(connection.channel, channel), eq(connection.status, 'connected')))
      .returning({ channel: connection.channel });
    if (!moved.length) throw new Error(`${ADAPTERS[channel].label} is not connected`);
    return insertMessages(tx, messages, ADAPTERS[channel].label);
  });
}

export type PushOutcome = 'stored' | 'already had' | 'not connected' | 'test' | 'skipped' | 'refused' | 'duplicate';

/**
 * Takes one pushed event and its message in one transaction. The event row goes first, so a second delivery of the same
 * event waits on it and then finds it taken. A failure rolls both back, so the provider's retry is not mistaken for a duplicate.
 * The message is stored only while its channel is connected, checked in the same statement that marks the channel heard from.
 */
export async function takePush(
  row: { provider: string; eventId: string; kind: string; channel: Channel | null; sentAt: string | null },
  messages: InboxMessage[],
  outcome: Exclude<PushOutcome, 'stored' | 'already had' | 'not connected' | 'duplicate'> | null,
): Promise<PushOutcome> {
  await ensureBusiness();
  const sent = row.sentAt ? new Date(row.sentAt) : null;
  return db.transaction(async tx => {
    const [taken] = await tx.insert(pushEvent).values({
      tenantId: TENANT, provider: row.provider, eventId: row.eventId, kind: row.kind, channel: row.channel,
      contentId: messages[0]?.id ?? null, outcome: outcome ?? 'not connected',
      sentAt: sent && !Number.isNaN(sent.getTime()) ? sent : null,
    }).onConflictDoNothing().returning({ id: pushEvent.id });
    if (!taken) return 'duplicate';
    if (outcome || !row.channel || !messages.length) return outcome ?? 'skipped';
    const live = await tx.update(connection).set({ lastPullAt: new Date() })
      .where(and(eq(connection.tenantId, TENANT), eq(connection.channel, row.channel), eq(connection.status, 'connected')))
      .returning({ channel: connection.channel });
    if (!live.length) return 'not connected';
    const final: PushOutcome = (await insertMessages(tx, messages, ADAPTERS[row.channel].label)) ? 'stored' : 'already had';
    await tx.update(pushEvent).set({ outcome: final }).where(eq(pushEvent.id, taken.id));
    return final;
  });
}

/** Days a customer's text stays after the owner's last reply, and days a pushed event row stays. */
export const HISTORY_DAYS = 30;

/**
 * The retention sweep for the comment history. A comment whose newest status is a reply older than 30 days loses its text
 * and the facts the reader took from it. Who wrote, when, where and that it was answered stay, and so does the owner's reply.
 * Pushed event rows older than 30 days go too; Zernio stops retrying long before that.
 */
export async function sweepHistory(now = new Date()): Promise<{ vanished: number; events: number }> {
  const cutoff = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
  return db.transaction(async tx => {
    const gone = await tx.execute<{ content_id: string }>(sql`
      with last as (
        select distinct on (content_id) content_id, kind, at from event
        where tenant_id = ${TENANT} and kind in ('waiting', 'answered', 'spam', 'sent')
        order by content_id, id desc)
      update message m set body = '', vanished_at = ${now.toISOString()}
      from last
      where m.tenant_id = ${TENANT} and m.content_id = last.content_id and m.vanished_at is null
        and last.kind in ('answered', 'sent') and last.at < ${cutoff.toISOString()}
      returning m.content_id`);
    const ids = [...gone].map(r => r.content_id);
    if (ids.length) await tx.delete(messageFacts).where(and(eq(messageFacts.tenantId, TENANT), inArray(messageFacts.contentId, ids)));
    const events = await tx.delete(pushEvent).where(and(eq(pushEvent.tenantId, TENANT), lt(pushEvent.receivedAt, cutoff))).returning({ id: pushEvent.id });
    return { vanished: ids.length, events: events.length };
  });
}

/** Every pushed event, oldest first, for the arrival probe and the tests. */
export async function pushEvents() {
  return db.select().from(pushEvent).where(eq(pushEvent.tenantId, TENANT)).orderBy(asc(pushEvent.id));
}

export async function record(contentId: string, kind: Status | 'sent', replyText?: string) {
  await db.insert(event).values({ tenantId: TENANT, contentId, kind, replyText: replyText ?? null });
}

export async function setOwnerNames(names: string[]) {
  await ensureBusiness();
  await db.update(business).set({ ownerNames: names }).where(eq(business.tenantId, TENANT));
}

export async function load() {
  const [b] = await db.select().from(business).where(eq(business.tenantId, TENANT));
  const messages = await db.select().from(message).where(eq(message.tenantId, TENANT)).orderBy(asc(message.receivedAt));
  const events = await db.select().from(event).where(eq(event.tenantId, TENANT));
  const factRows = await db.select().from(messageFacts).where(eq(messageFacts.tenantId, TENANT));
  const facts = Object.fromEntries(factRows.map(f => [f.contentId, f.facts]));
  const ownerNames = b?.ownerNames ?? [];
  return { businessName: b?.name ?? null, ownerNames, messages, state: toState(ownerNames, messages, events, facts) };
}

/** The business the owner named at sign up, or null before sign up. */
export async function businessName(): Promise<string | null> {
  const [b] = await db.select({ name: business.name }).from(business).where(eq(business.tenantId, TENANT));
  return b?.name ?? null;
}

export async function nameBusiness(name: string) {
  await db
    .insert(business)
    .values({ tenantId: TENANT, name })
    .onConflictDoUpdate({ target: business.tenantId, set: { name } });
}

/** Clears this business so a demo can start again. */
export async function startOver() {
  await db.transaction(async tx => {
    await tx.delete(insight).where(eq(insight.tenantId, TENANT));
    await tx.delete(pushEvent).where(eq(pushEvent.tenantId, TENANT));
    await tx.delete(connectorCall).where(eq(connectorCall.tenantId, TENANT));
    await tx.delete(event).where(eq(event.tenantId, TENANT));
    await tx.delete(messageFacts).where(eq(messageFacts.tenantId, TENANT));
    await tx.delete(message).where(eq(message.tenantId, TENANT));
    await tx.delete(connection).where(eq(connection.tenantId, TENANT));
    await tx.delete(business).where(eq(business.tenantId, TENANT));
  });
}

/** Customer messages the reader has not labelled yet. The owner's own lines are skipped once the owner is known. */
export async function unread(): Promise<InboxMessage[]> {
  const [b] = await db.select().from(business).where(eq(business.tenantId, TENANT));
  const owners = new Set(b?.ownerNames ?? []);
  const rows = await db
    .select({ m: message })
    .from(message)
    .leftJoin(messageFacts, and(eq(messageFacts.tenantId, message.tenantId), eq(messageFacts.contentId, message.contentId)))
    // A vanished comment has no words left to read.
    .where(and(eq(message.tenantId, TENANT), isNull(messageFacts.contentId), isNull(message.vanishedAt)));
  return rows
    .map(({ m }) => ({ id: m.contentId, platform: m.platform, author: m.author, receivedAt: m.receivedAt, text: m.body, ...(m.stars ? { stars: m.stars } : {}) }))
    .filter(m => !owners.has(m.author));
}

export async function saveFacts(found: Record<string, Facts>, model: string) {
  const rows = Object.entries(found).map(([contentId, facts]) => ({ tenantId: TENANT, contentId, facts, model }));
  if (!rows.length) return;
  try {
    await db.insert(messageFacts).values(rows).onConflictDoNothing();
  } catch (e) {
    // Start over pressed while the reader was busy: its messages are gone, so their facts have nowhere to go.
    if ((e as { cause?: { code?: string } }).cause?.code !== '23503') throw e;
  }
}

export async function saveThemes(themes: Theme[]) {
  await db.insert(insight).values({ tenantId: TENANT, themes }).onConflictDoUpdate({ target: insight.tenantId, set: { themes } });
}

export async function loadThemes(): Promise<Theme[]> {
  const [row] = await db.select().from(insight).where(eq(insight.tenantId, TENANT));
  return row?.themes ?? [];
}

/** Writes one gateway ledger row. The reply text is not copied here; the sent event already holds it. */
export async function saveCall(row: { lead: string; channel: string; action: string; outcome: string; provider?: string; note?: string; at: string }) {
  await db.insert(connectorCall).values({
    tenantId: TENANT, lead: row.lead, channel: row.channel, action: row.action, outcome: row.outcome,
    provider: row.provider ?? null, note: row.note ?? null, at: new Date(row.at),
  });
}

/**
 * The stored message a lead's reply answers, with what the checker needs. The lead names it by the ref it was given,
 * which is the stored reply ref, or ends in the platform id whichever provider read it. Null when none matches.
 */
export async function messageForRef(channel: string, ref: string): Promise<{ contentId: string; text: string; ownerLines: string[] } | null> {
  if (!ref) return null;
  const ids = [`${channel}:${ref}`, `${channel}:${ref.split('|').at(-1)}`];
  const [hit] = await db.select({ contentId: message.contentId, text: message.body }).from(message)
    .where(and(eq(message.tenantId, TENANT), like(message.contentId, `${channel}:%`), or(eq(message.replyRef, ref), inArray(message.contentId, ids))))
    .limit(1);
  if (!hit) return null;
  const [b] = await db.select({ owners: business.ownerNames }).from(business).where(eq(business.tenantId, TENANT));
  const owners = b?.owners ?? [];
  const lines = owners.length ? await db.select({ body: message.body }).from(message).where(and(eq(message.tenantId, TENANT), inArray(message.author, owners))) : [];
  return { ...hit, ownerLines: lines.map(l => l.body) };
}

/** Keeps a lead's checked reply as a draft on its message, for the owner to check and send. */
export async function holdReply(contentId: string, text: string) {
  await db.insert(event).values({ tenantId: TENANT, contentId, kind: 'drafted', replyText: text });
}

/** The newest gateway ledger rows, for the activity page. */
export async function recentCalls(limit = 300) {
  return db.select().from(connectorCall).where(eq(connectorCall.tenantId, TENANT)).orderBy(desc(connectorCall.id)).limit(limit);
}

/** The provider's reply handle for one stored message, or null when it has none. */
export async function replyRefFor(contentId: string): Promise<string | null> {
  const rows = await db.select({ ref: message.replyRef }).from(message)
    .where(and(eq(message.tenantId, TENANT), eq(message.contentId, contentId)));
  return rows[0]?.ref ?? null;
}
