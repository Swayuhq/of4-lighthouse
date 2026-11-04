import { describe, expect, it, vi } from 'vitest';
import { createGateway } from '../src/gateway/gateway';
import { allowedTools, leadTools } from '../src/gateway/leads';
import { readFileSync } from 'node:fs';
import { loadPolicies } from '../src/gateway/policy';

const SCHEMA = readFileSync('policies/connectors.cedarschema', 'utf8');
const POLICIES = loadPolicies(readFileSync('policies/connectors.cedar', 'utf8'), SCHEMA);

describe('Each lead is handed only the tools its rules allow', () => {
  it('the replies lead can read and reply', () => {
    expect(allowedTools(POLICIES, 'replies').map(t => t.name)).toEqual(['facebook_read', 'facebook_reply', 'instagram_read', 'instagram_reply', 'google_reviews_read', 'google_reviews_reply', 'whatsapp_read', 'whatsapp_reply']);
  });

  it('the ads lead can read but has no reply tool at all', () => {
    expect(allowedTools(POLICIES, 'ads').map(t => t.name)).toEqual(['facebook_read', 'instagram_read']);
  });

  it('a lead with no rules has no tools', () => {
    expect(allowedTools(POLICIES, 'seo')).toEqual([]);
  });

  it('a tool call goes through the gateway, so the owner is still asked', async () => {
    const askOwner = vi.fn(async () => false);
    const provider = vi.fn(async () => ({ id: 'x' }));
    const gateway = createGateway({
      policies: POLICIES, routes: { 'facebook:reply': 'composio' }, providers: { composio: provider, zernio: provider, own: provider },
      askOwner, record: async () => {},
    });
    const tools = leadTools(POLICIES, 'replies', gateway);
    const execute = tools.facebook_reply.execute as (input: unknown, context: unknown) => Promise<unknown>;
    const out = await execute({ ref: 'c1', text: 'Thanks!' }, {});
    expect(askOwner).toHaveBeenCalledOnce();
    expect(provider).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: false, reason: 'The owner did not approve this.' });
  });
});
