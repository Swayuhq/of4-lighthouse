// Turns the stored rows back into the inbox state. Pure, so the tests can check the bookkeeping without a database.
import type { State, Status } from '../inbox';
import type { Facts } from '../facts';

export type MessageRow = {
  contentId: string;
  thread: string;
  platform: string;
  author: string;
  receivedAt: string;
  body: string;
  stars: number | null;
};

export type EventRow = { id: number; contentId: string; kind: string; replyText: string | null };

const STATUS_KINDS: Record<string, Status> = { waiting: 'waiting', answered: 'answered', spam: 'spam', sent: 'answered' };

export function toState(ownerNames: string[], messages: MessageRow[], events: EventRow[], facts: Record<string, Facts> = {}): State {
  const state: State = { messages: [], thread: {}, ownerNames, status: {}, reply: {}, facts };
  for (const m of messages) {
    state.messages.push({
      id: m.contentId,
      platform: m.platform,
      author: m.author,
      receivedAt: m.receivedAt,
      text: m.body,
      ...(m.stars === null ? {} : { stars: m.stars }),
    });
    state.thread[m.contentId] = m.thread;
  }
  // Events apply in the order they were written. The newest one decides the state.
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    const status = STATUS_KINDS[e.kind];
    if (!status) continue;
    state.status[e.contentId] = status;
    if (e.kind === 'sent') state.reply[e.contentId] = e.replyText ?? '';
    else delete state.reply[e.contentId];
  }
  return state;
}

/** Customer messages the books hold, counted by the database, not by the screen. */
export function customerCount(ownerNames: string[], messages: MessageRow[]): number {
  const owners = new Set(ownerNames);
  return messages.filter(m => !owners.has(m.author)).length;
}
