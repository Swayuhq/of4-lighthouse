// Many lead agents reading the same channels at the same moment, on the real test accounts, through the real gateway.
// Read only: it never replies. Counts every request each provider received and every 429 it answered.
// Run with scripts/parallel.sh [leads] [channels] [--unshared]. --unshared gives each lead its own gateway, the way the
// app worked before reads were shared, to show what the same load does without sharing.
import { readFileSync } from 'node:fs';
import { createGateway, type CallResult, type LedgerRow } from '../src/gateway/gateway';
import { loadPolicies } from '../src/gateway/policy';
import { ROUTES } from '../src/gateway/setup';
import { composio, own, zernioProvider } from '../src/gateway/providers';

const args = process.argv.slice(2);
const unshared = args.includes('--unshared');
const [leads = 10, channelList = 'facebook,instagram'] = args.filter(a => !a.startsWith('--')) as [number?, string?];
const LEADS = Number(leads);
const CHANNELS = String(channelList).split(',');

// Count requests by host and status. URLs and keys are never printed.
const seen: Record<string, { requests: number; tooMany: number }> = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const host = new URL(String(input instanceof Request ? input.url : input)).host;
  const res = await realFetch(input, init);
  seen[host] ??= { requests: 0, tooMany: 0 };
  seen[host].requests++;
  if (res.status === 429) seen[host].tooMany++;
  return res;
};

const policies = loadPolicies(readFileSync('policies/connectors.cedar', 'utf8'), readFileSync('policies/connectors.cedarschema', 'utf8'));
const ledger: LedgerRow[] = [];
const make = () => createGateway({
  policies, routes: ROUTES, providers: { composio, zernio: zernioProvider, own },
  askOwner: async () => 'held', record: async row => { ledger.push(row); },
});
const shared = make();

const start = performance.now();
const jobs = CHANNELS.flatMap(channel => Array.from({ length: LEADS }, async (_, i) => {
  const t = performance.now();
  const out: CallResult = await (unshared ? make() : shared).call({ lead: 'replies', channel, action: 'read', args: {} });
  return { lead: i + 1, channel, ok: out.ok, items: out.ok ? (out.result as unknown[]).length : 0, ms: Math.round(performance.now() - t), waitSeconds: out.ok ? undefined : out.waitSeconds, note: out.ok ? '' : out.reason.slice(0, 90) };
}));
const rows = await Promise.all(jobs);
const totalMs = Math.round(performance.now() - start);

const summary = CHANNELS.map(channel => {
  const mine = rows.filter(r => r.channel === channel);
  return { channel, leads: mine.length, ok: mine.filter(r => r.ok).length, waited: mine.filter(r => r.waitSeconds !== undefined).length, failed: mine.filter(r => !r.ok && r.waitSeconds === undefined).length, items: mine.find(r => r.ok)?.items ?? 0, slowestMs: Math.max(...mine.map(r => r.ms)) };
});

console.log(`${unshared ? 'Unshared' : 'Shared'} reads, ${LEADS} leads per channel, ${totalMs} ms in all`);
console.table(summary);
console.table(seen);
const notes = [...new Set(rows.filter(r => !r.ok).map(r => r.note))];
if (notes.length) console.log('Reasons given:', notes);
console.log(JSON.stringify({ at: new Date().toISOString(), unshared, leads: LEADS, totalMs, summary, requests: seen, ledgerRows: ledger.length }));
