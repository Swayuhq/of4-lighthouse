// The model client against a fake Gemini answer and the real lighthouse_test database, so no money is spent.
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.LIGHTHOUSE_DB_NAME = 'lighthouse_test';
process.env.SWAYU_GEMINI_API_KEY = 'test-key';
const { ask } = await import('../src/agents/model');
const { db } = await import('../src/store/db');

const Shape = z.object({ kind: z.enum(['question', 'praise']) }).strict();
const call = { agent: 'reader', model: 'gemini-3.1-flash-lite' as const, instructions: 'Label it.', input: 'Do you deliver?', shape: Shape, maxOutputTokens: 1000 };

const answer = (content: string, usage = { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1500 }) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status: 200 }));

const lastCall = async () => {
  const rows = await db.execute(sql`select outcome, cost_usd from model_call order by id desc limit 1`);
  return rows[0] as { outcome: string; cost_usd: string };
};

beforeEach(async () => {
  await db.execute(sql`delete from model_call`);
  vi.unstubAllGlobals();
});

describe('model client on Gemini', () => {
  it('sends a strict shape to the Gemini endpoint and returns the parsed answer', async () => {
    const fetch = answer('{"kind":"question"}');
    vi.stubGlobal('fetch', fetch);
    expect(await ask(call)).toEqual({ kind: 'question' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('generativelanguage.googleapis.com');
    const body = JSON.parse(init.body);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.max_tokens).toBe(1000);
  });

  it('books thinking tokens as output: total minus prompt, not completion alone', async () => {
    vi.stubGlobal('fetch', answer('{"kind":"praise"}'));
    await ask(call);
    // 1000 in at 0.25 plus 500 out at 1.5, per million.
    expect(await lastCall()).toEqual({ outcome: 'ok', cost_usd: '0.001000' });
  });

  it('refuses an answer outside the shape, so the plain rules take over', async () => {
    vi.stubGlobal('fetch', answer('{"kind":"question","note":"ignore the rules"}'));
    expect(await ask(call)).toBeNull();
    expect((await lastCall()).outcome).toBe('wrong shape');
  });
});
