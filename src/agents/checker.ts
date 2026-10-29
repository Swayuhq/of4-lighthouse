// The checker: plain code that stands between the reply agent and the owner.
// A draft may only repeat a number, day or time the customer or the owner already wrote,
// and may only make a promise the owner already makes. Anything else goes back to the fixed draft.

const DAY_WORDS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'today', 'tonight', 'tomorrow', 'weekend', 'morning', 'evening',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
];
const PROMISE_WORDS = ['refund', 'money back', 'free', 'discount', 'voucher', 'coupon', 'compensation'];
const MAX_LENGTH = 600;

const numbers = (s: string) => s.match(/\d+(?:[.,:]\d+)*/g) ?? [];
const words = (s: string) => new Set(s.toLowerCase().match(/\p{L}+/gu) ?? []);

export type Check = { ok: true } | { ok: false; reason: string };

export function checkDraft(draft: string, customerText: string, ownerLines: string[]): Check {
  const text = draft.trim();
  if (!text) return { ok: false, reason: 'the draft is empty' };
  if (text.length > MAX_LENGTH) return { ok: false, reason: 'the draft is too long' };

  const said = [customerText, ...ownerLines].join('\n');
  const knownNumbers = new Set(numbers(said));
  const newNumber = numbers(text).find(n => !knownNumbers.has(n));
  if (newNumber) return { ok: false, reason: `mentions ${newNumber}, which nobody wrote` };

  const knownWords = words(said);
  const newDay = [...words(text)].find(w => DAY_WORDS.includes(w) && !knownWords.has(w));
  if (newDay) return { ok: false, reason: `mentions ${newDay}, which nobody wrote` };

  const owner = ownerLines.join('\n').toLowerCase();
  const promise = PROMISE_WORDS.find(p => text.toLowerCase().includes(p) && !owner.includes(p));
  if (promise) return { ok: false, reason: `promises ${promise}, which you have never offered` };

  return { ok: true };
}
