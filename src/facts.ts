// What the reader agent may say about a message. Closed lists wherever they fit, so a message cannot
// smuggle an instruction through the facts; the two free text fields are short and only ever shown.
import { z } from 'zod';

export const KINDS = ['complaint', 'question', 'order', 'praise', 'spam', 'other'] as const;
export const PROBLEMS = ['none', 'late', 'not_delivered', 'damaged', 'wrong_item', 'refund', 'poor_service', 'other'] as const;

export const FactsShape = z
  .object({
    kind: z.enum(KINDS),
    problem: z.enum(PROBLEMS),
    /** What the customer wants, in a few plain words, or null. */
    asks: z.string().nullable(),
    /** A time the customer needs something by, in their words, such as "Friday", or null. */
    deadline: z.string().nullable(),
  })
  .strict();

export type Facts = z.infer<typeof FactsShape>;

export const PROBLEM_REASON: Record<Exclude<Facts['problem'], 'none'>, string> = {
  late: 'says it is late',
  not_delivered: 'not delivered',
  damaged: 'says damaged',
  wrong_item: 'wrong item',
  refund: 'wants a refund',
  poor_service: 'unhappy with service',
  other: 'a complaint',
};

const clip = (s: string | null, n: number) => (s === null ? null : s.trim().slice(0, n) || null);

/** Shortens the free text fields so the screen and the reply agent never get a long passage from a stranger. */
export function tidy(f: Facts): Facts {
  return { ...f, asks: clip(f.asks, 80), deadline: clip(f.deadline, 30) };
}
