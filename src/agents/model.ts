// The one path to the model provider. Every agent calls ask(); nothing else talks to OpenAI.
// It reserves the largest possible cost against a daily cap before the call, books the real cost after,
// cancels the request on timeout, and accepts only an answer that fits the agent's strict shape.
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, TENANT } from '../store/db';

// Dollars per million tokens, from swayu-app src/model/prices.ts, read 30 August 2026.
const PRICES = {
  'gpt-5-nano': { input: 0.05, output: 0.4 },
  'gpt-5-mini': { input: 0.25, output: 2 },
} as const;
export type Model = keyof typeof PRICES;

const KEY = process.env.SWAYU_OPENAI_API_KEY?.trim() || '';
delete process.env.SWAYU_OPENAI_API_KEY;
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
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: a.model,
        instructions: a.instructions,
        input: a.input,
        max_output_tokens: a.maxOutputTokens,
        reasoning: { effort: 'minimal' },
        store: false,
        text: { format: { type: 'json_schema', name: a.agent, strict: true, schema } },
      }),
    });
    const body = await res.json();
    const used = body?.usage ? usd(a.model, body.usage.input_tokens ?? 0, body.usage.output_tokens ?? 0) : null;
    if (!res.ok) {
      await book(id, `refused ${res.status}`, used);
      console.error(`[${a.agent}] provider said ${res.status}: ${body?.error?.message ?? 'no message'}`);
      return null;
    }
    const text = (body.output ?? [])
      .flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? [])
      .find((c: { type: string }) => c.type === 'output_text')?.text;
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
