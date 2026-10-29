// The one path to the model provider. Every agent calls ask(); nothing else talks to Gemini.
// It reserves the largest possible cost against a daily cap before the call, books the real cost after,
// cancels the request on timeout, and accepts only an answer that fits the agent's strict shape.
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, TENANT } from '../store/db';

// Paid dollars per million tokens, output including thinking, read 29 October 2026:
// https://ai.google.dev/gemini-api/docs/pricing. A free tier key is still booked at these prices.
const PRICES = {
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
} as const;
// Lowest thinking for every agent. gemini-3.8-flash refused with 503 or timed out on 4 of 4 calls on 29 October 2026.
// https://ai.google.dev/gemini-api/docs/openai read 29 October 2026: Gemini 3 thinking cannot be turned off.
const EFFORT: Record<Model, string> = { 'gemini-3.1-flash-lite': 'minimal', 'gemini-3.8-flash': 'minimal' };
export type Model = keyof typeof PRICES;

const KEY = process.env.SWAYU_GEMINI_API_KEY?.trim() || '';
delete process.env.SWAYU_GEMINI_API_KEY;
const DAILY_CAP_USD = Number(process.env.SWAYU_LIGHTHOUSE_DAILY_CAP_USD ?? '1');

export const agentsOn = () => KEY.length > 0 && DAILY_CAP_USD > 0;

export type Ask<T> = {
  agent: string;
  model: Model;
  instructions: string;
  input: string;
  shape: z.ZodType<T>;
  maxOutputTokens: number;
  timeoutMs?: number;
};

const usd = (model: Model, inputTokens: number, outputTokens: number) =>
  (inputTokens * PRICES[model].input + outputTokens * PRICES[model].output) / 1_000_000;

/** Reserves the call's largest possible cost. Returns null when the daily cap would be passed. */
async function reserve(agent: string, model: Model, maxUsd: number): Promise<number | null> {
  return db.transaction(async tx => {
    // One lock for every reservation, so two calls at once cannot both squeeze under the cap.
    await tx.execute(sql`select pg_advisory_xact_lock(4174)`);
    const rows = await tx.execute(sql`
      insert into model_call (tenant_id, agent, model, reserved_usd)
      select ${TENANT}, ${agent}, ${model}, ${maxUsd}
      where (select coalesce(sum(coalesce(cost_usd, reserved_usd)), 0) from model_call
             where at > now() - interval '1 day') + ${maxUsd} <= ${DAILY_CAP_USD}
      returning id`);
    return rows.length ? Number((rows[0] as { id: string }).id) : null;
  });
}

async function book(id: number, outcome: string, costUsd: number | null) {
  // A call with no usage report may still be billed, so it keeps its reserved maximum.
  await db.execute(sql`update model_call set outcome = ${outcome}, cost_usd = coalesce(${costUsd}, reserved_usd) where id = ${id}`);
}

/** Asks one agent. Returns null on any failure, so the caller falls back to the plain rules. */
export async function ask<T>(a: Ask<T>): Promise<T | null> {
  if (!agentsOn()) return null;
  const inputGuess = Math.ceil((a.instructions.length + a.input.length) / 3);
  const id = await reserve(a.agent, a.model, usd(a.model, inputGuess, a.maxOutputTokens));
  if (id === null) return null;

  const { $schema: _, ...schema } = z.toJSONSchema(a.shape, { target: 'draft-7' }) as Record<string, unknown>;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), a.timeoutMs ?? 45_000);
  try {
    // Google's OpenAI compatible endpoint, the same route swayu-app calls Gemini through.
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: a.model,
        messages: [
          { role: 'system', content: a.instructions },
          { role: 'user', content: a.input },
        ],
        max_tokens: a.maxOutputTokens,
        reasoning_effort: EFFORT[a.model],
        response_format: { type: 'json_schema', json_schema: { name: a.agent, strict: true, schema } },
      }),
    });
    const body = await res.json();
    // Google's total includes thinking tokens that completion_tokens may leave out, so output is total minus prompt.
    const u = body?.usage;
    const used = u ? usd(a.model, u.prompt_tokens ?? 0, Math.max((u.total_tokens ?? 0) - (u.prompt_tokens ?? 0), u.completion_tokens ?? 0)) : null;
    if (!res.ok) {
      await book(id, `refused ${res.status}`, used);
      console.error(`[${a.agent}] provider said ${res.status}: ${body?.error?.message ?? 'no message'}`);
      return null;
    }
    const text: string | undefined = body?.choices?.[0]?.message?.content ?? undefined;
    const parsed = a.shape.safeParse(text ? JSON.parse(text) : null);
    await book(id, parsed.success ? 'ok' : 'wrong shape', used);
    if (!parsed.success) console.error(`[${a.agent}] answer did not fit the shape`);
    return parsed.success ? parsed.data : null;
  } catch (e) {
    await book(id, controller.signal.aborted ? 'timed out' : 'failed', null);
    console.error(`[${a.agent}] ${controller.signal.aborted ? 'timed out' : (e as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
