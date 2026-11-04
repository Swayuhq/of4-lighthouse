import { describe, expect, it, vi } from 'vitest';
import { createGateway } from '../src/gateway/gateway';
import { allowedTools, leadTools } from '../src/gateway/leads';
import type { Rule } from '../src/gateway/policy';

const RULES: Rule[] = [
  { lead: 'replies', channel: 'facebook', action: 'read', decision: 'allow' },
  { lead: 'replies', channel: 'facebook', action: 'reply', decision: 'ask' },
  { lead: 'ads', channel: 'facebook', action: 'read', decision: 'allow' },
  { lead: 'ads', channel: 'facebook', action: 'reply', decision: 'block' },
];

describe('Each lead is handed only the tools its rules allow', () => {
  it('the replies lead can read and reply', () => {
    expect(allowedTools(RULES, 'replies').map(t => t.name)).toEqual(['facebook_read', 'facebook_reply']);
  });

  it('the ads lead can read but has no reply tool at all', () => {
    expect(allowedTools(RULES, 'ads').map(t => t.name)).toEqual(['facebook_read']);
  });

  it('a lead with no rules has no tools', () => {
    expect(allowedTools(RULES, 'seo')).toEqual([]);
  });

  it('a tool call goes through the gateway, so the owner is still asked', async () => {
    const askOwner = vi.fn(async () => false);
    const provider = vi.fn(async () => ({ id: 'x' }));
    const gateway = createGateway({
      rules: RULES, routes: { 'facebook:reply': 'composio' }, providers: { composio: provider, zernio: provider },
      askOwner, record: async () => {},
    });
    const tools = leadTools(RULES, 'replies', gateway);
    const execute = tools.facebook_reply.execute as (input: unknown, context: unknown) => Promise<unknown>;
    const out = await execute({ ref: 'c1', text: 'Thanks!' }, {});
    expect(askOwner).toHaveBeenCalledOnce();
    expect(provider).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: false, reason: 'The owner did not approve this.' });
  });
});
