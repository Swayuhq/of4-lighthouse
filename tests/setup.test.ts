// The two doors of the shared gateway: the owner's Send is the owner's approval; a lead agent's reply is held.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => ({ calls: [] as { provider: string; channel: string; action: string }[], ledger: [] as Record<string, unknown>[] }));
vi.mock('../src/gateway/providers', () => {
  const make = (provider: string) => async (channel: string, action: string) => {
    sent.calls.push({ provider, channel, action });
    return action === 'read' ? [] : { id: 'r1' };
  };
  return { composio: make('composio'), zernioProvider: make('zernio'), own: make('own') };
});
vi.mock('../src/store/db', () => ({ saveCall: async (row: Record<string, unknown>) => { sent.ledger.push(row); } }));

import { leadGateway, ownerGateway, ROUTES } from '../src/gateway/setup';

beforeEach(() => { sent.calls = []; sent.ledger = []; });

describe('One gateway, two doors', () => {
  it('a lead agent reply is held for the owner and never reaches a provider', async () => {
    const out = await leadGateway().call({ lead: 'replies', channel: 'facebook', action: 'reply', args: { ref: '1_2', text: 'Hi' } });
    expect(out.ok).toBe(false);
    expect(sent.calls).toEqual([]);
    expect(sent.ledger).toMatchObject([{ lead: 'replies', channel: 'facebook', action: 'reply', outcome: 'declined' }]);
  });

  it('the owner pressing Send goes out through the routed provider, with a ledger row for the approval and the send', async () => {
    const out = await ownerGateway().call({ lead: 'replies', channel: 'facebook', action: 'reply', args: { ref: '1_2', text: 'Hi' } });
    expect(out).toMatchObject({ ok: true, provider: ROUTES['facebook:reply'] });
    expect(sent.calls).toEqual([{ provider: 'composio', channel: 'facebook', action: 'reply' }]);
    expect(sent.ledger.map(r => r.outcome)).toEqual(['approved', 'done']);
  });

  it('a read needs no approval and is routed by the table', async () => {
    await leadGateway().call({ lead: 'replies', channel: 'instagram', action: 'read', args: {} });
    expect(sent.calls).toEqual([{ provider: 'zernio', channel: 'instagram', action: 'read' }]);
  });

  it('the owner door does not widen the rules: the ads lead still may not reply', async () => {
    const out = await ownerGateway().call({ lead: 'ads', channel: 'facebook', action: 'reply', args: { ref: '1_2', text: 'Hi' } });
    expect(out.ok).toBe(false);
    expect(sent.calls).toEqual([]);
    expect(sent.ledger).toMatchObject([{ outcome: 'refused' }]);
  });

  it('every channel the replies lead may use has a provider for reading and replying, except WhatsApp reads by webhook', () => {
    for (const c of ['facebook', 'instagram', 'google_reviews']) {
      expect(ROUTES[`${c}:read`]).toBeDefined();
      expect(ROUTES[`${c}:reply`]).toBeDefined();
    }
    expect(ROUTES['whatsapp:reply']).toBe('own');
  });
});
