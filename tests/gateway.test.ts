import { describe, expect, it, vi } from 'vitest';
import { createGateway, type GatewayDeps, type LedgerRow } from '../src/gateway/gateway';
import { readFileSync } from 'node:fs';
import { decide, loadPolicies } from '../src/gateway/policy';

const SCHEMA = readFileSync('policies/connectors.cedarschema', 'utf8');
const POLICIES = loadPolicies(readFileSync('policies/connectors.cedar', 'utf8'), SCHEMA);

function setup(overrides: Partial<GatewayDeps> = {}) {
  const ledger: LedgerRow[] = [];
  const composio = vi.fn(async () => ({ id: 'fb_reply_1' }));
  const zernio = vi.fn(async () => ({ id: 'zn_reply_1' }));
  const deps: GatewayDeps = {
    policies: POLICIES,
    routes: { 'facebook:read': 'composio', 'facebook:reply': 'composio' },
    providers: { composio, zernio, own: vi.fn() },
    askOwner: vi.fn(async () => 'approved' as const),
    record: async row => { ledger.push(row); },
    ...overrides,
  };
  return { gateway: createGateway(deps), deps, ledger, composio, zernio };
}

describe('The permission check decides before any provider is called', () => {
  it('the policy file gives each lead what was agreed', () => {
    expect(decide(POLICIES, 'replies', 'facebook', 'read')).toBe('allow');
    expect(decide(POLICIES, 'replies', 'google_reviews', 'reply')).toBe('ask');
    expect(decide(POLICIES, 'ads', 'instagram', 'read')).toBe('allow');
  });

  it('anything not permitted is blocked: an unknown lead, a channel the ads lead lacks, an unknown action', () => {
    expect(decide(POLICIES, 'nobody', 'facebook', 'read')).toBe('block');
    expect(decide(POLICIES, 'ads', 'whatsapp', 'read')).toBe('block');
    expect(decide(POLICIES, 'replies', 'facebook', 'delete')).toBe('block');
  });

  it('a forbid beats a permit, even one added later by mistake', () => {
    const loose = loadPolicies(readFileSync('policies/connectors.cedar', 'utf8') + '\npermit (principal == Lead::"ads", action == Action::"reply", resource == Channel::"facebook");', SCHEMA);
    expect(decide(loose, 'ads', 'facebook', 'reply')).toBe('block');
  });

  it('a policy file Cedar cannot read stops the app instead of letting calls through', () => {
    expect(() => loadPolicies('permit (principal == Lead::"x", action', SCHEMA)).toThrow('The connector policy file is invalid');
  });

  it('a misspelled lead, channel or action stops startup instead of silently blocking', () => {
    const real = readFileSync('policies/connectors.cedar', 'utf8');
    expect(() => loadPolicies(real.replace('Lead::"ads"', 'Lead::"adz"'), SCHEMA)).toThrow('"adz"');
    expect(() => loadPolicies(real.replace('Channel::"instagram"', 'Channel::"instagarm"'), SCHEMA)).toThrow('"instagarm"');
    expect(() => loadPolicies(real.replace('Action::"reply"', 'Action::"replly"'), SCHEMA)).toThrow('replly');
  });

  it('a blocked call never reaches a provider and is recorded as refused', async () => {
    const { gateway, composio, zernio, ledger } = setup();
    const out = await gateway.call({ lead: 'ads', channel: 'facebook', action: 'reply', args: { id: 'c1', text: 'Hi' } });
    expect(out).toEqual({ ok: false, reason: 'The ads lead may not reply on Facebook.' });
    expect(composio).not.toHaveBeenCalled();
    expect(zernio).not.toHaveBeenCalled();
    expect(ledger).toEqual([expect.objectContaining({ lead: 'ads', channel: 'facebook', action: 'reply', outcome: 'refused' })]);
  });

  it('an allowed call goes to the provider the route table names', async () => {
    const { gateway, composio, zernio, ledger } = setup();
    const out = await gateway.call({ lead: 'replies', channel: 'facebook', action: 'read', args: {} });
    expect(out).toEqual({ ok: true, provider: 'composio', result: { id: 'fb_reply_1' } });
    expect(composio).toHaveBeenCalledWith('facebook', 'read', {});
    expect(zernio).not.toHaveBeenCalled();
    expect(ledger[0]).toMatchObject({ outcome: 'done', provider: 'composio' });
  });

  it('changing one route line moves the channel to the other provider', async () => {
    const { gateway, composio, zernio } = setup({ routes: { 'facebook:read': 'zernio' } });
    await gateway.call({ lead: 'replies', channel: 'facebook', action: 'read', args: {} });
    expect(zernio).toHaveBeenCalledOnce();
    expect(composio).not.toHaveBeenCalled();
  });
});

describe('A call that needs the owner waits for the owner', () => {
  it('the owner says yes, so the reply goes out', async () => {
    const { gateway, deps, composio, ledger } = setup();
    const out = await gateway.call({ lead: 'replies', channel: 'facebook', action: 'reply', args: { id: 'c1', text: 'Thank you!' } });
    expect(deps.askOwner).toHaveBeenCalledWith({ lead: 'replies', channel: 'facebook', action: 'reply', args: { id: 'c1', text: 'Thank you!' } });
    expect(composio).toHaveBeenCalledOnce();
    expect(out.ok).toBe(true);
    expect(ledger.map(r => r.outcome)).toEqual(['approved', 'done']);
  });

  it('a lead acting alone has its reply held for the owner, so nothing is sent', async () => {
    const { gateway, composio, ledger } = setup({ askOwner: async () => 'held' });
    const out = await gateway.call({ lead: 'replies', channel: 'facebook', action: 'reply', args: { id: 'c1', text: 'Thank you!' } });
    expect(out).toEqual({ ok: false, reason: "Held for the owner's approval." });
    expect(composio).not.toHaveBeenCalled();
    expect(ledger.map(r => r.outcome)).toEqual(['held']);
  });

  it('a reply that cannot be kept for the owner is refused in plain words and never sent', async () => {
    const { gateway, composio, ledger } = setup({ askOwner: async () => { throw new Error('no inbox message matches this comment'); } });
    const out = await gateway.call({ lead: 'replies', channel: 'facebook', action: 'reply', args: { id: 'c1', text: 'Thank you!' } });
    expect(out).toEqual({ ok: false, reason: 'Swayu could not keep this reply for the owner: no inbox message matches this comment' });
    expect(composio).not.toHaveBeenCalled();
    expect(ledger).toMatchObject([{ outcome: 'refused' }]);
  });
});

describe('Failures are recorded in plain words, never hidden', () => {
  it('an allowed call with no route is refused, not guessed', async () => {
    const { gateway, composio, zernio, ledger } = setup({ routes: {} });
    const out = await gateway.call({ lead: 'replies', channel: 'facebook', action: 'read', args: {} });
    expect(out).toEqual({ ok: false, reason: 'No provider is set for reading Facebook.' });
    expect(composio).not.toHaveBeenCalled();
    expect(zernio).not.toHaveBeenCalled();
    expect(ledger[0]).toMatchObject({ outcome: 'refused' });
  });

  it('a provider error is recorded as failed with the provider named', async () => {
    const { gateway, ledger } = setup({ providers: { composio: async () => { throw new Error('rate limited'); }, zernio: async () => ({}), own: vi.fn() } });
    const out = await gateway.call({ lead: 'replies', channel: 'facebook', action: 'read', args: {} });
    expect(out).toEqual({ ok: false, reason: 'Composio could not read Facebook: rate limited' });
    expect(ledger[0]).toMatchObject({ outcome: 'failed', provider: 'composio' });
  });
});
