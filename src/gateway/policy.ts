// Who may do what on which channel. Decided at the connector, agreed with Dhruv on 4 Nov 2026.
// Anything the rules do not name is blocked. This table stands in for a policy engine until one is chosen;
// only decide() reads it, so swapping the engine changes this file alone.

export type Decision = 'allow' | 'ask' | 'block';
export type Rule = { lead: string; channel: string; action: string; decision: Decision };

export function decide(rules: readonly Rule[], lead: string, channel: string, action: string): Decision {
  const match = rules.filter(r => r.lead === lead && r.channel === channel && r.action === action);
  if (match.length === 0) return 'block';
  // When two rules disagree, the stricter one wins.
  if (match.some(r => r.decision === 'block')) return 'block';
  if (match.some(r => r.decision === 'ask')) return 'ask';
  return 'allow';
}
