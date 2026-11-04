// One request budget per outside provider, shared by every lead and every open tab in this process.
// Zernio counts requests over a sliding minute (60 on the free tier, 600 from 3 connected accounts) and answers 429 with
// Retry-After; Composio counts per organisation per minute (2,000 on Hobby). Read from docs.zernio.com/guides/rate-limits
// and docs.composio.dev/reference/v3/rate-limits on 4 Nov 2026.

export class RateLimited extends Error {
  constructor(readonly provider: string, readonly seconds: number, message = `${provider} asked Lighthouse to wait ${seconds} seconds`) {
    super(message);
  }
}

type Options = {
  name: string;
  perMinute: number;
  /** The longest a caller waits for a slot. Past this it fails at once, so a blocked provider is not asked again. */
  maxWaitMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const WINDOW_MS = 60_000;

export function createLimiter({ name, perMinute, maxWaitMs, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) }: Options) {
  let limit = perMinute;
  let pausedUntil = 0;
  let taken: number[] = [];

  /** Waits for a free slot and takes it. The check and the take run with no await between them, so callers cannot race. */
  async function take(): Promise<void> {
    for (;;) {
      const t = now();
      taken = taken.filter(at => at > t - WINDOW_MS);
      let wait: number;
      if (pausedUntil > t) wait = pausedUntil - t;
      else if (taken.length < limit) { taken.push(t); return; }
      else wait = taken[0] + WINDOW_MS - t;
      if (wait > maxWaitMs) throw new RateLimited(name, Math.ceil(wait / 1000));
      await sleep(wait);
    }
  }

  /** The provider answered 429. Nobody asks it again until the wait is over. */
  function pause(seconds: number) {
    pausedUntil = Math.max(pausedUntil, now() + seconds * 1000);
  }

  /** The provider's own limit header. Anything that is not a positive number is ignored. */
  function learn(header: string | null) {
    const n = Number(header);
    if (header && Number.isInteger(n) && n > 0) limit = n;
  }

  return { take, pause, learn };
}

export type Limiter = ReturnType<typeof createLimiter>;

/** Starts at each provider's lowest published budget; the limit header on each answer raises it. */
export const LIMITS: Record<'zernio' | 'composio', Limiter> = {
  zernio: createLimiter({ name: 'Zernio', perMinute: 60, maxWaitMs: 10_000 }),
  composio: createLimiter({ name: 'Composio', perMinute: 2000, maxWaitMs: 10_000 }),
};

/** Seconds from a 429: the Retry-After header, else the body's own count, else one window. */
export function retryAfter(header: string | null, body?: { details?: { retryAfterSeconds?: number } }): number {
  const n = Number(header ?? body?.details?.retryAfterSeconds);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : 60;
}
