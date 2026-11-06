// Zernio pushes new comments and reviews to Lighthouse. Shapes and the signature follow docs.zernio.com/webhooks and
// /webhooks/inbox, read 5 Nov 2026, and the ReviewWebhookReview model of the zernio crate on docs.rs.
// The database tests run against the local lighthouse_test database, never the demo one.
import { createHmac } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.LIGHTHOUSE_DB_NAME = 'lighthouse_test';
const ran: string[] = [];
vi.mock('next/server', async real => ({ ...(await real<typeof import('next/server')>()), after: () => { ran.push('after'); } }));

const { pushSignatureOk, readPush } = await import('../src/zernio-push');
const { receivePush } = await import('../src/pipeline');
const { connect, holdReply, load, markBroken, pushEvents, record, startOver, sweepHistory } = await import('../src/store/db');
const { POST } = await import('../app/api/webhooks/zernio/route');

const SECRET = 'zernio-secret';
const sign = (body: string, secret = SECRET) => createHmac('sha256', secret).update(body).digest('hex');

const comment = (over: Record<string, unknown> = {}, id = 'evt-1') => ({
  id, event: 'comment.received', timestamp: '2026-11-05T10:00:03Z',
  comment: {
    id: '17890001', postId: 'zp-1', platformPostId: 'ig-post-1', platform: 'instagram', text: 'Do you deliver to Park Street?',
    author: { id: 'u1', username: 'priya.k', name: 'Priya' }, createdAt: '2026-11-05T10:00:00Z', isReply: false, parentCommentId: null, ...over,
  },
  post: { id: 'zp-1', platformPostId: 'ig-post-1', content: null, imageUrl: null, permalink: 'https://www.instagram.com/p/abc/' },
  account: { id: 'acc-ig', platform: 'instagram', username: 'bakery' },
});

const review = (over: Record<string, unknown> = {}, id = 'evt-r1') => ({
  id, event: 'review.new', timestamp: '2026-11-05T11:00:05Z',
  review: { id: 'accounts/1/locations/2/reviews/3', platform: 'googlebusiness', rating: 2, text: 'Cake arrived crushed', reviewer: { id: null, name: 'Ravi' }, createdAt: '2026-11-05T11:00:00Z', hasReply: false, ...over },
  account: { id: 'acc-g', platform: 'googlebusiness', username: 'bakery' },
});

const post = (payload: unknown, headers: Record<string, string> = {}) => {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return POST(new Request('http://127.0.0.1/api/webhooks/zernio', { method: 'POST', body, headers: { 'x-zernio-signature': sign(body), ...headers } }));
};

describe('Checking that a push came from Zernio', () => {
  it('accepts the lowercase hex signature of the exact body', () => {
    const body = JSON.stringify(comment());
    expect(pushSignatureOk(body, sign(body), SECRET)).toBe(true);
  });

  it('refuses a changed body, a wrong secret, no header, no secret and a short header', () => {
    const body = JSON.stringify(comment());
    expect(pushSignatureOk(body.replace('Park', 'Lake'), sign(body), SECRET)).toBe(false);
    expect(pushSignatureOk(body, sign(body, 'other'), SECRET)).toBe(false);
    expect(pushSignatureOk(body, null, SECRET)).toBe(false);
    expect(pushSignatureOk(body, sign(body), undefined)).toBe(false);
    expect(pushSignatureOk(body, sign(body), '')).toBe(false);
    expect(pushSignatureOk(body, 'abc', SECRET)).toBe(false);
  });
});

describe('Reading a push', () => {
  it('a comment gets the same platform id a check would give it, so pushed and checked never count twice', () => {
    const p = readPush(comment());
    expect(p).toMatchObject({ eventId: 'evt-1', kind: 'comment.received', channel: 'instagram', test: false, sentAt: '2026-11-05T10:00:03Z' });
    expect(p?.item).toEqual({
      id: '17890001', ref: 'acc-ig|zp-1|17890001', author: 'Priya', text: 'Do you deliver to Park Street?', at: '2026-11-05T10:00:00Z',
      link: 'https://www.instagram.com/p/abc/c/17890001/',
    });
  });

  it('a comment on a post made outside Zernio replies through the platform post id', () => {
    expect(readPush(comment({ postId: null }))?.item?.ref).toBe('acc-ig|ig-post-1|17890001');
  });

  it("the owner's own comment is not a customer message", () => {
    const p = readPush(comment({ author: { id: 'me', name: 'Bakery', isOwnAccount: true } }));
    expect(p?.item).toBeNull();
    expect(p?.skip).toBe('own');
  });

  it('a platform Lighthouse does not read is kept as skipped, not stored', () => {
    expect(readPush(comment({ platform: 'tiktok' }))).toMatchObject({ channel: null, item: null, skip: 'platform' });
  });

  it('a Google review keeps its stars, and no rating is not zero stars', () => {
    expect(readPush(review())).toMatchObject({ channel: 'google_reviews', item: { id: 'accounts/1/locations/2/reviews/3', ref: 'acc-g|accounts/1/locations/2/reviews/3', author: 'Ravi', stars: 2, text: 'Cake arrived crushed' } });
    expect(readPush(review({ rating: 0 }))?.item?.stars).toBeUndefined();
    expect(readPush(review({ reviewer: { id: null, name: '' } }))?.item?.author).toBe('A Google user');
  });

  it('a review already answered on Google arrives as answered', () => {
    expect(readPush(review({ hasReply: true }))?.item?.answered).toBe(true);
  });

  it('a sample send from the Zernio dashboard is marked test', () => {
    expect(readPush({ ...comment(), test: true })?.test).toBe(true);
  });

  it('an event Lighthouse does not read is skipped; no event id or a malformed body is unreadable', () => {
    expect(readPush({ id: 'evt-9', event: 'post.published', timestamp: '2026-11-05T10:00:00Z' })).toMatchObject({ channel: null, item: null, skip: 'event' });
    expect(readPush({ event: 'comment.received' })).toBeNull();
    expect(readPush(null)).toBeNull();
    expect(readPush({ id: 'evt-2', event: 'comment.received', comment: { id: 5 } })).toMatchObject({ item: null, skip: 'shape' });
  });
});

describe('Storing a push', () => {
  beforeEach(async () => { await startOver(); ran.length = 0; });
  afterAll(() => startOver());

  it('a pushed comment lands in the inbox as waiting, and its event row holds times and ids, never the text', async () => {
    await connect('instagram');
    expect(await receivePush('zernio', readPush(comment())!)).toBe('stored');
    const { state } = await load();
    expect(state.messages.map(m => m.id)).toEqual(['instagram:17890001']);
    const [row] = await pushEvents();
    expect(row).toMatchObject({ provider: 'zernio', eventId: 'evt-1', kind: 'comment.received', channel: 'instagram', contentId: 'instagram:17890001', outcome: 'stored' });
    expect(row.sentAt?.toISOString()).toBe('2026-11-05T10:00:03.000Z');
    expect(JSON.stringify(row)).not.toContain('Park Street');
  });

  it('the same event delivered twice is dropped the second time', async () => {
    await connect('instagram');
    await receivePush('zernio', readPush(comment())!);
    expect(await receivePush('zernio', readPush(comment())!)).toBe('duplicate');
    expect(await pushEvents()).toHaveLength(1);
    expect((await load()).state.messages).toHaveLength(1);
  });

  it('two deliveries of one event at the same moment store it once', async () => {
    await connect('instagram');
    const out = await Promise.all([1, 2, 3].map(() => receivePush('zernio', readPush(comment())!)));
    expect(out.filter(o => o === 'stored')).toHaveLength(1);
    expect(out.filter(o => o === 'duplicate')).toHaveLength(2);
    expect((await load()).state.messages).toHaveLength(1);
  });

  it('a new event for a comment the check already read adds nothing', async () => {
    await connect('instagram');
    await receivePush('zernio', readPush(comment())!);
    expect(await receivePush('zernio', readPush(comment({}, 'evt-other'))!)).toBe('already had');
    expect((await load()).state.messages).toHaveLength(1);
  });

  it('a channel the owner has not connected, or that is broken, stores nothing', async () => {
    expect(await receivePush('zernio', readPush(comment())!)).toBe('not connected');
    await connect('instagram');
    await markBroken('instagram', 'down');
    expect(await receivePush('zernio', readPush(comment({}, 'evt-3'))!)).toBe('not connected');
    expect((await load()).state.messages).toHaveLength(0);
  });

  it('a test send, a skipped event and a refused shape are recorded and store nothing', async () => {
    await connect('instagram');
    expect(await receivePush('zernio', readPush({ ...comment(), test: true })!)).toBe('test');
    expect(await receivePush('zernio', readPush(comment({ platform: 'tiktok' }, 'evt-4'))!)).toBe('skipped');
    expect(await receivePush('zernio', readPush(comment({ text: 'x'.repeat(4001) }, 'evt-5'))!)).toBe('refused');
    expect((await load()).state.messages).toHaveLength(0);
    expect((await pushEvents()).map(e => e.outcome).sort()).toEqual(['refused', 'skipped', 'test']);
  });

  it('a review answered on Google before it reached Lighthouse counts as answered', async () => {
    await connect('google_reviews');
    await receivePush('zernio', readPush(review({ hasReply: true }))!);
    expect((await load()).state.status).toEqual({ 'google_reviews:accounts/1/locations/2/reviews/3': 'answered' });
  });
});

describe('A customer edits a review', () => {
  // Zernio, /webhooks/inbox, read 6 Nov 2026: review.updated has the same shape as review.new.
  const ID = 'google_reviews:accounts/1/locations/2/reviews/3';
  const edited = (over: Record<string, unknown> = {}, id = 'evt-r2') => ({ ...review(over, id), event: 'review.updated' });
  beforeEach(async () => { await startOver(); await connect('google_reviews'); });
  afterAll(() => startOver());

  it('is read like a new review', () => {
    expect(readPush(edited({ text: 'Cake arrived fine in the end', rating: 4 }))).toMatchObject({ channel: 'google_reviews', kind: 'review.updated', item: { text: 'Cake arrived fine in the end', stars: 4 } });
  });

  it('the owner sees the new words and stars, and the old draft goes so a new one is written', async () => {
    await receivePush('zernio', readPush(review())!);
    await holdReply(ID, 'So sorry the cake was crushed.');
    expect(await receivePush('zernio', readPush(edited({ text: 'Crushed and late. Never again.', rating: 1 }))!)).toBe('stored');
    const { state } = await load();
    expect(state.messages.find(m => m.id === ID)).toMatchObject({ text: 'Crushed and late. Never again.', stars: 1 });
    expect(state.drafts[ID]).toBeUndefined();
    expect(state.status[ID]).toBe('waiting');
  });

  it('an edit after the owner replied updates the words and keeps the reply', async () => {
    await receivePush('zernio', readPush(review())!);
    await record(ID, 'sent', 'So sorry.');
    expect(await receivePush('zernio', readPush(edited({ text: 'Thanks for the quick reply', rating: 4, hasReply: true }))!)).toBe('stored');
    const { state } = await load();
    expect(state.messages.find(m => m.id === ID)).toMatchObject({ text: 'Thanks for the quick reply', stars: 4 });
    expect(state.status[ID]).toBe('answered');
    expect(state.reply[ID]).toBe('So sorry.');
  });

  it('a reply made in the Google app, with the words unchanged, marks it answered and changes nothing else', async () => {
    await receivePush('zernio', readPush(review())!);
    expect(await receivePush('zernio', readPush(edited({ hasReply: true }))!)).toBe('already had');
    expect((await load()).state.status[ID]).toBe('answered');
  });

  it('a review whose words were swept after 30 days does not get them back', async () => {
    await receivePush('zernio', readPush(review())!);
    await record(ID, 'answered');
    await sweepHistory(new Date(Date.now() + 31 * 86_400_000));
    await receivePush('zernio', readPush(edited({ text: 'Edited much later' }))!);
    expect((await load()).state.messages.find(m => m.id === ID)?.text).toBe('');
  });
});

describe('The Zernio webhook', () => {
  beforeEach(async () => { await startOver(); ran.length = 0; process.env.SWAYU_ZERNIO_WEBHOOK_SECRET = SECRET; });

  it('answers 200 and reads the new message after answering, so Zernio is never kept past its 5 seconds', async () => {
    await connect('instagram');
    expect((await post(comment())).status).toBe(200);
    expect(ran).toEqual(['after']);
    expect((await load()).state.messages).toHaveLength(1);
  });

  it('answers 200 to a duplicate without starting the readers again', async () => {
    await connect('instagram');
    await post(comment());
    expect((await post(comment())).status).toBe(200);
    expect(ran).toEqual(['after']);
  });

  it('refuses an unsigned or wrongly signed push with 401 and stores nothing', async () => {
    await connect('instagram');
    expect((await post(comment(), { 'x-zernio-signature': '' })).status).toBe(401);
    expect((await post(comment(), { 'x-zernio-signature': sign('other') })).status).toBe(401);
    expect(await pushEvents()).toHaveLength(0);
  });

  it('refuses every push while no secret is set', async () => {
    delete process.env.SWAYU_ZERNIO_WEBHOOK_SECRET;
    expect((await post(comment())).status).toBe(401);
  });

  it('accepts the older X-Late-Signature header', async () => {
    await connect('instagram');
    const body = JSON.stringify(comment());
    const res = await POST(new Request('http://127.0.0.1/api/webhooks/zernio', { method: 'POST', body, headers: { 'x-late-signature': sign(body) } }));
    expect(res.status).toBe(200);
  });

  it('answers 400 to signed text that is not a readable event, and 413 to an oversized body', async () => {
    expect((await post('not json')).status).toBe(400);
    expect((await post({ event: 'comment.received' })).status).toBe(400);
    expect((await post({ ...comment(), pad: 'x'.repeat(300_000) })).status).toBe(413);
  });
});
