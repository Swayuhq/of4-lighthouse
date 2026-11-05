import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composio, NotOffered, own, zernioProvider } from '../src/gateway/providers';

type Call = { url: string; init: RequestInit };
let calls: Call[];

function answer(routes: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const path = url.replace('https://zernio.com/api/v1', '');
    const key = Object.keys(routes).find(k => path.startsWith(k));
    if (!key) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  }));
}

beforeEach(() => { calls = []; process.env.SWAYU_ZERNIO_API_KEY = 'test-key'; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.SWAYU_ZERNIO_API_KEY; });

describe('Zernio comments read the same shape as Composio', () => {
  it('reads customer comments and skips the owner, ads and posts with none', async () => {
    answer({
      '/accounts': { accounts: [{ _id: 'acc1', platform: 'facebook' }] },
      '/inbox/comments?': { data: [
        { id: 'p1', platform: 'facebook', commentCount: 2 },
        { id: 'p2', platform: 'facebook', commentCount: 0 },
        { id: 'ad1:facebook', platform: 'facebook', isAd: true, commentCount: 5 },
      ] },
      '/inbox/comments/p1': { comments: [
        { id: 'c1', message: 'Open on Sunday?', createdTime: '2026-11-04T08:00:00Z', from: { name: 'Lee' } },
        { id: 'c2', message: 'Yes, 10 to 6', createdTime: '2026-11-04T08:05:00Z', from: { name: 'Our Page', isOwner: true } },
      ] },
    });
    const items = await zernioProvider('facebook', 'read', {});
    expect(items).toEqual([{ id: 'c1', ref: 'acc1|p1|c1', author: 'Lee', text: 'Open on Sunday?', at: '2026-11-04T08:00:00Z' }]);
    expect(calls.some(c => c.url.includes('/inbox/comments/p2'))).toBe(false);
    expect(calls.every(c => (c.init.headers as Record<string, string>).authorization === 'Bearer test-key')).toBe(true);
  });

  it('a comment the owner already answered on the platform says so, so it is not counted as waiting', async () => {
    answer({
      '/accounts': { accounts: [{ _id: 'acc1', platform: 'instagram' }] },
      '/inbox/comments?': { data: [{ id: 'p1', platform: 'instagram', commentCount: 2, permalink: 'https://www.instagram.com/p/X/' }] },
      '/inbox/comments/p1': { comments: [
        { id: 'c1', message: 'Open Sunday?', createdTime: '2026-11-04T08:00:00Z', from: { username: 'lee' }, replies: [{ id: 'r1', from: { username: 'shop', isOwner: true } }] },
        { id: 'c2', message: 'Price?', createdTime: '2026-11-04T08:01:00Z', from: { username: 'mei' }, replies: [{ id: 'r2', from: { username: 'ann' } }] },
      ] },
    });
    const items = await zernioProvider('instagram', 'read', {}) as { id: string; answered?: boolean; link?: string }[];
    expect(items.map(i => [i.id, i.answered ?? false])).toEqual([['c1', true], ['c2', false]]);
    expect(items[0].link).toBe('https://www.instagram.com/p/X/c/c1/');
  });

  it('a reply carries the account, the comment and a retry key', async () => {
    answer({ '/inbox/comments/p1': { success: true, data: { commentId: 'r9' } } });
    const out = await zernioProvider('facebook', 'reply', { ref: 'acc1|p1|c1', text: 'Thank you!', idempotencyKey: 'k1' });
    expect(out).toEqual({ id: 'r9' });
    const sent = calls[0];
    expect(sent.init.method).toBe('POST');
    expect(JSON.parse(String(sent.init.body))).toEqual({ accountId: 'acc1', commentId: 'c1', message: 'Thank you!' });
    expect((sent.init.headers as Record<string, string>)['Idempotency-Key']).toBe('k1');
  });

  it('a reply Zernio does not confirm is an error, never a success', async () => {
    answer({ '/inbox/comments/p1': { success: true } });
    await expect(zernioProvider('facebook', 'reply', { ref: 'acc1|p1|c1', text: 'Hi' })).rejects.toThrow('did not confirm');
  });

  it('no connected account says so', async () => {
    answer({ '/accounts': { accounts: [] } });
    await expect(zernioProvider('instagram', 'read', {})).rejects.toThrow('no Instagram account is connected in Zernio');
  });

  it('a missing key fails before any request', async () => {
    delete process.env.SWAYU_ZERNIO_API_KEY;
    answer({});
    await expect(zernioProvider('facebook', 'read', {})).rejects.toThrow('SWAYU_ZERNIO_API_KEY is not set');
    expect(calls).toHaveLength(0);
  });

  it('a channel Zernio does not cover is refused as not offered', async () => {
    await expect(zernioProvider('whatsapp', 'read', {})).rejects.toBeInstanceOf(NotOffered);
  });
});

describe('Zernio Google reviews', () => {
  it('reads unanswered Google reviews with stars, and replies to one', async () => {
    answer({
      '/accounts': { accounts: [{ _id: 'g1', platform: 'googlebusiness' }] },
      '/inbox/reviews?': { data: [
        { id: 'accounts/1/locations/2/reviews/3', platform: 'googlebusiness', accountId: 'g1', reviewer: { name: 'Sam' }, rating: 2, text: 'Cake arrived damaged', created: '2026-11-03T10:00:00Z' },
        { id: 'fbr1', platform: 'facebook', accountId: 'f1', reviewer: { name: 'Ana' }, rating: 5, text: 'Lovely', created: '2026-11-03T11:00:00Z' },
      ] },
      '/inbox/reviews/accounts': { status: 'ok', reply: { id: 'rep1' } },
    });
    const items = await zernioProvider('google_reviews', 'read', {});
    expect(items).toEqual([{ id: 'accounts/1/locations/2/reviews/3', ref: 'g1|accounts/1/locations/2/reviews/3', author: 'Sam', text: 'Cake arrived damaged', at: '2026-11-03T10:00:00Z', stars: 2 }]);
    const out = await zernioProvider('google_reviews', 'reply', { ref: 'g1|accounts/1/locations/2/reviews/3', text: 'Sorry, Sam.' });
    expect(out).toEqual({ id: 'rep1' });
    expect(calls.at(-1)!.url).toContain('/inbox/reviews/accounts%2F1%2Flocations%2F2%2Freviews%2F3/reply');
  });
});

describe('Unknown is never zero, and a reply finds its comment through any provider', () => {
  it('Google reviews with no Google profile connected fail instead of reading as zero reviews', async () => {
    answer({ '/accounts': { accounts: [{ _id: 'acc1', platform: 'facebook' }] }, '/inbox/reviews?': { data: [] } });
    await expect(zernioProvider('google_reviews', 'read', {})).rejects.toThrow('no Google Business Profile is connected');
    expect(calls.some(c => c.url.includes('/inbox/reviews'))).toBe(false);
  });

  it('Zernio refuses a comment another provider read, rather than posting somewhere wrong', async () => {
    answer({});
    await expect(zernioProvider('facebook', 'reply', { ref: '140_11', text: 'Hi' })).rejects.toThrow('read through another provider');
    expect(calls).toHaveLength(0);
  });

  it('Composio answers a Facebook comment Zernio read, using Meta\'s own comment id', async () => {
    process.env.SWAYU_COMPOSIO_API_KEY = 'test-key';
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).params.arguments.tools[0].arguments);
      const inner = { successful: true, data: { results: [{ response: { successful: true, data: { id: '11_99' } }, error: null }] } };
      return new Response(`data: ${JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify(inner) }] } })}\n`);
    }));
    expect(await composio('facebook', 'reply', { ref: 'acc1|140_1|1_11', text: 'Thanks!' })).toEqual({ id: '11_99' });
    expect(sent).toEqual([{ object_id: '11', message: 'Thanks!' }]);
  });

  it('WhatsApp is read by webhook only, so the own provider offers replies alone', async () => {
    await expect(own('whatsapp', 'read', {})).rejects.toBeInstanceOf(NotOffered);
    await expect(own('facebook', 'reply', { ref: 'x', text: 'y' })).rejects.toBeInstanceOf(NotOffered);
  });
});
