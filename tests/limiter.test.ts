import { describe, expect, it } from 'vitest';
import { createLimiter, RateLimited } from '../src/gateway/limiter';

/** A clock that only moves when a caller sleeps, so every wait is exact and instant. */
function clock() {
  let t = 1_000_000;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => { slept.push(ms); t += ms; },
    advance: (ms: number) => { t += ms; },
    slept,
  };
}

describe('Each provider gets its own request budget over a sliding minute', () => {
  it('lets the budget through at once, then waits for the oldest slot to free', async () => {
    const c = clock();
    const limit = createLimiter({ name: 'Zernio', perMinute: 3, maxWaitMs: 60_000, now: c.now, sleep: c.sleep });
    await limit.take(); c.advance(1_000);
    await limit.take(); await limit.take();
    expect(c.slept).toEqual([]);
    await limit.take();
    // The first slot was taken 1 second before the clock moved on, so it frees 59 seconds from now.
    expect(c.slept).toEqual([59_000]);
  });

  it('a wait longer than the caller may wait fails at once, with the seconds, and takes no slot', async () => {
    const c = clock();
    const limit = createLimiter({ name: 'Zernio', perMinute: 2, maxWaitMs: 10_000, now: c.now, sleep: c.sleep });
    await limit.take(); await limit.take();
    const error = await limit.take().catch(e => e);
    expect(error).toBeInstanceOf(RateLimited);
    expect(error.seconds).toBe(60);
    expect(error.message).toBe('Zernio asked Lighthouse to wait 60 seconds');
    expect(c.slept).toEqual([]);
  });

  it('many callers at once never take more than the budget', async () => {
    const c = clock();
    const limit = createLimiter({ name: 'Zernio', perMinute: 5, maxWaitMs: 0, now: c.now, sleep: c.sleep });
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => limit.take()));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(7);
  });
});

describe('A 429 pauses the whole provider, not just the one call', () => {
  it('a long pause makes every later caller fail at once without asking the provider', async () => {
    const c = clock();
    const limit = createLimiter({ name: 'Zernio', perMinute: 60, maxWaitMs: 10_000, now: c.now, sleep: c.sleep });
    limit.pause(58);
    const error = await limit.take().catch(e => e);
    expect(error).toBeInstanceOf(RateLimited);
    expect(error.seconds).toBe(58);
    c.advance(58_000);
    await expect(limit.take()).resolves.toBeUndefined();
  });

  it('a short pause is waited out', async () => {
    const c = clock();
    const limit = createLimiter({ name: 'Zernio', perMinute: 60, maxWaitMs: 10_000, now: c.now, sleep: c.sleep });
    limit.pause(3);
    await limit.take();
    expect(c.slept).toEqual([3_000]);
  });

  it('a shorter pause never cuts a longer one short', async () => {
    const c = clock();
    const limit = createLimiter({ name: 'Zernio', perMinute: 60, maxWaitMs: 0, now: c.now, sleep: c.sleep });
    limit.pause(30);
    limit.pause(2);
    expect((await limit.take().catch(e => e)).seconds).toBe(30);
  });
});

describe('The provider tells us its real budget', () => {
  it('takes the limit from the provider header, and ignores a header that is not a positive number', async () => {
    const c = clock();
    const limit = createLimiter({ name: 'Zernio', perMinute: 2, maxWaitMs: 0, now: c.now, sleep: c.sleep });
    limit.learn('abc');
    limit.learn('0');
    limit.learn(null);
    await limit.take(); await limit.take();
    await expect(limit.take()).rejects.toBeInstanceOf(RateLimited);
    limit.learn('600');
    await expect(limit.take()).resolves.toBeUndefined();
  });
});
