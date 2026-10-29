import { beforeEach, describe, expect, it, vi } from 'vitest';

const ask = vi.fn();
vi.mock('../src/agents/model', () => ({ ask: (...a: unknown[]) => ask(...a) }));
const { findThemes } = await import('../src/agents/insights');

const msg = (id: string, text: string) => ({ id, platform: 'WhatsApp', author: 'Tom', receivedAt: '2026-10-28T08:00', text });
const messages = [msg('a', 'Do you deliver to Park Street?'), msg('b', 'Park Street delivery?'), msg('c', 'Cake was dry'), msg('d', 'Lovely')];

beforeEach(() => ask.mockReset());

describe('insights agent', () => {
  it('keeps a theme tied to real messages and counts them in code', async () => {
    ask.mockResolvedValue({ themes: [{ title: 'Asking about Park Street delivery', messages: ['m1', 'm2'] }] });
    expect(await findThemes(messages)).toEqual([{ title: 'Asking about Park Street delivery', ids: ['a', 'b'], count: 2 }]);
  });

  it('drops ids the model made up, and themes left with fewer than two messages', async () => {
    ask.mockResolvedValue({ themes: [{ title: 'Dry cake', messages: ['m3', 'm99'] }, { title: 'Delivery', messages: ['m1', 'm2', 'm2'] }] });
    const themes = await findThemes(messages);
    expect(themes.map(t => t.title)).toEqual(['Delivery']);
    expect(themes[0].count).toBe(2);
  });

  it('shortens a long title and returns nothing when the model fails', async () => {
    ask.mockResolvedValue({ themes: [{ title: 'x'.repeat(200), messages: ['m1', 'm2'] }] });
    expect((await findThemes(messages))[0].title.length).toBeLessThanOrEqual(60);
    ask.mockResolvedValue(null);
    expect(await findThemes(messages)).toEqual([]);
  });

  it('does not call the model for fewer than two messages', async () => {
    expect(await findThemes([messages[0]])).toEqual([]);
    expect(ask).not.toHaveBeenCalled();
  });
});
