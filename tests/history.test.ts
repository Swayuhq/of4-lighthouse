// The comment history: a customer's text vanishes 30 days after the owner's last reply, like vanishing messages.
// Who wrote, when, on which channel and that it was answered stay. Decided by Sujit on 5 Nov 2026.
// Runs against the local lighthouse_test database, never the demo one.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.LIGHTHOUSE_DB_NAME = 'lighthouse_test';
const { connect, db, load, pushEvents, record, saveFacts, startOver, store, storeFromChannel, sweepHistory, takePush, unread, TENANT } = await import('../src/store/db');
const { event, pushEvent } = await import('../src/store/schema');

const NOW = new Date('2026-12-10T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const msg = (id: string, text = 'Is the cake eggless?') => ({ id, platform: 'Instagram', author: 'priya.k', receivedAt: '2026-11-01T09:15', text });
const facts = { kind: 'question' as const, problem: 'none' as const, asks: 'eggless cake', deadline: null };

/** Writes a status event and moves it back in time. */
async function at(contentId: string, kind: 'sent' | 'answered' | 'waiting' | 'spam', days: number) {
  await record(contentId, kind, kind === 'sent' ? 'Yes, all our cakes are eggless.' : undefined);
  const rows = await db.select({ id: event.id }).from(event).where(and(eq(event.tenantId, TENANT), eq(event.contentId, contentId), eq(event.kind, kind)));
  await db.update(event).set({ at: daysAgo(days) }).where(eq(event.id, rows.at(-1)!.id));
}

const text = async (id: string) => (await load()).messages.find(m => m.contentId === id);

beforeEach(() => startOver());
afterAll(() => startOver());

describe('The 30 day clock on answered comments', () => {
  it('a comment answered 31 days ago loses its text and its facts; who, when, channel and answered stay', async () => {
    await store([msg('instagram:1')], 'Instagram');
    await saveFacts({ 'instagram:1': facts }, 'test');
    await at('instagram:1', 'sent', 31);
    expect(await sweepHistory(NOW)).toEqual({ vanished: 1, events: 0 });
    const m = await text('instagram:1');
    expect(m).toMatchObject({ body: '', author: 'priya.k', platform: 'Instagram', receivedAt: '2026-11-01T09:15' });
    expect(m?.vanishedAt).toEqual(NOW);
    const { state } = await load();
    expect(state.status['instagram:1']).toBe('answered');
    expect(state.facts).toEqual({});
    expect(state.messages[0].vanished).toBe(true);
  });

  it('a comment answered 29 days ago keeps its text', async () => {
    await store([msg('instagram:1')], 'Instagram');
    await at('instagram:1', 'answered', 29);
    expect(await sweepHistory(NOW)).toEqual({ vanished: 0, events: 0 });
    expect((await text('instagram:1'))?.body).toBe('Is the cake eggless?');
  });

  it('the clock runs from the last reply, not the first', async () => {
    await store([msg('instagram:1')], 'Instagram');
    await at('instagram:1', 'sent', 40);
    await at('instagram:1', 'sent', 5);
    await sweepHistory(NOW);
    expect((await text('instagram:1'))?.body).toBe('Is the cake eggless?');
  });

  it('a comment moved back to waiting, a waiting one and a spam one are never swept', async () => {
    await store([msg('instagram:1'), msg('instagram:2', 'Where are you?'), msg('instagram:3', 'Buy followers')], 'Instagram');
    await at('instagram:1', 'sent', 40);
    await at('instagram:1', 'waiting', 35);
    await at('instagram:3', 'spam', 40);
    expect(await sweepHistory(NOW)).toEqual({ vanished: 0, events: 0 });
    expect((await load()).messages.every(m => m.body !== '')).toBe(true);
  });

  it('a second sweep changes nothing, and the vanished time is kept', async () => {
    await store([msg('instagram:1')], 'Instagram');
    await at('instagram:1', 'sent', 31);
    await sweepHistory(NOW);
    expect(await sweepHistory(new Date(NOW.getTime() + 86_400_000))).toEqual({ vanished: 0, events: 0 });
    expect((await text('instagram:1'))?.vanishedAt).toEqual(NOW);
  });

  it('the reader never reads a vanished comment again', async () => {
    await store([msg('instagram:1')], 'Instagram');
    await at('instagram:1', 'sent', 31);
    await sweepHistory(NOW);
    expect(await unread()).toEqual([]);
  });

  it('reading the same comment from the platform again does not bring its text back', async () => {
    await connect('instagram');
    await storeFromChannel('instagram', [msg('instagram:1')], 0);
    await at('instagram:1', 'sent', 31);
    await sweepHistory(NOW);
    await storeFromChannel('instagram', [msg('instagram:1')], 0);
    expect((await text('instagram:1'))?.body).toBe('');
  });
});

describe('The 30 day clock on pushed events', () => {
  it('an event row older than 30 days is removed and a newer one stays', async () => {
    const row = (eventId: string) => ({ provider: 'zernio', eventId, kind: 'comment.received', channel: null, sentAt: null });
    await takePush(row('old'), [], 'skipped');
    await takePush(row('new'), [], 'skipped');
    await db.update(pushEvent).set({ receivedAt: daysAgo(31) }).where(eq(pushEvent.eventId, 'old'));
    await db.update(pushEvent).set({ receivedAt: daysAgo(29) }).where(eq(pushEvent.eventId, 'new'));
    expect(await sweepHistory(NOW)).toEqual({ vanished: 0, events: 1 });
    expect((await pushEvents()).map(e => e.eventId)).toEqual(['new']);
  });
});
