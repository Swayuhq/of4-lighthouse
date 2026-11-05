// Who may do what on which channel, decided by Cedar at the connector level (agreed with Dhruv on 4 Nov 2026).
// Cedar denies anything no policy permits, and a forbid always beats a permit. Swayu adds one thing on top:
// a permit tagged @ask("owner") means the owner approves each call first.
// Cedar 4.14.0 numbers policies policy0, policy1... and ignores @id, so the ask tag is read from each policy's own text.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAuthorized, policySetTextToParts, validate } from '@cedar-policy/cedar-wasm/nodejs';

export type Decision = 'allow' | 'ask' | 'block';
export type Policies = { byId: Record<string, string>; ask: Set<string> };

/** Every channel and action the gateway knows. A lead's tools are the ones Cedar does not block. */
export const CATALOG = [
  { channel: 'facebook', action: 'read' }, { channel: 'facebook', action: 'reply' },
  { channel: 'instagram', action: 'read' }, { channel: 'instagram', action: 'reply' },
  { channel: 'google_reviews', action: 'read' }, { channel: 'google_reviews', action: 'reply' },
  { channel: 'google_reviews', action: 'read_all' },
  { channel: 'whatsapp', action: 'read' }, { channel: 'whatsapp', action: 'reply' },
  { channel: 'google_places', action: 'read' },
] as const;

/**
 * Parses the policy file once and checks it against the schema, which names every lead, channel and action.
 * A file Cedar cannot read, or one naming anything the schema does not, stops the app. Without the schema a
 * misspelled lead matches nothing and is silently blocked.
 */
export function loadPolicies(text: string, schema: string): Policies {
  const parts = policySetTextToParts(text);
  if (parts.type !== 'success') throw new Error(`The connector policy file is invalid: ${parts.errors.map(e => e.message).join('; ')}`);
  const checked = validate({ validationSettings: { mode: 'strict' }, schema, policies: { staticPolicies: Object.fromEntries(parts.policies.map((p, i) => [`policy${i}`, p])) } });
  const problems = checked.type === 'success' ? checked.validationErrors.map(e => e.error.message) : checked.errors.map(e => e.message);
  if (problems.length) throw new Error(`The connector policy file is invalid: ${problems.join('; ')}`);
  const byId: Record<string, string> = {};
  const ask = new Set<string>();
  parts.policies.forEach((policy, i) => {
    const id = `policy${i}`;
    byId[id] = policy;
    if (/@ask\(\s*"owner"\s*\)/.test(policy)) ask.add(id);
  });
  return { byId, ask };
}

/** Reads policies/connectors.cedar and checks it against policies/connectors.cedarschema. */
export function readPolicies(dir = join(process.cwd(), 'policies')): Policies {
  return loadPolicies(readFileSync(join(dir, 'connectors.cedar'), 'utf8'), readFileSync(join(dir, 'connectors.cedarschema'), 'utf8'));
}

export function decide(policies: Policies, lead: string, channel: string, action: string): Decision {
  const answer = isAuthorized({
    principal: { type: 'Lead', id: lead },
    action: { type: 'Action', id: action },
    resource: { type: 'Channel', id: channel },
    context: {},
    policies: { staticPolicies: policies.byId },
    entities: [],
  });
  // Cedar could not evaluate the request: fail closed.
  if (answer.type !== 'success' || answer.response.diagnostics.errors.length > 0) return 'block';
  if (answer.response.decision !== 'allow') return 'block';
  return answer.response.diagnostics.reason.some(id => policies.ask.has(id)) ? 'ask' : 'allow';
}
