// Runs against a real local Postgres database named lighthouse_test, never the demo one.
// Set it up once with: createdb lighthouse_test && psql -d lighthouse_test -f src/store/schema.sql
import type { Facts } from '../src/facts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.LIGHTHOUSE_DB_NAME = 'lighthouse_test';
const { load, loadThemes, saveFacts, saveThemes, startOver, store } = await import('../src/store/db');

const msg = (id: string, text: string) => ({ id, platform: 'WhatsApp', author: 'Tom', receivedAt: '2026-10-28T08:00', text });
const facts: Facts = { kind: 'question', problem: 'none', asks: null, deadline: null };

beforeEach(() => startOver());
afterAll(() => startOver());

describe('Start over', () => {
  it('clears the themes too, so the screen keeps nothing from before', async () => {
    await store([msg('a', 'Park Street?'), msg('b', 'Park Street delivery?')], 'chat');
    await saveThemes([{ title: 'Park Street delivery', ids: ['a', 'b'], count: 2 }]);
    await startOver();
    expect(await loadThemes()).toEqual([]);
    expect((await load()).messages).toEqual([]);
  });

  it('facts the reader finishes after Start over are dropped quietly', async () => {
    await store([msg('a', 'Park Street?')], 'chat');
    await startOver();
    await expect(saveFacts({ a: facts }, 'gemini-3.1-flash-lite')).resolves.toBeUndefined();
    expect((await load()).state.facts).toEqual({});
  });

  it('facts for a message that is still stored are kept', async () => {
    await store([msg('a', 'Park Street?')], 'chat');
    await saveFacts({ a: facts }, 'gemini-3.1-flash-lite');
    expect(Object.keys((await load()).state.facts)).toEqual(['a']);
  });
});
