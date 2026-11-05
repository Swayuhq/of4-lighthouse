import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { zernioProvider, MAX_REVIEW_PAGES, type ReviewSet } from '../src/gateway/providers';
import { allowedTools } from '../src/gateway/leads';
import { decide, loadPolicies } from '../src/gateway/policy';
import { sentence } from '../src/activity';

const SCHEMA = readFileSync('policies/connectors.cedarschema', 'utf8');
const POLICIES = loadPolicies(readFileSync('policies/connectors.cedar', 'utf8'), SCHEMA);

let urls: string[];
const review = (id: string, over: Record<string, unknown> = {}) => ({
  id, reviewer: { displayName: `Customer ${id}`, isAnonymous: false }, rating: 4, comment: `Review ${id}`, createTime: '2026-10-01T10:00:00Z', reviewReply: null, ...over,
});

/** Answers the Zernio account list, then one reviews page per page token. */
function pages(byToken: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    if (url.includes('/accounts?platform=')) return new Response(JSON.stringify({ accounts: [{ _id: 'gbp1', platform: 'googlebusiness' }] }));
    const token = new URL(url).searchParams.get('pageToken') ?? '';
    const body = byToken[token];
    return body ? new Response(JSON.stringify(body)) : new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  }));
}

beforeEach(() => { urls = []; process.env.SWAYU_ZERNIO_API_KEY = 'test-key'; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.SWAYU_ZERNIO_API_KEY; });

describe('The analytics lead may read every one of the owner\'s reviews, and never answer one', () => {
  it('reads all reviews, cannot reply, and cannot use the inbox read', () => {
    expect(decide(POLICIES, 'analytics', 'google_reviews', 'read_all')).toBe('allow');
    expect(decide(POLICIES, 'analytics', 'google_reviews', 'reply')).toBe('block');
    expect(decide(POLICIES, 'analytics', 'google_reviews', 'read')).toBe('block');
  });

  it('the other leads cannot read every review', () => {
    expect(decide(POLICIES, 'replies', 'google_reviews', 'read_all')).toBe('block');
    expect(decide(POLICIES, 'ads', 'google_reviews', 'read_all')).toBe('block');
  });

  it('the analytics lead has two tools: the places search and every owner review', () => {
    expect(allowedTools(POLICIES, 'analytics').map(t => t.name)).toEqual(['google_reviews_read_all', 'google_places_read']);
  });
});

describe('Every review, page by page', () => {
  it('follows the page token to the end and keeps the total and average Google reports', async () => {
    pages({
      '': { reviews: [review('r1'), review('r2', { reviewReply: { comment: 'Thanks!' } })], averageRating: 4.3, totalReviewCount: 3, nextPageToken: 'p2' },
      p2: { reviews: [review('r3', { comment: undefined, rating: 5 })], averageRating: 4.3, totalReviewCount: 3, nextPageToken: null },
    });
    const set = (await zernioProvider('google_reviews', 'read_all', {})) as ReviewSet;
    expect(set.total).toBe(3);
    expect(set.average).toBe(4.3);
    expect(set.complete).toBe(true);
    expect(set.reviews.map(r => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(set.reviews[0]).toEqual({ id: 'r1', ref: 'gbp1|r1', author: 'Customer r1', text: 'Review r1', at: '2026-10-01T10:00:00Z', stars: 4 });
    expect(set.reviews[1].answered).toBe(true);
    // A star only review is still a review: it counts, with empty text.
    expect(set.reviews[2]).toMatchObject({ text: '', stars: 5 });
    const reads = urls.filter(u => u.includes('/gmb-reviews'));
    expect(reads).toHaveLength(2);
    expect(reads.every(u => u.includes('/accounts/gbp1/gmb-reviews') && u.includes('pageSize=50'))).toBe(true);
  });

  it('an anonymous reviewer is not given a made up name', async () => {
    pages({ '': { reviews: [review('r1', { reviewer: { isAnonymous: true } })], totalReviewCount: 1, nextPageToken: null } });
    const set = (await zernioProvider('google_reviews', 'read_all', {})) as ReviewSet;
    expect(set.reviews[0].author).toBe('A Google user');
  });

  it('stops at the page limit and says the set is not complete', async () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_REVIEW_PAGES + 5; i++) many[i === 0 ? '' : `t${i}`] = { reviews: [review(`r${i}`)], totalReviewCount: 999, nextPageToken: `t${i + 1}` };
    pages(many);
    const set = (await zernioProvider('google_reviews', 'read_all', {})) as ReviewSet;
    expect(urls.filter(u => u.includes('/gmb-reviews'))).toHaveLength(MAX_REVIEW_PAGES);
    expect(set.complete).toBe(false);
  });

  it('a page token that repeats ends the read instead of looping', async () => {
    pages({ '': { reviews: [review('r1')], totalReviewCount: 2, nextPageToken: 'same' }, same: { reviews: [review('r2')], totalReviewCount: 2, nextPageToken: 'same' } });
    const set = (await zernioProvider('google_reviews', 'read_all', {})) as ReviewSet;
    expect(urls.filter(u => u.includes('/gmb-reviews'))).toHaveLength(2);
    expect(set.complete).toBe(false);
  });

  it('a review seen on two pages is kept once', async () => {
    pages({
      '': { reviews: [review('r1'), review('r2')], totalReviewCount: 2, nextPageToken: 'p2' },
      p2: { reviews: [review('r2')], totalReviewCount: 2, nextPageToken: null },
    });
    const set = (await zernioProvider('google_reviews', 'read_all', {})) as ReviewSet;
    expect(set.reviews.map(r => r.id)).toEqual(['r1', 'r2']);
  });

  it('with no Google profile connected the read fails, so no reviews never reads as zero reviews', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ accounts: [] }))));
    await expect(zernioProvider('google_reviews', 'read_all', {})).rejects.toThrow('no Google Business Profile is connected');
  });
});

describe('The activity list', () => {
  it('says every review was read, in plain words', () => {
    expect(sentence({ id: 1, lead: 'analytics', channel: 'google_reviews', action: 'read_all', outcome: 'done', provider: 'zernio', note: null, at: new Date() }))
      .toBe('Read all your Google reviews through Zernio.');
  });
});

describe('Verifier findings, round 2', () => {
  it('the inbox read and the every review read in flight at once are never shared', async () => {
    const { createGateway } = await import('../src/gateway/gateway');
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const calls: string[] = [];
    const zernio = async (_channel: string, action: string) => { calls.push(action); await gate; return action === 'read_all' ? { complete: true, reviews: [] } : []; };
    const unused = async () => { throw new Error('not this provider'); };
    const gateway = createGateway({
      policies: POLICIES, routes: { 'google_reviews:read': 'zernio', 'google_reviews:read_all': 'zernio' },
      providers: { composio: unused, zernio, own: unused }, askOwner: async () => 'approved', record: async () => {},
    });
    const inbox = gateway.call({ lead: 'replies', channel: 'google_reviews', action: 'read', args: {} });
    const all = gateway.call({ lead: 'analytics', channel: 'google_reviews', action: 'read_all', args: {} });
    release();
    const [a, b] = await Promise.all([inbox, all]);
    expect(calls.sort()).toEqual(['read', 'read_all']);
    expect(a.ok && Array.isArray(a.result)).toBe(true);
    expect(b.ok && !Array.isArray(b.result)).toBe(true);
  });

  it('an empty page token means the last page', async () => {
    pages({ '': { reviews: [review('r1')], totalReviewCount: 1, nextPageToken: '' } });
    const set = (await zernioProvider('google_reviews', 'read_all', {})) as ReviewSet;
    expect(urls.filter(u => u.includes('/gmb-reviews'))).toHaveLength(1);
    expect(set.complete).toBe(true);
  });

  it('a rating of 0 means Google sent none, so it is left out, not counted as zero stars', async () => {
    pages({ '': { reviews: [review('r1', { rating: 0 })], totalReviewCount: 1, nextPageToken: null } });
    const set = (await zernioProvider('google_reviews', 'read_all', {})) as ReviewSet;
    expect(set.reviews[0].stars).toBeUndefined();
  });

  it('no Google profile connected reads in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ accounts: [] }))));
    await expect(zernioProvider('google_reviews', 'read_all', {})).rejects.toThrow('no Google Business Profile is connected');
  });
});
