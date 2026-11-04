// The one door between a lead agent and every connector provider.
// Order on every call: permission check, owner approval when asked, route to one provider, ledger row at each step.
import { decide, type Policies } from './policy';

export type ProviderName = 'composio' | 'zernio' | 'own';
export type Provider = (channel: string, action: string, args: Record<string, unknown>) => Promise<unknown>;
export type CallRequest = { lead: string; channel: string; action: string; args: Record<string, unknown> };
export type CallResult = { ok: true; provider: ProviderName; result: unknown } | { ok: false; reason: string };
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

const LABEL: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', whatsapp: 'WhatsApp', google_reviews: 'Google reviews' };
const PROVIDER_LABEL: Record<ProviderName, string> = { composio: 'Composio', zernio: 'Zernio', own: 'Swayu' };
const VERB: Record<string, string> = { read: 'read', reply: 'reply on' };
const ING: Record<string, string> = { read: 'reading', reply: 'replying on' };
const label = (channel: string) => LABEL[channel] ?? channel;

export function createGateway(deps: GatewayDeps) {
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
        const reason = `Swayu could not keep this reply for the owner: ${error instanceof Error ? error.message : 'unknown error'}`;
        await log(request, 'refused', { note: reason });
        return { ok: false, reason };
      }
      if (verdict === 'held') {
        await log(request, 'held');
        return { ok: false, reason: "Held for the owner's approval." };
      }
      await log(request, 'approved');
    }

    try {
      const result = await deps.providers[provider](channel, action, request.args);
      await log(request, 'done', { provider });
      return { ok: true, provider, result };
    } catch (error) {
      const reason = `${PROVIDER_LABEL[provider]} could not ${VERB[action] ?? action} ${label(channel)}: ${error instanceof Error ? error.message : 'unknown error'}`;
      await log(request, 'failed', { provider, note: reason });
      return { ok: false, reason };
    }
  }

  return { call };
}
