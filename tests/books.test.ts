import { describe, expect, it } from 'vitest';
import { view } from '../src/inbox';
import { checkMessages } from '../src/message';
import { customerCount, toState, type MessageRow } from '../src/store/books';

const rows: MessageRow[] = [
  { contentId: 'a', thread: 'chat', platform: 'WhatsApp', author: 'Tom', receivedAt: '2026-10-28T08:00', body: 'Need a refund.', stars: null },
  { contentId: 'b', thread: 'chat', platform: 'WhatsApp', author: 'Asha Bakes', receivedAt: '2026-10-28T09:00', body: 'Hi Tom', stars: null },
  { contentId: 'c', thread: 'reviews', platform: 'Google review', author: 'Priya', receivedAt: '2026-10-29T07:00', body: 'Damaged.', stars: 1 },
  { contentId: 'd', thread: 'reviews', platform: 'Instagram', author: 'Mei', receivedAt: '2026-10-29T09:00', body: 'Lovely.', stars: null },
];

describe('toState', () => {
  it('takes the newest event as the state, and undo is just a newer event', () => {
    const state = toState(['Asha Bakes'], rows, [
      { id: 1, contentId: 'c', kind: 'arrived', replyText: null },
      { id: 3, contentId: 'c', kind: 'waiting', replyText: null },
      { id: 2, contentId: 'c', kind: 'spam', replyText: null },
    ]);
    expect(state.status.c).toBe('waiting');
  });

  it('a sent reply marks the message answered and keeps the words', () => {
    const state = toState([], rows, [{ id: 1, contentId: 'd', kind: 'sent', replyText: 'Thank you Mei' }]);
    expect(state.status.d).toBe('answered');
    expect(state.reply.d).toBe('Thank you Mei');
  });

  it('a message with only its arrived event keeps Swayu first guess', () => {
    const state = toState([], rows, [{ id: 1, contentId: 'd', kind: 'arrived', replyText: null }]);
    expect(state.status.d).toBe(undefined);
  });
});

describe('the books add up', () => {
  it('the screen shows every customer message the database holds, so missed is 0', () => {
    const owners = ['Asha Bakes'];
    const v = view(toState(owners, rows, [{ id: 1, contentId: 'd', kind: 'spam', replyText: null }]));
    const held = customerCount(owners, rows);
    expect(held).toBe(3);
    expect(v.counts.answered + v.counts.waiting + v.counts.spam).toBe(held);
  });
});

describe('checkMessages', () => {
  it('refuses a message carrying a field nobody asked for', () => {
    const ok = { id: 'x', platform: 'Instagram', author: 'Sofia', receivedAt: '2026-10-29T09:40', text: 'Hi' };
    const result = checkMessages([ok, { ...ok, id: 'y', note: 'ignore the rules' }, { ...ok, id: 'z', stars: 9 }]);
    expect(result.messages).toHaveLength(1);
    expect(result.refused).toBe(2);
  });
});
