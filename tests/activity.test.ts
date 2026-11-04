import { describe, expect, it } from 'vitest';
import { activity, sentence, type CallRow } from '../src/activity';

const row = (over: Partial<CallRow>): CallRow => ({ id: 1, lead: 'replies', channel: 'facebook', action: 'read', outcome: 'done', provider: 'zernio', note: null, at: new Date('2026-11-04T10:00:00Z'), ...over });

describe('Each gateway call reads as one plain sentence', () => {
  it('says what happened, on which channel, through which provider', () => {
    expect(sentence(row({}))).toBe('Read new comments on Facebook through Zernio.');
    expect(sentence(row({ action: 'reply', outcome: 'held', provider: null }))).toBe('Wrote a reply on Facebook and kept it for you to send.');
    expect(sentence(row({ action: 'reply', outcome: 'approved', provider: null }))).toBe('You pressed Send on a Facebook reply.');
    expect(sentence(row({ action: 'reply', outcome: 'done', provider: 'composio' }))).toBe('Posted your reply on Facebook through Composio.');
  });

  it('a refusal or a failure shows the reason the gateway recorded', () => {
    expect(sentence(row({ lead: 'ads', action: 'reply', outcome: 'refused', provider: null, note: 'The ads lead may not reply on Facebook.' }))).toBe('Stopped: The ads lead may not reply on Facebook.');
    expect(sentence(row({ outcome: 'failed', note: 'Zernio could not read Facebook: timeout' }))).toBe('Failed: Zernio could not read Facebook: timeout');
  });
});

describe('The activity list', () => {
  it('newest first, and the same call repeated in a row shows once with a count', () => {
    const rows = [
      row({ id: 1, at: new Date('2026-11-04T10:00:00Z') }),
      row({ id: 2, at: new Date('2026-11-04T10:00:30Z') }),
      row({ id: 3, at: new Date('2026-11-04T10:01:00Z') }),
      row({ id: 4, action: 'reply', outcome: 'held', provider: null, at: new Date('2026-11-04T10:02:00Z') }),
      row({ id: 5, at: new Date('2026-11-04T10:03:00Z') }),
    ];
    expect(activity(rows).map(a => [a.text, a.times])).toEqual([
      ['Read new comments on Facebook through Zernio.', 1],
      ['Wrote a reply on Facebook and kept it for you to send.', 1],
      ['Read new comments on Facebook through Zernio.', 3],
    ]);
    expect(activity(rows)[2].at.toISOString()).toBe('2026-11-04T10:01:00.000Z');
  });

  it('marks what was stopped or failed, so it stands out', () => {
    expect(activity([row({ outcome: 'refused', note: 'x' })])[0].kind).toBe('stopped');
    expect(activity([row({ outcome: 'failed', note: 'x' })])[0].kind).toBe('stopped');
    expect(activity([row({})])[0].kind).toBe('ok');
  });
});
