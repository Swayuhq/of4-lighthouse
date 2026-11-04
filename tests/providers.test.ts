import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotOffered, zernioProvider } from '../src/gateway/providers';

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
    expect(items).toEqual([{ ref: 'acc1|p1|c1', author: 'Lee', text: 'Open on Sunday?', at: '2026-11-04T08:00:00Z' }]);
    expect(calls.some(c => c.url.includes('/inbox/comments/p2'))).toBe(false);
    expect(calls.every(c => (c.init.headers as Record<string, string>).authorization === 'Bearer test-key')).toBe(true);
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
    await expect(zernioProvider('instagram', 'read', {})).rejects.toThrow('no instagram account is connected in Zernio');
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
      '/inbox/reviews?': { data: [
        { id: 'accounts/1/locations/2/reviews/3', platform: 'googlebusiness', accountId: 'g1', reviewer: { name: 'Sam' }, rating: 2, text: 'Cake arrived damaged', created: '2026-11-03T10:00:00Z' },
        { id: 'fbr1', platform: 'facebook', accountId: 'f1', reviewer: { name: 'Ana' }, rating: 5, text: 'Lovely', created: '2026-11-03T11:00:00Z' },
      ] },
      '/inbox/reviews/accounts': { status: 'ok', reply: { id: 'rep1' } },
    });
    const items = await zernioProvider('google_reviews', 'read', {});
    expect(items).toEqual([{ ref: 'g1|accounts/1/locations/2/reviews/3', author: 'Sam', text: 'Cake arrived damaged', at: '2026-11-03T10:00:00Z', stars: 2 }]);
    const out = await zernioProvider('google_reviews', 'reply', { ref: 'g1|accounts/1/locations/2/reviews/3', text: 'Sorry, Sam.' });
    expect(out).toEqual({ id: 'rep1' });
    expect(calls.at(-1)!.url).toContain('/inbox/reviews/accounts%2F1%2Flocations%2F2%2Freviews%2F3/reply');
  });
});
