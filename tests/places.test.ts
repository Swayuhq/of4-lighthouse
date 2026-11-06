import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGateway, type LedgerRow } from '../src/gateway/gateway';
import { allowedTools, leadTools } from '../src/gateway/leads';
import { decide, loadPolicies } from '../src/gateway/policy';
import { own } from '../src/gateway/providers';
import { MAX_PLACES, MAX_REVIEWS, type Place } from '../src/gateway/places';
import { sentence } from '../src/activity';
import { TENANT } from '../src/tenant';

const SCHEMA = readFileSync('policies/connectors.cedarschema', 'utf8');
const POLICIES = loadPolicies(readFileSync('policies/connectors.cedar', 'utf8'), SCHEMA);

function setup() {
  const ledger: LedgerRow[] = [];
  const unused = async () => { throw new Error('not this provider'); };
  const gateway = createGateway({
    policies: POLICIES, routes: { 'google_places:read': 'own' }, providers: { composio: unused, zernio: unused, own },
    askOwner: async () => 'approved', record: async row => { ledger.push(row); },
  });
  return { gateway, ledger };
}

describe('The analytics lead reads Google Maps places and nothing else', () => {
  it('may read places, may never send anything, and may not touch customer channels', () => {
    expect(decide(POLICIES, 'analytics', 'google_places', 'read')).toBe('allow');
    expect(decide(POLICIES, 'analytics', 'google_places', 'reply')).toBe('block');
    for (const channel of ['facebook', 'instagram', 'google_reviews', 'whatsapp']) {
      expect(decide(POLICIES, 'analytics', channel, 'read')).toBe('block');
      expect(decide(POLICIES, 'analytics', channel, 'reply')).toBe('block');
    }
  });

  it('a send stays blocked even if someone later adds a permit by mistake', () => {
    const loose = loadPolicies(readFileSync('policies/connectors.cedar', 'utf8') + '\npermit (principal == Lead::"analytics", action == Action::"reply", resource == Channel::"facebook");', SCHEMA);
    expect(decide(loose, 'analytics', 'facebook', 'reply')).toBe('block');
  });

  it('the other leads cannot read places', () => {
    expect(decide(POLICIES, 'replies', 'google_places', 'read')).toBe('block');
    expect(decide(POLICIES, 'ads', 'google_places', 'read')).toBe('block');
  });

  it('the analytics lead is handed the places read', () => {
    expect(allowedTools(POLICIES, 'analytics').map(t => t.name)).toContain('google_places_read');
  });
});

describe('The places read takes one search phrase', () => {
  const tool = leadTools(POLICIES, { tenant: TENANT, lead: 'analytics' }, setup().gateway).google_places_read;
  const schema = tool.inputSchema as unknown as { safeParse: (v: unknown) => { success: boolean } };

  it('accepts a phrase and an optional area', () => {
    expect(schema.safeParse({ query: 'millet restaurant' }).success).toBe(true);
    expect(schema.safeParse({ query: 'sweets shop', near: 'Saibaba Colony, Coimbatore' }).success).toBe(true);
  });

  it('refuses an empty phrase, an oversized one, and any field it does not know', () => {
    expect(schema.safeParse({ query: '' }).success).toBe(false);
    expect(schema.safeParse({ query: 'x'.repeat(201) }).success).toBe(false);
    expect(schema.safeParse({ query: 'sweets shop', limit: 500 }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });
});

describe('The stub returns the agreed place shape', () => {
  it('ranks places for the phrase, in map order, with at most 5 reviews each', async () => {
    const { gateway, ledger } = setup();
    const out = await gateway.call({ tenant: TENANT, lead: 'analytics', channel: 'google_places', action: 'read', args: { query: 'millet restaurant', near: 'Coimbatore' } });
    if (!out.ok) throw new Error(out.reason);
    const places = out.result as Place[];
    expect(places.length).toBeGreaterThan(0);
    expect(places.length).toBeLessThanOrEqual(MAX_PLACES);
    expect(places.map(p => p.rank)).toEqual(places.map((_, i) => i + 1));
    for (const p of places) {
      expect(p.query).toBe('millet restaurant');
      expect(p.placeId).toMatch(/^stub_/);
      expect(p.reviews?.length ?? 0).toBeLessThanOrEqual(MAX_REVIEWS);
      if (p.mapsLink) expect(new URL(p.mapsLink).hostname).toBe('www.google.com');
      if (p.rating !== undefined) expect(p.rating).toBeGreaterThanOrEqual(1);
      if (p.rating !== undefined) expect(p.rating).toBeLessThanOrEqual(5);
    }
    expect(ledger.map(r => [r.outcome, r.provider])).toEqual([['done', 'own']]);
  });

  it('a different phrase gives the same places in a different order, so ranking code sees real movement', async () => {
    const { gateway } = setup();
    const read = async (query: string) => {
      const out = await gateway.call({ tenant: TENANT, lead: 'analytics', channel: 'google_places', action: 'read', args: { query } });
      if (!out.ok) throw new Error(out.reason);
      return (out.result as Place[]).map(p => p.placeId);
    };
    const a = await read('millet restaurant');
    const b = await read('sweets shop');
    expect([...a].sort()).toEqual([...b].sort());
    expect(a).not.toEqual(b);
    expect(await read('millet restaurant')).toEqual(a);
  });

  it('a read with no phrase fails in plain words', async () => {
    const { gateway } = setup();
    const out = await gateway.call({ tenant: TENANT, lead: 'analytics', channel: 'google_places', action: 'read', args: {} });
    expect(out.ok).toBe(false);
  });
});

describe('The activity list says what the places read did', () => {
  it('reads as a plain sentence', () => {
    expect(sentence({ id: 1, lead: 'analytics', channel: 'google_places', action: 'read', outcome: 'done', provider: 'own', note: null, at: new Date() }))
      .toBe('Looked up nearby businesses on Google Maps through Swayu.');
  });
});
