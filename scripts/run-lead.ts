// Runs one lead agent once, on the real model, through the shared gateway's lead door.
// Any reply the lead attempts is held for the owner and never sent. Run with: sh scripts/lead.sh replies "<task>"
import { readFileSync } from 'node:fs';
import { createLead } from '../src/gateway/leads';
import { loadPolicies } from '../src/gateway/policy';
import { leadGateway } from '../src/gateway/setup';

const lead = process.argv[2] ?? 'replies';
const task = process.argv[3] ?? 'Read the new Instagram comments, then reply to each one a customer wrote.';
const agent = createLead(loadPolicies(readFileSync('policies/connectors.cedar', 'utf8')), lead, leadGateway());
const out = await agent.generate(task, { maxSteps: 10 });
const calls = out.steps.flatMap(s => s.toolCalls ?? []).map(c => (c as { payload?: { toolName?: string }; toolName?: string }).payload?.toolName ?? (c as { toolName?: string }).toolName);
console.log(JSON.stringify({ lead, task, toolCalls: calls, answer: out.text }, null, 1));
process.exit(0);
