// Many lead agents across many businesses on one Zernio budget, on a simulated clock: no network, no accounts, no keys.
// The gateway and the limiter are the real ones; only the provider is a stand in that takes a limiter slot and answers.
// Run: ~/Projects/swayu-app/node_modules/.bin/tsx scripts/simulate-leads.ts [businesses] [leadsPerBusiness]
import { readFileSync } from 'node:fs';
import { createGateway, type CallRequest } from '../src/gateway/gateway';
import { createLimiter } from '../src/gateway/limiter';
import { loadPolicies } from '../src/gateway/policy';

const BUSINESSES = Number(process.argv[2] ?? 125);
const LEADS = Number(process.argv[3] ?? 8);
const policies = loadPolicies(readFileSync('policies/connectors.cedar', 'utf8'), readFileSync('policies/connectors.cedarschema', 'utf8'));

/** `waitCeilingMs` is how long a call may wait for a slot before it is refused. Infinity means it waits in line. */
type Run = { scenario: string; perMinute: number; waitCeilingMs: number };

async function simulate(run: Run, work: (business: string, lead: number) => CallRequest) {
  // The simulated clock: sleep parks a timer, and the driver below jumps time to the next timer once nothing else can move.
  let clock = 0;
  const timers: { at: number; wake: () => void }[] = [];
  const sleep = (ms: number) => new Promise<void>(wake => { timers.push({ at: clock + ms, wake }); });
  const limiter = createLimiter({ name: 'Zernio', perMinute: run.perMinute, maxWaitMs: run.waitCeilingMs, now: () => clock, sleep });

  const sent: number[] = [];
  const provider = async (_channel: string, action: string) => {
    await limiter.take();
    sent.push(clock);
    return action === 'reply' ? { id: 'reply' } : [];
  };
  const gateway = createGateway({
    policies, routes: { 'instagram:read': 'zernio', 'instagram:reply': 'zernio' },
    providers: { zernio: provider, composio: provider, own: provider },
    askOwner: async () => 'approved', record: async () => {},
  });

  const calls: { business: string; ok: boolean; refused: boolean; doneAt: number }[] = [];
  const jobs = Array.from({ length: BUSINESSES }, (_, b) => `00000000-0000-4000-8000-${String(b + 1).padStart(12, '0')}`)
    .flatMap(business => Array.from({ length: LEADS }, (_, lead) => gateway.call(work(business, lead)).then(out => {
      calls.push({ business, ok: out.ok, refused: !out.ok && out.waitSeconds !== undefined, doneAt: clock });
    })));

  let finished = false;
  const all = Promise.all(jobs).then(() => { finished = true; });
  while (!finished) {
    await new Promise(r => setImmediate(r));
    if (finished || !timers.length) continue;
    timers.sort((a, b) => a.at - b.at);
    const next = timers.shift()!;
    clock = Math.max(clock, next.at);
    next.wake();
  }
  await all;

  const perSecond = new Map<number, number>();
  for (const at of sent) perSecond.set(Math.floor(at / 1000), (perSecond.get(Math.floor(at / 1000)) ?? 0) + 1);
  const okBusinesses = new Set(calls.filter(c => c.ok).map(c => c.business));
  return {
    scenario: run.scenario, perMinute: run.perMinute, waitCeiling: Number.isFinite(run.waitCeilingMs) ? `${run.waitCeilingMs / 1000} s` : 'waits in line',
    leads: calls.length,
    providerRequests: sent.length,
    succeeded: calls.filter(c => c.ok).length,
    refused: calls.filter(c => c.refused).length,
    businessesWithNothing: BUSINESSES - okBusinesses.size,
    peakPerSecond: Math.max(0, ...perSecond.values()),
    clearSeconds: Math.round(Math.max(0, ...calls.filter(c => c.ok).map(c => c.doneAt)) / 1000),
  };
}

const read = (business: string, lead: number): CallRequest => ({ tenant: business, lead: lead % 2 ? 'ads' : 'replies', channel: 'instagram', action: 'read', args: {} });
const reply = (business: string, lead: number): CallRequest => ({ tenant: business, lead: 'replies', channel: 'instagram', action: 'reply', args: { ref: `${business}:${lead}`, text: 'Thank you!' } });

const rows = [];
for (const [scenario, work] of [['every lead reads at once', read], ['every lead replies at once', reply]] as const) {
  for (const perMinute of [60, 600]) {
    for (const waitCeilingMs of [10_000, Infinity]) rows.push(await simulate({ scenario, perMinute, waitCeilingMs }, work));
  }
}
console.log(`${BUSINESSES} businesses x ${LEADS} leads = ${BUSINESSES * LEADS} lead agents, all starting in the same instant, simulated clock`);
console.table(rows);
console.log(JSON.stringify({ businesses: BUSINESSES, leadsPerBusiness: LEADS, rows }));
