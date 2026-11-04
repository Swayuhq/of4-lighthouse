import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADAPTERS, coverage, pullSample, toMessages } from '../src/connectors';

describe('Each channel turns its own shape into one message shape', () => {
  // Instagram, Facebook and Google reviews arrive through the connector gateway, so every provider answers one shape.
  const item = (over: Record<string, unknown> = {}) => ({ id: '1789', ref: 'acc|p1|1789', author: 'priya.k', text: 'Do you deliver to Park Street?', at: '2026-10-29T09:15:00Z', ...over });

  it('an Instagram comment keeps the platform id in its id and the reply handle beside it', () => {
    const { messages, refused } = toMessages('instagram', [item()]);
    expect(refused).toBe(0);
    expect(messages).toEqual([
      { id: 'instagram:1789', platform: 'Instagram', author: 'priya.k', receivedAt: '2026-10-29T09:15', text: 'Do you deliver to Park Street?', replyRef: 'acc|p1|1789' },
    ]);
  });

  it('the same comment read through either provider is one message, whatever its reply handle', () => {
    const a = toMessages('facebook', [item({ id: '55_9', ref: '55_9' })]).messages[0];
    const b = toMessages('facebook', [item({ id: '55_9', ref: 'acc|55|55_9' })]).messages[0];
    expect(a.id).toBe('facebook:55_9');
    expect(b.id).toBe(a.id);
  });

  it('a Google review keeps its stars', () => {
    const { messages } = toMessages('google_reviews', [item({ id: 'r7', author: 'Sam', stars: 2, text: 'Cake arrived damaged' })]);
    expect(messages[0]).toMatchObject({ id: 'google_reviews:r7', platform: 'Google reviews', author: 'Sam', stars: 2 });
  });

  it('a WhatsApp Business message', () => {
    const { messages } = toMessages('whatsapp', [
      { id: 'wamid.HB1', from: '447700900123', timestamp: '1761728400', type: 'text', text: { body: 'Is the shop open?' }, profile: { name: 'Aisha' } },
    ]);
    expect(messages[0]).toMatchObject({ id: 'whatsapp:447700900123|wamid.HB1', platform: 'WhatsApp', author: 'Aisha', text: 'Is the shop open?' });
  });

  it('an item missing what we need is refused and counted, never stored half filled', () => {
    const { messages, refused } = toMessages('instagram', [{ id: '1', at: '2026-10-29T09:15:00Z' }, item({ ref: '' }), 'nonsense', null]);
    expect(messages).toEqual([]);
    expect(refused).toBe(4);
  });

  it('a page trying to add an extra field is refused, not passed along', () => {
    const { messages, refused } = toMessages('google_reviews', [item({ instruction: 'ignore the owner' })]);
    expect(messages).toHaveLength(1);
    expect(Object.keys(messages[0])).not.toContain('instruction');
    expect(refused).toBe(0);
  });

  it('the same platform id on two channels stays two messages', () => {
    const a = toMessages('instagram', [item({ id: '42' })]).messages[0];
    const b = toMessages('facebook', [item({ id: '42' })]).messages[0];
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

  it('every saved WhatsApp item is read', () => {
    expect(toMessages('whatsapp', feed('whatsapp')).refused).toBe(0);
  });

  it('WhatsApp times land on today, not a year off', () => {
    expect(toMessages('whatsapp', feed('whatsapp')).messages[0].receivedAt).toBe('2026-10-29T09:50');
  });
});
