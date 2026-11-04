// Lead agents on Mastra, the framework swayu-app runs. A lead is handed only the connector tools its rules allow,
// and every tool goes through the gateway, which checks the same rules again. A blocked action is never a tool.
import { createOpenAI } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { cappedFetch, type Model } from '../agents/model';
import type { createGateway } from './gateway';
import type { Rule } from './policy';

type Gateway = ReturnType<typeof createGateway>;

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai';
const MODEL: Model = 'gemini-3.1-flash-lite';
const MAX_OUTPUT = 2000;

const READ_INPUT = z.object({}).strict();
const REPLY_INPUT = z.object({
  ref: z.string().min(1).max(512).describe('The ref of the comment or review, exactly as the read tool returned it.'),
  text: z.string().min(1).max(1000).describe('The reply, in the business owner\'s voice.'),
}).strict();

const DESCRIBE: Record<string, string> = {
  read: 'Read the newest customer comments or reviews on',
  reply: 'Reply to one customer comment or review on',
};

/** Tool names for one lead: one per allowed or ask rule, none for a blocked one. */
export function allowedTools(rules: readonly Rule[], lead: string): { channel: string; action: string; name: string }[] {
  return rules
    .filter(r => r.lead === lead && r.decision !== 'block')
    .map(r => ({ channel: r.channel, action: r.action, name: `${r.channel}_${r.action}` }));
}

export function leadTools(rules: readonly Rule[], lead: string, gateway: Gateway) {
  return Object.fromEntries(allowedTools(rules, lead).map(({ channel, action, name }) => [name, createTool({
    id: name,
    description: `${DESCRIBE[action] ?? action} ${channel.replace('_', ' ')}.`,
    inputSchema: action === 'reply' ? REPLY_INPUT : READ_INPUT,
    execute: async input => gateway.call({ lead, channel, action, args: input as Record<string, unknown> }),
  })]));
}

export const LEAD_INSTRUCTIONS: Record<string, string> = {
  replies: 'You answer customers for a small business. Read the new comments and reviews with your tools, then reply to each one that a customer wrote, in a warm, short voice. Never promise a discount or a refund. If a tool refuses, say so in one plain sentence.',
  ads: 'You run ads for a small business. Read what customers say about the business to plan the next ad. You do not reply to customers.',
};

export function createLead(rules: readonly Rule[], lead: string, gateway: Gateway): Agent {
  const provider = createOpenAI({ baseURL: GEMINI, apiKey: 'set-by-capped-fetch', fetch: cappedFetch(`${lead} lead`, MODEL, MAX_OUTPUT) });
  return new Agent({
    id: `${lead}-lead`,
    name: `${lead} lead`,
    instructions: LEAD_INSTRUCTIONS[lead] ?? 'Use your tools to help the business owner.',
    model: provider.chat(MODEL),
    tools: leadTools(rules, lead, gateway),
  });
}
