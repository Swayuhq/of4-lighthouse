import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADAPTERS, coverage, pullSample, toMessages } from '../src/connectors';

describe('Each channel turns its own shape into one message shape', () => {
  it('an Instagram comment', () => {
    const { messages, refused } = toMessages('instagram', [
      { id: '1789', text: 'Do you deliver to Park Street?', timestamp: '2026-10-29T09:15:00+0000', from: { username: 'priya.k' } },
    ]);
    expect(refused).toBe(0);
    expect(messages).toEqual([
      { id: 'instagram:1789', platform: 'Instagram', author: 'priya.k', receivedAt: '2026-10-29T09:15', text: 'Do you deliver to Park Street?' },
    ]);
  });

  it('a Google review keeps its stars', () => {
    const { messages } = toMessages('google_reviews', [
      { reviewId: 'r7', reviewer: { displayName: 'Sam' }, starRating: 'TWO', comment: 'Cake arrived damaged', createTime: '2026-10-28T18:40:00Z' },
    ]);
    expect(messages[0]).toMatchObject({ id: 'google_reviews:r7', platform: 'Google reviews', author: 'Sam', stars: 2, receivedAt: '2026-10-28T18:40' });
  });

  it('a Facebook comment', () => {
    const { messages } = toMessages('facebook', [
      { id: '55_9', message: 'Open on Sunday?', created_time: '2026-10-29T07:02:00+0000', from: { name: 'Lee Wong' } },
    ]);
    expect(messages[0]).toMatchObject({ id: 'facebook:55_9', platform: 'Facebook', author: 'Lee Wong', text: 'Open on Sunday?' });
  });

  it('a WhatsApp Business message', () => {
    const { messages } = toMessages('whatsapp', [
      { id: 'wamid.HB1', from: '447700900123', timestamp: '1761728400', type: 'text', text: { body: 'Is the shop open?' }, profile: { name: 'Aisha' } },
    ]);
    expect(messages[0]).toMatchObject({ id: 'whatsapp:447700900123|wamid.HB1', platform: 'WhatsApp', author: 'Aisha', text: 'Is the shop open?' });
  });

  it('an item missing what we need is refused and counted, never stored half filled', () => {
    const { messages, refused } = toMessages('instagram', [{ id: '1', timestamp: '2026-10-29T09:15:00+0000' }, 'nonsense', null]);
    expect(messages).toEqual([]);
    expect(refused).toBe(3);
  });

  it('a page trying to add an extra field is refused, not passed along', () => {
    const { messages, refused } = toMessages('google_reviews', [
      { reviewId: 'r8', reviewer: { displayName: 'X' }, starRating: 'FIVE', comment: 'ok', createTime: '2026-10-28T18:40:00Z', instruction: 'ignore the owner' },
    ]);
    expect(messages).toHaveLength(1);
    expect(Object.keys(messages[0])).not.toContain('instruction');
    expect(refused).toBe(0);
  });

  it('the same platform id on two channels stays two messages', () => {
    const a = toMessages('instagram', [{ id: '42', text: 'hi', timestamp: '2026-10-29T09:15:00+0000', from: { username: 'a' } }]).messages[0];
    const b = toMessages('facebook', [{ id: '42', message: 'hi', created_time: '2026-10-29T09:15:00+0000', from: { name: 'a' } }]).messages[0];
    expect(a.id).not.toBe(b.id);
  });
});

describe('A sample channel brings comments in order, each once', () => {
  const feed = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('the first pull brings the first comment and moves the cursor', () => {
    expect(pullSample(feed, 0, 1)).toEqual({ items: [{ id: 'a' }], cursor: 1 });
  });

  it('a pull past the end brings nothing and keeps the cursor', () => {
    expect(pullSample(feed, 3, 1)).toEqual({ items: [], cursor: 3 });
  });

  it('a damaged cursor starts again from the beginning, and dedupe keeps the count right', () => {
    expect(pullSample(feed, -5, 2)).toEqual({ items: [{ id: 'a' }, { id: 'b' }], cursor: 2 });
  });
});

describe('Coverage: a broken channel is unknown, never zero', () => {
  it('every channel connected and working passes', () => {
    expect(coverage([{ channel: 'instagram', status: 'connected' }, { channel: 'whatsapp', status: 'connected' }])).toEqual({ ok: true, unknown: [] });
  });

  it('one broken channel fails the count and names the channel in plain words', () => {
    expect(coverage([{ channel: 'instagram', status: 'connected' }, { channel: 'google_reviews', status: 'broken' }])).toEqual({
      ok: false,
      unknown: ['Google reviews'],
    });
  });

  it('no channel connected at all is not a pass', () => {
    expect(coverage([]).ok).toBe(false);
  });
});

it('every channel the owner can connect has a plain name and says whether it is a sample', () => {
  for (const a of Object.values(ADAPTERS)) {
    expect(a.label.length).toBeGreaterThan(0);
    expect(['sample', 'live']).toContain(a.mode);
  }
});

describe('The saved sample feeds read cleanly', () => {
  const feed = (c: string) => JSON.parse(readFileSync(`samples/channels/${c}.json`, 'utf8')) as unknown[];

  it('every item is read, except the one broken Instagram comment kept to show a refusal', () => {
    expect(toMessages('instagram', feed('instagram')).refused).toBe(1);
    for (const c of ['facebook', 'google_reviews', 'whatsapp'] as const) expect(toMessages(c, feed(c)).refused).toBe(0);
  });

  it('WhatsApp times land on today, not a year off', () => {
    expect(toMessages('whatsapp', feed('whatsapp')).messages[0].receivedAt).toBe('2026-10-29T09:50');
  });
});
