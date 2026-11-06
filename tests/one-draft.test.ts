// 4 and 5 Nov: the replies lead kept a draft, read "Held" as a refusal and wrote a second one for the same comment.
// The owner sees one draft per message, whatever the model does. Runs against lighthouse_test, never the demo database.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.LIGHTHOUSE_DB_NAME = 'lighthouse_test';
const { holdReply, load, record, startOver, store } = await import('../src/store/db');

const msg = { id: 'instagram:1', platform: 'Instagram', author: 'Priya', receivedAt: '2026-11-05T08:00', text: 'How can I buy this?' };

beforeEach(() => startOver());
afterAll(() => startOver());

describe('One draft per message', () => {
  it('a second draft for a message that already holds one is not kept, so the owner sees the first', async () => {
    await store([msg], 'Instagram');
    await holdReply('instagram:1', 'Thanks for reaching out! I will check and get back to you.');
    await holdReply('instagram:1', 'Thanks for your interest! I will check on this.');
    const { state } = await load();
    expect(state.drafts['instagram:1']).toBe('Thanks for reaching out! I will check and get back to you.');
  });

  it('after the owner acts on a message, a new draft can be kept again', async () => {
    await store([msg], 'Instagram');
    await holdReply('instagram:1', 'First draft.');
    await record('instagram:1', 'waiting');
    await holdReply('instagram:1', 'Second draft.');
    const { state } = await load();
    expect(state.drafts['instagram:1']).toBe('Second draft.');
  });
});
