// A drafting run that fails, like a rate limit from the model, must not cost those messages their draft.
import { describe, expect, it, vi } from 'vitest';
import { emptyState } from '../src/inbox';

const generate = vi.hoisted(() => vi.fn());
vi.mock('../src/agents/model', () => ({ agentsOn: () => true }));
vi.mock('../src/store/db', () => ({
  load: async () => ({ state: { ...emptyState(), messages: [{ id: 'facebook:1', platform: 'Facebook', author: 'Priya', receivedAt: '2026-11-04T08:00', text: 'Do you deliver?' }], thread: { 'facebook:1': 'Facebook' } } }),
  replyRefFor: async () => 'acc|p1|1',
}));
vi.mock('../src/gateway/leads', () => ({ createLead: () => ({ generate }) }));
vi.mock('../src/gateway/policy', () => ({ readPolicies: () => ({}) }));
vi.mock('../src/gateway/setup', () => ({ leadGateway: () => ({}) }));

import { draftNow } from '../src/drafting';

describe('A failed drafting run', () => {
  it('releases its messages, so the next run tries them again', async () => {
    generate.mockRejectedValueOnce(new Error('429 too many requests')).mockResolvedValueOnce({});
    await expect(draftNow()).rejects.toThrow('429');
    await draftNow();
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0]).toContain('"ref":"acc|p1|1"');
  });

  it('a run that worked does not ask for the same message twice', async () => {
    generate.mockClear();
    await draftNow();
    expect(generate).not.toHaveBeenCalled();
  });
});
