import { describe, expect, it, vi } from 'vitest';
import { createGateway, type GatewayDeps, type LedgerRow } from '../src/gateway/gateway';
import { decide, type Rule } from '../src/gateway/policy';

const RULES: Rule[] = [
  { lead: 'replies', channel: 'facebook', action: 'read', decision: 'allow' },
  { lead: 'replies', channel: 'facebook', action: 'reply', decision: 'ask' },
  { lead: 'ads', channel: 'facebook', action: 'read', decision: 'allow' },
  { lead: 'ads', channel: 'facebook', action: 'reply', decision: 'block' },
];

function setup(overrides: Partial<GatewayDeps> = {}) {
  const ledger: LedgerRow[] = [];
  const composio = vi.fn(async () => ({ id: 'fb_reply_1' }));
  const zernio = vi.fn(async () => ({ id: 'zn_reply_1' }));
  const deps: GatewayDeps = {
    rules: RULES,
    routes: { 'facebook:read': 'composio', 'facebook:reply': 'composio' },
    providers: { composio, zernio },
    askOwner: vi.fn(async () => true),
    record: async row => { ledger.push(row); },
    ...overrides,
  };
  return { gateway: createGateway(deps), deps, ledger, composio, zernio };
}

describe('The permission check decides before any provider is called', () => {
  it('nothing written in the rules is blocked', () => {
    expect(decide(RULES, 'replies', 'instagram', 'reply')).toBe('block');
    expect(decide(RULES, 'nobody', 'facebook', 'read')).toBe('block');
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

  it('the owner says no, so nothing is sent', async () => {
    const { gateway, composio, ledger } = setup({ askOwner: async () => false });
    const out = await gateway.call({ lead: 'replies', channel: 'facebook', action: 'reply', args: { id: 'c1', text: 'Thank you!' } });
    expect(out).toEqual({ ok: false, reason: 'The owner did not approve this.' });
    expect(composio).not.toHaveBeenCalled();
    expect(ledger.map(r => r.outcome)).toEqual(['declined']);
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
    const { gateway, ledger } = setup({ providers: { composio: async () => { throw new Error('rate limited'); }, zernio: async () => ({}) } });
    const out = await gateway.call({ lead: 'replies', channel: 'facebook', action: 'read', args: {} });
    expect(out).toEqual({ ok: false, reason: 'Composio could not read Facebook: rate limited' });
    expect(ledger[0]).toMatchObject({ outcome: 'failed', provider: 'composio' });
  });
});
