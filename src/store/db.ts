// The only module that talks to Postgres. One business for now; every row still carries its tenant id.
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { InboxMessage } from '../parse';
import type { Status } from '../inbox';
import type { Facts } from '../facts';
import type { Theme } from '../agents/insights';
import { business, event, insight, message, messageFacts } from './schema';
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

/** Stores new messages and their arrived events together. A message already stored is skipped. */
export async function store(messages: InboxMessage[], thread: string): Promise<number> {
  if (!messages.length) return 0;
  await ensureBusiness();
  return db.transaction(async tx => {
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
      })))
      .onConflictDoNothing()
      .returning({ contentId: message.contentId });
    if (added.length) {
      await tx.insert(event).values(added.map(a => ({ tenantId: TENANT, contentId: a.contentId, kind: 'arrived' })));
    }
    return added.length;
  });
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
  return { ownerNames, messages, state: toState(ownerNames, messages, events, facts) };
}

/** Which of these ids are already stored, so the watcher only brings genuinely new comments. */
export async function storedIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ contentId: message.contentId })
    .from(message)
    .where(and(eq(message.tenantId, TENANT), inArray(message.contentId, ids)));
  return new Set(rows.map(r => r.contentId));
}

/** Clears this business so a demo can start again. */
export async function startOver() {
  await db.transaction(async tx => {
    await tx.delete(insight).where(eq(insight.tenantId, TENANT));
    await tx.delete(message).where(eq(message.tenantId, TENANT));
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
    .where(and(eq(message.tenantId, TENANT), isNull(messageFacts.contentId)));
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
