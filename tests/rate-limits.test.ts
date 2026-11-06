// A 429 from either provider: waited out once when short, refused at once when long, and the reply keeps its retry key.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLimiter, LIMITS, RateLimited } from '../src/gateway/limiter';
import { zernioProvider } from '../src/gateway/providers';
import { facebookReply } from '../src/composio';
import { TENANT } from '../src/tenant';

let calls: { url: string; init: RequestInit }[];
let slept: number[];

/** Answers each request with the next response in the list. */
function respond(...responses: (() => Response)[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('no answer left');
    return next();
  }));
}

const tooMany = (seconds: number) => () => new Response(JSON.stringify({ error: `Rate limit exceeded. Please retry after ${seconds} seconds.`, details: { retryAfterSeconds: seconds } }), { status: 429, headers: { 'retry-after': String(seconds) } });
const ok = (body: unknown, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(body), { status: 200, headers });
const accounts = ok({ accounts: [{ _id: 'acc1', platform: 'facebook' }] });

beforeEach(() => {
  calls = [];
  slept = [];
  let t = 0;
  const now = () => t;
  const sleep = async (ms: number) => { slept.push(ms); t += ms; };
  LIMITS.zernio = createLimiter({ name: 'Zernio', perMinute: 60, maxWaitMs: 10_000, now, sleep });
  LIMITS.composio = createLimiter({ name: 'Composio', perMinute: 2000, maxWaitMs: 10_000, now, sleep });
  process.env.SWAYU_ZERNIO_API_KEY = 'test-key';
  process.env.SWAYU_COMPOSIO_API_KEY = 'test-key';
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.SWAYU_ZERNIO_API_KEY; delete process.env.SWAYU_COMPOSIO_API_KEY; });

describe('Zernio says wait', () => {
  it('a short wait is waited out and the request is sent once more', async () => {
    respond(tooMany(2), accounts, ok({ data: [] }));
    await expect(zernioProvider('facebook', 'read', {}, TENANT)).resolves.toEqual([]);
    expect(slept).toEqual([2_000]);
    expect(calls).toHaveLength(3);
  });

  it('a long wait fails at once with the seconds, and the next read does not ask Zernio at all', async () => {
    respond(tooMany(58));
    const error = (await zernioProvider('facebook', 'read', {}, TENANT).catch(e => e)) as RateLimited;
    expect(error).toBeInstanceOf(RateLimited);
    expect(error.seconds).toBe(58);
    expect(calls).toHaveLength(1);
    await expect(zernioProvider('instagram', 'read', {}, TENANT)).rejects.toBeInstanceOf(RateLimited);
    expect(calls).toHaveLength(1);
  });

  it('a second 429 after the wait gives up rather than asking a third time', async () => {
    respond(tooMany(1), tooMany(1));
    await expect(zernioProvider('facebook', 'read', {}, TENANT)).rejects.toBeInstanceOf(RateLimited);
    expect(calls).toHaveLength(2);
  });

  it('a reply sent again after a wait carries the same retry key, so it cannot post twice', async () => {
    respond(tooMany(1), ok({ data: { commentId: 'r1' } }));
    await zernioProvider('facebook', 'reply', { ref: 'acc1|p1|c1', text: 'Thanks', idempotencyKey: 'k1' }, TENANT);
    const keys = calls.map(c => (c.init.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys).toEqual(['k1', 'k1']);
  });

  it('learns the real budget from the limit header', async () => {
    LIMITS.zernio = createLimiter({ name: 'Zernio', perMinute: 1, maxWaitMs: 0 });
    respond(ok({ accounts: [{ _id: 'acc1', platform: 'facebook' }] }, { 'x-ratelimit-limit': '600' }), ok({ data: [] }));
    await expect(zernioProvider('facebook', 'read', {}, TENANT)).resolves.toEqual([]);
  });
});

describe('Composio says wait', () => {
  it('a short wait is waited out once, then the reply goes through', async () => {
    const posted = { successful: true, data: { results: [{ response: { successful: true, data: { id: 'fb_r1' } }, error: null }] } };
    respond(
      () => new Response(JSON.stringify({ message: 'Rate limit exceeded' }), { status: 429, headers: { 'retry-after': '3' } }),
      () => new Response(`data: ${JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify(posted) }] } })}\n`),
    );
    await expect(facebookReply('1_2', 'Thanks')).resolves.toBe('fb_r1');
    expect(slept).toEqual([3_000]);
  });

  it('a long wait fails with the seconds', async () => {
    respond(() => new Response('{}', { status: 429, headers: { 'retry-after': '40' } }));
    const error = (await facebookReply('1_2', 'Thanks').catch(e => e)) as RateLimited;
    expect(error).toBeInstanceOf(RateLimited);
    expect(error.message).toBe('Composio asked Lighthouse to wait 40 seconds');
  });
});
