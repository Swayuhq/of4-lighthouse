// The one door between a lead agent and every connector provider.
// Order on every call: permission check, owner approval when asked, route to one provider, ledger row at each step.
import { decide, type Policies } from './policy';
import { RateLimited } from './limiter';

export type ProviderName = 'composio' | 'zernio' | 'own';
export type Provider = (channel: string, action: string, args: Record<string, unknown>) => Promise<unknown>;
export type CallRequest = { lead: string; channel: string; action: string; args: Record<string, unknown> };
/** `waitSeconds` means the provider asked us to slow down: the channel works, try again after that many seconds. */
export type CallResult = { ok: true; provider: ProviderName; result: unknown } | { ok: false; reason: string; waitSeconds?: number };
export type LedgerRow = CallRequest & { outcome: 'refused' | 'approved' | 'held' | 'done' | 'failed'; provider?: ProviderName; note?: string; at: string };

export type GatewayDeps = {
  policies: Policies;
  /** Key is "channel:action". One line moves a channel to another provider. */
  routes: Partial<Record<string, ProviderName>>;
  providers: Record<ProviderName, Provider>;
  /** The owner approved it, or it is kept for the owner to check. A throw means it could not be kept, so it is refused. */
  askOwner: (request: CallRequest) => Promise<'approved' | 'held'>;
  record: (row: LedgerRow) => Promise<void>;
};

const LABEL: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', whatsapp: 'WhatsApp', google_reviews: 'Google reviews', google_places: 'Google Maps places' };
const PROVIDER_LABEL: Record<ProviderName, string> = { composio: 'Composio', zernio: 'Zernio', own: 'Swayu' };
const VERB: Record<string, string> = { read: 'read', reply: 'reply on', read_all: 'read every review on' };
const ING: Record<string, string> = { read: 'reading', reply: 'replying on', read_all: 'reading every review on' };
const label = (channel: string) => LABEL[channel] ?? channel;

export function createGateway(deps: GatewayDeps) {
  // A read already on its way is shared by every lead that asks for the same one, so ten leads cost one read.
  // Only while it is in flight: a finished read is never served again. Replies are never shared.
  const reading = new Map<string, Promise<unknown>>();

  function send(provider: ProviderName, { channel, action, args }: CallRequest): Promise<unknown> {
    if (action !== 'read' && action !== 'read_all') return deps.providers[provider](channel, action, args);
    // The action is part of the key: the inbox read and the every review read must never answer each other.
    const key = `${provider}:${channel}:${action}:${JSON.stringify(args)}`;
    let read = reading.get(key);
    if (!read) {
      read = deps.providers[provider](channel, action, args).finally(() => reading.delete(key));
      reading.set(key, read);
    }
    return read;
  }

  async function log(request: CallRequest, outcome: LedgerRow['outcome'], extra: Partial<LedgerRow> = {}) {
    await deps.record({ ...request, outcome, ...extra, at: new Date().toISOString() });
  }

  async function call(request: CallRequest): Promise<CallResult> {
    const { lead, channel, action } = request;
    const decision = decide(deps.policies, lead, channel, action);

    if (decision === 'block') {
      const reason = `The ${lead} lead may not ${VERB[action] ?? action} ${label(channel)}.`;
      await log(request, 'refused', { note: reason });
      return { ok: false, reason };
    }

    const provider = deps.routes[`${channel}:${action}`];
    if (!provider) {
      const reason = `No provider is set for ${ING[action] ?? action} ${label(channel)}.`;
      await log(request, 'refused', { note: reason });
      return { ok: false, reason };
    }

    if (decision === 'ask') {
      let verdict: 'approved' | 'held';
      try {
        verdict = await deps.askOwner(request);
      } catch (error) {
        const reason = `The reply was not kept: ${error instanceof Error ? error.message : 'unknown error'}.`;
        await log(request, 'refused', { note: reason });
        return { ok: false, reason };
      }
      if (verdict === 'held') {
        await log(request, 'held');
        return { ok: false, reason: "Kept as a draft for the owner to check and send. This message is done: do not reply to it again." };
      }
      await log(request, 'approved');
    }

    try {
      const result = await send(provider, request);
      // A read that stopped before the end says so in the ledger, so nothing claims it read everything.
      const partial = (result as { complete?: unknown } | null)?.complete === false;
      await log(request, 'done', partial ? { provider, note: 'stopped early' } : { provider });
      return { ok: true, provider, result };
    } catch (error) {
      const reason = `${PROVIDER_LABEL[provider]} could not ${VERB[action] ?? action} ${label(channel)}: ${error instanceof Error ? error.message : 'unknown error'}`;
      await log(request, 'failed', { provider, note: reason });
      return error instanceof RateLimited ? { ok: false, reason, waitSeconds: error.seconds } : { ok: false, reason };
    }
  }

  return { call };
}
