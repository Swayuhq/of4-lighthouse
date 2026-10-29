// The one shape every source must give. Anything else is refused before it is stored.
import { z } from 'zod';
import type { InboxMessage } from './parse';

export const MessageShape = z
  .object({
    id: z.string().min(1).max(4000),
    platform: z.string().min(1).max(40),
    author: z.string().min(1).max(200),
    receivedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    text: z.string().max(4000),
    stars: z.number().int().min(1).max(5).optional(),
  })
  .strict();

/** Keeps the messages that fit the shape and counts the ones that do not. */
export function checkMessages(messages: unknown[]): { messages: InboxMessage[]; refused: number } {
  const good: InboxMessage[] = [];
  for (const m of messages) {
    const parsed = MessageShape.safeParse(m);
    if (parsed.success) good.push(parsed.data);
  }
  return { messages: good, refused: messages.length - good.length };
}
